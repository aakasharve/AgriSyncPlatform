# ShramSafal real-phone journeys

Paste each block into `mobile_run_task` as `task_desc`, filling in the `{placeholders}`.
Every block ends with the safety sentence from SKILL.md rule 4. Keep it there.

Screen facts these journeys rely on (checked in the code, 2026-10-25):

- The app may show Marathi or English. The instructions describe meaning, so the agent should
  match either language.
- To add a log, these journeys pick one specific crop and plot, so the entry shows in that plot's
  list. "Entire Farm" (संपूर्ण शेत) is a separate scope with its own panel and its own sync route
  (`logSyncMutationService.ts`, LABOUR_PHASE2 B1c). Test it as its own journey when needed.
- The add-log button is a round white button with a green "+" at the bottom-left of the log
  screen. Its accessibility label is "Quick Log". It appears only after a crop and plot are
  picked.
- The Quick Log sheet shows activity chips (irrigation, labour, inputs). Choosing one opens the
  entry screen, which has a save button.
- A successful save shows a full-screen "Saved to Ledger" confirmation (Marathi wording may
  differ).

---

## J1. Smoke: the app opens and the home screen works (Flash)

```
Open ShramSafal. Wait up to 20 seconds for it to finish loading.
Checkpoint 1: the app's main screen is visible, with no crash dialog, no blank white screen and
no "app keeps stopping" message.
Checkpoint 2: tap each item of the bottom navigation bar once, waiting 3 seconds on each. Note
any screen that is blank, shows an error, or shows raw technical text.
Do not create, save, submit, approve or delete anything.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

## J2. Save one daily log while online (Flash, or Pro for a report)

```
Open ShramSafal and go to the daily log screen.
Pick the crop "{crop}" and the plot "{plot}". Do not pick "Entire Farm".
Tap the round "+" button labelled "Quick Log" at the bottom-left.
Choose the irrigation activity chip. On the entry screen, tap the save button.
Checkpoint 1: a "Saved to Ledger" confirmation is shown (Marathi wording may differ).
Go back to the log screen for today.
Checkpoint 2: today's list shows an irrigation entry for plot "{plot}".
Report exactly what text the confirmation and the new entry show.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

## J3. Offline capture, then reconnect (Pro, verification_level="checkpoints")

```
Use the ADB shell to turn off the network: run "svc wifi disable" and "svc data disable".
Confirm the phone shows no internet connection.
Open ShramSafal, go to the daily log screen, pick the crop "{crop}" and the plot "{plot}" (not
"Entire Farm"), tap the "Quick Log" "+" button, choose irrigation, and save.
Checkpoint 1: the "Saved to Ledger" confirmation appears while offline.
Checkpoint 2: back on today's list, the irrigation entry for "{plot}" is visible.
Now restore the network: run "svc wifi enable" and "svc data enable". Wait 60 seconds with
ShramSafal open.
Checkpoint 3: the irrigation entry is still in today's list. Note any error, warning, conflict
or "not synced" message, with its exact text.
Checkpoint 4: the phone has internet again.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

A phone run cannot prove the server stored the entry. Mark that **Not verified here**. The
proof is J2/J3 followed by the same entry appearing on a second device logged in to the same
farm, or a read-only server check.

## J4. Marathi text survives a save (Pro)

```
Open ShramSafal, go to the daily log screen, pick the crop "{crop}" and the plot "{plot}" (not
"Entire Farm").
Open the observation or note option for a log and type exactly this Marathi text:
आज ठिबक सिंचन केले
Save it.
Checkpoint 1: the saved note shows exactly "आज ठिबक सिंचन केले", with no boxes, question
marks, missing letters or broken vowel signs.
Checkpoint 2: leave the screen, come back, and the same text is still shown unchanged.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

## J5. Two farmers on one phone stay separate (Pro)

Needs two test accounts. Their phone numbers and passwords go to Gemini in this task. Use test
accounts only, never a real farmer's account.

```
Open ShramSafal. Note the farm name and the plot names visible for the current account.
Log out from the profile or settings area.
Log in with phone {farmer_b_phone} and password {farmer_b_password}.
Checkpoint 1: no farm name, plot name or log entry from the first account is visible anywhere
on the home screen, the log screen or the profile.
Log out. Log in again with phone {farmer_a_phone} and password {farmer_a_password}.
Checkpoint 2: the first account's farm name, plots and today's entries are all back.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

## J6. Read-only sweep for dead buttons and broken screens (Pro, expected_output_desc set)

```
Open ShramSafal. Visit every screen reachable from the bottom navigation bar and from the
profile or settings menu, one level deep.
On each screen, record: the screen title, whether it loaded, any crash or error message, any
English text on a screen that is otherwise Marathi, and any button that visibly does nothing
when tapped.
Do not tap any button that saves, submits, approves, pays, deletes, logs out or sends anything.
Do not clear app data, uninstall, reinstall or force-stop ShramSafal.
```

`expected_output_desc`: "A table with one row per screen: title, loaded yes/no, problems seen
(exact text), screenshot reference."
