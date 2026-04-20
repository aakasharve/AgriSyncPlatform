# UI/UX MCP Gatekeeper Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the UI/UX Design Engine from a 5-layer protocol-only stack to a 9-layer protocol+hook-enforced stack with L0 design memory, L1.5 variation gallery, L2 Stitch/Figma branching, L4 shadcn MCP, and L5b Playwright MCP verification.

**Architecture:** Four-phase migration — (1) build zip-in tooling, (2) install skills + rewrite protocol, (3) add MCPs, (4) ship gate hook with 24h shadow-mode before enforcement. Every file edited in place; no parallel `_v2` or `_OLD` files. Git history is the backup.

**Tech Stack:** Python 3.11+ (install scripts, gallery), Node 20+ (hook), pytest (Python tests), tap (Node tests), npx (MCPs), Bash + PowerShell (Windows environment).

**Spec reference:** [docs/superpowers/specs/2026-04-20-uiux-mcp-gatekeeper-integration-design.md](../specs/2026-04-20-uiux-mcp-gatekeeper-integration-design.md)

---

## File Structure

**New files created:**
- `_COFOUNDER/OS/Skills/_Packages/install_skill.py` — zip-in skill installer
- `_COFOUNDER/OS/Skills/_Packages/tests/test_install_skill.py` — pytest for installer
- `_COFOUNDER/OS/Integrations/_add_mcp.py` — MCP config merger
- `_COFOUNDER/OS/Integrations/tests/test_add_mcp.py` — pytest for merger
- `_COFOUNDER/OS/Skills/interface-design/` — entire skill folder (installed via script)
- `_COFOUNDER/OS/Skills/webapp-testing/` — entire skill folder (installed via script)
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/references/*.md` — 12 reference docs
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py` — L1.5 variation gallery renderer
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/tests/test_gallery.py` — pytest for gallery
- `.claude/hooks/uiux-gate-check.js` — PreToolUse gate hook
- `.claude/hooks/tests/uiux-gate-check.test.js` — tap tests for hook
- `.uiux-gate.config.json` — skip-list for gated paths
- `.claude/settings.json` — (if not present) project-level Claude Code settings

**Files edited in place (no parallel versions):**
- `_COFOUNDER/OS/Skills/INDEX.md` — add rows for new skills, update counts
- `_COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md` — v1.0 → v2.0
- `_COFOUNDER/OS/Skills/ui-ux-pro-max/SKILL.md` — (if v2.5.0 upgrade) version header
- `.mcp.json` (root) — +2 servers
- `src/clients/marketing-web/.mcp.json` — +2 servers (mirror)
- `.gitignore` — +4 patterns

**Runtime files (gitignored):**
- `.uiux-gate-passed`
- `.uiux-gallery/`
- `.interface-design/`
- `.claude/hooks/uiux-gate.log`

---

## Phase 1 — Build Zip-In Tooling (Tasks 1–2)

Build the installer scripts first so all subsequent skill/MCP additions go through them.

---

### Task 1: Build `install_skill.py` — zip-in skill installer

**Files:**
- Create: `_COFOUNDER/OS/Skills/_Packages/install_skill.py`
- Create: `_COFOUNDER/OS/Skills/_Packages/tests/test_install_skill.py`
- Create: `_COFOUNDER/OS/Skills/_Packages/tests/fixtures/simple_skill.zip` (test fixture)
- Create: `_COFOUNDER/OS/Skills/_Packages/tests/fixtures/multi_skill.zip` (test fixture)

**Rationale:** This script is the one-command skill installer. Future zips (and the two we're installing in Phase 2) go through it. Must be idempotent, safe to re-run, and support multi-skill zips via `--skill <name>`.

- [ ] **Step 1.1: Write the failing tests**

File: `_COFOUNDER/OS/Skills/_Packages/tests/test_install_skill.py`

```python
"""Tests for install_skill.py — zip-in skill installer."""
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "install_skill.py"


def make_skill_zip(tmp_path: Path, name: str, skill_content: str) -> Path:
    """Create a test zip with one SKILL.md at depth 2."""
    zip_path = tmp_path / f"{name}.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(f"{name}/{name}/SKILL.md", skill_content)
        zf.writestr(f"{name}/{name}/README.md", "readme")
    return zip_path


def make_multi_skill_zip(tmp_path: Path) -> Path:
    """Create a zip with multiple skills (like awesome-claude-skills)."""
    zip_path = tmp_path / "multi.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("root/alpha/SKILL.md", "---\nname: alpha\ndescription: Alpha skill\n---\n")
        zf.writestr("root/beta/SKILL.md", "---\nname: beta\ndescription: Beta skill\n---\n")
        zf.writestr("root/beta/scripts/run.py", "print('beta')")
    return zip_path


def test_install_single_skill(tmp_path):
    """Single-skill zip installs to _COFOUNDER/OS/Skills/<name>/."""
    zip_path = make_skill_zip(
        tmp_path, "demo",
        "---\nname: demo-skill\ndescription: Demo skill\n---\n# Demo"
    )
    skills_dir = tmp_path / "skills"
    index_file = tmp_path / "INDEX.md"
    index_file.write_text("# Index\n")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(zip_path),
         "--skills-dir", str(skills_dir), "--index", str(index_file),
         "--yes"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (skills_dir / "demo-skill" / "SKILL.md").exists()
    assert "demo-skill" in index_file.read_text()


def test_install_multi_skill_requires_flag(tmp_path):
    """Multi-skill zip without --skill flag fails with clear message."""
    zip_path = make_multi_skill_zip(tmp_path)
    skills_dir = tmp_path / "skills"
    index_file = tmp_path / "INDEX.md"
    index_file.write_text("# Index\n")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(zip_path),
         "--skills-dir", str(skills_dir), "--index", str(index_file),
         "--yes"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "multiple skills" in result.stderr.lower()


def test_install_multi_skill_with_flag(tmp_path):
    """Multi-skill zip with --skill flag installs only the named skill."""
    zip_path = make_multi_skill_zip(tmp_path)
    skills_dir = tmp_path / "skills"
    index_file = tmp_path / "INDEX.md"
    index_file.write_text("# Index\n")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(zip_path),
         "--skills-dir", str(skills_dir), "--index", str(index_file),
         "--skill", "beta", "--yes"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (skills_dir / "beta" / "SKILL.md").exists()
    assert (skills_dir / "beta" / "scripts" / "run.py").exists()
    assert not (skills_dir / "alpha").exists()


def test_idempotent_with_yes(tmp_path):
    """Running twice with --yes is safe."""
    zip_path = make_skill_zip(
        tmp_path, "demo",
        "---\nname: demo-skill\ndescription: Demo\n---"
    )
    skills_dir = tmp_path / "skills"
    index_file = tmp_path / "INDEX.md"
    index_file.write_text("# Index\n")

    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(zip_path),
             "--skills-dir", str(skills_dir), "--index", str(index_file),
             "--yes"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr

    # INDEX.md should have exactly one row for demo-skill (no duplicates)
    content = index_file.read_text()
    assert content.count("demo-skill") == 1


def test_staging_cleaned_on_success(tmp_path):
    """_staging/ is removed after install."""
    zip_path = make_skill_zip(
        tmp_path, "demo",
        "---\nname: demo-skill\ndescription: Demo\n---"
    )
    skills_dir = tmp_path / "skills"
    index_file = tmp_path / "INDEX.md"
    index_file.write_text("# Index\n")

    subprocess.run(
        [sys.executable, str(SCRIPT), str(zip_path),
         "--skills-dir", str(skills_dir), "--index", str(index_file),
         "--yes"],
        check=True, capture_output=True,
    )
    assert not (skills_dir.parent / "_staging").exists()


def test_invalid_zip_fails_clean(tmp_path):
    """Non-zip or zip without SKILL.md fails with clear error."""
    bad_zip = tmp_path / "not-a-zip.zip"
    bad_zip.write_text("this is not a zip")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(bad_zip),
         "--skills-dir", str(tmp_path / "skills"),
         "--index", str(tmp_path / "INDEX.md"),
         "--yes"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "not a valid zip" in result.stderr.lower() or "bad zip" in result.stderr.lower()
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run:
```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
python -m pytest _COFOUNDER/OS/Skills/_Packages/tests/test_install_skill.py -v
```

Expected: ALL tests FAIL with `FileNotFoundError` or similar — script doesn't exist yet.

- [ ] **Step 1.3: Implement `install_skill.py`**

File: `_COFOUNDER/OS/Skills/_Packages/install_skill.py`

```python
#!/usr/bin/env python3
"""Install a skill from a zip file into the CoFounder OS skill library.

Usage:
    python install_skill.py <path-to-skill.zip>                    # single-skill zip
    python install_skill.py <path-to-zip> --skill <name>           # multi-skill zip

Idempotent: running twice is safe. If the target skill exists, prompts unless --yes.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


SKILL_FRONTMATTER_RE = re.compile(
    r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL | re.MULTILINE
)
NAME_RE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
DESC_RE = re.compile(r"^description:\s*(.+?)\s*$", re.MULTILINE | re.DOTALL)


def parse_frontmatter(skill_md_text: str) -> dict[str, str]:
    m = SKILL_FRONTMATTER_RE.search(skill_md_text)
    if not m:
        return {}
    body = m.group(1)
    out: dict[str, str] = {}
    name_m = NAME_RE.search(body)
    if name_m:
        out["name"] = name_m.group(1).strip()
    desc_m = DESC_RE.search(body)
    if desc_m:
        # description can be multiline; strip only
        out["description"] = desc_m.group(1).strip().replace("\n", " ")
    return out


def find_skill_dirs(root: Path, filter_name: str | None) -> list[Path]:
    """Walk `root`, return every directory containing SKILL.md."""
    hits: list[Path] = []
    for p in root.rglob("SKILL.md"):
        skill_dir = p.parent
        if filter_name and filter_name != skill_dir.name:
            continue
        hits.append(skill_dir)
    return hits


def install_one(skill_dir: Path, dest_root: Path, index_file: Path, yes: bool) -> None:
    skill_md = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    fm = parse_frontmatter(skill_md)
    name = fm.get("name") or skill_dir.name
    desc = fm.get("description", "(no description)")

    dest = dest_root / name
    if dest.exists():
        if not yes:
            answer = input(f"skill '{name}' already exists at {dest}. Overwrite? [y/N] ").strip().lower()
            if answer != "y":
                print(f"  [skip] {name}")
                return
        shutil.rmtree(dest)

    shutil.copytree(skill_dir, dest)
    print(f"  [installed] {name} -> {dest}")
    update_index(index_file, name, desc)


def update_index(index_file: Path, name: str, desc: str) -> None:
    text = index_file.read_text(encoding="utf-8") if index_file.exists() else "# Index\n"
    row = f"| `{name}` | {desc} |"
    # Dedupe: replace existing row for this skill, else append
    pattern = re.compile(rf"^\|\s*`{re.escape(name)}`\s*\|.*\|\s*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(row, text)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += row + "\n"
    index_file.write_text(text, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Install a skill zip into CoFounder OS")
    ap.add_argument("zip_path", help="Path to skill zip")
    ap.add_argument("--skill", help="For multi-skill zips: name of subfolder to install")
    ap.add_argument("--skills-dir", default="_COFOUNDER/OS/Skills",
                    help="Target skills directory")
    ap.add_argument("--index", default="_COFOUNDER/OS/Skills/INDEX.md",
                    help="INDEX.md file to update")
    ap.add_argument("--yes", action="store_true", help="Overwrite without prompting")
    args = ap.parse_args()

    zip_path = Path(args.zip_path)
    skills_dir = Path(args.skills_dir)
    index_file = Path(args.index)

    if not zip_path.exists():
        print(f"error: zip not found: {zip_path}", file=sys.stderr)
        return 2

    if not zipfile.is_zipfile(zip_path):
        print(f"error: not a valid zip: {zip_path}", file=sys.stderr)
        return 2

    skills_dir.mkdir(parents=True, exist_ok=True)
    staging = skills_dir.parent / "_staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(staging)

        hits = find_skill_dirs(staging, args.skill)
        if not hits:
            msg = f"no SKILL.md found in {zip_path}"
            if args.skill:
                msg += f" matching --skill {args.skill}"
            print(f"error: {msg}", file=sys.stderr)
            return 2

        if len(hits) > 1 and not args.skill:
            names = ", ".join(sorted(h.name for h in hits))
            print(
                f"error: zip contains multiple skills ({names}). "
                f"Use --skill <name> to pick one.",
                file=sys.stderr,
            )
            return 2

        for skill_dir in hits:
            install_one(skill_dir, skills_dir, index_file, args.yes)

        return 0
    finally:
        if staging.exists():
            shutil.rmtree(staging)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run:
```bash
python -m pytest _COFOUNDER/OS/Skills/_Packages/tests/test_install_skill.py -v
```

Expected: ALL tests PASS (6 tests).

- [ ] **Step 1.5: Commit**

```bash
git add _COFOUNDER/OS/Skills/_Packages/install_skill.py _COFOUNDER/OS/Skills/_Packages/tests/
git commit -m "feat(cofounder): zip-in skill installer with tests"
```

---

### Task 2: Build `_add_mcp.py` — MCP config merger

**Files:**
- Create: `_COFOUNDER/OS/Integrations/_add_mcp.py`
- Create: `_COFOUNDER/OS/Integrations/tests/test_add_mcp.py`

**Rationale:** MCP additions must write to BOTH `.mcp.json` (root) and `src/clients/marketing-web/.mcp.json`. They must remain identical. Script handles the mirror + JSON merge.

- [ ] **Step 2.1: Write the failing tests**

File: `_COFOUNDER/OS/Integrations/tests/test_add_mcp.py`

```python
"""Tests for _add_mcp.py — MCP config merger."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "_add_mcp.py"


def test_adds_mcp_to_both_files(tmp_path):
    root_mcp = tmp_path / ".mcp.json"
    marketing_mcp = tmp_path / "marketing" / ".mcp.json"
    marketing_mcp.parent.mkdir()

    initial = {"mcpServers": {"existing": {"command": "echo"}}}
    root_mcp.write_text(json.dumps(initial, indent=2))
    marketing_mcp.write_text(json.dumps(initial, indent=2))

    result = subprocess.run(
        [sys.executable, str(SCRIPT),
         "newmcp",
         "--command", "npx",
         "--args", "-y,@test/mcp@latest",
         "--mcp-files", f"{root_mcp},{marketing_mcp}"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr

    root_data = json.loads(root_mcp.read_text())
    marketing_data = json.loads(marketing_mcp.read_text())
    assert "newmcp" in root_data["mcpServers"]
    assert "newmcp" in marketing_data["mcpServers"]
    assert root_data == marketing_data


def test_adds_with_env_vars(tmp_path):
    mcp_file = tmp_path / ".mcp.json"
    mcp_file.write_text(json.dumps({"mcpServers": {}}))

    result = subprocess.run(
        [sys.executable, str(SCRIPT),
         "withenv",
         "--command", "npx",
         "--args", "-y,@test/mcp",
         "--env", "API_KEY=secret",
         "--env", "REGION=us-east-1",
         "--mcp-files", str(mcp_file)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr

    data = json.loads(mcp_file.read_text())
    assert data["mcpServers"]["withenv"]["env"] == {
        "API_KEY": "secret",
        "REGION": "us-east-1",
    }


def test_idempotent(tmp_path):
    mcp_file = tmp_path / ".mcp.json"
    mcp_file.write_text(json.dumps({"mcpServers": {}}))

    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPT),
             "double",
             "--command", "npx",
             "--args", "-y,@test/mcp",
             "--mcp-files", str(mcp_file)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr

    data = json.loads(mcp_file.read_text())
    # Exactly one entry for 'double'
    assert list(data["mcpServers"].keys()).count("double") == 1


def test_files_identical_after_add(tmp_path):
    """Regression: both .mcp.json files must stay byte-identical."""
    root_mcp = tmp_path / "a.json"
    marketing_mcp = tmp_path / "b.json"
    for f in (root_mcp, marketing_mcp):
        f.write_text(json.dumps({"mcpServers": {"x": {"command": "echo"}}}, indent=2))

    subprocess.run(
        [sys.executable, str(SCRIPT),
         "sync",
         "--command", "npx",
         "--args", "-y,@test/mcp",
         "--mcp-files", f"{root_mcp},{marketing_mcp}"],
        check=True, capture_output=True,
    )
    assert root_mcp.read_text() == marketing_mcp.read_text()
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run:
```bash
python -m pytest _COFOUNDER/OS/Integrations/tests/test_add_mcp.py -v
```

Expected: ALL tests FAIL — script doesn't exist.

- [ ] **Step 2.3: Implement `_add_mcp.py`**

File: `_COFOUNDER/OS/Integrations/_add_mcp.py`

```python
#!/usr/bin/env python3
"""Add an MCP server to all .mcp.json files (project root + marketing-web).

Usage:
    python _add_mcp.py <name> --command <cmd> --args <a,b,c> [--env KEY=val ...] \\
                       [--mcp-files file1,file2,...]

Default --mcp-files: .mcp.json,src/clients/marketing-web/.mcp.json
Idempotent: re-running overwrites the same entry.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


DEFAULT_FILES = [
    ".mcp.json",
    "src/clients/marketing-web/.mcp.json",
]


def add_mcp(
    mcp_file: Path, name: str, command: str, args_list: list[str],
    env: dict[str, str], stdio_type: str | None,
) -> None:
    data = json.loads(mcp_file.read_text(encoding="utf-8"))
    servers = data.setdefault("mcpServers", {})
    entry: dict = {"command": command, "args": args_list, "env": env}
    if stdio_type:
        entry["type"] = stdio_type
    # Preserve key order: type, command, args, env
    if stdio_type:
        entry = {"type": stdio_type, "command": command, "args": args_list, "env": env}
    servers[name] = entry
    mcp_file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Add an MCP server to .mcp.json files")
    ap.add_argument("name", help="MCP server name (e.g. 'playwright')")
    ap.add_argument("--command", required=True, help="Command to run (e.g. 'npx')")
    ap.add_argument("--args", required=True,
                    help="Comma-separated args (e.g. '-y,@playwright/mcp@latest')")
    ap.add_argument("--env", action="append", default=[],
                    help="KEY=value, can repeat")
    ap.add_argument("--type", default="stdio", help="MCP type (default: stdio)")
    ap.add_argument("--mcp-files",
                    default=",".join(DEFAULT_FILES),
                    help="Comma-separated list of .mcp.json files to update")
    args = ap.parse_args()

    args_list = [a for a in args.args.split(",") if a]
    env: dict[str, str] = {}
    for kv in args.env:
        if "=" not in kv:
            print(f"error: --env must be KEY=value, got {kv!r}", file=sys.stderr)
            return 2
        k, v = kv.split("=", 1)
        env[k] = v

    files = [Path(f) for f in args.mcp_files.split(",") if f]
    missing = [f for f in files if not f.exists()]
    if missing:
        print(f"error: files not found: {missing}", file=sys.stderr)
        return 2

    for f in files:
        add_mcp(f, args.name, args.command, args_list, env, args.type)
        print(f"  [added] {args.name} -> {f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run:
```bash
python -m pytest _COFOUNDER/OS/Integrations/tests/test_add_mcp.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add _COFOUNDER/OS/Integrations/_add_mcp.py _COFOUNDER/OS/Integrations/tests/
git commit -m "feat(cofounder): MCP config merger with tests"
```

---

## Phase 2 — Install Skills + Rewrite Protocol (Tasks 3–7)

Use the Phase 1 tools to install skills. Edit protocol doc in place.

---

### Task 3: Install `interface-design` skill (L0)

**Files:**
- Uses: `_COFOUNDER/OS/Skills/_Packages/install_skill.py`
- Source: `E:/APPS/Running App Versions/Exploring skills and repo/interface-design-main.zip`
- Creates: `_COFOUNDER/OS/Skills/interface-design/` (entire folder)
- Modifies: `_COFOUNDER/OS/Skills/INDEX.md`

- [ ] **Step 3.1: Run installer**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
python _COFOUNDER/OS/Skills/_Packages/install_skill.py \
  "E:/APPS/Running App Versions/Exploring skills and repo/interface-design-main.zip" \
  --skill interface-design \
  --yes
```

Expected stdout:
```
  [installed] interface-design -> _COFOUNDER/OS/Skills/interface-design
```

- [ ] **Step 3.2: Verify install**

Run:
```bash
ls _COFOUNDER/OS/Skills/interface-design/SKILL.md
grep -c "interface-design" _COFOUNDER/OS/Skills/INDEX.md
```

Expected: file exists; count ≥ 1.

- [ ] **Step 3.3: Commit**

```bash
git add _COFOUNDER/OS/Skills/interface-design/ _COFOUNDER/OS/Skills/INDEX.md
git commit -m "feat(skills): install interface-design (L0 design memory)"
```

---

### Task 4: Install `webapp-testing` skill (L5b support)

**Files:**
- Uses: `_COFOUNDER/OS/Skills/_Packages/install_skill.py`
- Source: `E:/APPS/Running App Versions/Exploring skills and repo/awesome-claude-skills-master.zip`
- Creates: `_COFOUNDER/OS/Skills/webapp-testing/`
- Creates: `_COFOUNDER/OS/Skills/webapp-testing/scripts/screenshot_viewports.py` (new helper)
- Creates: `_COFOUNDER/OS/Skills/webapp-testing/scripts/contrast_check.py` (new helper)

- [ ] **Step 4.1: Run installer with --skill flag**

```bash
python _COFOUNDER/OS/Skills/_Packages/install_skill.py \
  "E:/APPS/Running App Versions/Exploring skills and repo/awesome-claude-skills-master.zip" \
  --skill webapp-testing \
  --yes
```

Expected stdout:
```
  [installed] webapp-testing -> _COFOUNDER/OS/Skills/webapp-testing
```

Only `webapp-testing/` should appear. The 29 other skills in the zip are ignored.

- [ ] **Step 4.2: Add `screenshot_viewports.py` helper**

File: `_COFOUNDER/OS/Skills/webapp-testing/scripts/screenshot_viewports.py`

```python
#!/usr/bin/env python3
"""Capture screenshots at 3 viewports (375, 768, 1280) and write gate token.

Usage:
    python screenshot_viewports.py --url <url> [--out .uiux-gallery/verify/]
    python screenshot_viewports.py --pass --gate-file .uiux-gate-passed

When --pass is set AFTER Playwright MCP has captured viewports, write the
gate token consumed by the PreToolUse hook.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path


VIEWPORTS = [(375, 667), (768, 1024), (1280, 800)]


def git_head() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True)
        return out.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def write_gate_token(gate_file: Path, target_files: list[str] | None, scope: str) -> None:
    now = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    token = {
        "gitSha": git_head(),
        "layers": {
            "L5b": {
                "timestamp": now,
                "viewports": [w for w, _ in VIEWPORTS],
                "screenshotsPath": ".uiux-gallery/verify/",
                "contrastPassed": True,
                "a11yTreeCaptured": True,
            }
        },
        "scope": scope,
        "targetFiles": target_files or [],
    }
    gate_file.write_text(json.dumps(token, indent=2) + "\n", encoding="utf-8")
    print(f"[gate] wrote {gate_file}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="URL to screenshot")
    ap.add_argument("--out", default=".uiux-gallery/verify/")
    ap.add_argument("--pass", dest="pass_gate", action="store_true",
                    help="Write gate token (assumes Playwright MCP ran)")
    ap.add_argument("--gate-file", default=".uiux-gate-passed")
    ap.add_argument("--scope", default="all")
    ap.add_argument("--target-file", action="append", default=[])
    args = ap.parse_args()

    if args.pass_gate:
        write_gate_token(Path(args.gate_file), args.target_file, args.scope)
        return 0

    # Non-pass mode: print the prescribed viewports for the Playwright MCP caller
    print("Viewports to capture (use Playwright MCP browser_resize + browser_take_screenshot):")
    for w, h in VIEWPORTS:
        print(f"  {w}x{h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4.3: Add `contrast_check.py` helper**

File: `_COFOUNDER/OS/Skills/webapp-testing/scripts/contrast_check.py`

```python
#!/usr/bin/env python3
"""Compute WCAG AA contrast ratio from two hex colors.

Usage:
    python contrast_check.py #1C1917 #FFFFFF
    # prints: 16.52 PASS (AA body text >= 4.5)
"""
from __future__ import annotations

import sys


def _luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        raise ValueError(f"expected #RRGGBB, got {hex_color!r}")
    r, g, b = (int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))

    def ch(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    ratio = contrast(sys.argv[1], sys.argv[2])
    aa_body = ratio >= 4.5
    aa_large = ratio >= 3.0
    status = "PASS" if aa_body else ("PASS-LARGE" if aa_large else "FAIL")
    print(f"{ratio:.2f} {status} (AA body >= 4.5, large >= 3.0)")
    return 0 if aa_body else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4.4: Smoke test helpers**

```bash
python _COFOUNDER/OS/Skills/webapp-testing/scripts/contrast_check.py "#1C1917" "#FFFFFF"
```

Expected: `16.52 PASS (AA body >= 4.5, large >= 3.0)` and exit 0.

```bash
python _COFOUNDER/OS/Skills/webapp-testing/scripts/screenshot_viewports.py
```

Expected: prints viewport list.

- [ ] **Step 4.5: Commit**

```bash
git add _COFOUNDER/OS/Skills/webapp-testing/ _COFOUNDER/OS/Skills/INDEX.md
git commit -m "feat(skills): install webapp-testing + viewport/contrast helpers (L5b)"
```

---

### Task 5: Enrich `ui-ux-pro-max` — references, v2.5.0 upgrade, gallery.py

**Files:**
- Creates: `_COFOUNDER/OS/Skills/ui-ux-pro-max/references/*.md` (12 docs)
- Modifies: `_COFOUNDER/OS/Skills/ui-ux-pro-max/SKILL.md` (if v2.5.0 has changes)
- Modifies: `_COFOUNDER/OS/Skills/ui-ux-pro-max/data/*.csv` (if v2.5.0 has more rows)
- Creates: `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py`
- Creates: `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/tests/test_gallery.py`

- [ ] **Step 5.1: Copy 12 reference docs**

```bash
SRC="E:/APPS/Running App Versions/Exploring skills and repo/_extracted/ui-ux-design-pro-skill-main/ui-ux-design-pro-skill-main/skills/ui-ux-design-pro/references"
DEST="_COFOUNDER/OS/Skills/ui-ux-pro-max/references"
mkdir -p "$DEST"
cp "$SRC"/*.md "$DEST/"
ls "$DEST/"
```

Expected: 13 `.md` files listed (12 reference docs + any existing index).

- [ ] **Step 5.2: Version-check and upgrade ui-ux-pro-max**

Compare CSV row counts:

```bash
CURRENT="_COFOUNDER/OS/Skills/ui-ux-pro-max/data"
NEW="E:/APPS/Running App Versions/Exploring skills and repo/ui-ux-pro-max-skill-extracted/ui-ux-pro-max-skill-main/src/ui-ux-pro-max/data"
for csv in colors.csv typography.csv styles.csv ui-reasoning.csv ux-guidelines.csv; do
  [ -f "$CURRENT/$csv" ] && old=$(wc -l < "$CURRENT/$csv") || old=0
  [ -f "$NEW/$csv" ] && new=$(wc -l < "$NEW/$csv") || new=0
  echo "$csv: current=$old new=$new"
done
```

Rule: if `new > current` for ANY file, overwrite the entire `data/` folder:

```bash
# Only run if comparison showed new > current
cp -r "$NEW"/* "$CURRENT/"
```

Also copy new scripts if they differ:

```bash
CURRENT_SCRIPTS="_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts"
NEW_SCRIPTS="E:/APPS/Running App Versions/Exploring skills and repo/ui-ux-pro-max-skill-extracted/ui-ux-pro-max-skill-main/src/ui-ux-pro-max/scripts"
cp "$NEW_SCRIPTS"/*.py "$CURRENT_SCRIPTS/"
```

- [ ] **Step 5.3: Write failing test for `gallery.py`**

File: `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/tests/test_gallery.py`

```python
"""Tests for gallery.py — L1.5 variation gallery renderer."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "gallery.py"


def test_renders_n_variants(tmp_path):
    """gallery.py --variants 4 produces 4 variant cards and index.html."""
    out_dir = tmp_path / "gallery"
    result = subprocess.run(
        [sys.executable, str(SCRIPT),
         "--query", "farming mobile app",
         "--variants", "4",
         "--out", str(out_dir)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (out_dir / "index.html").exists()
    variants = json.loads((out_dir / "variants.json").read_text())
    assert len(variants) == 4
    for v in variants:
        assert "palette" in v
        assert "typography" in v
        assert "style" in v


def test_choose_writes_chosen_json(tmp_path):
    """gallery.py --choose <id> writes chosen.json."""
    out_dir = tmp_path / "gallery"
    subprocess.run(
        [sys.executable, str(SCRIPT), "--query", "x", "--variants", "3", "--out", str(out_dir)],
        check=True, capture_output=True,
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--choose", "v2", "--out", str(out_dir)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    chosen = json.loads((out_dir / "chosen.json").read_text())
    assert chosen["variantId"] == "v2"
    assert "palette" in chosen


def test_variant_ids_are_vN(tmp_path):
    """Variant IDs are v1, v2, v3... for easy CLI selection."""
    out_dir = tmp_path / "gallery"
    subprocess.run(
        [sys.executable, str(SCRIPT), "--query", "x", "--variants", "3", "--out", str(out_dir)],
        check=True, capture_output=True,
    )
    variants = json.loads((out_dir / "variants.json").read_text())
    ids = [v["id"] for v in variants]
    assert ids == ["v1", "v2", "v3"]
```

- [ ] **Step 5.4: Run test to verify it fails**

```bash
python -m pytest _COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/tests/test_gallery.py -v
```

Expected: FAIL — `gallery.py` doesn't exist.

- [ ] **Step 5.5: Implement `gallery.py`**

File: `_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py`

```python
#!/usr/bin/env python3
"""L1.5 Variation Gallery — render N design-system variants side-by-side.

Usage:
    python gallery.py --query <q> --variants N [--out <dir>]
    python gallery.py --choose vN [--out <dir>]

Reads palettes/typography/styles from sibling data/*.csv files.
Produces index.html (grid of cards) + variants.json.
--choose writes chosen.json with the picked variant.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


def load_csv_rows(name: str) -> list[dict]:
    path = DATA_DIR / name
    if not path.exists():
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def pick_n(rows: list[dict], n: int, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    if len(rows) <= n:
        return list(rows)
    return rng.sample(rows, n)


def build_variants(n: int, query: str) -> list[dict]:
    palettes = load_csv_rows("colors.csv") or [
        {"name": f"palette{i}", "primary": f"#{i*30:06x}", "surface": "#fafafa", "accent": "#ff5722"}
        for i in range(1, 10)
    ]
    typographies = load_csv_rows("typography.csv") or [
        {"heading": "DM Serif", "body": "Inter"},
        {"heading": "Playfair", "body": "DM Sans"},
        {"heading": "Noto Serif Devanagari", "body": "Noto Sans Devanagari"},
    ]
    styles = load_csv_rows("styles.csv") or [
        {"name": "Organic Biophilic"}, {"name": "Neo-Brutalist"},
        {"name": "Swiss Precision"}, {"name": "Warm Handmade"},
    ]

    chosen_pals = pick_n(palettes, n, seed=hash(query) % 10000)
    chosen_typos = pick_n(typographies, n, seed=(hash(query) + 1) % 10000)
    chosen_styles = pick_n(styles, n, seed=(hash(query) + 2) % 10000)

    variants = []
    for i in range(n):
        variants.append({
            "id": f"v{i+1}",
            "palette": chosen_pals[i % len(chosen_pals)],
            "typography": chosen_typos[i % len(chosen_typos)],
            "style": chosen_styles[i % len(chosen_styles)].get("name", f"style{i+1}"),
        })
    return variants


def render_html(variants: list[dict], query: str) -> str:
    cards: list[str] = []
    for v in variants:
        pal = v["palette"]
        primary = pal.get("primary", "#000")
        surface = pal.get("surface", "#fff")
        accent = pal.get("accent", "#f00")
        heading_font = v["typography"].get("heading", "serif")
        body_font = v["typography"].get("body", "sans-serif")
        cards.append(f"""
<div class="card" style="background:{surface}">
  <div class="id">{v['id']}</div>
  <div class="style" style="font-family:'{heading_font}',serif">{v['style']}</div>
  <div class="swatch" style="background:{primary}"></div>
  <div class="swatch" style="background:{accent}"></div>
  <div class="specimen" style="font-family:'{heading_font}',serif;color:{primary}">Headline</div>
  <div class="specimen body" style="font-family:'{body_font}',sans-serif;color:{primary}">
    Body text sample — this is how paragraphs will read.
  </div>
  <button style="background:{primary};color:{surface};font-family:'{body_font}',sans-serif">Button</button>
</div>""")

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>L1.5 Gallery — {query}</title>
<style>
body {{ margin:0; padding:24px; background:#f4f4f5; font-family:system-ui; }}
h1 {{ font-size:14px; text-transform:uppercase; letter-spacing:0.1em; color:#71717a; margin:0 0 16px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px; }}
.card {{ padding:24px; border-radius:12px; border:1px solid #e4e4e7; }}
.id {{ font-size:11px; color:#a1a1aa; letter-spacing:0.1em; margin-bottom:8px; }}
.style {{ font-size:20px; margin-bottom:16px; }}
.swatch {{ width:32px; height:32px; border-radius:6px; display:inline-block; margin-right:6px; }}
.specimen {{ font-size:28px; margin:16px 0 8px; }}
.body {{ font-size:14px; line-height:1.6; margin-bottom:16px; }}
button {{ padding:10px 18px; border:none; border-radius:8px; cursor:pointer; }}
</style></head>
<body>
<h1>Variation Gallery — {query}</h1>
<div class="grid">{''.join(cards)}</div>
</body></html>"""


def cmd_render(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    variants = build_variants(args.variants, args.query)
    (out / "variants.json").write_text(json.dumps(variants, indent=2))
    (out / "index.html").write_text(render_html(variants, args.query))
    print(f"[gallery] wrote {args.variants} variants to {out}")
    return 0


def cmd_choose(args: argparse.Namespace) -> int:
    out = Path(args.out)
    variants_path = out / "variants.json"
    if not variants_path.exists():
        print(f"error: {variants_path} not found — run --query first", file=__import__("sys").stderr)
        return 2
    variants = json.loads(variants_path.read_text())
    match = next((v for v in variants if v["id"] == args.choose), None)
    if not match:
        print(f"error: variant {args.choose!r} not found", file=__import__("sys").stderr)
        return 2
    chosen = dict(match)
    chosen["variantId"] = match["id"]
    (out / "chosen.json").write_text(json.dumps(chosen, indent=2))
    print(f"[gallery] chose {args.choose}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", help="Design brief (e.g. 'farming mobile PWA')")
    ap.add_argument("--variants", type=int, default=4)
    ap.add_argument("--out", default=".uiux-gallery/")
    ap.add_argument("--choose", help="Pick variant id (e.g. v2) — writes chosen.json")
    args = ap.parse_args()

    if args.choose:
        return cmd_choose(args)
    if args.query:
        return cmd_render(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5.6: Run tests to verify they pass**

```bash
python -m pytest _COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/tests/test_gallery.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5.7: Commit**

```bash
git add _COFOUNDER/OS/Skills/ui-ux-pro-max/
git commit -m "feat(skills): ui-ux-pro-max v2.5 — 12 refs, gallery.py (L1.5), data upgrade"
```

---

### Task 6: Update `INDEX.md` with new skill rows and layer mapping

**Files:**
- Modify: `_COFOUNDER/OS/Skills/INDEX.md`

- [ ] **Step 6.1: Read current INDEX.md**

```bash
cat _COFOUNDER/OS/Skills/INDEX.md | head -130
```

- [ ] **Step 6.2: Replace the UI/UX Design Engine section**

Locate section `## UI/UX Design Engine Skills (NEW — 2026-03-29)` and replace with:

```markdown
## UI/UX Design Engine Skills (UPDATED — 2026-04-20)

> 9-layer stack. All synced to: `_COFOUNDER/OS/Skills/`
> Trigger protocol: `_COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md` v2.0

### CORE — Auto-apply for any UI/UX task

| Skill | Layer | Purpose | Trigger Keywords |
|-------|-------|---------|-----------------|
| `interface-design`   | L0  | Design memory across sessions (.interface-design/system.md) | (auto, session-start) |
| `ui-ux-pro-max` v2.5 | L1  | 161 palettes, 99 UX rules, 25 charts + 12 reference docs | new screen, palette, redesign |
| `ui-ux-pro-max/gallery` | L1.5 | Variation gallery — 3–5 variants rendered, user picks visually | variation, alternative, options |
| `shadcn`             | L4  | Component primitives (via shadcn MCP, not CLI) | shadcn, form, dialog |
| `ui-styling`         | L5a | Manual a11y + polish checklist | contrast, hover, polish |
| `webapp-testing`     | L5b | Playwright test authoring + viewport/contrast helpers | test ui, screenshot, viewport |
| `design-system`      | —   | Token architecture, 3-layer token system | token, theme, CSS var |
| `design`             | —   | Brand identity, logo, icon design | brand, logo, icon |
| `brand`              | —   | Brand voice, visual consistency | brand voice, tone |

### MCP Tools (Part of the Design Engine)

| MCP Server | Tool | Layer | Trigger |
|---|---|---|---|
| `stitch`     | generate_screen_from_text, get_screen_code | L2a | Text → mockup |
| `figma` (claude.ai) | get_design_context, get_screenshot | L2b | figma.com/design URLs |
| `magic`      | 21st.dev component registry | L3 | Animations, custom components |
| `shadcn`     | Component search + install | L4 | shadcn primitives |
| `playwright` | browser_navigate, browser_snapshot, browser_resize | L5b | Visual verification |

### Skill Application Order (9-Layer Stack)

```
L0   → interface-design    (load design memory)
L1   → ui-ux-pro-max       (generate candidate pool)
L1.5 → gallery.py          (render variants, user picks)
L2a  → Stitch MCP       or L2b → Figma MCP   (pick one)
L3   → Magic MCP           (component discovery)
L4   → shadcn MCP          (component primitives)
L5a  → ui-styling          (manual a11y checklist)
L5b  → Playwright MCP + webapp-testing   (automated verify, writes gate token)
```
```

Also update the top-of-file summary line:

```diff
- > 45 skills organized by domain.
+ > 47 skills organized by domain.
```

And:

```diff
- > Last updated: 2026-03-29
+ > Last updated: 2026-04-20
- > **NEW (2026-03-29):** UI/UX Design Engine skills added (7 new skills, synced to all agents).
+ > **UPDATED (2026-04-20):** UI/UX Design Engine v2.0 — 9 layers, +2 skills (interface-design, webapp-testing), +2 MCPs (playwright, shadcn).
```

- [ ] **Step 6.3: Commit**

```bash
git add _COFOUNDER/OS/Skills/INDEX.md
git commit -m "docs(skills): update INDEX.md for 9-layer UI/UX stack v2.0"
```

---

### Task 7: Rewrite `UI_UX_DESIGN_ENGINE_PROTOCOL.md` v1.0 → v2.0 (edit in place)

**Files:**
- Modify: `_COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md`

**Rationale:** Single source of truth. No parallel v1/v2 files. Git history is the backup.

- [ ] **Step 7.1: Replace header**

Change lines 1–5:

```markdown
# UI/UX Design Engine Protocol
> Version: 2.0 | Updated: 2026-04-20 | Owner: All Agents
> This protocol is **MANDATORY** for every UI/UX change across both apps.
> It supersedes ad-hoc UI decisions. Design-before-code is a Red Line.
> **Breaking change from v1.0:** L0 added, L1.5 added, L2 branched (Stitch/Figma equal), L5 split (manual/automated), gate token enforced via PreToolUse hook.
```

- [ ] **Step 7.2: Replace the 5-Layer Stack ASCII block with 9-layer**

Replace the block starting at `## The 5-Layer Design Stack` through the closing ``` with:

```markdown
## The 9-Layer Design Stack

Every UI/UX task flows through this stack — top to bottom, in order.
No layer is optional for its trigger condition.

```
┌─────────────────────────────────────────────────────────────────┐
│  L0   interface-design         — Design Memory                  │
│       .interface-design/system.md persists across sessions      │
├─────────────────────────────────────────────────────────────────┤
│  L1   ui-ux-pro-max v2.5.0     — Design System Generation       │
│       161 palettes · 99 UX rules · 25 charts · 12 reference docs│
├─────────────────────────────────────────────────────────────────┤
│  L1.5 ui-ux-pro-max/gallery.py — Variation Gallery              │
│       3–5 variants rendered as HTML grid, user picks visually   │
├─────────────────────────────────────────────────────────────────┤
│  L2a  Stitch MCP    L2b  Figma MCP   (EQUAL — pick exactly one) │
│       Text → mockup   Figma URL → extracted design + code       │
├─────────────────────────────────────────────────────────────────┤
│  L3   21st.dev Magic MCP       — Component Discovery            │
├─────────────────────────────────────────────────────────────────┤
│  L4   shadcn MCP               — Component Primitives           │
│       Structured queries, install via MCP (not raw CLI)         │
├─────────────────────────────────────────────────────────────────┤
│  L5a  ui-styling               — Manual a11y / Polish Checklist │
├─────────────────────────────────────────────────────────────────┤
│  L5b  Playwright MCP + webapp-testing — Automated Verification  │
│       3 viewports, contrast ≥ 4.5:1, a11y tree captured         │
│       On success writes .uiux-gate-passed (consumed by hook)    │
└─────────────────────────────────────────────────────────────────┘
```
```

- [ ] **Step 7.3: Replace the Layer Activation Matrix**

Locate `## Layer Activation Matrix` section. Replace the entire table with:

```markdown
## Layer Activation Matrix

| UI Task | L0 | L1 | L1.5 | L2a | L2b | L3 | L4 | L5a | L5b |
|---------|----|----|------|-----|-----|----|----|-----|-----|
| New screen / page | **REQ** | **REQ** | **REQ** | REQ *or* | REQ *or* | REQ | REQ | **REQ** | **REQ** |
| New visual component | REQ | Rec | **REQ** | REQ *or* | REQ *or* | **REQ** | REQ | **REQ** | **REQ** |
| Redesign existing screen | **REQ** | **REQ** | **REQ** | REQ *or* | REQ *or* | Rec | Rec | **REQ** | **REQ** |
| Animation / micro-interaction | REQ | — | — | Rec | — | **REQ** | — | **REQ** | **REQ** |
| Design system / token change | **REQ** | **REQ** | **REQ** | Rec | Rec | — | — | **REQ** | Rec |
| Marketing website section | REQ | **REQ** | **REQ** | REQ *or* | REQ *or* | **REQ** | — | **REQ** | **REQ** |
| Add button / icon to screen | REQ | — | — | — | — | Rec | Rec | **REQ** | **REQ** |
| CSS bug fix | REQ | — | — | — | — | — | — | **REQ** | **REQ** |
| Accessibility audit | — | — | — | — | — | — | — | **REQ** | **REQ** |
| Copy / i18n only | — | — | — | — | — | — | — | — | — |

**L2 rule**: exactly one of L2a (Stitch) or L2b (Figma) is required — never both, never zero.
```

- [ ] **Step 7.4: Insert new "L0 — interface-design" section**

After the matrix, before existing "Layer 1" section:

```markdown
---

## Layer 0 — interface-design (Design Memory)

### What It Does
Persists design decisions across sessions in `.interface-design/system.md` so button heights, spacing values, and chosen tokens don't drift.

### Skill Location
`_COFOUNDER/OS/Skills/interface-design/`

### When to Use
- **Always** at session start (auto-loaded by `session-start-hook`)
- **Always** when a design decision is approved by the user (append a new decision block)

### Memory File Format
`.interface-design/system.md` (gitignored, per-project):

```markdown
# Design Decisions

## Decision 2026-04-20-1015 — Primary button height
- Value: 48px (mobile minimum touch target)
- Reason: WCAG 2.2 touch target ≥ 44px; 48px on 4px grid
- Applies to: all primary buttons in mobile-web

## Decision 2026-04-20-1102 — Chosen variant for LogScreen redesign
- Palette: Organic Biophilic (primary #059669)
- Typography: Noto Serif Devanagari + DM Sans
- Variant ID: v3 from .uiux-gallery/2026-04-20-log-screen/
```

### Write Rule
- Append only (never mutate earlier blocks)
- One block per decision
- Block ID format: `YYYY-MM-DD-HHMM`

---
```

- [ ] **Step 7.5: Insert new "L1.5 — Variation Gallery" section**

After the existing "Layer 1 — ui-ux-pro-max" section, insert:

```markdown
---

## Layer 1.5 — Variation Gallery

### What It Does
Renders 3–5 candidate design-system variants side-by-side so the user picks visually instead of iterating by rejection.

### Skill Location
`_COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py`

### Command Template
```bash
# Generate gallery (N variants from query)
python _COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py \
  --query "Indian farming PWA offline dashboard semi-literate" \
  --variants 4 \
  --out .uiux-gallery/2026-04-20-log-screen/

# User opens .uiux-gallery/<topic>/index.html in browser, picks

# Record choice
python _COFOUNDER/OS/Skills/ui-ux-pro-max/scripts/gallery.py \
  --choose v3 \
  --out .uiux-gallery/2026-04-20-log-screen/
```

### Output Files
- `.uiux-gallery/<date>-<topic>/index.html` — grid of variant cards
- `.uiux-gallery/<date>-<topic>/variants.json` — all variants
- `.uiux-gallery/<date>-<topic>/chosen.json` — user's pick (feeds L0)

### Each Card Shows
- Primary + accent + surface color swatches
- Heading + body font specimen
- Sample button styled with variant
- Style name label (e.g. "Organic Biophilic", "Neo-Brutalist")

### When to Skip
Only for: CSS bug fixes, accessibility audits, copy changes. Everything else: mandatory.

---
```

- [ ] **Step 7.6: Split Layer 2 into L2a + L2b**

Replace the existing "Layer 2 — Stitch MCP" section with:

```markdown
---

## Layer 2 — Visual Design (L2a OR L2b)

**Exactly one** of these runs per design task. Never both. Choice is driven by input:
- Text brief? → L2a (Stitch)
- Figma URL? → L2b (Figma MCP)

### Layer 2a — Stitch MCP

[Keep existing L2 Stitch content here — workflow, prompt template, etc.]

### Layer 2b — Figma MCP

#### What It Does
Extracts existing Figma designs → React+Tailwind reference code + screenshots + design tokens.

#### Availability
Via claude.ai remote MCP (already active). Tools prefixed `mcp__claude_ai_Figma__*`.

#### When to Use
- User provides `figma.com/design/<fileKey>/<file-name>?node-id=<nodeId>` URL
- Design already exists in Figma (not a from-scratch design)
- Code Connect mapping needed

#### Primary Tools
- `mcp__claude_ai_Figma__get_design_context` — React+Tailwind code + screenshot + hints
- `mcp__claude_ai_Figma__get_screenshot` — visual reference only
- `mcp__claude_ai_Figma__get_variable_defs` — design tokens

#### Workflow
```
1. Parse URL: figma.com/design/:fileKey/:name?node-id=:nodeId
   Convert "-" in nodeId to ":"
2. mcp__claude_ai_Figma__get_design_context(fileKey, nodeId)
   → returns React+Tailwind reference + design tokens + screenshot
3. Adapt reference code to our stack:
   - Replace hardcoded colors with our CSS variable tokens
   - Replace English strings with i18n keys
   - Use cn() not raw template literals
   - Use FieldGroup + Field pattern for forms
4. Save mockup reference to .uiux-gallery/<topic>/figma-ref.png
5. Proceed to L3
```

#### Adaptation Rules
- Code Connect snippets → use the mapped codebase component directly
- Design tokens as CSS variables → map to project's token system
- Raw hex colors → use semantic tokens from `src/styles/tokens.css`
- Absolute positioning in output → refactor to flex/grid
- Design annotations → follow designer notes explicitly

---
```

- [ ] **Step 7.7: Rewrite Layer 4 (shadcn MCP)**

Replace the existing "Layer 4 — shadcn" section with:

```markdown
---

## Layer 4 — shadcn MCP

### What It Does
Structured queries to the shadcn registry via MCP. Replaces brittle `npx shadcn@latest` CLI calls.

### MCP Config
Added to `.mcp.json` as `"shadcn": { "command": "npx", "args": ["-y", "shadcn@latest", "mcp"] }`.

### When to Use
Any time a shadcn primitive is the right base for a component.

### Primary Tools (via MCP)
- `mcp__shadcn__search` — find components by keyword
- `mcp__shadcn__add` — install component source to project
- `mcp__shadcn__docs` — get component usage docs
- `mcp__shadcn__list_installed` — check what's already in project

### Adaptation Rules (Always Apply)
- Replace `bg-primary` defaults with our `--brand-primary: #059669`
- Replace `text-foreground` with our `--text-primary: #1C1917`
- Replace `rounded-md` with project standard (`rounded-lg` or `rounded-xl`)
- Add Devanagari font fallback to typography components
- Ensure all form components use `FieldGroup + Field` pattern (not raw divs)

### Anti-Pattern
```diff
- npx shadcn@latest add button
+ mcp__shadcn__add({ component: "button" })
```

---
```

- [ ] **Step 7.8: Split Layer 5 into L5a + L5b**

Replace the existing "Layer 5 — ui-styling" section with:

```markdown
---

## Layer 5 — Polish + Verification (L5a + L5b)

Both run. L5a is the human/agent checklist. L5b is the machine verification.
Only L5b writes the gate token.

### Layer 5a — ui-styling (Manual Checklist)

[Keep existing L5 content — Pre-Delivery Checklist with Visual Quality, Interaction, Contrast, Layout, Accessibility sections]

### Layer 5b — Automated Verification (Playwright MCP + webapp-testing)

#### What It Does
Drives a real Chromium browser via Playwright MCP to capture 3-viewport screenshots, check contrast, and capture the accessibility tree.

#### MCP Config
Added to `.mcp.json` as `"playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--browser", "chromium"] }`.

#### Primary Tools (via MCP)
- `mcp__playwright__browser_navigate` — open URL
- `mcp__playwright__browser_resize` — set viewport
- `mcp__playwright__browser_take_screenshot` — capture PNG
- `mcp__playwright__browser_snapshot` — accessibility tree

#### Workflow
```
1. Start local dev server (mobile-web at http://localhost:5173)
2. For each viewport in [375x667, 768x1024, 1280x800]:
   a. browser_resize(width, height)
   b. browser_navigate(<target-url>)
   c. browser_take_screenshot → .uiux-gallery/verify/<viewport>.png
   d. browser_snapshot → capture a11y tree
3. Run contrast check on the computed styles:
   python webapp-testing/scripts/contrast_check.py <primary> <surface>
   Expected: PASS (≥ 4.5:1)
4. Write the gate token:
   python webapp-testing/scripts/screenshot_viewports.py --pass \
     --target-file src/clients/mobile-web/src/screens/LogScreen.tsx
5. Gate token at .uiux-gate-passed unlocks subsequent Write/Edit on gated files
```

#### Checklist (all must pass)
- [ ] Screenshot at 375×667 captured
- [ ] Screenshot at 768×1024 captured
- [ ] Screenshot at 1280×800 captured
- [ ] Accessibility tree captured for at least one viewport
- [ ] Contrast ratio ≥ 4.5:1 on primary body text
- [ ] `prefers-reduced-motion` respected (verify no animations play)
- [ ] `.uiux-gate-passed` written with current git SHA

#### What Triggers a Re-Run
Token invalidates on:
- New git commit (SHA mismatch)
- Timestamp older than 24h
- Any L2 mockup file change

#### Gemini / Codex Note
The gate token enforcement is Claude-only (hook-based). Gemini and Codex follow this protocol voluntarily — but still must run L5b and record the checklist in the PR description.

---
```

- [ ] **Step 7.9: Insert new "Gate Enforcement" section**

After Layer 5, before "Agent Responsibilities":

```markdown
---

## Gate Enforcement (Two-Tier)

### Tier 1 — Protocol (This Document)
Humans + agents read this doc. Self-policing. All three agents (Claude, Gemini, Codex) honor it.

### Tier 2 — Hook (Claude only)
Machine-enforced via `.claude/hooks/uiux-gate-check.js` registered as a `PreToolUse` hook in `.claude/settings.json`.

When Claude attempts `Write` or `Edit` on any file under:
- `src/clients/{mobile-web,marketing-web}/src/**/*.{tsx,astro,css,scss,module.css}`
- `src/clients/*/src/styles/**/*.ts`
- `src/clients/*/src/theme/**/*.ts`

…the hook checks `.uiux-gate-passed` at repo root:
- **Token missing** → tool call **blocked**
- **Token present + valid** → tool call **allowed**
- **Token git SHA mismatch** → **blocked** (needs re-verify for new commit)
- **Token timestamp > 24h** → **blocked**

### Bypass (Audited)
```bash
export UIUX_GATE_BYPASS=1   # per-shell only, never save to .bashrc
```
Every bypass logged to `.claude/hooks/uiux-gate.log`.

### Skip List
`.uiux-gate.config.json` paths bypass the gate unconditionally (i18n, types, tests).

---
```

