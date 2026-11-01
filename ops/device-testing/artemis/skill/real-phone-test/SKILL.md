---
name: real-phone-test
description: Walk ShramSafal farmer journeys on a real Android test phone with Google Artemis (its MCP tools mobile_run_task, mobile_manage_task, mobile_get_device_state, mobile_inspect_trace, mobile_diagnose), collect screenshot evidence, and report in founder language. Use when the founder asks to test on a real phone, run Founder Acceptance Gate journeys on a handset, check a new APK on a device, or reproduce a field bug on the phone. Produces evidence for the founder's tick; never ticks a gate itself.
---

# Real-phone test (Artemis)

## Why this exists

Some failures only happen on a real phone: the Android WebView, mobile data, going offline and
back, the Marathi keyboard, permission prompts. The plans require a real-handset run before every
deploy (Founder Acceptance Gate), and the doctrine judges releases by journeys (W3). Artemis lets
Claude operate a USB-connected Android phone from plain-language instructions and records every
step as screenshots and a trace.

**What it is not**

- **Not a pass/fail gate.** Artemis's "succeeded" is an AI's opinion. The output is evidence; the
  founder still verifies and ticks the gate (Definition of Done).
- **Cannot test voice.** It cannot speak into the microphone. Voice-note journeys stay manual.
- **Not a replacement** for `npx vitest run`, `dotnet test`, or the Playwright suite.

## Hard rules: stop and tell the founder if any is not met

1. **Dedicated test phone only.** Never the founder's personal phone, never a farmer's phone.
   Artemis installs an accessibility helper, keeps the screen awake, and in Pro mode can run any
   shell command on the phone.
2. **Test accounts only.** Every screenshot, and every word typed into a task, goes to Google's
   Gemini API. Never log in as a real farmer. Never type a real farmer's name, phone number or
   amounts into a task.
3. **Stay inside ShramSafal.** Always pass `locked_app_package="com.agrisync.shramsafal"`.
4. **Never wipe the app.** Every task text must contain:
   `Do not clear app data, uninstall, reinstall or force-stop ShramSafal.`
   The phone may hold entries that have not synced yet (P10). Only a journey the founder
   explicitly calls "clean install" may do otherwise, and only after they confirm nothing unsynced
   is on the phone.
5. **This is production.** There is no staging server; the APK talks to the live API. Every
   journey writes real rows under the test account. Run what was asked, not extra rounds. Name
   the test account (label, never password) in the report.
6. **Keys never go through the chat.** The Gemini key lives in Artemis's `.env`. If
   `mobile_diagnose` says it is missing, tell the founder which file to paste it into.
7. **Restore the network.** Any journey that turns Wi-Fi or mobile data off must turn both back
   on at the end, and you must confirm it with `mobile_get_device_state`.

## Preflight: report each line as Done / Not done

1. `mobile_diagnose` returns `ready` or `degraded`. If the tool is not in your list at all, the
   MCP server did not start: run `python ops/device-testing/artemis/install_artemis.py --check`
   and relay the result.
2. `adb devices -l` shows exactly one authorized device. More than one: ask which serial.
3. The founder confirms: this is the dedicated test phone, and which test account is logged in.
   The founder logs that account in by hand before the first run, so no password enters a task.
4. APK version, read-only: `adb shell dumpsys package com.agrisync.shramsafal` (the
   `versionName` line).
5. Network: Wi-Fi or mobile data, and whether the founder wants a slow-network run.

## Choosing the mode

- **Flash**: one clear path ("save an irrigation log for this plot"). Fast, no plan, no ADB
  shell, no final report.
- **Pro**: offline/online switching (needs the ADB shell), multi-step journeys, anything that
  needs a written report. Pass `verification_level="checkpoints"` and an
  `expected_output_desc` that asks for one line per checkpoint with what was seen on screen.

## Running a journey

1. Copy the journey text from `journeys.md` exactly and fill in its placeholders. Keep the
   safety sentence from rule 4.
2. `mobile_run_task(task_desc=..., model="Flash"|"Pro", locked_app_package="com.agrisync.shramsafal",
   device_serial=..., verification_level=..., expected_output_desc=...)`
3. Check `mobile_manage_task(action="status", trace_id=...)` about once a minute. Tasks can
   stall silently.
4. When it ends: read `stderr_log`. For Pro, read `notes_dir/output.md`. Use
   `mobile_inspect_trace` to fetch the screenshot behind every checkpoint.
5. First run of a new journey is discovery. If Artemis took a wrong turn because the
   instruction was unclear, fix the journey text in `journeys.md` and rerun once.

## Judging the result (P4, E6, W6)

- A checkpoint is **Done** only when a screenshot shows the expected outcome. If there is no
  screenshot, it is **Needs review**, whatever Artemis reported.
- Never state a number that was not visible on screen.
- Classify every failure:
  - **App bug**: evidence plus steps to reproduce.
  - **Agent mistake**: Artemis tapped the wrong thing or timed out. Rerun once with clearer text,
    then call it **Needs review**.
  - **Environment**: phone locked, no network, device busy.
- What a phone run cannot see, such as whether the server stored a row, stays **Not verified
  here**. Say which separate check would prove it.

## Report to the founder

Use the founder's response format (Founder Summary, Product Impact, What Changed, Risk or
Caution, What I Should Check, Next Step). Include:

- a table: journey, checkpoint, Done / Not done / Needs review, screenshot path
- APK versionName, phone model, test account label, network, Flash or Pro, trace_id
- plain-language bug descriptions ("after turning the internet back on, the irrigation entry
  disappeared from today's list")

Save the run note to `_COFOUNDER/OS/State/DeviceTests/<YYYY-MM-DD>-<journey>.md`. Create the
folder if it is missing. Never save screenshots or run notes in the public repo.

## Deeper reference

Artemis's full agent rules: `<artemis>/mcp_server/rules.md` (about 13.6 KB). Read it only when
diagnosing Artemis itself. It is deliberately not installed globally.
