# Workflow-led setup: can it gather the same details, and how much work is it? (2026-11-21)

Question from the founder: if the setup screens follow the workflow-led design, can the app still gather everything the
setup hub gathers today, and is it a rewrite? This is read from the code on `task/plr-d10-ui-9a`. It is an estimate,
not a measured build. Nothing was built.

## Short answer

Yes for the areas drawn, because only the screens change. The saved shapes stay the same, so there is no database,
server, sync or schedule change.

| Area | Where it is saved today (unchanged) |
|---|---|
| Water source and motors | `UtilitiesSection.handleSaveSourceWithMotors` into the profile through `onUpdateProfile`. `WaterSourceWizard` hands over `onSave(source, motors)`. |
| Electricity timetable | `ElectricityTimingConfigurator` writes `profile.electricityTiming` through `onUpdate`. |
| Plots | `AddPlotWizard.onSave(plot, start)` into `useCropPlotState.handleAddPlot`: registers the plot on the server (`registerNewPlotOnServer`) and adopts the crop's checked schedule. The schedule-start logic currently sits inside the wizard's `handleSave`. |
| Invite someone | `InviteBuilderSheet`: `createInvitation(farmId, createBody(grant, { name, mobile, fieldOperatorId }))`. |
| Sign-in consent | `useConsentBeforeOtp`: the two legal records are written before the phone number is sent. Keep this untouched. |

Water, motors, electricity, machines, name and village are saved on this phone only (`useFarmerSetupPersistence`,
decision D-9 pending). The new flows inherit exactly that. Other phones of a farm do not see the water setup, same as today.

## Gaps against today (not drawn in the prototype)

- Name and village, the farm boundary map, the weather connection.
- Machines: name, own or rented, type, tank litres.
- Drawing a plot's boundary (stays as today's map screen).
- The plot form's optional "which machines work this plot" step (`linkedMachineryIds`).
- Electricity: today keeps several cut windows a day per phase, repeat rules, days and an alternate week B. The ring draws one
  window, so it needs "add another cut" and a way into today's timetable for odd cases.
- Changing something already saved: today's forms open pre-filled and keep stored fields the form does not show.
- Password sign-in, new-phone check, join by code or QR.
- The hub is more than setup: farm switcher, responsibilities, team, labour, finance, settings, app version and log-out
  stay as they are. Only the "माझं शेत" setup block would become the road.

## Effort (working days of one builder lane, checks included in the last column)

| Piece | Build | With tests, double check, real-phone walk, APK |
|---|---|---|
| Pilot: shared flow engine (12 blocks, buzz, soft sound, back and resume, big text, Marathi digits) plus water and power | 3-4 + 2-3 | about 5-6 for the pilot as a whole |
| Crops and plots (plot-saving logic pulled out of the wizard so both screens share it) | 3 | slice 1 in total 6-8 with two builders in parallel, 10-12 with one |
| Setup road, name and village, machines, invite | 4-6 | |
| Sign-in notice read page by page, permissions, read-aloud, voice answers | 5-7 | |

Everything together is about 16-25 days. About 78 tests guard today's setup screens; they keep passing if the new flow is
added beside the old one and would need rewriting if it replaced them. Marathi copy review comes on top (founder side).

## Riskiest parts

- **Sign-in and consent:** a bug stops everyone from logging in, and the consent record has legal weight.
- **Read-aloud:** the app has only the phone's built-in speech, used once for a celebration line. Marathi depends on the
  voice installed on each phone. Untested.
- **Voice answers:** `DeviceSpeechRecognizer` returns a transcript only. Turning "पाच एचपी" into 5 is new work that needs real speech to test.
- **Sound and buzz:** the app has `haptics.ts` (buzz) but no UI sound helper. Neither was tried on a real Android phone.

## Recommendation given on 2026-11-21

Build only the pilot (engine plus water and power) behind a switch, with today's screens kept as fallback and for editing.
The founder paused the idea and parked it here until the pilot feedback of real users is in.