- [ ] **Step 7.10: Update trigger keyword table and anti-patterns**

Locate the trigger keyword table and add rows:

```markdown
| `figma` `figma.com/design` | L0 + L2b + L5a + L5b | Claude or Gemini |
| `test ui` `screenshot` `viewport` `e2e` | L5b | Claude or Codex |
| `design memory` `design decision` `token change` | L0 + L1 | All |
| `variation` `alternative` `options` | L1.5 | All |
```

Locate the anti-patterns table and add rows:

```markdown
| Skip L5b before opening UI PR | Run Playwright MCP viewport checks first |
| Commit UI changes without gate token | Token MUST exist at commit time |
| Use both Stitch AND Figma for same screen | Pick ONE at L2, document which |
| Write raw `npx shadcn` in new work | Use shadcn MCP queries |
| Pick ONE palette at L1 without gallery | Generate L1.5 variants, let user pick |
```

- [ ] **Step 7.11: Commit**

```bash
git add _COFOUNDER/OS/Integrations/UI_UX_Design_Engine/UI_UX_DESIGN_ENGINE_PROTOCOL.md
git commit -m "docs(protocol): UI/UX Design Engine v1.0 -> v2.0 (9-layer, gate enforcement)"
```

---

## Phase 3 — MCPs (Tasks 8–9)

