# Real-phone testing with Google Artemis

Lets Claude Code drive a USB-connected Android **test** phone through ShramSafal journeys and
bring back screenshot evidence for the Founder Acceptance Gate. Feasibility, risks and decisions:
[`docs/superpowers/specs/2026-10-25-artemis-real-phone-testing.md`](../../../docs/superpowers/specs/2026-10-25-artemis-real-phone-testing.md).

## Install (founder laptop, once)

Needs `git` and Python 3.10+. Artemis's own installer adds `uv`, `adb`, `scrcpy` and `ffmpeg`
in user space and may ask before using WinGet.

```powershell
python ops/device-testing/artemis/install_artemis.py
```

Then:

1. Paste a Gemini API key into `..\artemis\.env` as `GEMINI_API_KEY=...`. Use a separate Google
   project with billing on, not the app's own key.
2. On the test phone, turn on Developer options > USB debugging, plug it in, and tap Allow.
3. Restart Claude Code in this repo and approve the `artemis` MCP server.
4. Ask Claude: `/real-phone-test`

| Command | What it does |
|---|---|
| `install_artemis.py --check` | Shows what is done and what is missing. Changes nothing. |
| `install_artemis.py --uninstall` | Removes our MCP entry and the skill. The Artemis folder stays. |
| `install_artemis.py --skip-deps` | Repairs the wiring without rerunning Artemis's toolchain installer. |

## What gets written

All of it is gitignored, and the installer refuses to write any file git would track.

- `../artemis/`: the Artemis checkout, pinned to one reviewed commit (`ARTEMIS_PIN`).
- `.mcp.json`: the `artemis` server entry. It applies to this project only, not every Claude
  session.
- `_COFOUNDER/OS/Skills/real-phone-test/`: the skill, plus one row in `INDEX.md`.
- `.claude/skills/real-phone-test/SKILL.md`: a pointer to the skill, so Claude Code can run it.

The installer does not run Artemis's `start.bat`. Its default answer installs Artemis's rules
into every AI tool's global settings.

## Tests

```bash
cd ops/device-testing/artemis && python3 -m unittest -v test_install_artemis
```
