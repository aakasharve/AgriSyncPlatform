# Real-phone testing with Google Artemis: feasibility and integration

**Date:** 2026-10-25 · **Status:** Code-complete, not tested on a phone · **Spec ID:** none yet.
`_COFOUNDER/specs/_active/` was not available in the session that wrote this, so the founder
must assign one.
**Artemis evaluated at:** `google/artemis@351ca8422f7b5b54e80a9c1ce03a222e02415b6b` (2026-09-28)

## Verdict

**It suits us, with conditions.** It is the right tool for one job: walking farmer journeys on a
real Android handset and bringing back screenshot evidence before the founder ticks the
Acceptance Gate. It is **not** a CI gate, it **cannot test voice**, and it must run on a
**dedicated test phone with test accounts only**.

**Integration: one skill plus one project-scoped MCP server. No plugin.** A plugin earns its
place when it has to enforce gates or hooks, as `agrisync-deploy` does. Here the only control
that matters is how the agent behaves, and a skill carries that.

## The requirement it serves

The repo already demands a real-device run and has no tool for it:

- Every deploy plan has a **Founder Acceptance Gate**: "Verify on a real device" (for example
  `docs/superpowers/plans/2026-08-15-launch-readiness-non-oversight.md`, six journeys).
- `docs/DECISIONS-BEFORE-FIRST-FARMERS-2026-08-23.md` item 9: "Run the app end-to-end yourself,
  on a real phone, on mobile data."
- Doctrine **W3**: the acceptance standard is journeys, not bug counts.
- Today's automated tests (vitest, Playwright `e2e/`) run in a desktop browser. None touches the
  Android WebView, the phone's network switch, or the Marathi keyboard.

## What Artemis is (checked in its code, not only its README)

| Claim | Evidence at the pinned commit |
|---|---|
| Drives a real Android phone over USB (or an emulator) from plain-language tasks | README Quick Start; `artemis/drivers/android/` |
| Claude Code integration through MCP, with 5 tools | **Booted here**: `mobile_diagnose`, `mobile_get_device_state`, `mobile_inspect_trace`, `mobile_manage_task`, `mobile_run_task` (server 1.29.0) |
| Types Marathi | Non-ASCII text goes through the on-phone helper, which sets the focused field's text through accessibility (`ACTION_SET_TEXT`). `adb input text` cannot type Marathi, and it is used only for plain ASCII. See `artemis/drivers/android/input_ime.py`, `artemis/clients/accessibility_client.py` and `packages/artemis-accessibility-helper/.../GestureController.java` |
| Can see inside a WebView app like ShramSafal | Reads the accessibility tree that Android WebView exposes while an accessibility service is running, and falls back to visual locating from screenshots. It also tries to force WebView accessibility flags, which only works on rooted or engineering phones (`artemis/sdk/agent.py`) |
| Can stay inside one app | `mobile_run_task(locked_app_package=...)` |
| Can switch the network off and on | Pro profile has an ADB shell (`artemis/tools/command_tool.py`) |
| Windows support | `start.bat`, `scripts/install_deps.ps1` |
| License | Apache-2.0 |

## Fit against our needs

| Need | Fit | Note |
|---|---|---|
| Founder Acceptance Gate journeys on a handset | **Good** | J1 to J6 in the skill's `journeys.md` |
| Offline capture, then reconnect | **Good** (Pro) | `svc wifi/data disable/enable` |
| Marathi text survives a save | **Likely** | Code path exists. Not yet run against our React inputs (J4 is the test) |
| Two farmers on one phone stay separate | **Good** (Pro) | Both test accounts' credentials go to Gemini |
| Voice note capture (our core path) | **No** | It cannot speak into the microphone. Stays manual |
| Proof that the server stored the row | **No** | A phone run sees the phone only. Needs a second device or a read-only server check |
| CI pass/fail gate | **No** | AI judgment, not deterministic. Evidence only |

## Risks, and what the integration does about each