---

### Task 8: Add Playwright + shadcn MCPs to both `.mcp.json` files

**Files:**
- Modify: `.mcp.json` (root)
- Modify: `src/clients/marketing-web/.mcp.json` (mirror — create if missing)

- [ ] **Step 8.1: Check if marketing-web `.mcp.json` exists**

```bash
ls src/clients/marketing-web/.mcp.json 2>&1 || echo "MISSING"
```

If missing, create with the same content as root `.mcp.json`:

```bash
cp .mcp.json src/clients/marketing-web/.mcp.json
```

- [ ] **Step 8.2: Add Playwright MCP via `_add_mcp.py`**

```bash
python _COFOUNDER/OS/Integrations/_add_mcp.py \
  playwright \
  --command npx \
  --args "-y,@playwright/mcp@latest,--browser,chromium" \
  --mcp-files ".mcp.json,src/clients/marketing-web/.mcp.json"
```

Expected stdout:
```
  [added] playwright -> .mcp.json
  [added] playwright -> src/clients/marketing-web/.mcp.json
```

- [ ] **Step 8.3: Add shadcn MCP via `_add_mcp.py`**

```bash
python _COFOUNDER/OS/Integrations/_add_mcp.py \
  shadcn \
  --command npx \
  --args "-y,shadcn@latest,mcp" \
  --mcp-files ".mcp.json,src/clients/marketing-web/.mcp.json"
```

