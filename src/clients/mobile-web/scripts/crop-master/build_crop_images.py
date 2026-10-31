"""Publish the founder's crop pictures for the app, matched to their crop BY MHCR ID.

spec: plr-d10-redesign-real-integration-2026-10-25 (I18, founder rulings (b)/(c) 2026-10-26).

For every picture in the founder's folder (file names like
`MHCR-0001__Rice__भात__Paddy__Rice_(paddy)__तांदूळ__धान__साळ.webp`):
  1. the MHCR id at the start of the file name says which crop it is;
  2. the English and Marathi names right after it are checked against that id's row in the crop master sheet
     (canonical names; spaces are written as "_" in file names);
  3. only a picture whose id is known, whose names match, and whose id has exactly ONE picture is published.
     Everything else is REPORTED and NOT published: a picture is never shown on the wrong crop.
Published pictures are written as compressed WebP renditions named by id only:
    <out>/crop-images/v1/MHCR-0001-480.webp   (tiles)
    <out>/crop-images/v1/MHCR-0001-960.webp   (the chosen crop)
plus `crop-images-report.json` beside that folder, never inside the served one (published, mismatched, unknown id, duplicate, missing, unreadable). The founder's files are
only read, never changed. Re-run whenever he sends more pictures:

    python scripts/crop-master/build_crop_images.py --images "G:\\APP_Image assents\\CROP Images" --out OUT_DIR

Encoding uses Pillow when it is installed, else ffmpeg (on PATH). Tests: see test_build_crop_images.py.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_crop_master as gcm  # noqa: E402  (the sheet reader lives there, once)

DEFAULT_IMAGES = r"G:\APP_Image assents\CROP Images"
FOLDER = os.path.join("crop-images", "v1")
SIZES = (480, 960)
PICTURE_EXT = {".webp", ".png", ".jpg", ".jpeg"}
ID_AT_START = re.compile(r"^(MHCR-\d{4})(?:__|\.|$)")


def name_key(value: str) -> str:
    """A name as it is compared: NFC, spaces and underscores alike, no case."""
    return re.sub(r"[\s_]+", " ", unicodedata.normalize("NFC", value or "")).strip().lower()


def plan_images(file_names: list[str], master: dict[str, dict]) -> tuple[dict[str, str], dict]:
    """Which file publishes which id, and the report. `master` maps id -> {"en", "mr"} (the sheet's canonical names)."""
    report: dict[str, list] = {"published": [], "nameMismatch": [], "unknownId": [], "noId": [], "duplicate": [], "missing": []}
    by_id: dict[str, list[str]] = {}
    for name in sorted(file_names):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in PICTURE_EXT:
            continue  # prompts, notes and other files beside the pictures
        m = ID_AT_START.match(stem)
        if not m:
            report["noId"].append(name)
            continue
        by_id.setdefault(m.group(1), []).append(name)

    plan: dict[str, str] = {}
    for cid, names in sorted(by_id.items()):
        if cid not in master:
            report["unknownId"].extend(names)
            continue
        if len(names) > 1:
            report["duplicate"].append({"id": cid, "files": names})
            continue
        name = names[0]
        parts = os.path.splitext(name)[0].split("__")
        row = master[cid]
        en_ok = len(parts) > 1 and name_key(parts[1]) == name_key(row["en"])
        mr_ok = len(parts) > 2 and name_key(parts[2]) == name_key(row["mr"])
        if not (en_ok and mr_ok):
            report["nameMismatch"].append({
                "id": cid, "file": name,
                "fileNames": [p.replace("_", " ") for p in parts[1:3]], "sheetNames": [row["en"], row["mr"]],
            })
            continue
        plan[cid] = name
        report["published"].append(cid)
    report["missing"] = sorted(cid for cid in master if cid not in plan and cid not in by_id)
    return plan, report


def _encode_pillow(src: str, dst: str, width: int) -> None:
    from PIL import Image  # type: ignore

    with Image.open(src) as im:
        im = im.convert("RGB")
        height = max(1, round(im.height * width / im.width))
        im.resize((width, height), Image.LANCZOS).save(dst, "WEBP", quality=72, method=6)


def _encode_ffmpeg(src: str, dst: str, width: int) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", f"scale={width}:-2:flags=lanczos",
         "-c:v", "libwebp", "-quality", "72", "-compression_level", "6", dst],
        check=True,
    )


def default_encoder():
    try:
        import PIL  # type: ignore  # noqa: F401
        return _encode_pillow
    except ImportError:
        if shutil.which("ffmpeg"):
            return _encode_ffmpeg
        raise SystemExit("Neither Pillow nor ffmpeg is available to write WebP.")


def publish(plan: dict[str, str], images_dir: str, out_dir: str, report: dict, encode=None) -> None:
    """Write the renditions of every planned picture (only those); a picture that cannot be read is reported."""
    encode = encode or default_encoder()
    target = os.path.join(out_dir, FOLDER)
    os.makedirs(target, exist_ok=True)
    report.setdefault("unreadable", [])
    for cid, name in sorted(plan.items()):
        try:
            for size in SIZES:
                encode(os.path.join(images_dir, name), os.path.join(target, f"{cid}-{size}.webp"), size)
        except Exception as exc:  # a broken file must not stop the others, and is never half-published
            for size in SIZES:
                partial = os.path.join(target, f"{cid}-{size}.webp")
                if os.path.exists(partial):
                    os.remove(partial)
            report["published"].remove(cid)
            report["unreadable"].append({"id": cid, "file": name, "error": str(exc)})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--xlsx", default=gcm.DEFAULT_XLSX)
    ap.add_argument("--images", default=DEFAULT_IMAGES)
    ap.add_argument("--out", required=True, help="folder that will hold crop-images/v1/")
    args = ap.parse_args(argv)

    crops, sheet_report = gcm.build_master(gcm.read_rows(args.xlsx))
    if sheet_report["errors"]:
        print("The sheet has errors; fix them first:", sheet_report["errors"], file=sys.stderr)
        return 1
    master = {c["id"]: {"en": c["en"], "mr": c["mr"]} for c in crops}
    plan, report = plan_images(os.listdir(args.images), master)
    publish(plan, args.images, args.out, report)
    report["counts"] = {k: len(v) for k, v in report.items() if isinstance(v, list)}
    with open(os.path.join(args.out, "crop-images-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(report["counts"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
