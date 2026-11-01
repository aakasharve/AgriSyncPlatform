#!/usr/bin/env python3
"""Install Google Artemis (an AI agent that operates a real Android phone) into the
AgriSync cofounder setup, so Claude Code can walk ShramSafal journeys on a test phone.

Run on the founder's laptop, from anywhere:
    python ops/device-testing/artemis/install_artemis.py              # install or repair
    python ops/device-testing/artemis/install_artemis.py --check      # report only
    python ops/device-testing/artemis/install_artemis.py --uninstall  # undo our wiring

Standard library only. Fail-closed: every file it writes must be gitignored in this
repo, or it refuses to write anything, so no private config can reach the public repo.

What it touches:
  <repo>/../artemis/                              Artemis checkout, pinned to ARTEMIS_PIN
  <repo>/.mcp.json                                adds the "artemis" MCP server (project scope)
  <repo>/_COFOUNDER/OS/Skills/real-phone-test/    the skill (canonical copy)
  <repo>/_COFOUNDER/OS/Skills/INDEX.md            one row, same format as install_skill.py
  <repo>/.claude/skills/real-phone-test/SKILL.md  pointer, so Claude Code can invoke the skill
  If _COFOUNDER/OS/Skills/ does not exist, the full skill goes to .claude/skills/ instead.

What it deliberately does NOT do:
  * run Artemis's start.bat / start.sh. Their MCP prompt defaults to "Y" and writes
    Artemis's ~13.6 KB rules file into the GLOBAL config of every AI tool on the
    machine, so it would load into every Claude session (marketing included). The
    skill carries the rules that matter and points at the full file.
  * write or print any API key. The Gemini key is pasted into <artemis>/.env by hand.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ARTEMIS_URL = "https://github.com/google/artemis.git"
# Pinned: the MCP server was booted and its five tools listed at this commit
# (2026-10-25). Upgrades are a deliberate edit here, never a silent pull.
ARTEMIS_PIN = "351ca8422f7b5b54e80a9c1ce03a222e02415b6b"
SERVER_NAME = "artemis"
SKILL_NAME = "real-phone-test"
# Artemis's object detector needs a Gemini model, so a Google key is required even
# when another provider is configured.
GEMINI_KEYS = ("GEMINI_API_KEY", "GOOGLE_API_KEY")

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_SRC = SCRIPT_DIR / "skill" / SKILL_NAME


class InstallError(Exception):
    pass


def repo_root():
    return SCRIPT_DIR.parents[2]


def is_windows():
    return os.name == "nt"


def venv_python(artemis_dir, windows=None):
    windows = is_windows() if windows is None else windows
    if windows:
        return Path(artemis_dir) / ".venv" / "Scripts" / "python.exe"
    return Path(artemis_dir) / ".venv" / "bin" / "python"


def mcp_entry(artemis_dir, windows=None):
    """The same server block `artemis mcp --generate-config claude` prints, written at
    project scope instead of into ~/.claude.json."""
    return {
        "type": "stdio",
        "command": str(venv_python(artemis_dir, windows)),
        "args": ["-m", "mcp_server"],
        "env": {
            "PYTHONUNBUFFERED": "1",
            "PYTHONPATH": str(artemis_dir),
            "ARTEMIS_DESKTOP_NOTIFY": "true",
        },
    }


def assert_private(repo, paths):
    """Refuse unless git ignores every path. A path git cannot judge counts as public."""
    public = []
    for p in paths:
        rel = Path(os.path.relpath(p, repo)).as_posix()  # git wants / on Windows too
        # Without --no-index a file git already tracks never counts as ignored.
        r = subprocess.run(["git", "-C", str(repo), "check-ignore", "-q", rel],
                           capture_output=True)
        if r.returncode != 0:
            public.append(rel)
    if public:
        raise InstallError("refusing to write files git would track: " + ", ".join(public))


def _load_json(path):
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return {}
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise InstallError(f"{path} is not valid JSON ({exc}); fix it by hand, nothing was changed")
    if not isinstance(data, dict):
        raise InstallError(f"{path} is not a JSON object; nothing was changed")
    return data


def merge_mcp(mcp_file, entry):
    """Add or replace only our server. Returns True when the file changed."""
    data = _load_json(mcp_file)
    servers = data.setdefault("mcpServers", {})
    if servers.get(SERVER_NAME) == entry:
        return False
    servers[SERVER_NAME] = entry
    mcp_file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return True


def remove_mcp(mcp_file):
    data = _load_json(mcp_file)
    if SERVER_NAME not in data.get("mcpServers", {}):
        return False
    del data["mcpServers"][SERVER_NAME]
    mcp_file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return True


def skill_meta(skill_md):
    text = Path(skill_md).read_text(encoding="utf-8")
    m = re.search(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    front = m.group(1) if m else ""
    name = re.search(r"^name:\s*(.+?)\s*$", front, re.MULTILINE)
    desc = re.search(r"^description:\s*(.+?)\s*$", front, re.MULTILINE)
    return (name.group(1) if name else SKILL_NAME,
            desc.group(1) if desc else "(no description)")


def update_index(index_file, name, desc):
    """Same row format and dedupe rule as _COFOUNDER/OS/Skills/_Packages/install_skill.py."""
    text = index_file.read_text(encoding="utf-8") if index_file.exists() else "# Index\n"
    row = f"| `{name}` | {desc} |"
    pattern = re.compile(rf"^\|\s*`{re.escape(name)}`\s*\|.*\|\s*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(lambda _: row, text)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += row + "\n"
    index_file.write_text(text, encoding="utf-8")


def remove_index_row(index_file, name):
    if not index_file.exists():
        return
    text = index_file.read_text(encoding="utf-8")
    pattern = re.compile(rf"^\|\s*`{re.escape(name)}`\s*\|.*\|[ \t]*\n?", re.MULTILINE)
    index_file.write_text(pattern.sub("", text), encoding="utf-8")


def skill_paths(repo):
    skills_dir = repo / "_COFOUNDER" / "OS" / "Skills"
    return {
        "skills_dir": skills_dir,
        "canonical": skills_dir / SKILL_NAME,
        "index": skills_dir / "INDEX.md",
        "claude": repo / ".claude" / "skills" / SKILL_NAME,
    }


def pointer_text(name, desc):
    return (
        "---\n"
        f"name: {name}\n"
        f"description: {desc}\n"
        "---\n\n"
        f"Source of truth: `_COFOUNDER/OS/Skills/{SKILL_NAME}/SKILL.md`.\n"
        "Read that file and `journeys.md` beside it now, then follow them exactly.\n"
    )


def install_skill(repo, skill_src=SKILL_SRC):
    """Returns (written paths, warning or None)."""
    p = skill_paths(repo)
    name, desc = skill_meta(skill_src / "SKILL.md")
    if p["skills_dir"].is_dir():
        assert_private(repo, [p["canonical"], p["index"], p["claude"]])
        if p["canonical"].exists():
            shutil.rmtree(p["canonical"])
        shutil.copytree(skill_src, p["canonical"])
        update_index(p["index"], name, desc)
        if p["claude"].exists():
            shutil.rmtree(p["claude"])
        p["claude"].mkdir(parents=True)
        (p["claude"] / "SKILL.md").write_text(pointer_text(name, desc), encoding="utf-8")
        return [p["canonical"], p["index"], p["claude"] / "SKILL.md"], None
    assert_private(repo, [p["claude"]])
    if p["claude"].exists():
        shutil.rmtree(p["claude"])
    shutil.copytree(skill_src, p["claude"])
    return [p["claude"]], ("_COFOUNDER/OS/Skills/ not found: installed the full skill to "
                           ".claude/skills/ only. Re-run after the cofounder repo is present.")


def remove_skill(repo):
    p = skill_paths(repo)
    removed = []
    for d in (p["canonical"], p["claude"]):
        if d.exists():
            shutil.rmtree(d)
            removed.append(d)
    remove_index_row(p["index"], SKILL_NAME)
    return removed


def env_key_status(env_file):
    """Which Gemini keys hold a value. Values are never returned or printed."""
    status = {k: False for k in GEMINI_KEYS}
    if not env_file.exists():
        return status
    for line in env_file.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$", line)
        if m and m.group(1) in status:
            value = re.split(r"(?:^|\s)#", m.group(2))[0].strip().strip("'\"")
            status[m.group(1)] = bool(value)
    return status


def git(args, cwd=None):
    r = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise InstallError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def head_commit(artemis_dir):
    try:
        return git(["rev-parse", "HEAD"], cwd=artemis_dir)
    except InstallError:
        return None


def ensure_checkout(artemis_dir):
    if not artemis_dir.exists():
        print(f"  cloning Artemis into {artemis_dir} ...")
        git(["clone", ARTEMIS_URL, str(artemis_dir)])
    origin = git(["remote", "get-url", "origin"], cwd=artemis_dir)
    if "google/artemis" not in origin:
        raise InstallError(f"{artemis_dir} is not a google/artemis checkout (origin: {origin})")
    if head_commit(artemis_dir) == ARTEMIS_PIN:
        return
    # Only tracked changes block a checkout; .venv and .env are untracked and survive it.
    if git(["status", "--porcelain", "--untracked-files=no"], cwd=artemis_dir):
        raise InstallError(f"{artemis_dir} has local edits; not moving it to the pinned commit")
    git(["fetch", "origin"], cwd=artemis_dir)
    git(["checkout", "--detach", ARTEMIS_PIN], cwd=artemis_dir)


def run_deps(artemis_dir):
    """Artemis's own toolchain installer: uv, adb, scrcpy, ffmpeg, `uv sync`, and .env from
    .env.example. Without --Launch it neither starts the UI nor touches any MCP config."""
    if is_windows():
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
               str(artemis_dir / "scripts" / "install_deps.ps1")]
    else:
        cmd = ["bash", str(artemis_dir / "scripts" / "install_deps.sh")]
    if subprocess.run(cmd, cwd=artemis_dir).returncode != 0:
        raise InstallError("Artemis toolchain install failed; read the output above")


def check(repo, artemis_dir):
    """[(label, ok, detail)]. Read-only."""
    p = skill_paths(repo)
    keys = env_key_status(artemis_dir / ".env")
    expected = mcp_entry(artemis_dir)
    try:
        current = _load_json(repo / ".mcp.json").get("mcpServers", {}).get(SERVER_NAME)
    except InstallError as exc:
        current = None
        mcp_detail = str(exc)
    else:
        mcp_detail = "registered" if current == expected else (
            "missing" if current is None else "present but points elsewhere")
    head = head_commit(artemis_dir) if artemis_dir.exists() else None
    if p["skills_dir"].is_dir():
        skill_ok = (p["canonical"] / "SKILL.md").exists() and (p["claude"] / "SKILL.md").exists()
        skill_detail = "canonical + pointer" if skill_ok else "missing"
    else:
        skill_ok = (p["claude"] / "SKILL.md").exists()
        skill_detail = ".claude/skills only (no _COFOUNDER)" if skill_ok else "missing"
    return [
        ("Artemis checkout", artemis_dir.exists(), str(artemis_dir)),
        ("Pinned commit", head == ARTEMIS_PIN, (head or "none")[:12] + f" (want {ARTEMIS_PIN[:12]})"),
        ("Python environment", venv_python(artemis_dir).exists(), str(venv_python(artemis_dir))),
        ("Gemini key in .env", any(keys.values()),
         "set" if any(keys.values()) else f"missing: paste it into {artemis_dir / '.env'}"),
        ("MCP server in .mcp.json", current == expected, mcp_detail),
        ("Skill " + SKILL_NAME, skill_ok, skill_detail),
    ]


def print_report(rows):
    for label, ok, detail in rows:
        print(f"  [{'Done' if ok else 'Not done'}] {label}: {detail}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Install Artemis real-phone testing for AgriSync")
    ap.add_argument("--artemis-dir", help="where Artemis lives (default: next to this repo)")
    ap.add_argument("--check", action="store_true", help="report state, change nothing")
    ap.add_argument("--uninstall", action="store_true",
                    help="remove our MCP entry and skill; leaves the Artemis folder")
    ap.add_argument("--skip-deps", action="store_true",
                    help="skip Artemis's toolchain installer (adb, scrcpy, ffmpeg, uv sync)")
    args = ap.parse_args(argv)

    repo = repo_root()
    artemis_dir = Path(args.artemis_dir).resolve() if args.artemis_dir else repo.parent / "artemis"
    try:
        if artemis_dir == repo or repo in artemis_dir.parents:
            raise InstallError(f"keep Artemis outside this repo (got {artemis_dir})")
        if args.check:
            rows = check(repo, artemis_dir)
            print_report(rows)
            return 0 if all(ok for _, ok, _ in rows) else 1
        if args.uninstall:
            assert_private(repo, [repo / ".mcp.json"])
            print("  MCP entry removed" if remove_mcp(repo / ".mcp.json") else "  no MCP entry")
            for d in remove_skill(repo):
                print(f"  removed {d}")
            print(f"  Left in place: {artemis_dir} (delete it by hand if you are done).")
            print("  On the phone, remove the helper first: uv run artemis helper uninstall")
            return 0
        assert_private(repo, [repo / ".mcp.json"])
        ensure_checkout(artemis_dir)
        if not args.skip_deps:
            run_deps(artemis_dir)
        merge_mcp(repo / ".mcp.json", mcp_entry(artemis_dir))
        _, warning = install_skill(repo)
        if warning:
            print("  WARNING: " + warning)
        print()
        rows = check(repo, artemis_dir)
        print_report(rows)
        print("\n  Next, by hand:")
        print(f"   1. Paste a Gemini API key into {artemis_dir / '.env'} (GEMINI_API_KEY=...).")
        print("      Use a separate Google project with billing on, not the app's own key.")
        print("   2. Test phone: Developer options > USB debugging ON, plug in, tap Allow.")
        print("   3. Restart Claude Code in this repo and approve the 'artemis' MCP server.")
        print(f"   4. Ask Claude: /{SKILL_NAME}")
        return 0 if all(ok for _, ok, _ in rows) else 1
    except InstallError as exc:
        print(f"  ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
