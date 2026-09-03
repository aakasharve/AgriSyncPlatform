# Farmer-facing vocabulary audit

**spec:** 2026-08-28-labour-v2-release-1
**Branch:** `feat/labour-v2-r1` · **Scanned at:** `7219974d` · **Date:** 2026-09-03
**Status:** READ-ONLY EVIDENCE. No production code, copy, name, key or identifier was changed
by this audit. No replacement word is proposed anywhere in this document.

## What this is, and what it deliberately is not

The founder runs a dedicated naming session later. This document exists so that session starts
from **what the product actually says today**, verified in the code, not from what plans and
comments claim it says. It maps the words on farmer-reachable surfaces, English and Marathi as
i18n pairs where keys exist, and reduces the mess to a numbered decision list.

It proposes nothing. There are no candidate replacements, no brand ideas, no alternatives
lists, and no generic HR/workforce vocabulary offered as a default. Where a concept has no
settled word, Section D says so and stops.

**Scope of the mechanical scan**

| | |
|---|---|
| Files scanned | 47 (the whole `features/labour/` tree plus 12 named surfaces outside it) |
| Files carrying farmer-facing text | 31 |
| **Farmer-facing strings inspected** | **453** |
| Unique string literals among them | 362 |
| Usages mapped in Section A (a word once per distinct meaning) | 295 |
| **Unique terms found (distinct entries in Section A's "Current word" column)** | **259** |

The gap between 362 unique literals and 259 unique terms is the copy that repeats verbatim
across screens (`—`, `पुन्हा प्रयत्न करा`, `लक्षात ठेवलं ✓`, the mock names, the Marathi month
and weekday arrays) plus the sentences counted once. The gap the other way — 259 terms across
295 usages — is the collision surface: 36 usages are a word already mapped, being used for a
different thing somewhere else.

Extraction idiom is the one already in the repo — `features/labour/__tests__/farmerVocabulary.scan.test.ts`:
(i) any string literal containing Devanagari, (ii) any JSX text node, comments stripped first.
Surfaces read by hand beyond that scan: `DetailSheet.tsx`, `ExecutionStatusSelector.tsx`,
`i18n/translations.ts`, `roleLabels.ts`, `GetLabourDataHandler.cs`.

**Reachability legend used throughout**

| Mark | Meaning |
|---|---|
| *(live)* | reachable by a real farmer on a real farm today |
| *(preview-only)* | reachable ONLY inside the `import.meta.env.DEV`-gated `?preview=labour` mount (`App.tsx:164`), or behind `isPreview` (`useLabourState.ts:157`, `farmCtx === null`) |
| *(flag-off)* | the string exists in the tree but its render site is gated by a hard `false` constant — no farmer, preview or real, sees it today |
| *(mock)* | only ever rendered from `labourMock.ts`, i.e. preview data |

One structural fact that shapes everything below: **the server sends no farmer-facing words for
this feature at all.** `GetLabourDataHandler.cs:689` returns `Insight: string.Empty`, and
`weekLabel` is a machine date. Every Marathi word a farmer reads in Labour is authored in the
client. The naming session therefore changes client copy only — no server copy exists to
coordinate with.

---

# A. Current vocabulary inventory

Contextually different usages are **not** deduplicated: the same word appears once per place it
is used with a different meaning. Paths are relative to `src/clients/mobile-web/src/`.

## A1 · Subsystem and navigation naming

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| कामगार व्यवस्थापन | mr | Hub screen title (back-header) *(live)* | `features/labour/components/LabourFeature.tsx:59` | The name of the entire subsystem |
| कामगार व्यवस्थापन · Labour | mr+en | Setup Hub row card label *(live)* | `features/profile/components/SetupHubMenu.tsx:286` | The single door into the subsystem |
| मजुरी | mr | Subtitle under that Setup Hub row *(live)* | `features/profile/components/SetupHubMenu.tsx:286` | What the subsystem is "about" — wages |
| कामगार व्यवस्थापन कसं वापरायचं? | mr | Help-note toggle label on the hub *(live)* | `features/labour/components/LabourHub.tsx:450` | "How do I use Labour Management?" |
| कामगार व्यवस्थापनासाठी नोंद | mr | Banner headline on the log page *(live)* | `core/navigation/mainViewComponents.tsx:105` | "A record for Labour Management" |
| कामगार व्यवस्थापन | mr | Back-pill on that same banner *(live)* | `core/navigation/mainViewComponents.tsx:114` | Return to the subsystem |
| कामगार व्यवस्थापनाकडे परत जा — back to Labour Management | mr+en | `aria-label` of that banner *(live)* | `core/navigation/mainViewComponents.tsx:98` | Screen-reader name of the same action |
| हजेरी · मजूर · मजुरी बोला | mr | Banner subtitle *(live)* | `core/navigation/mainViewComponents.tsx:110` | The three things you may speak here |
| आढावा | mr | Dashboard screen title + hub quick tile *(live)* | `features/labour/components/LabourFeature.tsx:72`; `LabourHub.tsx` | "Overview" — the stats screen |
| हजेरी वही | mr | Ledger screen title, hub tile, dashboard button, register header *(live)* | `LabourFeature.tsx:73`; `LabourHub.tsx`; `WeeklyDashboard.tsx`; `HajeriLedger.tsx` | The attendance register |
| सर्व दिवस | mr | Sub-line of the हजेरी वही tile *(live)* | `features/labour/components/LabourHub.tsx` | "All days" |
| सर्व दिवसांची हजेरी पहा | mr | Sub-line of the हजेरी वही button on आढावा *(live)* | `features/labour/components/WeeklyDashboard.tsx` | "See every day's attendance" |
| तपासा | mr | Hub quick-tile label *(live)* | `features/labour/components/LabourHub.tsx` | "Check" — opens the approval queue |
| मंजूर करा | mr | Sub-line of that tile *(live)* | `features/labour/components/LabourHub.tsx` | "Approve" |
| तपासणी | mr | Review sheet `<h2>` *(live)* | `features/labour/components/ReviewSheet.tsx:624` | The name of the approval screen |
| तपासणी म्हणजे काय? | mr | Help-note label inside that sheet *(live)* | `features/labour/components/ReviewSheet.tsx:640` | "What is तपासणी?" |
| तपासायचं | mr | Dashboard approval strip *(live)* | `features/labour/components/WeeklyDashboard.tsx` | "To be checked" — the pending inbox |
| हजेरी घ्या | mr | Hub capture tile *(preview-only)* | `features/labour/components/LabourHub.tsx` (`SHOW_ATTENDANCE_TILE = false \|\| isPreview`) | "Take attendance" |
| आजची हजेरी | mr | Attendance screen title *(preview-only)* | `features/labour/components/LabourFeature.tsx:62` | "Today's attendance" |
| मुकादम | mr | Mukadam-detail screen title fallback *(live)* | `features/labour/components/LabourFeature.tsx:60` | The screen you are on |
| कामगार | mr | Person-detail screen title fallback *(live)* | `features/labour/components/LabourFeature.tsx:61` | The screen you are on |
| आजपर्यंत / आज / हा आठवडा / हा महिना | mr | The four time-window segments *(live)* | `features/labour/labourWindow.ts:LABOUR_WINDOW_LABELS` | The period the stats answer for |
| Labour Review | en | Header of the labour block in manual entry *(live)* | `features/logs/components/manual-entry/components/LabourReview.tsx:67` | Untranslated English section header |
| Total workers: N (…) | en | Line under that header *(live)* | `features/logs/components/manual-entry/components/LabourReview.tsx` | Untranslated English count line |

## A2 · Human labels — kept deliberately separate

### A2a · The individual, named

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| *(the name itself, verbatim)* | mr | Name chips on the just-logged card, result screen, review card, register rows | `LabourHub.tsx`; `AttendanceResult.tsx`; `LabourReview.tsx`; `HajeriLedger.tsx` | Exactly what the farmer said — never normalised |
| माणूस निवडा | mr | Picker section header *(live)* | `features/labour/components/FieldOperatorPicker.tsx:312` | "Choose a person" |
| नवीन माणसाचं नाव | mr | `aria-label` of the add field *(live)* | `features/labour/components/FieldOperatorPicker.tsx:420` | "A new person's name" |
| पूर्ण नाव / ओळख — ऐच्छिक | mr | Optional second field placeholder *(live)* | `features/labour/components/FieldOperatorPicker.tsx:438` | "Full name / identity — optional" |
| सारखं नाव — वेगळी व्यक्ती | mr | Disambiguation line under a colliding row *(live)* | `features/labour/components/FieldOperatorPicker.tsx:389` | "Same name — a different person" |
| फक्त नाव | mr | Badge beside a person *(live)* | `features/labour/components/LabourUiKit.tsx` (`NameOnlyBadge`) | "Name only" — how much the app knows |
| माणसं | mr | Hub group label above the people list *(live)* | `features/labour/components/LabourHub.tsx` | "People" |
| माणसं आणत आहोत… | mr | Roster loading state *(live)* | `features/labour/components/FieldOperatorPicker.tsx:313` | "Fetching people…" |
| याची माणसं · his team | mr+en | Mukadam-detail group label *(live)* | `features/labour/components/MukadamDetail.tsx` | "His people" |

### A2b · The anonymous, counted

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| मजूर | mr | `N मजूर` chip *(live)* | `features/labour/components/LabourDataPoints.tsx` | The countable workers of one entry |
| मजूर | mr | `N मजूर` line on the just-logged card *(live)* | `features/labour/components/LabourHub.tsx` | Same count, on the hub |
| मजूर | mr | `N मजूर` approval fact tile *(live)* | `features/labour/components/ReviewSheet.tsx` (`ReviewFacts`) | Same count, on the approval card |
| मजूर / workers | mr/en | `N मजूर` / `N workers` *(live)* | `features/logs/components/manual-entry/components/LabourReview.tsx` | Same count, on manual entry — the one place with an `en` pair |
| मजूर-दिवस | mr | Stat tile label *(live)* | `features/labour/components/WeeklyDashboard.tsx` | Man-days over the selected window |
| मजुरांची संख्या | mr | Picker helper line *(live)* | `features/labour/components/FieldOperatorPicker.tsx:310` | "The number of workers" — stated to be unaffected by naming |
| जण | mr | `आज कामावर N जण` *(live)* | `features/labour/components/LabourHub.tsx` | Whole headcount on the farm today |
| जण | mr | `N जण` under ShramSafalला समजलं *(live)* | `features/labour/components/AttendanceResult.tsx` | The count understood from speech |
| जण | mr | `या N जणांमध्ये कोण होते?` *(live)* | `features/labour/attendanceCopy.ts:rungWho` | "Who among these N?" |
| जण | mr | `+ २ जण` in the helper box *(preview-only)* | `features/labour/components/Attendance.tsx` | How unnamed remainder is counted |
| लोक | mr | `आज किती लोक आली?` *(preview-only)* | `features/labour/components/Attendance.tsx` | "How many people came today?" |
| लोक | mr | `N लोक` on the counter *(preview-only)* | `features/labour/components/Attendance.tsx` | The number being set |
| लोक | mr | `“रोकडेचे दहा लोक आले” — असं बोला` *(live)* | `features/labour/components/LabourHub.tsx` | The hero's spoken example |
| कोण होते / कोण आलं | mr | Rung questions, tile sub-line *(live/preview)* | `attendanceCopy.ts`; `LabourHub.tsx` | "Who was there / who came" |

### A2c · The identified app user

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| अ‍ॅप कामगार | mr | Helper box: `हिरवा ✓ = अ‍ॅप कामगार` *(preview-only)* | `features/labour/components/Attendance.tsx` | A worker who has the app |
| कामगार · Worker | mr+en | Role tag on a team member card *(live)* | `features/profile/components/TeamMemberCard.tsx:121` | Farm-membership role |
| कामगार | mr | Role registry `Worker.mr` *(live)* | `shared/roles/roleLabels.ts` | Farm-membership role |
| कामगार | mr | Operator chip `WORKER.labelMr` *(live)* | `shared/components/ui/OperatorSessionChip.tsx:25` | Who is operating the device |
| कामगार | mr | QR join role label *(live)* | `pages/JoinFarmLandingPage.tsx:37` | The role being offered by the QR |
| कामगार | mr | `workSummary.labour` *(live)* | `i18n/translations.ts:563` | A **cost category** in the day ledger |
| Labour | en | `workSummary.labour` en pair *(live)* | `i18n/translations.ts:355` | Same cost category, English |
| कामगार दर | mr | Settings section *(live)* | `i18n/translations.ts:588` | Labour rates |
| कामगार पाळ्या | mr | Settings section *(live)* | `i18n/translations.ts:602` | Labour shifts |
| पुरुष कामगार / महिला कामगार | mr | Day-summary rows *(live)* | `i18n/translations.ts:569-570` | Male / female workers |
| आज कामगार वापरलेले नाहीत | mr | Day-summary empty state *(live)* | `i18n/translations.ts:578` | "No labour was **used** today" |
| कामगारांना जोडा · Add your workers | mr+en | Setup nudge card *(live)* | `features/profile/sections/IdentitySection.tsx:458` | Onboarding call to action |
| अजून कोणी कामगार जोडलेला नाही | mr | Hub people empty state *(live)* | `features/labour/components/LabourHub.tsx` | "No worker added yet" |
| कुटुंब किंवा कामगार जोडा | mr | Team empty state *(live)* | `i18n/translations.ts:629` | "Add family or workers" |
| सदस्य / सदस्य · Member | mr / mr+en | Unknown-role fallback *(live)* | `shared/roles/roleLabels.ts:getRoleLabel` | Neutral "member" |
| हा सदस्य काय करू शकतो? · What can they do? | mr+en | Section label on the member card *(live)* | `features/profile/components/TeamMemberCard.tsx` | Capability section heading |
| भागीदार · Partner | mr+en | Role tag *(live)* | `features/profile/components/TeamMemberCard.tsx:121` | Secondary owner |
| मालक / सहमालक | mr | Role registry *(live)* | `shared/roles/roleLabels.ts` | Owner / co-owner |
| मालक / सह-मालक | mr | Operator chip *(live)* | `shared/components/ui/OperatorSessionChip.tsx:23-24` | Owner / co-owner — **different spelling of सहमालक** |
| सहमालक | mr | QR join role label *(live)* | `pages/JoinFarmLandingPage.tsx:39` | Third spelling site of the same role |
| चालक बदला / Switch Operator | mr+en | Operator switch control *(live)* | `shared/components/ui/OperatorSessionChip.tsx` | "Change the operator" |
| कृषितज्ज्ञ / सल्लागार / शेत निरीक्षक / प्रयोगशाळा / FPC तांत्रिक व्यवस्थापक | mr | Role registry *(live)* | `shared/roles/roleLabels.ts` | The five CEI professional roles |

### A2d · The group / crew

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| टीम N | mr+en-loan | Count pill on a mukadam row *(live)* | `features/labour/components/LabourUiKit.tsx` (`PersonRow`) | How many people he brings |
| {task} टीम | mr+en-loan | Task badge on a sub-mukadam *(live)* | `features/labour/components/LabourUiKit.tsx` (`TaskBadge`) | A task-scoped crew |
| टीमची हजेरी | mr+en-loan | Hub help-note "काय आहे" *(live)* | `features/labour/components/LabourHub.tsx` | "The team's attendance" |
| 'टीम सेटअप' | mr+en-loan | Hub + person help-note "का" *(live)* | `LabourHub.tsx`; `PersonDetail.tsx` | The Setup Hub team screen |
| टीममधून काढा · Remove | mr+en | Destructive action on the member card *(live)* | `features/profile/components/TeamMemberCard.tsx` | Remove from the team |
| माझा शेत संघ | mr | Setup Hub section *(live)* | `i18n/translations.ts` (`profile.myFarmTeam`) | "My farm team" — a **different Marathi word** for the same idea |
| अजून संघ सदस्य नाहीत | mr | Team empty state *(live)* | `i18n/translations.ts` (`profile.noTeamMembers`) | "No team members yet" |
| छाटणी टीम · आज | mr | Review item title *(mock)* | `features/labour/labourMock.ts` | A named crew for a day |

### A2e · The Mukadam-brought worker

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| मुकादमाकडून आलेले | mr | Guide card line 1 *(live)* | `i18n/labourOversightTranslations.ts` (`labourGuideLine1.mr`) | "People sent by a mukadam" |
| people sent by a mukadam | en | Same key, English pair *(live)* | `i18n/labourOversightTranslations.ts` (`labourGuideLine1.en`) | Same |
| {name}सोबत | mr | Crew aggregate row label in the register *(live)* | `features/labour/components/HajeriLedger.tsx` | "With {mukadam} — N people" |
| *(violet dot, no word)* | — | Cell marker for an उक्ते engagement *(live)* | `features/labour/components/HajeriLedger.tsx` | The arrangement, shown without a word |

## A3 · Mukadam vocabulary

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| मुकादम | mr | Badge on a person row *(live)* | `features/labour/components/LabourUiKit.tsx` (`MukadamBadge`) | **Crew organiser** — someone who brings people |
| मुकादम | mr | Role registry `Mukadam.mr`, orange badge *(live)* | `shared/roles/roleLabels.ts` | **Farm-membership role** with app access |
| Mukadam | en | Role registry `Mukadam.en` *(live)* | `shared/roles/roleLabels.ts` | Same role, English — untranslated loan |
| मुकादम | mr | QR join role label *(live)* | `pages/JoinFarmLandingPage.tsx:38` | The role a QR code offers |
| मुकादम | mr | Screen title fallback *(live)* | `features/labour/components/LabourFeature.tsx:60` | The detail screen you are on |
| उप-मुकादम | mr | Sub-badge *(live)* | `features/labour/components/LabourUiKit.tsx` (`MukadamBadge sub`) | A mukadam appointed by a mukadam |
| तात्पुरता | mr | Badge *(live)* | `features/labour/components/LabourUiKit.tsx` (`TempBadge`) | "Temporary" — attached to the **person** |
| {appointedBy} नी नेमला | mr | Sub-line on a sub-mukadam *(live)* | `features/labour/components/MukadamDetail.tsx` | "Appointed by X" |
| सर्व कारकुनी काम · तुम्ही नेमला | mr | Sub-line on a head mukadam *(live)* | `features/labour/components/MukadamDetail.tsx` | "All clerical work · you appointed him" |
| तुम्ही | mr | Fallback for the appointer *(live)* | `features/labour/components/MukadamDetail.tsx` | "You" |
| फक्त छाटणीसाठी · काम संपलं की बंद | mr | Why-line on a sub-mukadam balance *(live)* | `features/labour/components/MukadamDetail.tsx` | "Pruning only · ends when the work ends" |
| मुकादमाकडून आलेले | mr | Guide card *(live)* | `i18n/labourOversightTranslations.ts` | People he brings |
| No Workers or Mukadams found on this farm | en | Assign-worker empty state *(live)* | `features/work/components/AssignWorkerSheet.tsx` | Untranslated English |
| मुकादम | mr | Withheld-money comment (money card `null` for मुकादम/worker views) | `features/labour/labour.types.ts:254` | A **projection**, not a word on screen |

**Flag (category 3).** `मुकादम` carries at least three distinct referents on live surfaces, with
no word separating them: **(a)** a farm-membership role that grants app access and can be issued
by QR (`roleLabels.ts`, `JoinFarmLandingPage.tsx`, `TeamMemberCard.tsx`); **(b)** a crew
organiser who brings people to the farm, who may have no app account at all
(`LabourUiKit.MukadamBadge`, `MukadamDetail.tsx`, the register's `{name}सोबत` crew rows,
`labourGuideLine1`); **(c)** a data-projection tier that determines whether money is withheld
(`LabourView`, `labour.types.ts`). A farmer reading "मुकादम" on a badge cannot tell which of the
three he is looking at, and the app itself uses one badge for (a) and (b).

## A4 · Attendance vocabulary

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| बोलून हजेरी घ्या | mr | Hub hero headline *(live)* | `features/labour/components/LabourHub.tsx` | "Take attendance by speaking" — the act |
| बोलून नोंदवलेली हजेरी | mr | Just-logged card title *(live)* | `features/labour/components/LabourHub.tsx` | "Attendance recorded by speaking" — the record |
| हजेरी वही | mr | Register title / tile / button *(live)* | `HajeriLedger.tsx`; `LabourHub.tsx`; `WeeklyDashboard.tsx` | The register itself |
| आजची हजेरी | mr | Screen title *(preview-only)* | `features/labour/components/LabourFeature.tsx:62` | The capture screen |
| हजेरी घ्या / आज कोण आलं | mr | Capture tile + sub *(preview-only)* | `features/labour/components/LabourHub.tsx` | The act, as a tile |
| आजची हजेरी कोणती? | mr | Contradiction question *(live)* | `features/labour/attendanceCopy.ts:contradictionBody` | **One person's day-mark** |
| अजून हजेरी नोंदवली नाही | mr | Register empty state, owner view only *(live)* | `features/labour/components/HajeriLedger.tsx` | "No attendance recorded yet" |
| बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल. | mr | That empty state's subtitle *(live)* | `features/labour/components/HajeriLedger.tsx` | Where it will appear |
| त्यांची हजेरी घ्या किंवा ओळख पटवून द्या | mr | Guide headline *(live)* | `i18n/labourOversightTranslations.ts` (`labourGuideHeadline.mr`) | "Take their attendance, or identify them" |
| take their attendance, or identify them | en | Same key, English *(live)* | `i18n/labourOversightTranslations.ts` (`labourGuideHeadline.en`) | Same |
| हजेरी · मजूर · मजुरी बोला | mr | Log-page banner subtitle *(live)* | `core/navigation/mainViewComponents.tsx:110` | Three things you may say |
| आला | mr | Register legend + cell detail + segment *(live/preview)* | `HajeriLedger.tsx`; `HajeriCellDetail.tsx` (`DAY_WORD.full`); `Attendance.tsx` | "Came" — a full day |
| अर्धा | mr | Legend, cell detail, segment, mark word *(live/preview)* | `HajeriLedger.tsx`; `HajeriCellDetail.tsx`; `Attendance.tsx`; `attendanceCopy.ts:markWord.half` | Half day |
| नाही | mr | Register legend *(live)* | `features/labour/components/HajeriLedger.tsx` | Did not come |
| आला नाही | mr | Cell-detail chip *(live)* | `features/labour/components/HajeriCellDetail.tsx` (`DAY_WORD.absent`) | Did not come — **a second wording** |
| पूर्ण | mr | Mark word / cell-detail chip *(live)* | `features/labour/attendanceCopy.ts:markWord.full`; `HajeriCellDetail.tsx` | Full day |
| रात्र | mr | Mark word, legend `◾ रात्र`, cell chip *(live)* | `attendanceCopy.ts:markWord.night`; `HajeriLedger.tsx`; `HajeriCellDetail.tsx` | Night worked |
| पूर्ण दिवस / अर्धा दिवस / रात्रपाळी | mr | Shift chips *(preview-only)* | `features/labour/labourParse.ts:SHIFT_LABEL` | The shift — **three longer words for the same three marks** |
| शिफ्ट · shift | mr-loan+en | Section header *(preview-only)* | `features/labour/components/Attendance.tsx` | English loan word plus its English gloss |
| रिकामं = कुणी माहिती नाही | mr | Register legend *(live)* | `features/labour/components/HajeriLedger.tsx` | "Blank = nobody has said anything" |
| कुणी माहिती नाही | mr | Cell detail, null cell *(live)* | `features/labour/components/HajeriCellDetail.tsx` | Same, in the detail sheet |
| दिवस | mr | Register name-column header *(live)* | `features/labour/components/HajeriLedger.tsx` | Heads the column of **names**, reads "day" |
| 4त = 4 तास | mr | Legend *(live)* | `features/labour/components/HajeriLedger.tsx` | Stated hours |
| {n} तास | mr | Cell-detail chip *(live)* | `features/labour/components/HajeriCellDetail.tsx` | Stated hours |
| +2 जादा | mr | Legend *(live)* | `features/labour/components/HajeriLedger.tsx` | Stated extra hours |
| जादा {n} तास | mr | Cell-detail chip + dimensional week *(live)* | `features/labour/components/HajeriCellDetail.tsx` | Stated extra hours |
| N पूर्ण · N अर्धा · N रात्री · जादा N तास | mr | Dimensional week line *(live)* | `features/labour/components/HajeriCellDetail.tsx` | Counts of stated facts, never summed |
| हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही. | mr | Register footer *(live)* | `features/labour/components/HajeriLedger.tsx` | A **second** legend, in colour words |
| आज कामावर N जण | mr | Hub headline row *(live)* | `features/labour/components/LabourHub.tsx` | Whole count on the farm today |
| आज किती लोक आली? | mr | Counter heading *(preview-only)* | `features/labour/components/Attendance.tsx` | "How many people came today?" |
| नावं जोडा — किमान १ | mr | Section header *(preview-only)* | `features/labour/components/Attendance.tsx` | "Add names — at least one" |
| लक्षात ठेवलं ✓ | mr | Queued-mark toast, register legend, cell detail *(live)* | `LabourFeature.tsx`; `HajeriLedger.tsx`; `HajeriCellDetail.tsx` — all resolve `SYNC_HONESTY_I18N_KEYS.ON_PHONE` | "Remembered ✓" — on the phone, not acknowledged |
| शेतात होता ✓ · आज | mr | Review item title *(mock)* | `features/labour/labourMock.ts` | "Was on the farm ✓" |

## A5 · Money vocabulary — classified

Classification per the founder's rule: these are **not** equivalent.

| Current word | Lang | Class | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|---|
| रोजंदारी | mr | **stated** | Hub money card, left tile *(live)* | `features/labour/components/LabourHub.tsx` | Money on a day-rate basis that the farmer stated |
| नोंदलेली | mr | **stated** (qualifier) | Sub-label under रोजंदारी *(live)* | `features/labour/components/LabourHub.tsx` | "Recorded" |
| उक्ते काम | mr | **agreed** | Hub money card, right tile *(live)* | `features/labour/components/LabourHub.tsx` | Money that comes from an agreement |
| ठरलेली | mr | **agreed** (qualifier) | Sub-label under उक्ते काम *(live)* | `features/labour/components/LabourHub.tsx` | "Settled / agreed" |
| मजुरी | mr | **calculated** | Just-logged card, right-hand label *(live)* | `features/labour/components/LabourHub.tsx` | Sum of `totalCost` across the log's events; `—` when none stated |
| मजुरी | mr | **total** (windowed) | Stat tile on आढावा *(live)* | `features/labour/components/WeeklyDashboard.tsx` | Wages that moved in the selected window |
| मजुरी | mr | **subsystem descriptor** | Setup Hub row subtitle *(live)* | `features/profile/components/SetupHubMenu.tsx:286` | What the subsystem is about |
| दैनंदिन मजुरी | mr | **rate** | Settings *(live)* | `i18n/translations.ts` (`settings.dailyWage`) | Standard daily wage |
| कामगार दर / पुरुष दर / महिला दर | mr | **rate** | Settings *(live)* | `i18n/translations.ts:588-590` | Labour rates by gender |
| पुरुष: N × ₹r · महिला: N × ₹r | mr | **calculated** | Just-logged card rows *(live)* | `features/labour/components/LabourHub.tsx` | count × rate, shown with its product |
| काम झालं | mr | **calculated / total** | Balance-card tile *(live)* | `features/labour/components/LabourUiKit.tsx` (`BalanceCard`) | Total money recorded against the person |
| काम झालं · एकूण नोंदवलं | mr | **calculated / total** | Money-card header on आढावा *(live)* | `features/labour/components/WeeklyDashboard.tsx` | Same idea, farm-wide, all-time |
| दिलं | mr | **paid** | Balance-card tile + money-bar legend *(live)* | `LabourUiKit.tsx`; `WeeklyDashboard.tsx` | Actually paid out |
| बाकी | mr | **pending** | Balance-card tile + money-bar legend *(live)* | `LabourUiKit.tsx`; `WeeklyDashboard.tsx` | Owed = recorded − paid − advance |
| द्यायचे | mr | **pending** | Money line + balance headline *(live)* | `features/labour/components/LabourUiKit.tsx` | "To be paid" — the same balance, imperative |
| जास्त दिलं | mr | **calculated** | Money line + balance headline + tile *(live)* | `features/labour/components/LabourUiKit.tsx` | Overpaid |
| उचल | mr | **paid** (advance) | Balance tile + money-bar legend *(flag-off in prod; server hardcodes 0)* | `LabourUiKit.tsx`; `WeeklyDashboard.tsx` | Cash handed over early |
| उचल बाकी | mr | **pending** | Money line + balance headline *(mock only)* | `features/labour/components/LabourUiKit.tsx` | Advance still outstanding |
| उचल द्या | mr | **action** | Balance-card button *(flag-off, `showActions = false`)* | `features/labour/components/LabourUiKit.tsx` | "Give an advance" |
| उचल दिली | mr | **paid** (advance) | Stat tile *(flag-off, `SHOW_ADVANCE_STAT = false`)* | `features/labour/components/WeeklyDashboard.tsx` | "Advance given" |
| उचल — नमुना | mr | **placeholder** | Toast *(flag-off path)* | `features/labour/components/LabourFeature.tsx:287` | "Advance — sample" |
| पैसे द्या | mr | **action** | Settle button label, worker *(flag-off)* | `features/labour/components/PersonDetail.tsx` | "Pay" |
| सेटल | en-loan | **action** | Settle button label, mukadam *(flag-off)* | `features/labour/components/MukadamDetail.tsx` | English "settle", in Devanagari |
| पैसे दिले ✓ — नमुना | mr | **placeholder** | Toast *(flag-off path)* | `features/labour/components/LabourFeature.tsx:296` | "Money paid ✓ — sample" |
| पैसे · money | mr+en | **section label** | Money-card group label *(live)* | `features/labour/components/WeeklyDashboard.tsx` | "Money" |
| आजपर्यंत | mr | **basis** | Money-card basis line *(live)* | `features/labour/components/WeeklyDashboard.tsx` | States that this card is all-time |
| ₹ amount | — | **stated** | Wallet chip *(live)* | `features/labour/components/LabourDataPoints.tsx` | An amount the farmer actually said |
| ₹ amount | — | **stated** | Approval fact tile *(live)* | `features/labour/components/ReviewSheet.tsx` (`ReviewFacts`) | Same |
| — (em-dash) | — | **not stated** | Every money slot above | `LabourUiKit.tsx`; `WeeklyDashboard.tsx`; `LabourHub.tsx`; `ReviewSheet.tsx` | The house mark for "we were not told" |
| पैसे व हिशोब · Finance | mr+en | **other subsystem** | Setup Hub row *(live)* | `features/profile/components/SetupHubMenu.tsx` | The finance subsystem, not this one |
| Total Contract Amount (₹) | en | **agreed** | Contract tab, activity detail sheet *(live)* | `features/logs/components/activity-card/sheets/DetailSheet.tsx` | The agreed lump for contract work |
| आजचा एकूण खर्च | mr | **total** | Day-summary header *(live)* | `i18n/translations.ts` (`workSummary.totalDailyCost`) | Total daily cost |

## A6 · Work-arrangement vocabulary — separated from human labels

| Current word | Lang | Kind | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|---|
| उक्ते काम | mr | **work-arrangement label** | Hub money card, register legend, cell-detail chip *(live)* | `LabourHub.tsx`; `HajeriLedger.tsx`; `HajeriCellDetail.tsx` | The engagement is governed by an agreement |
| उक्ते | mr | **work-arrangement label** | Hub breakdown `N उक्ते` *(live)* | `features/labour/components/LabourHub.tsx` | Count of people on that basis today |
| रोजंदारी | mr | **basis, rendered as a card title** | Hub money card *(live)* | `features/labour/components/LabourHub.tsx` | Money on the ordinary day-rate basis |
| रोजंदारी | mr | **reads as a human category** | Hub breakdown `N रोजंदारी` *(live)* | `features/labour/components/LabourHub.tsx` | `N रोजंदारी · N उक्ते` — a count of **people**, split by a word that names a payment basis |
| Daily Wage | en | **work-arrangement label** | Labour type tab, activity detail sheet *(live)* | `features/logs/components/activity-card/sheets/DetailSheet.tsx:221` | Day-rate labour |
| Contract | en | **work-arrangement label** | Same tab row *(live)* | `features/logs/components/activity-card/sheets/DetailSheet.tsx:221` | Contract labour |
| Self | en | **work-arrangement label** | Same tab row *(live)* | `features/logs/components/activity-card/sheets/DetailSheet.tsx:221` | Own/family labour |
| Per Tree / Per Acre / Per Row / Lump Sum | en | **agreement unit** | Contract tab `Unit` select *(live)* | `features/logs/components/activity-card/sheets/DetailSheet.tsx` | The basis the agreement is priced on |
| तात्पुरता | mr | **human label wearing an arrangement's clothes** | Badge on a person *(live)* | `features/labour/components/LabourUiKit.tsx` (`TempBadge`) | "Temporary" — attached to the human, not the engagement |
| {task} टीम | mr+en-loan | **arrangement scope** | Task badge *(live)* | `features/labour/components/LabourUiKit.tsx` (`TaskBadge`) | A crew scoped to one task |
| फक्त छाटणीसाठी · काम संपलं की बंद | mr | **arrangement scope** | Sub-mukadam why-line *(live)* | `features/labour/components/MukadamDetail.tsx` | "Pruning only, ends with the work" |
| फक्त नाव vs अ‍ॅप कामगार | mr | **identification state, presented as person kinds** | Badge *(live)* + helper *(preview-only)* | `LabourUiKit.tsx`; `Attendance.tsx` | How much the app knows about him |

**Flag (category 6).** Three terms currently make a human look like a category:
`N रोजंदारी · N उक्ते` counts **people** under words that name a **payment basis**
(`LabourHub.tsx`); `तात्पुरता` is a badge on a **person** for what is a property of the
**engagement** (`LabourUiKit.TempBadge`); and `फक्त नाव` / `अ‍ॅप कामगार` present an
**identification state** as two kinds of worker (`LabourUiKit.NameOnlyBadge`,
`Attendance.tsx`). Separately, the same economic distinction is carried by an entirely
different, entirely English vocabulary on another live screen — `Daily Wage / Contract / Self`
in `DetailSheet.tsx` — which no farmer can reconcile with `रोजंदारी / उक्ते काम`.

## A7 · Work vocabulary

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| काम | mr | `आज कामावर N जण` *(live)* | `features/labour/components/LabourHub.tsx` | "At work" |
| काम झालं | mr | Balance tile + money-card header *(live)* | `LabourUiKit.tsx`; `WeeklyDashboard.tsx` | **A money total**, not a work statement |
| कुठे काम झालं · plots | mr+en | Group label on आढावा *(live)* | `features/labour/components/WeeklyDashboard.tsx` | "Where the work happened" |
| आजचं काम सांगा | mr | No-anchor reason *(live)* | `features/labour/attendanceCopy.ts:noAnchorReason` | "First tell today's work" |
| आजच्या कामात किती जण होते | mr | Same string *(live)* | `features/labour/attendanceCopy.ts:noAnchorReason` | "How many were in today's work" |
| कोण काम करत होतं ते इथे नोंदवता येतं. | mr | Picker helper *(live)* | `features/labour/components/FieldOperatorPicker.tsx:310` | "You can record who was working" |
| आज कोणत्या प्लॉटवर कोणी काम केलं | mr | Guide headline *(live)* | `i18n/labourOversightTranslations.ts` | "Who worked on which plot today" |
| दोन कामांत दिसतोय | mr | Contradiction body *(live)* | `features/labour/attendanceCopy.ts:contradictionBody` | "Appears in two jobs" |
| दोन्ही कामांच्या नोंदी तशाच राहतील | mr | Contradiction reassurance *(live)* | `features/labour/attendanceCopy.ts` | Both jobs' records stay as they are |
| कामे सांगण्यासाठी तयार | mr | Plot-tray row *(live)* | `i18n/labourOversightTranslations.ts` (`readyToLogLabel.mr`) | "Ready to log work" |
| Ready to Log | en | Same key, English pair *(live)* | `i18n/labourOversightTranslations.ts` (`readyToLogLabel.en`) | The old English literal, kept verbatim |
| नोंद / नोंदी | mr | Stat tile, group label, help copy, review copy *(live)* | `WeeklyDashboard.tsx`; `LabourHub.tsx`; `ReviewSheet.tsx` | Record(s) — of a day, of an entry, of the queue |
| आजच्या नोंदी | mr | Just-logged group label *(live)* | `features/labour/components/LabourHub.tsx` | "Today's records" |
| नोंदी तपासा | mr | Hub help-note "काय करायचं" *(live)* | `features/labour/components/LabourHub.tsx` | "Check the records" |
| कामाचा तपशील | mr | Day-summary header *(live)* | `i18n/translations.ts` (`workSummary.workBreakdown`) | "Work breakdown" |
| संपूर्ण शेत | mr | Approval fact tile, plot scope *(live)* | `features/labour/components/ReviewSheet.tsx` via `oversightTranslations.entireFarmLabel` | The whole farm as a scope |
| एकूण / Overview | mr / en | Entire-farm carousel subtitle *(live)* | `i18n/labourOversightTranslations.ts` (`entireFarmOverviewLabel`) | Overview |
| प्लॉट / PLOT / PLOTS | mr / en | Crop count pill *(live)* | `i18n/labourOversightTranslations.ts` (`plotCountUnit*`) | Plot — mr does not inflect, en does |
| निवडला / निवडले · SELECTED | mr / en | Crop count pill *(live)* | `i18n/labourOversightTranslations.ts` (`selectedCountUnit*`) | Selected — mr inflects, en does not |
| छाटणी / फवारणी / द्राक्ष छाटणी | mr | Task chips and cell-detail work context *(mock + live pass-through)* | `labourMock.ts`; `HajeriCellDetail.tsx`; `LabourDataPoints.tsx` | The task actually done |
| कामगार नेमणूक / नेमणूक करा | mr | Assign-worker sheet *(live)* | `features/work/components/AssignWorkerSheet.tsx` | "Worker assignment" / "Assign" |

## A8 · Responsibility / authority vocabulary

| Current word | Lang | Reads as | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|---|
| जबाबदारी ठरवा | mr | handover | Chevron label on a member card *(live)* | `features/profile/components/TeamMemberCard.tsx:134` | "Decide the responsibility" — replaced `प्रवेश` (access) under D5 |
| जबाबदारी द्या | mr | handover | OFF-state control *(live)* | `features/profile/components/TeamMemberCard.tsx:251` | "Give the responsibility" |
| कामगारांची जबाबदारी आहे | mr | handover | ON-state, editable and owner-tier *(live)* | `features/profile/components/TeamMemberCard.tsx:183,268` | "Has responsibility for the workers" |
| {name}ला किती दिवस? | mr | handover | Duration question *(live)* | `features/profile/components/TeamMemberCard.tsx` | "For how many days?" |
| आज · 2 दिवस · 3 दिवस · तारीख · कायम | mr | handover | Duration chips *(live)* | `features/profile/components/responsibilityDuration.ts:DURATION_CHIPS` | How long it lasts |
| N {महिना}पर्यंत · नंतर जबाबदारी आपोआप संपेल | mr | handover | End-line under the ON state *(live)* | `features/profile/components/responsibilityDuration.ts:responsibilityEndLine` | "Until N — then it ends by itself" |
| हा सदस्य काय करू शकतो? · What can they do? | mr+en | capability | Section label *(live)* | `features/profile/components/TeamMemberCard.tsx` | Heads the responsibility control |
| टीममधून काढा · Remove | mr+en | membership | Destructive button *(live)* | `features/profile/components/TeamMemberCard.tsx` | Remove from the farm |
| 'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं | mr | permission | Hub help-note "का" *(live)* | `features/labour/components/LabourHub.tsx:449` | "Who may record is decided in Team Setup" |
| नोंद करू द्या | mr | **permission** | Team member control *(live)* | `i18n/translations.ts` (`profile.allowLog`) | "Allow logging" |
| कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा | mr | **permission / security** | Setup Hub team section *(live)* | `i18n/translations.ts:623` (`profile.manageAccess`) | "Manage family and workers' **access**" — the word D5 banned, still live outside the scan's scope |
| Switch Operator / चालक बदला | mr+en | **security** | Operator chip *(live)* | `shared/components/ui/OperatorSessionChip.tsx` | Change who is operating |
| मंजूर / मंजूर करा | mr | authority | Approve button + tile sub *(live)* | `ReviewSheet.tsx`; `LabourHub.tsx` | "Approve" |
| सगळं मंजूर केलं (N) | mr | authority | Undo-bar label *(live)* | `features/labour/components/ReviewSheet.tsx` | "Approved all (N)" |
| मंजूर केलं / शंका नोंदवली | mr | authority | Confirm overlay + undo label *(live)* | `features/labour/components/ReviewSheet.tsx` | "Approved" / "Query raised" |
| शंका | mr | authority | Query button *(live)* | `features/labour/components/ReviewSheet.tsx` | "Doubt / query" |
| मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे. | mr | authority | Dispute reason sent with a query *(live)* | `features/labour/components/ReviewSheet.tsx:68` | "The owner has queried this record — the worker must be asked" |
| आपोआप मंजूर | mr | authority | Review help-note "का" *(live)* | `features/labour/components/ReviewSheet.tsx:639` | "Automatically approved" — **for a mechanism that does not exist** |
| पूर्ववत करा | mr | authority | Undo button *(live)* | `features/labour/components/ReviewSheet.tsx` | "Undo" |
| जतन करा → मंजुरीसाठी | mr | authority | Save button *(preview-only)* | `features/labour/components/Attendance.tsx` | "Save → for approval" |
| मुख्य मालक | mr | authority | Profile *(live)* | `i18n/translations.ts` (`profile.primaryOwner`) | "Primary owner" |

**Flag (category 8).** The UI is **split**. The labour-responsibility control on
`TeamMemberCard` now reads entirely as **handover** — जबाबदारी द्या / जबाबदारी ठरवा /
कामगारांची जबाबदारी आहे, with a duration and an automatic end, and `farmerVocabulary.scan.test.ts`
enforces the absence of permission words across `features/labour/` plus that card and
`IdentitySection.tsx`. Everything **around** it — outside that scan's scope — still reads as
**permission/security**: `profile.manageAccess` says प्रवेश ("access") on the Setup Hub screen
that leads to that very card, `profile.allowLog` says नोंद करू द्या ("allow logging"), the
device chip says *Switch Operator / चालक बदला*, and the hub's own help-note explains the split
as "who may record is decided in Team Setup". A farmer walks from a security screen into a
handover screen with no word telling him they are the same thing.

## A9 · Skill / reputation / history vocabulary already present in ShramSafal

Included per instruction so the new system does not collide with words that already exist.

| Current word | Lang | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|
| विश्वासार्हता गुण | mr | Reliability card headline *(live)* | `features/work/components/ReliabilityScoreCard.tsx:106` | "Reliability score" — a number about a person |
| Reliability Score · 30-day window | en | Sub-line of the same card *(live)* | `features/work/components/ReliabilityScoreCard.tsx:112` | Same, English, with its window |
| तपासणी प्रमाण | mr | Metric row *(live)* | `features/work/components/ReliabilityScoreCard.tsx:135` | "Verification ratio" |
| वेळेवर प्रमाण | mr | Metric row *(live)* | `features/work/components/ReliabilityScoreCard.tsx:140` | "On-time ratio" |
| वाद-मुक्त प्रमाण | mr | Metric row *(live)* | `features/work/components/ReliabilityScoreCard.tsx:145` | "Dispute-free ratio" |
| Show how this score is computed → / Score Computation | en | Explainer link + heading *(live)* | `features/work/components/ReliabilityScoreCard.tsx` | Untranslated English |
| Your reliability | en | Section heading on the profile *(live)* | `features/profile/sections/IdentitySection.tsx:413` | Untranslated English |
| विश्वासू नोंदी सुरू होतील · Trusted records unlock once verified | mr+en | Identity banner *(live)* | `features/profile/sections/IdentitySection.tsx:103` | Verification unlocks "trusted records" |
| पडताळलेली ओळख असली की तुमच्या नोंदींवर विश्वास वाढतो. | mr | Profile help copy *(live)* | `features/profile/ProfilePage.tsx:315` | "Verified identity increases trust in your records" |
| पडताळणी झालेला शेतकरी · Verified Farmer | mr+en | Identity banner *(live)* | `features/profile/sections/IdentitySection.tsx:134` | Verified farmer |
| ओळख तपासली जात आहे · ID under review | mr+en | Identity banner *(live)* | `features/profile/sections/IdentitySection.tsx:102` | Identity under review |
| तुमचा इतिहास सुरक्षित राहील. | mr | Leave-farm confirmation *(live)* | `features/people/components/MembershipsList.tsx:174` | "Your history stays safe" |
| ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर. | mr | Review help-note "का" *(live)* | `features/labour/components/ReviewSheet.tsx:639` | Claims a trust-graduation mechanism **that does not exist** |
| विश्वास · trust | mr+en | Group label on person detail *(flag-off, `SHOW_TRUST_GRADUATION`)* | `features/labour/components/PersonDetail.tsx:60` | The trust section |
| विश्वास द्या / विश्वास दिला / विश्वास काढा | mr | Trust-graduation controls *(flag-off)* | `features/labour/components/PersonDetail.tsx:66-78` | Grant / granted / revoke trust |
| विश्वास {n} — 30 दिवसांत वाद नाही | mr | Trust score line *(flag-off, `SHOW_TRUST_SCORE`)* | `features/labour/components/PersonDetail.tsx:210` | A score plus a dispute-free claim |
| विश्वासार्ह | mr | Sub-line under a name *(flag-off)* | `features/labour/components/PersonDetail.tsx:137` | "Trustworthy" |
| शिफारस · recommendation | mr+en | Eligibility card label *(flag-off)* | `features/labour/components/PersonDetail.tsx:73` | "Recommendation" |
| N दिवस · वाद नाही | mr | Eligibility line *(flag-off)* | `features/labour/components/PersonDetail.tsx:76` | "N days · no disputes" |
| २५ दिवस + स्वच्छ रेकॉर्ड नंतर विश्वास देता येईल | mr | Not-yet-eligible line *(flag-off)* | `features/labour/components/PersonDetail.tsx:87` | "After 25 days + a clean record" |
| सध्या याच्या नोंदी तुम्ही तपासता | mr | Not-yet-eligible headline *(flag-off)* | `features/labour/components/PersonDetail.tsx:85` | "For now you check his records" |
| इतिहासातून निवडा किंवा नवीन नाव | mr | Add-name toast *(preview-only)* | `features/labour/components/Attendance.tsx:116` | "Pick from history or a new name" |
| नाव जोडा — इतिहासातून किंवा नवीन | mr | Add-name button *(preview-only)* | `features/labour/components/Attendance.tsx:117` | Same |
| आवाजी इतिहास कायम ठेवा | mr | Voice diary headline *(live)* | `i18n/voiceDiaryTranslations.ts:141` | "Keep the voice history forever" |

**Note.** `{daysActive} दिवस काम` ("N days of work") was **deleted** from `PersonDetail.tsx`
under Task 22 because the number counted days since the worker was added, not days worked, and
no honest replacement word existed. The concept therefore currently has **no** word at all —
see Section D.

## A10 · Buttons, empty states, helper copy

| Current word | Lang | Kind | Farmer-facing location | File/path | Meaning in current UI |
|---|---|---|---|---|---|
| उघडा | mr | button | Hub hero pill *(live)* | `LabourHub.tsx` | "Open" |
| बरोबर | mr | button | The one save on the result screen *(live)* | `attendanceCopy.ts:confirmButton` | "Correct" |
| बदल करा | mr | button | Edit surface *(live)* | `attendanceCopy.ts:editButton` | "Make a change" |
| बोला | mr | button | Speak-more, rungs 2/3 *(live)* | `AttendanceResult.tsx` | "Speak" |
| मंजूर / शंका | mr | button | Approval pair *(live)* | `ReviewSheet.tsx` | Approve / query |
| पूर्ववत करा | mr | button | Undo *(live)* | `ReviewSheet.tsx` | "Undo" |
| जोडा | mr | button | Add a person *(live)* | `FieldOperatorPicker.tsx` | "Add" |
| बंद करा | mr | button | Close the picker; collapse the member card *(live)* | `FieldOperatorPicker.tsx`; `TeamMemberCard.tsx` | "Close" |
| बंद | mr | `aria-label` | Cell-detail close *(live)* | `HajeriCellDetail.tsx` | "Close" |
| मागे | mr | button | Back header on every sub-screen *(live)* | `LabourUiKit.tsx` (`BackHeader`) | "Back" |
| QR दाखवा | mr | button | People empty-state CTA *(live)* | `LabourHub.tsx` | "Show the QR" |
| पुन्हा प्रयत्न करा | mr | button + toast | Load-error banner; enqueue-failure toast *(live)* | `LabourUiKit.tsx`; `LabourFeature.tsx:341` | "Try again" |
| हे कसं चालतं? | mr | toggle | Default help-note label *(live)* | `LabourUiKit.tsx` (`HelpNote`) | "How does this work?" |
| काय आहे / काय करायचं / का? | mr | helper headings | Inside every help note *(live)* | `LabourUiKit.tsx` | "What it is / what to do / why" |
| नावं जोडा / आणखी नाव जोडा | mr | opt-in control | Picker trigger *(live)* | `FieldOperatorPicker.tsx:303` | "Add names" / "Add another name" |
| ऐच्छिक | mr | qualifier | On that trigger and the full-name field *(live)* | `FieldOperatorPicker.tsx:304,438` | "Optional" |
| नवीन नाव | mr | section label | Add form *(live)* | `FieldOperatorPicker.tsx:398` | "New name" |
| नाव | mr | placeholder | Add form *(live)* | `FieldOperatorPicker.tsx:421` | "Name" |
| ShramSafalला समजलं | mr | heading | Result screen *(live)* | `attendanceCopy.ts:understoodHeading` | "ShramSafal understood" |
| तुम्ही सांगितलं | mr | provenance chip | Result screen, disagreement card, source line *(live)* | `attendanceCopy.ts:youSaidChip` | "You said" |
| स्पष्ट माहिती | mr | provenance chip | Result screen, when the count came from the anchor *(live)* | `attendanceCopy.ts:explicitChip` | "Explicit information" |
| या N जणांमध्ये कोण होते? | mr | question | Ladder rung 2 *(live)* | `attendanceCopy.ts:rungWho` | "Who among these N?" |
| यांच्याशिवाय अजून कोण होते? | mr | question | Ladder rung 3 *(live)* | `attendanceCopy.ts:rungRemainder` | "Who else besides these?" |
| हे बरोबर आहे का? | mr | question | Ladder rung 4 *(live)* | `attendanceCopy.ts:rungConfirm` | "Is this correct?" |
| "बरोबर" दाबेपर्यंत काहीही जतन होणार नाही. | mr | honesty line | Above the save *(live)* | `attendanceCopy.ts:preSaveHonesty` | "Nothing is saved until you press बरोबर" |
| एक गोष्ट स्पष्ट करा | mr | title | Contradiction card *(live)* | `attendanceCopy.ts:contradictionTitle` | "Clarify one thing" |
| एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील. | mr | reassurance | Contradiction card *(live)* | `attendanceCopy.ts:contradictionReassurance` | Nothing is overwritten |
| दोन्ही नोंदी तशाच राहतील. | mr | reassurance | Headcount-disagreement card *(live)* | `AttendanceResult.tsx` | Both statements are kept |
| आजच्या कामाच्या नोंदीत N जण आहेत. | mr | fact line | Headcount-disagreement card *(live)* | `AttendanceResult.tsx` | What the log already says |
| आजच्या कामात किती जण होते ते अजून समजलं नाही. आधी आजचं काम सांगा. | mr | reason card | Under the inactive hero *(live)* | `attendanceCopy.ts:noAnchorReason` | Why the mic is off |
| अजून कोणी कामगार जोडलेला नाही / खालचं बटण दाबा आणि कामगाराला QR दाखवा. | mr | empty state | Hub people list *(live)* | `LabourHub.tsx` | No workers yet |
| अजून हजेरी नोंदवली नाही / बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल. | mr | empty state | Register, **owner view only** *(live)* | `HajeriLedger.tsx` | Nothing recorded yet |
| अजून सुचवण्यासारखं काही नाही / अधिक नोंदी झाल्यावर इथे उपयोगी माहिती दिसेल. | mr | empty state | आढावा insight slot *(live)* | `WeeklyDashboard.tsx` | Nothing to suggest yet |
| अजून प्लॉटनिहाय माहिती नाही / काम नोंदवल्यावर कोणत्या प्लॉटवर किती दिवस काम झालं ते इथे दिसेल. | mr | empty state | आढावा plots section *(live)* | `WeeklyDashboard.tsx` | No per-plot data yet |
| अजून कुणाचं नाव नाही / खाली नाव लिहून पहिलं नाव जोडा. | mr | empty state | Picker roster *(live)* | `FieldOperatorPicker.tsx:348` | No names yet |
| फार्म बुक अद्ययावत आहे / तपासायला काही उरलं नाही. | mr+en-loan | empty state | Review sheet *(live)* | `ReviewSheet.tsx:716` | "The **farm book** is up to date" |
| सगळं झालं ✓ | mr | empty state | Review sheet sub-heading *(live)* | `ReviewSheet.tsx:630` | "All done" |
| N नोंदी — मंजूर करा | mr | count line | Review sheet sub-heading *(live)* | `ReviewSheet.tsx:630` | "N records — approve" |
| माहिती आणता आली नाही | mr | error | Load-error banner *(live)* | `LabourUiKit.tsx` (`LoadErrorBanner`) | "Could not fetch the information" |
| माहिती आणत आहोत… | mr | loading | Full-screen loading *(live)* | `LabourUiKit.tsx` (`LoadingState`) | "Fetching…" |
| जोडता आलं नाही — पुन्हा प्रयत्न करा | mr | error toast | Attach a person failed *(live)* | `FieldOperatorPicker.tsx:227` | Could not attach |
| नाव जोडता आलं नाही — पुन्हा प्रयत्न करा | mr | error toast | Create a person failed *(live)* | `FieldOperatorPicker.tsx:250` | Could not add the name |
| यादी आली नाही, म्हणून नवीन नाव आत्ता जोडता येणार नाही — आधी पुन्हा प्रयत्न करा. | mr | blocked state | Add form, roster unavailable *(live)* | `FieldOperatorPicker.tsx:408` | Cannot add while the list is missing |
| मंजूर करता आलं नाही — पुन्हा प्रयत्न करा | mr | error | Approve failed *(live)* | `ReviewSheet.tsx:240` | Could not approve |
| शंका नोंदवता आली नाही — पुन्हा प्रयत्न करा | mr | error | Query failed *(live)* | `ReviewSheet.tsx:236` | Could not raise the query |
| लक्षात ठेवलं ✓ | mr | offline/pending | Toast, register legend, cell detail *(live)* | `LabourFeature.tsx`; `HajeriLedger.tsx`; `HajeriCellDetail.tsx` | On the phone, not yet acknowledged |
| किमान एक नाव आवश्यक. बाकीचे "+ २ जण" म्हणून मोजले जातील. हिरवा ✓ = अ‍ॅप कामगार, राखाडी = फक्त नाव. | mr | helper | Capture screen *(preview-only)* | `Attendance.tsx` | The whole naming rule in one box |
| 🎙 "आज ४ लोक कामाला आली" — व्हॉइस लॉगमधून | mr | helper | Counter hint *(preview-only)* | `Attendance.tsx` | Where the number came from |
| कोण काम करत होतं ते इथे नोंदवता येतं. मजुरांची संख्या यानं बदलत नाही. | mr | helper | Picker body *(live)* | `FieldOperatorPicker.tsx:310` | Naming never changes the headcount |
| टीमची हजेरी, मजुरी व नोंदींची तपासणी — सगळं एका जागी. | mr | helper | Hub help-note "काय आहे" *(live)* | `LabourHub.tsx` | What the subsystem covers |
| बोलून हजेरी घ्या · नोंदी तपासा. | mr | helper | Hub help-note "काय करायचं" *(live)* | `LabourHub.tsx` | What to do |
| रोजच्या नोंदी इथे तुम्ही मंजूर करता — तुमच्या स्वतःच्या असोत वा तुमच्या माणसांच्या. | mr | helper | Review help-note *(live)* | `ReviewSheet.tsx:637` | Whose records arrive here |
| चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो. | mr | helper | Review help-note "का" *(live)* | `ReviewSheet.tsx:639` | Why checking matters |
| तुमच्या शेतातले रोजचे कामगार असू शकतात… | mr | helper | Guide card line 1 *(live)* | `labourOversightTranslations.ts` | Who they may be |
| शक्य तेवढ्या सगळ्यांची नावं घ्या — म्हणजे नंतर तुम्हाला माहीत असेल, कोणतं काम कोणी केलं. | mr | helper | Guide card line 2 *(live)* | `labourOversightTranslations.ts` | Why to name people |
| 🎙 आवाज नोंद लॉग स्क्रीनवर होते | mr | fallback toast | When no log route is wired *(live)* | `LabourFeature.tsx:180` | Voice recording lives on the log screen |
| उचल — नमुना / सेटल — नमुना / पैसे दिले ✓ — नमुना | mr | placeholder toasts | Money actions *(flag-off paths)* | `LabourFeature.tsx:287-296` | Explicitly labelled "sample" |

---

# B. High-risk terms, classified by WHY

## B1 · Human reduced to an economic role

| Term | Where | Why it is high-risk |
|---|---|---|
| मजूर | `LabourDataPoints.tsx`, `LabourHub.tsx`, `ReviewSheet.tsx`, `LabourReview.tsx` | The default noun for a person on four live surfaces is the word for the labour he sells, not for him |
| कामगार | `LabourFeature.tsx:61`, `roleLabels.ts`, `TeamMemberCard.tsx`, `JoinFarmLandingPage.tsx` | Names both a screen about a person and a farm role; it is also the subsystem's own name |
| कामगार (as `workSummary.labour`) | `i18n/translations.ts:355,563` | Here the same word is a **cost category** on the day ledger, sitting beside सिंचन and यंत्रसामग्री |
| आज कामगार वापरलेले नाहीत | `i18n/translations.ts:578` | "No labour was **used** today" — people as a consumable input |
| N रोजंदारी · N उक्ते | `LabourHub.tsx` | Counts **people** under words that name a **payment basis** — the exact shape the founder's model forbids |
| मजूर-दिवस | `WeeklyDashboard.tsx` | A person-shaped unit of production |
| अ‍ॅप कामगार | `Attendance.tsx` *(preview-only)* | Splits humans into two kinds by whether they hold a device |
| फक्त नाव | `LabourUiKit.tsx` (`NameOnlyBadge`) | Reads as a judgement about the person, not about the app's knowledge — its own code comment records exactly this ambiguity |
| तात्पुरता | `LabourUiKit.tsx` (`TempBadge`) | "Temporary" applied to the human when it is a property of the engagement |

## B2 · Employer-centric framing

| Term | Where | Why |
|---|---|---|
| कामगार व्यवस्थापन | `LabourFeature.tsx:59`, `SetupHubMenu.tsx:286`, `mainViewComponents.tsx:105,114`, `LabourHub.tsx:450` | "Management **of workers**" — the subsystem is named after controlling people, on five live surfaces |
| याची माणसं · his team | `MukadamDetail.tsx` | People framed as belonging to a person |
| टीम N | `LabourUiKit.tsx` (`PersonRow`) | A human count rendered as an inventory pill beside a name |
| कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा | `i18n/translations.ts:623` | "Manage the **access** of family and workers" |
| नोंद करू द्या | `i18n/translations.ts` (`profile.allowLog`) | "**Allow** him to record" |
| नेमणूक करा / कामगार नेमणूक | `AssignWorkerSheet.tsx` | "Assign the worker" |
| मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे. | `ReviewSheet.tsx:68` | The dispute text sent to the record names owner and worker as opposing parties |

## B3 · Too technical

| Term | Where | Why |
|---|---|---|
| Labour Review / Total workers: N (…) | `LabourReview.tsx:67` | Untranslated English on a live Marathi screen; the file's own comment records that no approved Marathi exists |
| Reliability Score · 30-day window / Show how this score is computed → / Score Computation / Your reliability | `ReliabilityScoreCard.tsx`, `IdentitySection.tsx:413` | English measurement jargon about a person, live |
| Daily Wage / Contract / Self | `DetailSheet.tsx:221` | English economic categories on a live logging sheet |
| Per Tree / Per Acre / Per Row / Lump Sum / Unit / Quantity / Total Contract Amount (₹) | `DetailSheet.tsx` | An entire English contract form |
| Switch Operator | `OperatorSessionChip.tsx` | Device-session jargon |
| No operators added. / Add operators in Settings. | `OperatorSessionChip.tsx:97-98` | English, and "operator" is an internal concept |
| No Workers or Mukadams found on this farm | `AssignWorkerSheet.tsx` | English, with the internal role names |
| शिफ्ट · shift | `Attendance.tsx` *(preview-only)* | An English loan **and** its English gloss, side by side |
| सेटल | `MukadamDetail.tsx` *(flag-off)* | English "settle" transliterated |
| फार्म बुक | `ReviewSheet.tsx:716` | English "farm book" transliterated, on a live empty state |
| Verification Not Started / Verification Rejected / Start verification to build trust / Please fix issues and resubmit / Farm boundary drawn | `IdentitySection.tsx:113-125,304` | Live English-only states on the identity screen |

## B4 · Ambiguous

| Term | Where | Why |
|---|---|---|
| काम झालं | `LabourUiKit.tsx` (`BalanceCard`), `WeeklyDashboard.tsx` | Literally "the work is done", used as a **money total**. The most load-bearing ambiguity in the feature |
| हजेरी | `LabourHub.tsx`, `LabourFeature.tsx:62`, `HajeriLedger.tsx`, `attendanceCopy.ts` | The act, the record, the screen, and one person's day-mark, all one word |
| नोंद / नोंदी | `WeeklyDashboard.tsx`, `LabourHub.tsx`, `ReviewSheet.tsx`, `translations.ts` | A daily log, a queue item, a stat, an attendance mark, and a permission |
| दिवस | `HajeriLedger.tsx` | Heads the column of **names**; the word means "day" |
| आज | `labourWindow.ts`, `responsibilityDuration.ts`, `ReviewSheet.tsx`, `labourMock.ts` | A time window, a responsibility duration, a date badge, and a mock suffix |
| मजुरी | `LabourHub.tsx`, `WeeklyDashboard.tsx`, `SetupHubMenu.tsx`, `translations.ts` | A per-log calculated total, a windowed total, a subsystem descriptor, and a **rate** |
| बाकी | `LabourUiKit.tsx`, `WeeklyDashboard.tsx` vs `SetupHubMenu.tsx` | Money owed vs setup steps remaining |
| पूर्ण | `attendanceCopy.ts` vs `FieldOperatorPicker.tsx:438` vs `SetupHubMenu.tsx` | A day-mark, "full name", and "complete" |
| तुम्ही सांगितलं | `attendanceCopy.ts:youSaidChip` | Used both as a provenance chip on a count and as a prefix on the raw `sourceText` |
| ठरलेली / ठरवा / ठरतं | `LabourHub.tsx`, `TeamMemberCard.tsx:134`, `LabourHub.tsx:449` | The same root serves "an agreed amount", "decide a responsibility", and "is decided elsewhere" |

## B5 · Two concepts sharing one word

Fully enumerated in Section C1. The severe ones: **कामगार** (6 meanings), **हजेरी** (4),
**नोंद** (5), **मुकादम** (3), **टीम** (4), **काम** (4), **मजुरी** (4), **विश्वास** (3).

## B6 · One concept spread over several words

Fully enumerated in Section C2. The severe ones: the **countable human** (मजूर / लोक / जण /
माणसं / कामगार / व्यक्ती / सदस्य / चालक — eight live words), the **approval act** (तपासा /
तपासणी / तपासायचं / मंजूर / मंजूर करा / मंजुरीसाठी), **absence** (नाही / आला नाही), and the
**work-arrangement pair** (रोजंदारी / उक्ते काम vs Daily Wage / Contract / Self).

## B7 · Dignity conflict

| Term | Where | Why |
|---|---|---|
| आज कामगार वापरलेले नाहीत | `translations.ts:578` | People "used" or not used, on a live day-summary |
| फक्त नाव | `LabourUiKit.tsx` | A badge on a real person that reads as a deficiency in him |
| २५ दिवस + स्वच्छ रेकॉर्ड नंतर विश्वास देता येईल | `PersonDetail.tsx:87` *(flag-off)* | A probation notice about a person, shown to his employer |
| सध्या याच्या नोंदी तुम्ही तपासता | `PersonDetail.tsx:85` *(flag-off)* | Frames the worker as being under surveillance |
| विश्वासार्हता गुण / वाद-मुक्त प्रमाण | `ReliabilityScoreCard.tsx` *(live)* | A scored reputation on a named human — and the score's inputs are all-zero metrics, so every worker scores 100 |
| मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे. | `ReviewSheet.tsx:68` | The doubt is recorded against the person, in the record itself |
| तात्पुरता | `LabourUiKit.tsx` | Marks a human as temporary |
| याची माणसं · his team | `MukadamDetail.tsx` | Possessive framing of people |

## B8 · Comprehension risk for a semi-literate reader

| Term | Where | Why |
|---|---|---|
| उक्ते काम | `LabourHub.tsx`, `HajeriLedger.tsx`, `HajeriCellDetail.tsx` | Founder-sanctioned and correct, but carried on the hub by a **violet dot with no word** in the register cells — the word is only in the legend and the tap-detail |
| रोजंदारी / नोंदलेली vs उक्ते काम / ठरलेली | `LabourHub.tsx` | Four words, two money cards, and the distinction between "recorded" and "agreed" is carried entirely by two 13px sub-labels |
| मजूर-दिवस | `WeeklyDashboard.tsx` | A compound unit with no explanation anywhere on the screen |
| आजपर्यंत | `WeeklyDashboard.tsx` money-card basis line | Rendered at 11.5px as a qualifier; it is the only thing preventing the card being read on the slider's window |
| 4त = 4 तास · +2 जादा · ◾ रात्र | `HajeriLedger.tsx` | Three glyph conventions taught only in a legend above the grid |
| दोन legends | `HajeriLedger.tsx` | The top legend teaches आला/अर्धा/नाही by shape; the footer re-teaches the same three by colour, with different words |
| फार्म बुक | `ReviewSheet.tsx:716` | A transliterated English compound in the one place that tells the farmer he is finished |
| शिफ्ट · shift | `Attendance.tsx` *(preview-only)* | Neither half of it is Marathi |
| हा सदस्य काय करू शकतो? · What can they do? | `TeamMemberCard.tsx` | A bilingual line above the single most consequential control on the screen |

## B9 · Internal term leaking to a farmer-facing surface

| Internal term | Leaked as | Where |
|---|---|---|
| `Labour` (bounded-context / feature name) | "Labour" in `कामगार व्यवस्थापन · Labour` | `SetupHubMenu.tsx:286` *(live)* |
| `Labour Management` | "back to Labour Management" in an `aria-label` | `mainViewComponents.tsx:98` *(live, screen-reader)* |
| `LabourReview` (component) | "Labour Review" as a visible header | `LabourReview.tsx:67` *(live)* |
| `Worker` (role enum) | "Worker" in `कामगार · Worker`; "No Workers or Mukadams…" | `TeamMemberCard.tsx:121`; `AssignWorkerSheet.tsx` *(live)* |
| `Mukadam` (role enum) | "Mukadam" as the English half of the role label | `roleLabels.ts` *(live)* |
| `Operator` (device session) | "Switch Operator", "No operators added.", "Add operators in Settings." | `OperatorSessionChip.tsx` *(live)* |
| `ReliabilityScore` (domain type) | "Reliability Score · 30-day window", "Your reliability", "Score Computation" | `ReliabilityScoreCard.tsx`; `IdentitySection.tsx:413` *(live)* |
| `ContractUnit` (crop/domain field) | "Unit" select with Per Tree / Per Acre / Per Row / Lump Sum | `DetailSheet.tsx` *(live)* |
| `LabourType` = HIRED/CONTRACT/SELF | "Daily Wage / Contract / Self" tabs | `DetailSheet.tsx:221` *(live)* |
| `plotScope = 'Farm'` | Resolved to संपूर्ण शेत — **correctly**, no leak | `ReviewSheet.tsx` (listed as the counter-example) |

---

# C. Vocabulary collisions

## C1 · One word, several meanings

| Word | Distinct meanings, each with its site |
|---|---|
| **कामगार** | 1. The subsystem (`कामगार व्यवस्थापन`, `LabourFeature.tsx:59`) · 2. A farm-membership role (`roleLabels.ts`, `TeamMemberCard.tsx:121`, `JoinFarmLandingPage.tsx:37`) · 3. The person-detail screen title (`LabourFeature.tsx:61`) · 4. A device-session operator (`OperatorSessionChip.tsx:25`) · 5. A **cost category** on the day ledger (`translations.ts:563`) · 6. Settings groupings — कामगार दर, कामगार पाळ्या (`translations.ts:588,602`) |
| **हजेरी** | 1. The act (`बोलून हजेरी घ्या`) · 2. The record (`हजेरी वही`) · 3. The capture screen (`आजची हजेरी`) · 4. One person's day-mark (`आजची हजेरी कोणती?`, `attendanceCopy.ts`) |
| **नोंद / नोंदी** | 1. A daily log (`आजच्या नोंदी`) · 2. An approval-queue item (`N नोंदी — मंजूर करा`) · 3. A stat-tile count (`नोंदी`, `WeeklyDashboard.tsx`) · 4. An attendance mark (`बोलून नोंदवलेली हजेरी`) · 5. A permission (`नोंद करू द्या`, `translations.ts`) |
| **मुकादम** | 1. A farm role with app access and QR issuance · 2. A crew organiser who may have no account · 3. A data projection tier that governs money withholding (`LabourView`) |
| **टीम** | 1. A mukadam's people (`टीम N`) · 2. A task crew (`{task} टीम`) · 3. The farm's app members (`टीम सेटअप`, `टीममधून काढा`) · 4. Attendance scope (`टीमची हजेरी`) |
| **काम** | 1. Work performed (`कुठे काम झालं`) · 2. A task (`आजचं काम सांगा`) · 3. Being at work (`आज कामावर`) · 4. **A money total** (`काम झालं`) |
| **मजुरी** | 1. Per-log calculated total (`LabourHub.tsx`) · 2. Windowed wages total (`WeeklyDashboard.tsx`) · 3. Subsystem descriptor (`SetupHubMenu.tsx`) · 4. A **rate** (`दैनंदिन मजुरी`, `translations.ts`) |
| **उचल** | 1. Advance given out (`BalanceCard` tile, `उचल दिली` stat) · 2. Advance still outstanding (`उचल बाकी`) · 3. An action (`उचल द्या`) |
| **विश्वास** | 1. Trust-graduation / auto-approval (`PersonDetail.tsx`, `ReviewSheet.tsx:639`) · 2. A numeric score (`विश्वास {n}`, `विश्वासार्हता गुण`) · 3. Confidence gained from identity verification (`ProfilePage.tsx:315`, `IdentitySection.tsx:103`) |
| **आज** | 1. A time window (`labourWindow.ts`) · 2. A responsibility duration (`responsibilityDuration.ts`) · 3. A date badge in review (`reviewDetailDate.ts`) · 4. A mock suffix (`· आज`) |
| **बाकी** | 1. Money owed (`LabourUiKit.tsx`, `WeeklyDashboard.tsx`) · 2. Setup steps remaining (`SetupHubMenu.tsx`) · 3. "The rest of them" (`बाकीचे "+ २ जण"`, `Attendance.tsx`) |
| **पूर्ण** | 1. A full-day mark (`attendanceCopy.ts`) · 2. Full name (`पूर्ण नाव`) · 3. Complete (`SetupHubMenu.tsx`) |
| **आला** | 1. Register legend "came" · 2. Segment control "present" (`Attendance.tsx`) · 3. Negated as `आला नाही` in cell detail vs bare `नाही` in the legend |
| **दिलं** | 1. Money paid (`BalanceCard`) · 2. `जास्त दिलं` = overpaid · 3. `विश्वास दिला` = trust granted · 4. `जबाबदारी द्या` = responsibility handed over |
| **तपासा / तपासणी** | 1. The approval queue (`LabourHub.tsx`, `ReviewSheet.tsx:624`) · 2. Identity verification (`ओळख तपासली जात आहे`) · 3. A reliability metric (`तपासणी प्रमाण`) |

## C2 · Several words, one meaning

| Concept | Competing words, each with its site |
|---|---|
| **A countable human** | मजूर (`LabourDataPoints`, `ReviewSheet`) · लोक (`Attendance`, hub hero example) · जण (`LabourHub`, `AttendanceResult`, `attendanceCopy`) · माणसं / माणूस (`FieldOperatorPicker`, `LabourHub`, `MukadamDetail`) · कामगार (`roleLabels`, `LabourFeature`) · व्यक्ती (`FieldOperatorPicker:389`) · सदस्य (`roleLabels` fallback, `TeamMemberCard`) · चालक (`OperatorSessionChip`) |
| **The approval act** | तपासा (hub tile) · मंजूर करा (that tile's sub) · तपासणी (sheet `<h2>`) · तपासायचं (dashboard strip) · मंजूर (button) · मंजुरीसाठी (`जतन करा → मंजुरीसाठी`) |
| **The group a mukadam brings** | टीम (`PersonRow` pill) · याची माणसं (`MukadamDetail`) · {name}सोबत (register crew row) · मुकादमाकडून आलेले (guide card) · छाटणी टीम (mock) |
| **The farm's app members** | टीम (`टीम सेटअप`, `टीममधून काढा`) · संघ (`माझा शेत संघ`, `अजून संघ सदस्य नाहीत`, `translations.ts`) |
| **Absent that day** | नाही (register legend) · आला नाही (cell detail) — and `अनुपस्थित` appears only in `HajeriLedger.tsx`'s own header comment, never on screen |
| **Half a day** | अर्धा (mark word, legend, segment) · अर्धा दिवस (shift label, register footer) · ½ (glyph) |
| **Money owed** | बाकी (tile, bar legend) · द्यायचे (money line, balance headline) · उचल बाकी (when an advance is outstanding) |
| **Money paid** | दिलं (tile, bar legend) · पैसे द्या (worker button) · सेटल (mukadam button) · पैसे दिले (toast) |
| **Nothing was stated** | — em-dash (every money and count slot) · रिकामं (register legend) · कुणी माहिती नाही (legend + cell detail) · outright omission (`LabourHub` just-logged rows, `MukadamDetail` why-line) |
| **The register** | हजेरी वही (title, tile, button) · सर्व दिवस (tile sub) · सर्व दिवसांची हजेरी पहा (button sub) |
| **The work-arrangement pair** | रोजंदारी / उक्ते काम (`LabourHub.tsx`, Marathi, money-card titles) · Daily Wage / Contract / Self (`DetailSheet.tsx:221`, English, tab labels) — **the same distinction, two vocabularies, two languages, two live screens** |
| **A person's identification state** | फक्त नाव (badge) · अ‍ॅप कामगार / राखाडी (helper box) · हिरवा ✓ (helper box) · verified/unverified (`w.verified`, unnamed on screen) |
| **A queued, unacknowledged fact** | लक्षात ठेवलं ✓ (toast + legend + detail) · dashed amber cell (register, wordless) · tiny Clock glyph (register, wordless) |
| **The overview screen's own sections** | आढावा (title) · पैसे · money (group label) · कुठे काम झालं · plots (group label) — one Marathi title over two bilingual section labels |

---

# D. Vocabulary gaps — concepts with no settled farmer-facing word

Listed only. Deliberately **not** filled.

1. **The subsystem itself.** The founder's rule forbids "Labour"/"Labour Management" on farmer
   surfaces. `कामगार व्यवस्थापन` is the only name that exists, on five live surfaces
   (`LabourFeature.tsx:59`, `SetupHubMenu.tsx:286`, `mainViewComponents.tsx:105,114`,
   `LabourHub.tsx:450`). There is no second candidate anywhere in the tree.
2. **A withheld figure.** `HajeriLedger.tsx` renders a bare grid and claims nothing for a
   non-owner view because, in its own words, "no Marathi exists for a withheld state". The
   money card renders `—`, which is the mark for *not stated*, not for *not shown to you*.
3. **Days on the farm.** `{daysActive} दिवस काम` was deleted (Task 22) because the number was
   days since being added, not days worked. No word replaced it.
4. **The manual-entry labour block.** "Labour Review" and "Total workers: N (…)" remain English
   because, per the file's own comment, no founder-approved Marathi equivalent exists.
5. **The register's crew aggregate row.** `{name}सोबत` is a construction, not a term — it names
   no concept the farmer can be told about elsewhere.
6. **A counted but unnamed person.** `+ २ जण` is a formula in a helper box *(preview-only)*.
   There is no noun.
7. **The identification state.** `फक्त नाव` and `अ‍ॅप कामगार` name two ends of a spectrum with
   no name for the spectrum, and the second is an English loan.
8. **The engagement.** `LabourAssignment` — the thing an attendance mark, an amount and an
   arrangement all attach to — has never been given a farmer-facing word.
9. **"No known उक्ते agreement governs this."** The founder's model makes this the positive
   default. Today the app expresses it with `रोजंदारी`, which names a payment basis and is
   rendered as a people-count bucket.
10. **A rate with no trustworthy source.** Only the em-dash exists, and the em-dash already
    means "not stated" for four other things.
11. **A settled / verified period.** The stated end-goal is a downloadable week or month that a
    human can mark settled and verified. No vocabulary for "settled", "verified for the week",
    or "closed" exists on any labour surface.
12. **The outcome of a contradiction.** After the farmer answers `आजची हजेरी कोणती?` there is no
    word for what was recorded as a result — only the two original facts, both preserved.
13. **The period a figure covers, as a concept.** The four window labels exist; there is no word
    for the idea, which is why `आजपर्यंत` has to be printed as a bare qualifier on the money card.
14. **Night work as a noun.** `रात्र` is a mark and `रात्रपाळी` a shift label *(preview-only)*;
    the register shows `◾` with no word in the cell.
15. **A non-owner's own view of the register.** Nothing names what the worker or मुकादम is
    looking at, or why it differs from what the owner sees.

---

# E. Founder decision list

Fifteen real naming decisions. Each states the current terms, where they are used, and why a
decision is needed. No option is proposed.

### N1 — What is this subsystem called to a farmer?
**Current terms:** `कामगार व्यवस्थापन`; `कामगार व्यवस्थापन · Labour`; `Labour Management` (aria).
**Where:** `LabourFeature.tsx:59` (hub title), `SetupHubMenu.tsx:286` (the only door),
`mainViewComponents.tsx:98,105,114` (log-page banner ×3), `LabourHub.tsx:450` (help label).
**Why a decision is needed:** the rule bans both "Labour" and a person-classifying noun on
farmer surfaces, and `कामगार व्यवस्थापन` is both. No alternative exists in the tree, so nothing
can move until this word is chosen. It appears on the app's front door.

### N2 — What is one countable person called?
**Current terms:** `मजूर`, `लोक`, `जण`, `माणसं`/`माणूस`, `कामगार`, `व्यक्ती`, `सदस्य`, `चालक`.
**Where:** `LabourDataPoints.tsx`, `LabourHub.tsx`, `ReviewSheet.tsx`, `LabourReview.tsx`,
`AttendanceResult.tsx`, `attendanceCopy.ts`, `FieldOperatorPicker.tsx`, `MukadamDetail.tsx`,
`roleLabels.ts`, `OperatorSessionChip.tsx`, `Attendance.tsx`.
**Why:** eight live words for one idea, chosen per screen. The farmer meets `जण` on the hub,
`मजूर` on the just-logged card, `माणसं` in the picker, and `कामगार` on the detail screen — all
in one session, all the same people.

### N3 — Is `रोजंदारी` allowed to appear as a visible bucket of people?
**Current terms:** `रोजंदारी` (money-card title, sub-label `नोंदलेली`); `N रोजंदारी · N उक्ते`
(a count of people).
**Where:** `LabourHub.tsx` — the owner-only money grid and the `आज कामावर N जण` breakdown.
**Why:** the corrected economic model says रोजंदारी describes the **basis on which the farmer is
obligated to pay**, not a kind of person. The breakdown line currently counts humans under it.
`उक्ते काम` may stay farmer-facing; this decision is only about the other half of the pair.

### N4 — Does `मुकादम` keep covering farm authority and crew organiser?
**Current terms:** `मुकादम`, `उप-मुकादम`, `Mukadam` (en), `मुकादमाकडून आलेले`, `{name}सोबत`,
`तात्पुरता`.
**Where:** `LabourUiKit.tsx` (`MukadamBadge`), `MukadamDetail.tsx`, `HajeriLedger.tsx` (crew
rows), `roleLabels.ts`, `JoinFarmLandingPage.tsx:38`, `TeamMemberCard.tsx`,
`labourOversightTranslations.ts`, `AssignWorkerSheet.tsx` (English).
**Why:** one badge serves a QR-issuable app role and a man who brings ten people and has no
phone. The founder's model states explicitly that "Mukadam involvement ≠ automatically
contract", but the UI cannot even distinguish the two mukadams, let alone keep that separation.

### N5 — One word for the approval act.
**Current terms:** `तपासा`, `मंजूर करा`, `तपासणी`, `तपासायचं`, `मंजूर`, `मंजुरीसाठी`.
**Where:** `LabourHub.tsx` (tile + sub), `ReviewSheet.tsx:624,630,640,693` (heading, count line,
help label, button), `WeeklyDashboard.tsx` (strip), `Attendance.tsx` (save button).
**Why:** six words for one act across four screens, and `तपासणी` additionally collides with
identity verification (`ओळख तपासली जात आहे`) and with a reliability metric (`तपासणी प्रमाण`).

### N6 — `मजुरी`: total, rate, or the subsystem's descriptor?
**Current terms:** `मजुरी` in four roles; `दैनंदिन मजुरी`; `कामगार दर` / `पुरुष दर` / `महिला दर`.
**Where:** `LabourHub.tsx` (per-log calculated total), `WeeklyDashboard.tsx` (windowed total),
`SetupHubMenu.tsx:286` (subsystem subtitle), `translations.ts:588-590` and `settings.dailyWage`
(rates).
**Why:** the founder's classification treats rate, calculated and total as different things.
One word currently carries all three, and the same word also names the subsystem on the door.

### N7 — Is `काम झालं` allowed to be a money label?
**Current terms:** `काम झालं` (balance tile); `काम झालं · एकूण नोंदवलं` (money-card header);
`काम झालं ₹X − दिलं ₹Y` (the why-line).
**Where:** `LabourUiKit.tsx` (`BalanceCard`, every person and mukadam detail),
`WeeklyDashboard.tsx` (farm-wide money card), `PersonDetail.tsx`.
**Why:** the phrase reads "the work got done" and carries a rupee figure. It sits directly
above `दिलं` and `बाकी` on the one card a farmer uses to decide what he owes a named human.

### N8 — How is identification state described, if at all?
**Current terms:** `फक्त नाव`; `अ‍ॅप कामगार`; `हिरवा ✓` / `राखाडी`; `सारखं नाव — वेगळी व्यक्ती`.
**Where:** `LabourUiKit.tsx` (`NameOnlyBadge`, live on every person row),
`Attendance.tsx` *(preview-only helper)*, `FieldOperatorPicker.tsx:389`.
**Why:** `फक्त नाव` is a live badge on a real person that reads as a judgement about him rather
than about the app's knowledge — a defect its own code comment already names. `अ‍ॅप कामगार`
classifies humans by device ownership.

### N9 — `टीम` / `संघ`: which, and for which of four things?
**Current terms:** `टीम N`, `{task} टीम`, `टीमची हजेरी`, `टीम सेटअप`, `टीममधून काढा · Remove`,
`माझा शेत संघ`, `अजून संघ सदस्य नाहीत`, `याची माणसं · his team`.
**Where:** `LabourUiKit.tsx`, `LabourHub.tsx`, `MukadamDetail.tsx`, `TeamMemberCard.tsx`,
`translations.ts` (`profile.myFarmTeam`, `profile.noTeamMembers`).
**Why:** an English loan and a Marathi word are used for the same idea in the same app, and
between them they cover four different groups.

### N10 — Responsibility or permission? The app currently says both.
**Current terms:** handover side — `जबाबदारी द्या`, `जबाबदारी ठरवा`, `कामगारांची जबाबदारी आहे`,
`नंतर जबाबदारी आपोआप संपेल`. Permission side — `कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा`,
`नोंद करू द्या`, `Switch Operator / चालक बदला`, `'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं`.
**Where:** `TeamMemberCard.tsx:134,183,251,268` and `responsibilityDuration.ts` (handover);
`translations.ts:623` and `profile.allowLog`, `OperatorSessionChip.tsx`, `LabourHub.tsx:449`
(permission).
**Why:** D5 rewrote the labour control to handover, and `farmerVocabulary.scan.test.ts` now
bans permission vocabulary — but only inside `features/labour/` plus `TeamMemberCard.tsx` and
`IdentitySection.tsx`. `i18n/translations.ts` and `OperatorSessionChip.tsx` are outside that
scope, so the Setup Hub screen that **leads to** the handover control still says प्रवेश
("access") and the device chip still says *Operator*. A decision here also settles whether the
scan's scope should widen to the i18n bundle.

### N11 — The reputation vocabulary that already exists, and will collide.
**Current terms:** live — `विश्वासार्हता गुण`, `तपासणी प्रमाण`, `वेळेवर प्रमाण`,
`वाद-मुक्त प्रमाण`, `Reliability Score · 30-day window`, `Your reliability`,
`विश्वासू नोंदी सुरू होतील`, `ज्याच्यावर विश्वास दिला… आपोआप मंजूर`. Flag-off —
`विश्वास · trust`, `विश्वास द्या/दिला/काढा`, `विश्वासार्ह`, `शिफारस · recommendation`,
`स्वच्छ रेकॉर्ड`.
**Where:** `ReliabilityScoreCard.tsx` (reached from `IdentitySection.tsx:406` and
`WorkerProfilePage.tsx`), `ReviewSheet.tsx:639`, `PersonDetail.tsx:60-95,137,210`.
**Why:** a scored-reputation vocabulary is **already live** on a named human, and the labour
feature carries a second, dormant one. Any new skill or history vocabulary lands on top of both.
Two live strings also assert mechanisms that do not exist: `ReviewSheet.tsx:639` promises
auto-approval for trusted workers, and every worker's reliability score is 100 because its
metrics source returns zeros.

### N12 — `हजेरी`: act, record, screen, or one person's day?
**Current terms:** `बोलून हजेरी घ्या`, `बोलून नोंदवलेली हजेरी`, `हजेरी वही`, `आजची हजेरी`,
`आजची हजेरी कोणती?`, `अजून हजेरी नोंदवली नाही`, `हजेरी · मजूर · मजुरी बोला`.
**Where:** `LabourHub.tsx`, `LabourFeature.tsx:62,73`, `HajeriLedger.tsx`,
`attendanceCopy.ts:contradictionBody`, `mainViewComponents.tsx:110`,
`labourOversightTranslations.ts`.
**Why:** the founder has already ruled that हजेरी घेणे is the **act** of recording who came. The
same word is also the register, the screen, and one person's day-mark — and the contradiction
question `आजची हजेरी कोणती?` uses the fourth sense while the hero uses the first.

### N13 — `उचल`: the advance, the balance, or the act — on a legally sensitive concept.
**Current terms:** `उचल` (tile, legend), `उचल बाकी` (net), `उचल द्या` (button),
`उचल दिली` (stat), `उचल — नमुना` (toast).
**Where:** `LabourUiKit.tsx` (`MoneyLine`, `BalanceCard`), `WeeklyDashboard.tsx`,
`LabourFeature.tsx:287,295`. All flag-off or mock today; the server hardcodes `advance = 0m`.
**Why:** the vocabulary is already written and will go live the day an advance system ships.
The area carries a recorded legal constraint (advance-worked-off-against-days as a bonded-labour
pattern), which makes "given", "outstanding" and "give" three decisions, not one.

### N14 — The "not stated" family.
**Current terms:** `—` (em-dash), `रिकामं`, `कुणी माहिती नाही`, and outright omission.
**Where:** `LabourUiKit.tsx`, `WeeklyDashboard.tsx`, `LabourHub.tsx`, `ReviewSheet.tsx`
(em-dash); `HajeriLedger.tsx` legend (`रिकामं = कुणी माहिती नाही`); `HajeriCellDetail.tsx`
(`कुणी माहिती नाही`).
**Why:** the em-dash currently means *nobody stated a headcount*, *nobody stated a cost*, *no
job-card evidence*, **and** *withheld from this viewer* — four different truths under one glyph.
The register teaches a word for one of them and the money screens teach none.

### N15 — The residual English on live farmer screens.
**Current terms:** `Labour Review`, `Total workers: N (…)`, `Daily Wage / Contract / Self`,
`Per Tree / Per Acre / Per Row / Lump Sum`, `Unit`, `Quantity`, `Total Contract Amount (₹)`,
`Reliability Score · 30-day window`, `Your reliability`, `Score Computation`,
`Show how this score is computed →`, `Switch Operator`, `No operators added.`,
`Add operators in Settings.`, `No Workers or Mukadams found on this farm`,
`Verification Not Started`, `Verification Rejected`, plus the loans `सेटल`, `शिफ्ट`, `फार्म बुक`,
`अ‍ॅप कामगार`, `टीम`.
**Where:** `LabourReview.tsx:67`, `DetailSheet.tsx:210-380`, `ReliabilityScoreCard.tsx`,
`IdentitySection.tsx:113,124,413`, `OperatorSessionChip.tsx`, `AssignWorkerSheet.tsx`,
`MukadamDetail.tsx`, `Attendance.tsx`, `ReviewSheet.tsx:716`, `LabourUiKit.tsx`.
**Why:** `DetailSheet.tsx` is the sharpest case — a live sheet where the same economic
distinction as `रोजंदारी` / `उक्ते काम` is presented as `Daily Wage / Contract / Self` in English,
with its own English unit vocabulary. Whatever N3 decides has to reach this screen too, or the
app will state the farmer's payment basis two incompatible ways.

## E-bis · Internal term classification

Per the rule that internal names stay: this table classifies where each internal term actually
sits today, so the naming session knows which ones are purely internal and which have already
escaped onto a farmer's screen.

| Internal term | Classification | Evidence |
|---|---|---|
| `LabourAssignment` | **Internal only** | 156 files; never rendered. No farmer-facing word exists for it (Gap 8) |
| `LabourManagementPermission` | **Internal only** | 10 files; the farmer-facing surface says जबाबदारी, and `farmerVocabulary.scan.test.ts` bans permission words there |
| `FieldOperator` | **Internal only** | 116 files; the picker calls them माणसं / नाव, never "operator" |
| `Operator` (device session) | **Farmer-facing leak** | "Switch Operator", "No operators added.", "Add operators in Settings." — `OperatorSessionChip.tsx` *(live)* |
| `ContractUnit` | **Farmer-facing leak** | The `Unit` select and Per Tree / Per Acre / Per Row / Lump Sum — `DetailSheet.tsx` *(live)* |
| `LabourType` (HIRED / CONTRACT / SELF) | **Farmer-facing leak** | Rendered as the `Daily Wage / Contract / Self` tab row — `DetailSheet.tsx:221` *(live)* |
| `Labour` / `Labour Management` | **Both** | Internal context and feature name **and** live text: `SetupHubMenu.tsx:286`, `mainViewComponents.tsx:98`, `LabourReview.tsx:67` |
| `Mukadam` | **Both** | A role enum **and** a live badge, a live role label (`Mukadam` en), a live QR role, a live English empty state |
| `Worker` | **Both** | A role enum **and** live text: `कामगार · Worker` (`TeamMemberCard.tsx:121`), `No Workers or Mukadams…` (`AssignWorkerSheet.tsx`) |
| `ReliabilityScore` | **Both** | A domain type **and** live headings: `Reliability Score · 30-day window`, `Your reliability`, `Score Computation` |
| `AttendanceMark` / `dayMark` / `nightMark` | **Internal only** | The wire vocabulary; the farmer reads आला / अर्धा / नाही / रात्र |
| `LedgerCell` / `LedgerRow` / `LedgerCrewRow` | **Internal only** | Never rendered; the crew row shows `{name}सोबत` |
| `LabourWindow` (`alltime`/`today`/`week`/`month`) | **Internal only** | Wire values; the farmer reads the four approved Marathi labels |
| `LabourView` (`owner`/`crew`/`own`) | **Internal only** | Governs withholding; no word reaches the screen — which is Gap 2 |
| `LabourEngagement` | **Internal only** | 43 files; no farmer-facing counterpart |
| `LabourAnchor` | **Internal only** | The farmer reads only `noAnchorReason` |
| `plotScope = 'Farm'` | **Internal only** | Correctly resolved to `संपूर्ण शेत` at the render site — the counter-example that shows the pattern works |

---

*End of audit. Evidence only; nothing was renamed, replaced, added or removed.*
