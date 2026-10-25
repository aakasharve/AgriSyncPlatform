"""Tests for install_artemis.py. Run: cd ops/device-testing/artemis && python3 -m unittest -v test_install_artemis

No network, no phone, no Artemis checkout: every test works in a temporary git repo, so the
fail-closed rule (write only what git ignores) is exercised against real `git check-ignore`.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import install_artemis as ia  # noqa: E402

GITIGNORE = ".mcp.json\n.claude/\n/_COFOUNDER/\n"


def make_repo(root, cofounder=True):
    root = Path(root)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
    if cofounder:
        skills = root / "_COFOUNDER" / "OS" / "Skills"
        skills.mkdir(parents=True)
        (skills / "INDEX.md").write_text(
            "# Skills\n\n| Skill | Description |\n|---|---|\n| `webapp-testing` | Playwright |\n",
            encoding="utf-8")
    return root


class McpEntryTests(unittest.TestCase):
    def test_paths_per_os(self):
        self.assertTrue(ia.mcp_entry("C:/a", windows=True)["command"].endswith("python.exe"))
        posix = ia.mcp_entry("/opt/artemis", windows=False)
        self.assertEqual(posix["command"], str(Path("/opt/artemis/.venv/bin/python")))
        self.assertEqual(posix["args"], ["-m", "mcp_server"])
        self.assertEqual(posix["env"]["PYTHONPATH"], "/opt/artemis")


class MergeMcpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / ".mcp.json"
        self.entry = ia.mcp_entry("/opt/artemis", windows=False)

    def tearDown(self):
        self.tmp.cleanup()

    def test_creates_file_when_missing(self):
        self.assertTrue(ia.merge_mcp(self.file, self.entry))
        self.assertEqual(json.loads(self.file.read_text())["mcpServers"]["artemis"], self.entry)

    def test_keeps_other_servers_and_is_idempotent(self):
        self.file.write_text(json.dumps({"mcpServers": {"playwright": {"command": "npx"}}}))
        self.assertTrue(ia.merge_mcp(self.file, self.entry))
        self.assertFalse(ia.merge_mcp(self.file, self.entry))
        servers = json.loads(self.file.read_text())["mcpServers"]
        self.assertEqual(set(servers), {"playwright", "artemis"})

    def test_invalid_json_is_never_overwritten(self):
        self.file.write_text("{ broken")
        with self.assertRaises(ia.InstallError):
            ia.merge_mcp(self.file, self.entry)
        self.assertEqual(self.file.read_text(), "{ broken")

    def test_remove_keeps_other_servers(self):
        self.file.write_text(json.dumps({"mcpServers": {"playwright": {}, "artemis": {}}}))
        self.assertTrue(ia.remove_mcp(self.file))
        self.assertFalse(ia.remove_mcp(self.file))
        self.assertEqual(set(json.loads(self.file.read_text())["mcpServers"]), {"playwright"})


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.index = Path(self.tmp.name) / "INDEX.md"
        self.index.write_text("# Skills\n| `a` | first |\n| `b` | second |\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_append_then_replace_not_duplicate(self):
        ia.update_index(self.index, "real-phone-test", "v1")
        ia.update_index(self.index, "real-phone-test", r"v2 with \d backslash")
        text = self.index.read_text()
        self.assertEqual(text.count("`real-phone-test`"), 1)
        self.assertIn(r"v2 with \d backslash", text)

    def test_remove_row_leaves_neighbours(self):
        ia.update_index(self.index, "real-phone-test", "desc")
        ia.remove_index_row(self.index, "real-phone-test")
        self.assertEqual(self.index.read_text(), "# Skills\n| `a` | first |\n| `b` | second |\n")


class EnvKeyTests(unittest.TestCase):
    def check(self, content):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            env.write_text(content, encoding="utf-8")
            return ia.env_key_status(env)

    def test_empty_quoted_and_commented_count_as_missing(self):
        self.assertFalse(any(self.check("GEMINI_API_KEY=\nGOOGLE_API_KEY=''\n").values()))
        self.assertFalse(any(self.check("GEMINI_API_KEY=  # paste here\n").values()))

    def test_value_counts_as_set(self):
        self.assertTrue(self.check("GEMINI_API_KEY=abc123\n")["GEMINI_API_KEY"])

    def test_missing_file(self):
        self.assertFalse(any(ia.env_key_status(Path("/nonexistent/.env")).values()))


class PrivacyGuardTests(unittest.TestCase):
    def test_ignored_paths_pass_and_public_paths_refuse(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d)
            ia.assert_private(repo, [repo / ".mcp.json", repo / ".claude" / "skills" / "x",
                                     repo / "_COFOUNDER" / "OS" / "Skills" / "x"])
            with self.assertRaises(ia.InstallError):
                ia.assert_private(repo, [repo / "docs" / "leak.md"])

    def test_tracked_file_counts_as_public_even_if_pattern_matches(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d)
            (repo / ".mcp.json").write_text("{}")
            subprocess.run(["git", "-C", str(repo), "add", "-f", ".mcp.json"], check=True)
            with self.assertRaises(ia.InstallError):
                ia.assert_private(repo, [repo / ".mcp.json"])


class SkillInstallTests(unittest.TestCase):
    def test_real_skill_frontmatter_parses(self):
        name, desc = ia.skill_meta(ia.SKILL_SRC / "SKILL.md")
        self.assertEqual(name, "real-phone-test")
        self.assertIn("Artemis", desc)
        self.assertTrue((ia.SKILL_SRC / "journeys.md").exists())

    def test_with_cofounder_installs_canonical_index_and_pointer(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d)
            for _ in range(2):
                _, warning = ia.install_skill(repo)
            self.assertIsNone(warning)
            p = ia.skill_paths(repo)
            self.assertTrue((p["canonical"] / "journeys.md").exists())
            self.assertEqual(p["index"].read_text().count("`real-phone-test`"), 1)
            self.assertIn("`webapp-testing`", p["index"].read_text())
            pointer = (p["claude"] / "SKILL.md").read_text()
            self.assertIn("_COFOUNDER/OS/Skills/real-phone-test/SKILL.md", pointer)
            self.assertEqual(ia.skill_meta(p["claude"] / "SKILL.md")[0], "real-phone-test")

    def test_without_cofounder_falls_back_and_warns(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d, cofounder=False)
            _, warning = ia.install_skill(repo)
            self.assertIn("not found", warning)
            self.assertTrue((repo / ".claude" / "skills" / "real-phone-test" / "journeys.md").exists())
            self.assertFalse((repo / "_COFOUNDER").exists())

    def test_remove_skill_undoes_everything(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d)
            ia.install_skill(repo)
            ia.remove_skill(repo)
            p = ia.skill_paths(repo)
            self.assertFalse(p["canonical"].exists() or p["claude"].exists())
            self.assertNotIn("real-phone-test", p["index"].read_text())


class CheckAndMainTests(unittest.TestCase):
    def test_check_reports_gaps_and_never_prints_the_key(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(Path(d) / "repo")
            artemis = Path(d) / "artemis"
            artemis.mkdir()
            (artemis / ".env").write_text("GEMINI_API_KEY=SECRET-VALUE-123\n")
            ia.merge_mcp(repo / ".mcp.json", ia.mcp_entry(artemis))
            ia.install_skill(repo)
            rows = {label: (ok, detail) for label, ok, detail in ia.check(repo, artemis)}
            self.assertTrue(rows["Gemini key in .env"][0])
            self.assertTrue(rows["MCP server in .mcp.json"][0])
            self.assertTrue(rows["Skill real-phone-test"][0])
            self.assertFalse(rows["Pinned commit"][0])
            self.assertFalse(rows["Python environment"][0])
            self.assertNotIn("SECRET-VALUE-123", json.dumps(rows))

    def test_main_refuses_artemis_inside_the_repo(self):
        with tempfile.TemporaryDirectory() as d:
            repo = make_repo(d)
            original = ia.repo_root
            ia.repo_root = lambda: repo
            try:
                self.assertEqual(ia.main(["--artemis-dir", str(repo / "artemis"), "--skip-deps"]), 2)
            finally:
                ia.repo_root = original
            self.assertFalse((repo / "artemis").exists())
            self.assertFalse((repo / ".mcp.json").exists())


if __name__ == "__main__":
    unittest.main()
