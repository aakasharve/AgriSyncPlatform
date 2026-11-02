"""Offline checks of deploy.py's safety rules. No AWS call is made: aws, git and the build are replaced with stubs.

Run:  python -m unittest test_deploy      (from this folder)
"""
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy  # noqa: E402

CLEAN_PAGE = '<!doctype html><html><head></head><body><main>ok</main></body></html>'
BUILT = {"index.html": CLEAN_PAGE, "en/index.html": CLEAN_PAGE, "vision/index.html": CLEAN_PAGE, "robots.txt": "x",
         "sitemap.xml": "x", "llms.txt": "x", "analytics.js": "x", "assets/css/site.css": "x", "assets/js/site.js": "x",
         "assets/img/og-default.png": "x"}


def stopped(test, fn, *args):
    """Runs fn and returns the STOPPED message it exits with."""
    with test.assertRaises(SystemExit) as stop:
        fn(*args)
    return str(stop.exception.code)


class BuildChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.started = time.time()
        for rel, text in BUILT.items():
            self.write(rel, text)
        patcher = mock.patch.object(deploy, "OUT", self.out)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def write(self, rel, text, age=0):
        p = self.out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        if age:
            os.utime(p, (time.time() - age, time.time() - age))

    def test_a_clean_publish_build_passes(self):
        self.assertEqual(set(deploy.check_build(self.started)), set(BUILT))

    def test_preview_notes_stop_it(self):
        self.write("fpo.html", '<p class="pv-note">draft</p>')
        self.write("en/fpo.html", '<div class="preview-bar">preview</div>')
        message = stopped(self, deploy.check_build, self.started)
        self.assertIn("fpo.html: has preview notes", message)
        self.assertIn("en/fpo.html: has preview notes", message)

    def test_design_previews_stop_it(self):
        self.write("_home-v2.html", CLEAN_PAGE)
        self.assertIn("_home-v2.html: a design preview", stopped(self, deploy.check_build, self.started))

    def test_a_page_left_over_from_an_earlier_build_stops_it(self):
        self.write("get-app.html", CLEAN_PAGE, age=3600)
        self.assertIn("get-app.html: not written by this build", stopped(self, deploy.check_build, self.started))

    def test_static_v2_pages_in_the_build_stop_it(self):
        for rel in ("privacy/index.html", "privacy-mr/index.html", "delete-account/index.html", "googlef604748e4173278f.html"):
            self.write(rel, CLEAN_PAGE)
        message = stopped(self, deploy.check_build, self.started)
        for rel in ("privacy/index.html", "privacy-mr/index.html", "delete-account/index.html", "googlef604748e4173278f.html"):
            self.assertIn(f"{rel}: owned by Static_V2", message)

    def test_a_file_no_step_uploads_stops_it(self):
        self.write("en/data.json", "{}")
        self.assertIn("en/data.json: no upload step", stopped(self, deploy.check_build, self.started))

    def test_a_missing_home_page_stops_it(self):
        (self.out / "index.html").unlink()
        self.assertIn("index.html: missing", stopped(self, deploy.check_build, self.started))


class UploadSteps(unittest.TestCase):
    def test_each_kind_of_file_has_the_step_the_founder_set(self):
        self.assertEqual(deploy.step_of("assets/css/site.css"), 0)
        self.assertEqual(deploy.step_of("assets/js/site.js"), 0)
        self.assertEqual(deploy.step_of("assets/blog/x.jpg"), 1)
        self.assertEqual(deploy.step_of("llms-full.txt"), 2)
        self.assertEqual(deploy.step_of("sitemap.xml"), 3)
        self.assertEqual(deploy.step_of("blog/index.html"), 4)
        self.assertEqual(len(deploy.STEPS) - 1, deploy.step_of("index.html"), "pages must be the last step")

    def test_every_upload_never_deletes_and_excludes_the_static_v2_files_after_its_includes(self):
        done = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        with mock.patch.object(deploy.subprocess, "run", return_value=done) as run:
            for i in range(len(deploy.STEPS)):
                deploy.sync(i, False, {})
        self.assertEqual(run.call_count, len(deploy.STEPS))
        for call in run.call_args_list:
            args = call.args[0]
            self.assertNotIn("--delete", args)
            last_include = max((n for n, a in enumerate(args) if a == "--include"), default=-1)
            for protected in ("privacy/*", "privacy-mr/*", "delete-account/*", "googlef604748e4173278f.html"):
                self.assertGreater(args.index(protected), last_include, f"{protected} must come after every --include")

    def run_sync_with_output(self, stdout, files):
        done = subprocess.CompletedProcess([], 0, stdout=stdout, stderr="")
        with mock.patch.object(deploy.subprocess, "run", return_value=done):
            return deploy.sync(4, True, files)

    def test_aws_output_naming_a_static_v2_page_stops_it(self):
        out = "(dryrun) upload: privacy\\index.html to s3://shramsafal-marketing-prod/privacy/index.html\n"
        self.assertIn("Static_V2 owns", stopped(self, self.run_sync_with_output, out, {"privacy/index.html": None}))

    def test_aws_output_with_a_delete_stops_it(self):
        out = "(dryrun) delete: s3://shramsafal-marketing-prod/old.html\n"
        self.assertIn("unexpected aws output", stopped(self, self.run_sync_with_output, out, {}))

    def test_a_file_sent_by_the_wrong_step_stops_it(self):
        out = "(dryrun) upload: robots.txt to s3://shramsafal-marketing-prod/robots.txt\n"
        self.assertIn("belongs to another step", stopped(self, self.run_sync_with_output, out, {"robots.txt": None}))


class Publishing(unittest.TestCase):
    def main_with(self, argv, dirty=""):
        def no_aws(*args, **kwargs):
            raise AssertionError("reached AWS")

        git = lambda *args: dirty if args[0] == "status" else "abc1234"  # noqa: E731
        with mock.patch.object(sys, "argv", ["deploy.py", *argv]), mock.patch.object(deploy, "AWS", "aws"), \
                mock.patch.object(deploy, "git", git), mock.patch.object(deploy, "build", side_effect=AssertionError("built")), \
                mock.patch.object(deploy, "aws", no_aws), mock.patch.object(deploy.subprocess, "run", no_aws):
            return stopped(self, deploy.main)

    def test_publish_needs_exactly_confirm_publish(self):
        self.assertIn("--confirm PUBLISH", self.main_with(["--confirm", "publish"]))
        self.assertIn("--confirm PUBLISH", self.main_with(["--publish"]))

    def test_uncommitted_source_stops_a_publish_before_it_builds(self):
        message = self.main_with(["--confirm", "PUBLISH"], dirty=" M src/clients/Website/site-src/index.html")
        self.assertIn("uncommitted changes", message)


if __name__ == "__main__":
    unittest.main()