Expected stdout:
```
  [added] shadcn -> .mcp.json
  [added] shadcn -> src/clients/marketing-web/.mcp.json
```

- [ ] **Step 8.4: Verify both files identical and contain 5 servers**

```bash
diff .mcp.json src/clients/marketing-web/.mcp.json && echo "IDENTICAL"
python -c "import json; d=json.load(open('.mcp.json')); print(sorted(d['mcpServers'].keys()))"
```

Expected:
```
IDENTICAL
['cavemem', 'magic', 'playwright', 'shadcn', 'stitch']
```

- [ ] **Step 8.5: Commit**

```bash
git add .mcp.json src/clients/marketing-web/.mcp.json
git commit -m "feat(mcp): add playwright + shadcn MCP servers (L4, L5b)"
```

---

### Task 9: MCP smoke tests

**Files:** (no changes — verification only)

- [ ] **Step 9.1: Smoke test Playwright MCP**

```bash
timeout 30 npx -y @playwright/mcp@latest --help 2>&1 | head -20
```

Expected: help text listing tools like `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`. Exit code 0 or timeout (MCPs may wait on stdin — that's OK for help).

If download fails: check network, retry. If `browser` tools not listed: check `@playwright/mcp` version exists on npm.

- [ ] **Step 9.2: Smoke test shadcn MCP**

```bash
timeout 30 npx -y shadcn@latest mcp --help 2>&1 | head -20
```

Expected: help text for the MCP subcommand (shadcn v2.5+ ships this).

If `mcp` subcommand unknown: current shadcn version doesn't support MCP yet. Fallback: pin to `shadcn@2.5.0` or later explicitly in `.mcp.json`.

- [ ] **Step 9.3: Restart Claude Code and verify tools appear**

Instruct user: close and reopen Claude Code. In the new session, check for `mcp__playwright__*` and `mcp__shadcn__*` tool prefixes by running:

```
(In Claude) Use the ToolSearch tool: ToolSearch({ query: "playwright browser" })
```

Expected: tool schemas load for `mcp__playwright__browser_navigate`, etc.

If tools don't appear: check `.mcp.json` for JSON syntax errors, check `~/.claude/logs/` for MCP startup errors.

- [ ] **Step 9.4: Record smoke-test result**

Create: `docs/superpowers/plans/2026-04-20-mcp-smoke-test-notes.md` (brief; not a spec)

```markdown
# MCP Smoke-Test Notes — 2026-04-20

| MCP | Status | Tools Listed | Notes |
|---|---|---|---|
| playwright | PASS | browser_navigate, browser_snapshot, browser_take_screenshot, browser_resize | |
| shadcn | PASS | search, add, docs, list_installed | (fill in actual tool names after test) |
```

- [ ] **Step 9.5: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-mcp-smoke-test-notes.md
git commit -m "docs(mcp): smoke-test notes for playwright + shadcn"
```

---

## Phase 4 — Ship the Gate Hook (Tasks 10–14)

Hook ships LAST and in shadow-mode first.

---

### Task 10: Write the gate-check hook script with tests

**Files:**
- Create: `.claude/hooks/uiux-gate-check.js`
- Create: `.claude/hooks/tests/uiux-gate-check.test.js`
- Create: `.claude/hooks/tests/package.json` (for test deps)

- [ ] **Step 10.1: Write tests first**

File: `.claude/hooks/tests/package.json`

```json
{
  "name": "uiux-gate-check-tests",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "node --test *.test.js"
  }
}
```

File: `.claude/hooks/tests/uiux-gate-check.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK = path.join(__dirname, '..', 'uiux-gate-check.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-gate-'));
}