| Risk | What happens without care | Mitigation in this change |
|---|---|---|
| Screenshots and typed text go to Google's Gemini API | Farmer data could leave the country through a test run | Skill rule 2: test accounts only, no real farmer data typed |
| Gemini free tier may use prompts to improve Google's products | Test screenshots used for training | Use a separate Google project with billing on |
| Testing shares the app's Gemini quota | A long test run could starve farmers' voice parsing | Use a separate key and project (README step 1) |
| Pro mode runs any shell command on the phone | `pm clear` would wipe unsynced entries (P10) | Skill rule 4 sentence goes into every task. `locked_app_package` is always set. Dedicated phone only |
| No staging server; the APK talks to production | Test rows land in the live database | Run only what was asked. The report names the test account. **Decision 2 below** |
| The default Artemis installer writes ~13.6 KB of rules into every AI tool's global config | Extra context in every Claude session, marketing included | Our installer skips `start.bat` and registers MCP at project scope only |
| A young project: first commit 2026-08-13, last 2026-09-28, 121 commits | Breaking changes, possible abandonment | Pinned to one reviewed commit. Upgrading is a deliberate edit |
| Its locator depends on a **preview** Gemini model (`gemini-robotics-er-2-preview`, `config/artemis.jsonc`) | Google can withdraw a preview model | Watch for failures. `--check` and `mobile_diagnose` surface them |
| "Succeeded" is an AI's opinion | A false pass reaches the gate | Skill: a checkpoint counts as Done only with a screenshot. The founder still ticks the gate |
| Disk | — | The Python environment measured **1.2 GB** on Linux |
| Cost | — | **Not measured** (E6). Read the Google AI Studio usage page after the first J1 run |

## Integration design

```
founder laptop
├── AgriSyncPlatform/
│   ├── .mcp.json                         (gitignored)  "artemis" server, this project only
│   ├── .claude/skills/real-phone-test/   (gitignored)  pointer → canonical skill
│   ├── _COFOUNDER/OS/Skills/real-phone-test/  (private) SKILL.md + journeys.md, INDEX.md row
│   └── ops/device-testing/artemis/       (public)      installer, tests, skill source
└── artemis/                              (outside repo) pinned checkout, .env holds the Gemini key
          │ USB (adb)
          ▼
   dedicated Android test phone, ShramSafal APK, test account
```

The skill source sits in the public repo so it is reviewed like code. It holds no credentials,
and its journeys repeat flows already public in the deploy plans. The installer copies it into
the private cofounder library. **Decision 3 below** covers keeping it private instead.

## Change Surface

- **DB:** none. No schema, no migration, no seed. Test rows come only from founder-run journeys.
- **Backend:** none.
- **Frontend:** none. No app code, no `data-testid` changes. Journeys rely on visible text and
  the existing `aria-label="Quick Log"`.
- **Cross-cutting:** new `ops/device-testing/artemis/` (installer, unit tests, skill source,
  README) and this spec. Nothing runs in CI.

Tasks:

- [x] Evaluate Artemis against the repo's real-device requirement (this document)
- [x] Installer: pinned checkout, Artemis toolchain, project-scoped MCP, skill install; fail-closed on tracked paths
- [x] Unit tests: `python3 -m unittest -v test_install_artemis`, 18 tests passing
- [x] Skill `real-phone-test` and journeys J1 to J6, checked against the current code
- [x] Install, check and uninstall run end-to-end in a Linux cloud session against the real repo; git status stayed clean apart from the new tracked files
- [x] MCP server started from the written `.mcp.json`. `mobile_diagnose` reported `blocked` for exactly the two expected reasons: no Gemini key, no device
- [ ] Run the installer on the founder's Windows laptop
- [ ] J1 and J2 on the test phone; read the cost from AI Studio
- [ ] J3 to J6 on the test phone
- [ ] Fix journey text where Artemis took a wrong turn (first runs are discovery)

## Founder Acceptance Gate

Nothing here deploys, but the founder should verify these before relying on the tool:

1. `python ops/device-testing/artemis/install_artemis.py --check` shows every line **Done**.
2. In Claude Code, `/real-phone-test` → **J1** finishes with a screenshot of each bottom-nav
   screen.
3. **J3** (offline, then reconnect): the irrigation entry is still there after the network
   returns, **and** the phone has internet at the end.
4. **J4**: the Marathi note reads exactly `आज ठिबक सिंचन केले` on screen.
5. Compare one Artemis report against what you saw on the phone yourself. The report must not
   claim anything the screenshots do not show.

## Decisions needed

1. **Test phone.** Which handset is the dedicated test phone? It must not be anyone's daily
   phone.
2. **Production test account.** With no staging server, name one or two test farmer accounts
   whose rows everyone agrees to exclude from metrics and the trust ledger. Without this, test
   rows look like farmer activity.
3. **Where the skill source lives.** It is committed under `ops/` for review (no secrets). If
   agent skills must never be public, delete `ops/device-testing/artemis/skill/` after the
   first install and keep only the private copy.

## Alternative considered

**Maestro** (deterministic YAML flows) is the better tool for a repeatable regression suite
that must give the same answer every run without sending screenshots to a model. Artemis's own
guidance says to run a flow once to discover the path, then write a deterministic script. If
J2 and J3 become weekly checks, port them to Maestro then. Not before.
