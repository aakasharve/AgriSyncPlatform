"""Tests for build_crop_images.py, on a temp COPY (never the founder's folder).
Run: python -m unittest discover -s scripts/crop-master -p "test_*.py"
"""
import os
import shutil
import tempfile
import unicodedata
import unittest

import build_crop_images as bci

MASTER = {
    "MHCR-0001": {"en": "Rice", "mr": "भात"},
    "MHCR-0002": {"en": "Wheat", "mr": "गहू"},
    "MHCR-0003": {"en": "Sorghum", "mr": "ज्वारी"},
    "MHCR-0116": {"en": "Grapes", "mr": "द्राक्ष"},
    "MHCR-0117": {"en": "Pomegranate", "mr": "डाळिंब"},
}


def fake_encode(src: str, dst: str, width: int) -> None:
    """Copies the source bytes with the width stamped in front, so a test can see exactly which file went where."""
    with open(src, "rb") as f:
        data = f.read()
    with open(dst, "wb") as f:
        f.write(f"{width}:".encode() + data)


class PlanAndPublish(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.images = os.path.join(self.dir, "images")
        self.out = os.path.join(self.dir, "out")
        os.makedirs(self.images)
        self.files = {
            "MHCR-0001__Rice__भात__Paddy__तांदूळ.webp": b"RICE",
            # names say Wheat, id says Sorghum: a mismatch, never published as either
            "MHCR-0003__Wheat__गहू.webp": b"WHEAT-UNDER-SORGHUM-ID",
            # two pictures for Grapes: a duplicate, neither published
            "MHCR-0116__Grapes__द्राक्ष.webp": b"GRAPES-A",
            "MHCR-0116__Grapes__द्राक्ष__Grape.png": b"GRAPES-B",
            # an id the sheet does not have
            "MHCR-0999__Mystery__गूढ.webp": b"???",
            # not a picture: ignored
            "MHCR-0002.prompt.txt": b"prompt",
            # no id at all
            "pomegranate_card.webp": b"POM",
        }
        for name, data in self.files.items():
            with open(os.path.join(self.images, name), "wb") as f:
                f.write(data)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_all(self):
        plan, report = bci.plan_images(os.listdir(self.images), MASTER)
        bci.publish(plan, self.images, self.out, report, encode=fake_encode)
        return plan, report

    def test_each_problem_is_reported(self):
        _, report = self.run_all()
        self.assertEqual(report["published"], ["MHCR-0001"])
        self.assertEqual([m["id"] for m in report["nameMismatch"]], ["MHCR-0003"])
        self.assertEqual(report["nameMismatch"][0]["sheetNames"], ["Sorghum", "ज्वारी"])
        self.assertEqual([d["id"] for d in report["duplicate"]], ["MHCR-0116"])
        self.assertEqual(report["unknownId"], ["MHCR-0999__Mystery__गूढ.webp"])
        self.assertEqual(report["noId"], ["pomegranate_card.webp"])
        # Wheat has only a prompt file, Pomegranate nothing: both missing
        self.assertEqual(report["missing"], ["MHCR-0002", "MHCR-0117"])

    def test_a_picture_is_never_attached_to_the_wrong_id(self):
        self.run_all()
        target = os.path.join(self.out, bci.FOLDER)
        self.assertEqual(sorted(os.listdir(target)), ["MHCR-0001-480.webp", "MHCR-0001-960.webp"])
        with open(os.path.join(target, "MHCR-0001-480.webp"), "rb") as f:
            self.assertEqual(f.read(), b"480:RICE")
        with open(os.path.join(target, "MHCR-0001-960.webp"), "rb") as f:
            self.assertEqual(f.read(), b"960:RICE")

    def test_names_compare_without_case_spacing_or_unicode_form(self):
        decomposed = unicodedata.normalize("NFD", "MHCR-0117__pomegranate__डाळिंब.webp")
        plan, report = bci.plan_images([decomposed], MASTER)
        self.assertEqual(plan, {"MHCR-0117": decomposed})
        self.assertEqual(report["nameMismatch"], [])

    def test_an_unreadable_picture_is_reported_and_left_unpublished(self):
        def broken(src, dst, width):
            if width == 960:
                raise ValueError("cannot decode")
            fake_encode(src, dst, width)

        plan, report = bci.plan_images(os.listdir(self.images), MASTER)
        bci.publish(plan, self.images, self.out, report, encode=broken)
        self.assertEqual(report["published"], [])
        self.assertEqual([u["id"] for u in report["unreadable"]], ["MHCR-0001"])
        self.assertEqual(os.listdir(os.path.join(self.out, bci.FOLDER)), [])

    def test_the_founders_folder_is_only_read(self):
        before = {n: os.path.getmtime(os.path.join(self.images, n)) for n in os.listdir(self.images)}
        self.run_all()
        after = {n: os.path.getmtime(os.path.join(self.images, n)) for n in os.listdir(self.images)}
        self.assertEqual(before, after)

    def test_real_encoder_writes_webp(self):
        try:
            encode = bci.default_encoder()
        except SystemExit:
            self.skipTest("no WebP encoder on this machine")
        src = os.path.join(self.dir, "src.png")
        try:
            from PIL import Image  # type: ignore
            Image.new("RGB", (2048, 768), (40, 120, 60)).save(src)
        except ImportError:
            Image = None
            if not bci.shutil.which("ffmpeg"):
                self.skipTest("neither Pillow nor ffmpeg can make the test picture")
            bci.subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=2048x768",
                                "-frames:v", "1", src], check=True)
        dst = os.path.join(self.dir, "x-480.webp")
        encode(src, dst, 480)
        with open(dst, "rb") as f:
            head = f.read(12)
        self.assertEqual((head[:4], head[8:12]), (b"RIFF", b"WEBP"))
        if Image is not None:
            with Image.open(dst) as im:
                self.assertEqual(im.size, (480, 180))


if __name__ == "__main__":
    unittest.main()