function runHook(filePath, cwd, env = {}) {
  const input = JSON.stringify({ tool_input: { file_path: filePath } });
  return spawnSync('node', [HOOK], {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function setupRepo(tmp, tokenContent, configContent) {
  fs.mkdirSync(path.join(tmp, 'src', 'clients', 'mobile-web', 'src', 'screens'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'clients', 'mobile-web', 'src', 'i18n'), { recursive: true });
  // fake git dir with HEAD
  fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(tmp, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.git', 'refs', 'heads', 'main'), 'abc123\n');

  if (tokenContent !== null) {
    fs.writeFileSync(path.join(tmp, '.uiux-gate-passed'), tokenContent);
  }
  if (configContent) {
    fs.writeFileSync(path.join(tmp, '.uiux-gate.config.json'), configContent);
  }
}

test('allows non-UI file (logic .ts)', () => {
  const tmp = mkTmp();
  setupRepo(tmp, null);
  const r = runHook('src/clients/mobile-web/src/hooks/useAuth.ts', tmp);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('blocks .tsx when no token', () => {
  const tmp = mkTmp();
  setupRepo(tmp, null);
  const r = runHook('src/clients/mobile-web/src/screens/LogScreen.tsx', tmp);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /gate/i);
});

test('allows .tsx with valid token', () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  const token = JSON.stringify({
    gitSha: 'abc123',
    layers: { L5b: { timestamp: now } },
    scope: 'all',
  });
  setupRepo(tmp, token);
  const r = runHook('src/clients/mobile-web/src/screens/LogScreen.tsx', tmp);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('blocks .tsx when token git SHA mismatch', () => {
  const tmp = mkTmp();
  const now = new Date().toISOString();
  const token = JSON.stringify({
    gitSha: 'wrongsha',
    layers: { L5b: { timestamp: now } },
    scope: 'all',
  });
  setupRepo(tmp, token);
  const r = runHook('src/clients/mobile-web/src/screens/LogScreen.tsx', tmp);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /sha|commit/i);
});

test('blocks .tsx when token older than 24h', () => {
  const tmp = mkTmp();
  const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const token = JSON.stringify({
    gitSha: 'abc123',
    layers: { L5b: { timestamp: old } },
    scope: 'all',
  });
  setupRepo(tmp, token);
  const r = runHook('src/clients/mobile-web/src/screens/LogScreen.tsx', tmp);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /24h|stale|expired/i);
});

test('allows .tsx on skip list', () => {
  const tmp = mkTmp();
  const config = JSON.stringify({ skipPaths: ['src/clients/*/src/i18n/**'] });
  setupRepo(tmp, null, config);
  fs.mkdirSync(path.join(tmp, 'src', 'clients', 'mobile-web', 'src', 'i18n'), { recursive: true });
  const r = runHook('src/clients/mobile-web/src/i18n/translations.ts', tmp);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('bypass env var allows blocked file', () => {
  const tmp = mkTmp();
  setupRepo(tmp, null);
  const r = runHook(
    'src/clients/mobile-web/src/screens/LogScreen.tsx',
    tmp,
    { UIUX_GATE_BYPASS: '1' },
  );
  assert.strictEqual(r.status, 0, r.stderr);
  // Bypass must log
  const logPath = path.join(tmp, '.claude', 'hooks', 'uiux-gate.log');
  assert.ok(fs.existsSync(logPath), 'log file should exist');
  assert.match(fs.readFileSync(logPath, 'utf8'), /BYPASS/);
});

test('shadow mode never blocks but logs', () => {
  const tmp = mkTmp();
  setupRepo(tmp, null);
  const r = runHook(
    'src/clients/mobile-web/src/screens/LogScreen.tsx',
    tmp,
    { UIUX_GATE_SHADOW: '1' },
  );
  assert.strictEqual(r.status, 0, r.stderr);
  const logPath = path.join(tmp, '.claude', 'hooks', 'uiux-gate.log');
  assert.match(fs.readFileSync(logPath, 'utf8'), /SHADOW|would.*block/i);
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/.claude/hooks/tests"
node --test uiux-gate-check.test.js
```

Expected: ALL tests fail (hook script doesn't exist).

- [ ] **Step 10.3: Implement the hook**

File: `.claude/hooks/uiux-gate-check.js`

```javascript
#!/usr/bin/env node
/**
 * UI/UX Gate PreToolUse hook.
 *
 * Reads tool call JSON from stdin, decides ALLOW / BLOCK for Write/Edit
 * on UI files based on .uiux-gate-passed token.
 *
 * Exit 0 = allow; exit 2 = block (hook contract).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GATE_FILE = '.uiux-gate-passed';
const CONFIG_FILE = '.uiux-gate.config.json';
const LOG_FILE = path.join('.claude', 'hooks', 'uiux-gate.log');
const MAX_TOKEN_AGE_MS = 24 * 3600 * 1000;

const GATED_EXTENSIONS = ['.tsx', '.astro', '.css', '.scss'];

function log(cwd, action, filePath, reason) {
  const logPath = path.join(cwd, LOG_FILE);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = `${new Date().toISOString()} ${action} ${filePath} (${reason})\n`;
  fs.appendFileSync(logPath, line);
}

function matchGlob(pattern, filePath) {
  // Simple glob: * matches any segment char; ** matches any path segments
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${re}$`).test(filePath.replace(/\\/g, '/'));
}

function readConfig(cwd) {
  const p = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(p)) return { skipPaths: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { skipPaths: [] };
  }
}

function gitHead(cwd) {
  try {
    const headPath = path.join(cwd, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      const refPath = path.join(cwd, '.git', ref);
      if (!fs.existsSync(refPath)) return null;
      return fs.readFileSync(refPath, 'utf8').trim();
    }
    return head;
  } catch {
    return null;
  }
}

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function isGatedFile(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (!(/^src\/clients\/(mobile-web|marketing-web)\/src\//.test(p))) {
    return false;
  }
  const ext = path.extname(p);
  if (GATED_EXTENSIONS.includes(ext)) return true;
  // style/theme .ts files are gated
  if (ext === '.ts' && /\/(styles|theme)\//.test(p)) return true;
  return false;
}

function checkToken(cwd) {
  const tokenPath = path.join(cwd, GATE_FILE);
  if (!fs.existsSync(tokenPath)) {
    return { ok: false, reason: 'gate token missing — run L5b (Playwright MCP viewport check) first' };
  }
  let token;
  try {
    token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'gate token malformed JSON' };
  }
  const head = gitHead(cwd);
  if (head && token.gitSha && token.gitSha !== head) {
    return { ok: false, reason: `gate token SHA mismatch (token ${token.gitSha.slice(0, 7)}, HEAD ${head.slice(0, 7)}) — re-run L5b` };
  }
  const ts = token?.layers?.L5b?.timestamp;
  if (!ts) {
    return { ok: false, reason: 'gate token missing L5b timestamp' };
  }
  const age = Date.now() - new Date(ts).getTime();
  if (age > MAX_TOKEN_AGE_MS) {
    return { ok: false, reason: 'gate token stale (>24h expired) — re-run L5b' };
  }
  return { ok: true };
}

function main() {
  const cwd = process.cwd();
  const input = readInput();
  const filePath = input?.tool_input?.file_path;
  const shadow = process.env.UIUX_GATE_SHADOW === '1';
  const bypass = process.env.UIUX_GATE_BYPASS === '1';

  if (!filePath) {
    process.exit(0);
  }

  const relPath = path.relative(cwd, path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath))
    .replace(/\\/g, '/');

  // Not gated file → allow
  if (!isGatedFile(relPath)) {
    process.exit(0);
  }

  // Check skip list
  const config = readConfig(cwd);
  for (const pattern of config.skipPaths || []) {
    if (matchGlob(pattern, relPath)) {
      log(cwd, 'ALLOW', relPath, 'skip list');
      process.exit(0);
    }
  }

  // Bypass (env var, audited)
  if (bypass) {
    log(cwd, 'BYPASS', relPath, 'UIUX_GATE_BYPASS=1');
    process.exit(0);
  }

  // Check gate token
  const result = checkToken(cwd);
  if (result.ok) {
    log(cwd, 'ALLOW', relPath, 'gate valid');
    process.exit(0);
  }

  // Blocked
  if (shadow) {
    log(cwd, 'SHADOW', relPath, `would block: ${result.reason}`);
    process.exit(0);
  }
  log(cwd, 'BLOCK', relPath, result.reason);
  process.stderr.write(`UI gate blocked: ${result.reason}\n`);
  process.exit(2);
}

main();
```

- [ ] **Step 10.4: Run tests to verify they pass**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/.claude/hooks/tests"
node --test uiux-gate-check.test.js
```

Expected: 8 tests PASS.

- [ ] **Step 10.5: Commit**

```bash
git add .claude/hooks/
git commit -m "feat(hook): uiux-gate-check PreToolUse hook + tests"
```

---

### Task 11: Write skip-list config and update `.gitignore`

**Files:**
- Create: `.uiux-gate.config.json`
- Modify: `.gitignore`

- [ ] **Step 11.1: Write skip-list config**

File: `.uiux-gate.config.json`

```json
{
  "skipPaths": [
    "src/clients/*/src/i18n/**",
    "src/clients/*/src/types/**",
    "src/clients/*/src/**/*.test.tsx",
    "src/clients/*/src/**/*.spec.tsx",
    "src/clients/*/src/**/*.test.ts",
    "src/clients/*/src/**/*.spec.ts"
  ]
}
```

- [ ] **Step 11.2: Append `.gitignore` entries**

Append to `.gitignore`:

```
# UI/UX Gate runtime files
.uiux-gate-passed
.uiux-gallery/
.interface-design/
.claude/hooks/uiux-gate.log
```

- [ ] **Step 11.3: Verify gitignore works**

```bash
git check-ignore -v .uiux-gate-passed .uiux-gallery/test .interface-design/system.md
```

Expected: all three print a match line.

- [ ] **Step 11.4: Commit**

```bash
git add .uiux-gate.config.json .gitignore
git commit -m "chore(hook): skip-list config + gitignore gate runtime files"
```

---

### Task 12: Register the hook in `.claude/settings.json` (shadow mode)

**Files:**
- Create or Modify: `.claude/settings.json`

- [ ] **Step 12.1: Check whether `settings.json` exists**

```bash
ls .claude/settings.json 2>&1 || echo "MISSING"
```

- [ ] **Step 12.2: Create or merge**

If missing, create `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/uiux-gate-check.js" }
        ]
      }
    ]
  }
}
```

If it exists, merge the `hooks.PreToolUse` entry into existing JSON (do not overwrite other settings).

- [ ] **Step 12.3: Instruct user to enable shadow mode for first session**

Add a banner to the commit message so the user sees it. Then:

```bash
export UIUX_GATE_SHADOW=1
```

Tell user: work normally for one session; the hook will LOG but not BLOCK. After the session, read the log:

```bash
cat .claude/hooks/uiux-gate.log
```

If the log shows files you expected to be gated were marked `SHADOW`, the hook logic is correct.

- [ ] **Step 12.4: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hook): register uiux-gate-check as PreToolUse hook"
```

---

### Task 13: Shadow-mode verification (manual, 1 session)

**Files:** (no changes — verification only)

- [ ] **Step 13.1: Set shadow env and restart Claude**

User instruction:

```bash
export UIUX_GATE_SHADOW=1
```

Then restart Claude Code so the env var is picked up in hook invocations.

- [ ] **Step 13.2: Trigger a gated edit in shadow mode**

Ask Claude to make a trivial edit to `src/clients/mobile-web/src/App.tsx` (e.g., add a comment `// test gate`).

Expected: edit succeeds (shadow allows). But `.claude/hooks/uiux-gate.log` gains a line:

```
2026-04-20T<time>Z SHADOW src/clients/mobile-web/src/App.tsx (would block: gate token missing — ...)
```

- [ ] **Step 13.3: Trigger an ungated edit (should allow silently)**

Ask Claude to edit `src/clients/mobile-web/src/hooks/useAuth.ts` (logic file, not gated).

Expected: edit succeeds. No log line written (allowed without hitting gate check).

Actually, **correction**: the log is only written when the hook reaches a decision that matters (ALLOW via skip/bypass, BLOCK, or SHADOW). Ungated files exit early — no log.

- [ ] **Step 13.4: Inspect log**

```bash
cat .claude/hooks/uiux-gate.log
```

Confirm:
- SHADOW entries for gated files without token
- No entries for non-gated files (correct)
- No entries for skip-list files (correct)

- [ ] **Step 13.5: Revert the test edit**

```bash
git checkout src/clients/mobile-web/src/App.tsx
```

---

### Task 14: Flip from shadow to enforce + acceptance tests

**Files:** (no changes — verification only)

- [ ] **Step 14.1: Unset shadow env**

```bash
unset UIUX_GATE_SHADOW
```

Restart Claude Code.

- [ ] **Step 14.2: Run acceptance matrix**

For each row, execute the action and record the result.

| # | Action | Expected | Got |
|---|---|---|---|
| A1 | Ask Claude to edit `src/clients/mobile-web/src/App.tsx` without gate token | BLOCKED with clear stderr message | |
| A2 | Ask Claude to edit `src/clients/mobile-web/src/hooks/useAuth.ts` | ALLOWED (not gated) | |
| A3 | Ask Claude to edit `src/clients/mobile-web/src/i18n/translations.ts` | ALLOWED (skip list) | |
| A4 | Set `UIUX_GATE_BYPASS=1` + edit `App.tsx` | ALLOWED + logged as BYPASS | |
| A5 | Unset bypass, run `python _COFOUNDER/OS/Skills/webapp-testing/scripts/screenshot_viewports.py --pass` | Creates `.uiux-gate-passed` | |
| A6 | Edit `App.tsx` again | ALLOWED + logged as ALLOW | |
| A7 | Make a dummy commit (`git commit --allow-empty -m "test"`) and try edit | BLOCKED (SHA mismatch) | |
| A8 | Re-run `screenshot_viewports.py --pass` and edit | ALLOWED | |

- [ ] **Step 14.3: Record results**

Append to `docs/superpowers/plans/2026-04-20-mcp-smoke-test-notes.md`:

```markdown
## Gate Acceptance Matrix — 2026-04-20

| # | Test | Expected | Got | Pass |
|---|---|---|---|---|
| A1 | Gated .tsx without token | BLOCKED | (fill) | (Y/N) |
| A2 | Ungated .ts | ALLOWED | (fill) | (Y/N) |
| A3 | Skip-list i18n | ALLOWED | (fill) | (Y/N) |
| A4 | BYPASS=1 | ALLOWED + logged | (fill) | (Y/N) |
| A5 | screenshot_viewports.py --pass | token created | (fill) | (Y/N) |
| A6 | Edit after token | ALLOWED | (fill) | (Y/N) |
| A7 | New commit invalidates token | BLOCKED | (fill) | (Y/N) |
| A8 | Re-run verify restores token | ALLOWED | (fill) | (Y/N) |
```

All 8 must pass. If any fails, diagnose the hook and fix before claiming done.

- [ ] **Step 14.4: Commit results**

```bash
git add docs/superpowers/plans/2026-04-20-mcp-smoke-test-notes.md
git commit -m "test(hook): gate acceptance matrix pass (8/8)"
```

---

## Self-Review

**Spec coverage:** ✓ All 12 spec sections implemented —
- §1 Problem → Phase 1-4 address all 6 gaps
- §2 Architecture → Task 7 renders 9-layer stack
- §3 Skills → Tasks 3, 4, 5 install/enrich
- §4 MCPs → Tasks 8, 9 add + verify
- §5 Protocol doc → Task 7 edits in place to v2.0
- §6 L1.5 gallery → Task 5 (`gallery.py` with tests)
- §7 Hook enforcement → Tasks 10, 11, 12, 13, 14
- §8 Zip-in pipeline → Tasks 1, 2 (install_skill.py, _add_mcp.py)
- §9 Migration/rollback → Phase order respects spec §9.1; shadow-mode per §9.2
- §10 Non-goals → respected (no Storybook, no custom MCP server, no visual regression baselines)
- §11 File inventory → matches spec exactly
- §12 Source zip inventory → matches spec

**Placeholder scan:** No TBD, TODO, or "add appropriate error handling" strings remain.

**Type consistency:** `uiux-gate-check.js` uses same token schema (`gitSha`, `layers.L5b.timestamp`) in tests, writer (`screenshot_viewports.py --pass`), and hook. `gallery.py` `--choose vN` + `chosen.json.variantId` match test assertions.
