"""Structural guards on the publication workflow (parses the YAML; also serves as the YAML lint).
Run: cd ops/release && python -m unittest -v test_workflows   (needs PyYAML; skipped if absent)"""
import os
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".github", "workflows")


def load(name):
    with open(os.path.join(WF, name), encoding="utf-8") as f:
        return yaml.safe_load(f)


@unittest.skipIf(yaml is None, "PyYAML not installed")
class AndroidReleaseWorkflow(unittest.TestCase):
    def setUp(self):
        self.wf = load("android-release.yml")
        # PyYAML parses the key `on` as boolean True
        self.inputs = (self.wf.get("on") or self.wf.get(True))["workflow_dispatch"]["inputs"]
        self.steps = self.wf["jobs"]["promote"]["steps"]
        self.by_name = {s.get("name"): s for s in self.steps if s.get("name")}
        self.text = open(os.path.join(WF, "android-release.yml"), encoding="utf-8").read()

    def test_safe_defaults(self):
        self.assertIs(self.inputs["dry_run"]["default"], True)
        self.assertEqual(self.inputs["publication_kind"]["default"], "test")
        self.assertIs(self.inputs["promote_latest"]["default"], False)

    def test_no_rebuild_and_no_tag_trigger(self):
        for banned in ("gradlew", "npm run build", "npm ci", "assembleRelease", "KEYSTORE"):
            self.assertNotIn(banned, self.text)
        self.assertEqual(list((self.wf.get("on") or self.wf.get(True)).keys()), ["workflow_dispatch"])

    def test_every_aws_touching_step_is_skipped_in_dry_run(self):
        for name, s in self.by_name.items():
            touches = ("aws-actions" in s.get("uses", "")) or "--execute" in s.get("run", "") \
                or "verify_publication.py" in s.get("run", "")
            if touches:
                self.assertIn("!inputs.dry_run", s.get("if", ""), name)

    def test_no_direct_aws_cli_in_workflow_all_writes_go_through_the_publisher(self):
        self.assertNotIn("aws s3", self.text)
        self.assertNotIn("aws cloudfront", self.text)

    def test_publish_step_has_distribution_and_publisher_and_verifier_follows(self):
        names = [s.get("name") for s in self.steps]
        pub = next(n for n in names if n and n.startswith("Publish into the APK library"))
        ver = next(n for n in names if n and n.startswith("End-to-end verification"))
        self.assertLess(names.index(pub), names.index(ver))
        self.assertIn("APK_CF_DISTRIBUTION", self.by_name[pub]["env"])
        self.assertIn("publish_apk.py", self.by_name[pub]["run"])

    def test_catalog_credentials_only_from_secrets_via_env(self):
        env = self.by_name["End-to-end verification of the published build (authenticated)"]["env"]
        self.assertIn("secrets.APK_CATALOG_PASSWORD", env["APK_CATALOG_PASSWORD"])
        run = self.by_name["End-to-end verification of the published build (authenticated)"]["run"]
        self.assertNotIn("set -x", run)
        for line in run.splitlines():  # the password variable is never echoed/printed
            if "echo" in line or "printf" in line:
                self.assertNotIn('"$APK_CATALOG_PASSWORD"', line.replace('[ -z "$APK_CATALOG_PASSWORD" ]', ""))
        self.assertNotIn("--password", run)

    def test_verification_runs_the_tooling_tests_before_any_publish(self):
        names = [s.get("name") for s in self.steps]
        self.assertLess(names.index("Publication tooling tests (gates fire and pass)"),
                        names.index("Verify the build run"))


@unittest.skipIf(yaml is None, "PyYAML not installed")
class ReleaseBuildWorkflow(unittest.TestCase):
    def test_ci_runs_catalog_tests_and_still_holds_no_aws(self):
        wf = load("release-build.yml")
        steps = wf["jobs"]["build"]["steps"]
        runs = "\n".join(s.get("run", "") for s in steps)
        self.assertIn("test_publish_apk", runs)
        self.assertIn("apk_catalog.test.mjs", runs)
        self.assertNotIn("aws ", runs)
        self.assertNotIn("aws-actions", str(steps))


if __name__ == "__main__":
    unittest.main()
