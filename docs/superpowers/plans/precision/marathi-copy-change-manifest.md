# Marathi copy-change manifest — Labour V2 R1

Built 2026-09-04 from the founder's own decision list ("MARATHI WORD CALLS — 116 of 116
decided"). Every row below was checked against the working tree of `feat/labour-v2-r1`:
the old wording is confirmed present at the line named, and the line is the current one,
not the audit's snapshot. **Nothing here has been applied.**

Join integrity: 116 decisions · 0 duplicates · 0 unknown ids · 0 of the copy-chief's 116
non-KEEP rows left undecided · 0 decisions landing on a row that was already KEEP.

> **Nothing in this document has been applied.** It is the instruction list. No component,
> no `translations.ts` entry, no test and no internal `Labour*` identifier has been touched.

## What you decided

| | |
|---|---|
| Strings you changed | **96** |
| Strings you rewrote in your own words | **1** (#15) |
| Strings you deleted | **1** (#277) |
| Strings you kept | **18** |
| **Total** | **116 of 116** |

Every one of those 116 maps to a real line in the working tree. Where the automatic search
could not place a string, I opened the file and resolved it by hand; those rows carry a note
saying why. **Two of your decisions turned out to be the same edit** — #207 and #208 are one
literal at `LabourUiKit.tsx:117`, so the 98 changes land as **97 edits**.

Of the 97: **75 are live today**, 7 sit behind the disabled preview door, and 16 are in code
no route reaches. Those last 23 change nothing a farmer sees now — worth doing so the words
match when the doors open, but they are not the release.

---

## Three things need you before I apply any of it

### 1. The same words are still live on 24 screens outside Labour V2

You retired `मजूर`, `कामगार`, `मुकादम` and `तपासणी` on the Labour screens. Those words are
also live on **login, the farm-invite QR, referrals, the growth ledger, the role badges and
the DFES cards** — surfaces this audit never covered, because it was scoped to Labour V2.

If I apply only your 116, a farmer will read **"N जण"** on the हजेरी screen and **"मजूर"** on
the saved-log chip, in the same session. The word would be half-retired.

| Word you retired | Still live at | What it says today |
|---|---|---|
| `मजूर` | `savedView.tsx:210` | the saved-log chip label |
| | `LabourDataPoints.tsx:38` | `{count} मजूर` chip |
| | `ExecutionStatusSelector.tsx:31` | `मजूर नव्हते` (a deviation reason) |
| | `consentNotice.ts:285` | in the consent data list |
| `कामगार` | `LoginPage.tsx:131, :274` | `कामगार आहे?` · `मी कामगार आहे` |
| | `FarmInviteQrSheet.tsx:179, :269` | `तुमच्या कामगारांना ही QR दाखवा` |
| | `AssignWorkerSheet.tsx:82, :97` | `कामगार नेमणूक` · `कोणतेही कामगार उपलब्ध नाहीत` |
| | `IdentitySection.tsx:458` | `कामगारांना जोडा` |
| | `FirstFarmWizard.tsx:405` | `कामगारांशी शेअर करण्यासाठी तयार` |
| | `ReferralsPage.tsx:121` | referral terms |
| | `GrowthLedgerList.tsx:38` | `कामगार सक्रिय` |
| | `roleLabels.ts:98` · `FarmContextSwitcher.tsx:54` · `JoinFarmLandingPage.tsx:37` · `OperatorSessionChip.tsx:25` | the role badge, four places |
| `मुकादम` | `roleLabels.ts:92` · `FarmContextSwitcher.tsx:53` · `JoinFarmLandingPage.tsx:38` | the role badge |
| `तपासणी` | `PayoutEligibilityStrip.tsx:45` | `नोंद तपासणीची प्रतीक्षा` |
| | `ReliabilityScoreCard.tsx:135` | `तपासणी प्रमाण` |
| | `dfesTranslations.ts:465` | `तपासणी बाकी आहे` |

**The question:** same word everywhere, or Labour V2 only for now and the rest as a second pass?

Two cautions if you say "everywhere":

- **`मुकादम` is not obviously wrong outside Labour.** Your #66 changed one *farm-role badge*
  to `जबाबदार`. The role badge in `roleLabels.ts` names the same person in a different
  context, and `मुकादम` is a real word a farmer uses. This is the Farm-vs-crew question
  (N4) reappearing — it may deserve its own answer, not an automatic sweep.
- **One `तपासणी` must NOT change.** `ProfilePage.tsx:319` says `तुमच्या मातीची तपासणी` —
  soil testing. Different meaning, same word. It stays.

### 2. Deleting #277 removes the company's name from the consent screen

You marked it *remove this*:

> `श्रम सफल हे Agriryot Value Enterprises Private Limited चं ॲप आहे; ते AgriSync प्लॅटफॉर्मवर चालतं.`

The line is genuinely bad Marathi — two banned words (`ॲप`, `प्लॅटफॉर्म`) and an English legal
name mid-sentence. But it is also the only place the app tells the farmer **which company is
taking his data**, on the screen where he consents to that. Under DPDP the data fiduciary has
to identify itself at consent. I am not your lawyer and this is not legal advice — but
deleting it outright is a different act from fixing the Marathi.

**Recommended instead of deletion** — same information, no banned words, plain speech:

> `श्रम सफल — Agriryot Value Enterprises Private Limited यांची सेवा.`

Say the word and I apply the deletion exactly as you wrote it. Otherwise I apply this line
and we keep both the Marathi and the disclosure. **Nothing is applied until you answer.**

### 3. A button now points at a screen you renamed

Your #160 renames the screen `तपासणी` → **`मंजुरी`**. Your #117 changes the save button to
**`बरोबर — तपासणीसाठी`**. Applied together, the button sends the farmer to "तपासणी" and he
arrives at a screen headed "मंजुरी".

Both are inside your own decisions, so this is a coin-flip, not a defect — tell me which side
wins and I make them agree:

- **(a)** button reads `बरोबर — मंजुरीसाठी` — the screen name wins
- **(b)** screen stays `तपासणी` — #160 is withdrawn

Two other strings on that same screen keep the verb — #171 `सगळ्या नोंदी तपासून झाल्या` and
#190 `तपासा`. Those read fine either way: *तपासणे* is the action, *मंजुरी* is the outcome.

---


---

## A. LIVE TODAY — a farmer sees these now — 75 changes


### features/profile/components/SetupHubMenu.tsx

**#1** · setup-hub · line 289 — literal · was PASS, changed anyway

- old: `कामाच्या नोंदी`
- new: `कामाचा हिशोब`

**#3** · setup-hub · line 296 — literal

- old: `पैसे व हिशोब · Finance`
- new: `पैसे व हिशोब`

### i18n/translations.ts

**#4** · setup-hub · `profile.manageAccess` (line 623)

- old: `कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा`
- new: `कोणाला काय जबाबदारी, ते इथे ठरवा.`

**#6** · setup-hub · `profile.noTeamMembers` (line 628)

- old: `अजून संघ सदस्य नाहीत`
- new: `अजून कोणी संघात नाही`

**#7** · setup-hub · `profile.addFamilyOrWorkers` (line 629)

- old: `शेत व्यवस्थापनासाठी कुटुंब किंवा कामगार जोडा.`
- new: `शेतात मदत करणाऱ्यांची नावं जोडा — घरातली किंवा बाहेरची.`

**#8** · setup-hub · `profile.allowLog` (line 627)

- old: `नोंद करू द्या`
- new: `नोंद करण्याची जबाबदारी`

### core/navigation/mainViewComponents.tsx

**#10** · main-log-banner · line 98 — literal

- old: `कामाच्या नोंदींकडे परत जा — back to the work records`
- new: `कामाच्या नोंदींकडे परत जा`

**#11** · main-log-banner · line 108 — literal · was PASS, changed anyway

- old: `कामाच्या नोंदींसाठी`
- new: `कामाच्या हिशोबासाठी`

**#12** · main-log-banner · line 115 — literal

- old: `हजेरी · मजूर · मजुरी बोला`
- new: `कोण आलं · किती जण · किती मजुरी — बोला`

**#13** · main-log-banner · line 98 — literal · was PASS, changed anyway

- old: `कामाच्या नोंदी`
- new: `कामाचा हिशोब`

### core/navigation/mainView.tsx

**#15** · processing · line 688 — literal

- old: `Listening carefully to your log...`
- new: `श्रम साथी तुम्ही जे बोललात ते समजून घेत आहे`
- note: founder's own wording, not the copy-chief's

### features/labour/components/LabourFeature.tsx

**#33** · hub · line 73 — literal · was PASS, changed anyway

- old: `कामाच्या नोंदी`
- new: `कामाचा हिशोब`

### features/labour/components/LabourHub.tsx

**#43** · hub · line 364 — literal

- old: `N दिवसाच्या हिशोबाने`
- new: `दिवसाच्या हिशोबाने N जण`

**#44** · hub · line 392 — literal

- old: `N उक्ते`
- new: `उक्त्या कामावर N जण`
- note: template — `${data.home.ukteToday} उक्ते`

**#57** · hub · line 266 — literal

- old: `N मजूर`
- new: `N जण`
- note: template — `{toMr(labour.headcount)} मजूर`

**#60** · hub · line 461 — literal

- old: `'टीम सेटअप'मध्ये कोण नोंद करू शकतो ते ठरतं; इथे त्यांनी काय केलं आणि त्यावर किती विश्वास — ते दिसतं व ठरतं.`
- new: `'माझा शेत संघ'मध्ये कोणाला नोंद करता येईल ते ठरतं. इथे त्यांनी काय केलं ते दिसतं.`

**#63** · hub · line 474 — literal

- old: `अजून कोणी कामगार जोडलेला नाही`
- new: `अजून कोणाचंही नाव जोडलेलं नाही`

**#64** · hub · line 481 — literal

- old: `खालचं बटण दाबा आणि कामगाराला QR दाखवा.`
- new: `खालचं बटण दाबा आणि समोरच्याला QR दाखवा.`

### features/labour/components/LabourUiKit.tsx

**#66** · hub · line 137 — literal · was PASS, changed anyway

- old: `मुकादम`
- new: `जबाबदार`

**#68** · hub · line 142 — literal

- old: `{task} टीम`
- new: `फक्त {task}साठी`

**#70** · hub · line 156 — literal

- old: `फक्त नाव`
- new: `फक्त नाव माहीत`

### features/labour/components/HajeriLedger.tsx

**#82** · register · line 48 — literal

- old: `नाही`
- new: `आला नाही`

**#89** · register · line 130 — literal

- old: `दिवस`
- new: `नाव`

**#90** · register · line 170 — literal

- old: `{name}सोबत`
- new: `{name}सोबत आलेले`
- note: template — `{crew.throughName}सोबत`

**#92** · register · line 192 — literal

- old: `बोलून किंवा नोंद करून हजेरी घेतल्यावर ती इथे दिवसागणिक दिसेल.`
- new: `बोलून किंवा नोंद करून हजेरी घेतली, की ती इथे रोजच्या रोज दिसेल.`

**#93** · register · line 196 — literal

- old: `हिरवा = आला · पिवळा = अर्धा दिवस · राखाडी = नाही.`
- new: `हिरवा = आला · पिवळा = अर्धा · राखाडी = आला नाही.`

### features/labour/components/HajeriCellDetail.tsx

**#94** · tap-detail · line 36 — literal

- old: `पूर्ण`
- new: `आला`

**#98** · tap-detail · line 66 — literal

- old: `बंद`
- new: `बंद करा`

### features/labour/attendanceCopy.ts

**#118** · capture-already-known · `ATTENDANCE_COPY.understoodHeading` (line 12)

- old: `ShramSafalला समजलं`
- new: `श्रम सफलला समजलं`

### features/labour/components/AttendanceResult.tsx

**#124** · conflict-headcount · line 165 — literal

- old: `आजच्या कामाच्या नोंदीत N जण आहेत.`
- new: `आजच्या कामात N जण होते, असं आधी समजलं होतं.`

**#125** · conflict-headcount · line 167 — literal

- old: `दोन्ही नोंदी तशाच राहतील.`
- new: `दोन्ही गोष्टी तशाच राहतील.`

### features/labour/attendanceCopy.ts

**#128** · contradiction · `ATTENDANCE_COPY.contradictionReassurance` (line 30)

- old: `एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील.`
- new: `एकदाच स्पष्ट करा — दोन्ही कामांचं जे सांगितलं ते तसंच राहील.`

**#129** · contradiction · `ATTENDANCE_COPY.markWord` (line 32)

- old: `पूर्ण / अर्धा / रात्र`
- new: `आला / अर्धा / रात्र`
- note: object literal — markWord: { full: 'पूर्ण', half: 'अर्धा', night: 'रात्र' }; only `full` changes

### features/labour/components/FieldOperatorPicker.tsx

**#139** · picker · line 304 — literal

- old: `ऐच्छिक`
- new: `हवं तर`

**#140** · picker · line 310 — literal

- old: `कोण काम करत होतं ते इथे नोंदवता येतं. मजुरांची संख्या यानं बदलत नाही.`
- new: `कोण काम करत होतं ते इथे सांगता येतं. किती जण होते, ते यानं बदलत नाही.`

**#142** · picker · line 313 — literal

- old: `माणसं आणत आहोत…`
- new: `नावांची यादी येत आहे…`

**#146** · picker · line 389 — literal

- old: `सारखं नाव — वेगळी व्यक्ती`
- new: `सारखं नाव — माणूस वेगळा`

**#151** · picker · line 438 — literal

- old: `पूर्ण नाव / ओळख — ऐच्छिक`
- new: `पूर्ण नाव किंवा ओळख — हवं तर`

**#158** · picker · line 258 — literal

- old: `{name} ची नोंद झाली, पण या कामाला लावता आलं नाही — पुन्हा प्रयत्न करा`
- new: `{name}चं नाव यादीत आलं, पण या कामाला लावता आलं नाही — पुन्हा प्रयत्न करा`

### features/labour/components/ReviewSheet.tsx

**#160** · review · line 624 — literal · was PASS, changed anyway

- old: `तपासणी`
- new: `मंजुरी`

**#164** · review · line 637 — literal

- old: `रोजच्या नोंदी इथे तुम्ही मंजूर करता — तुमच्या स्वतःच्या असोत वा तुमच्या माणसांच्या.`
- new: `रोजच्या नोंदी इथे तुम्ही मंजूर करता — स्वतःच्या किंवा तुमच्या माणसांच्या.`

**#171** · review · line 716 — literal

- old: `फार्म बुक अद्ययावत आहे`
- new: `सगळ्या नोंदी तपासून झाल्या`

**#173** · review · line 747 — literal

- old: `पूर्ववत करा`
- new: `मागे घ्या`

**#181** · review · line 318 — literal

- old: `N मजूर`
- new: `N जण`
- note: template — `${toMr(count)} मजूर`

### features/labour/components/WeeklyDashboard.tsx

**#186** · overview · line 188 — literal

- old: `मजूर-दिवस`
- new: `एकूण हजेरी`

**#190** · overview · line 140 — literal

- old: `तपासायचं`
- new: `तपासा`

**#191** · overview · line 294 — literal

- old: `कुठे काम झालं · plots`
- new: `कुठे काम झालं`

**#193** · overview · line 164 — literal

- old: `अधिक नोंदी झाल्यावर इथे उपयोगी माहिती दिसेल.`
- new: `आणखी नोंदी झाल्यावर इथे उपयोगी माहिती दिसेल.`

**#194** · overview · line 298 — literal

- old: `अजून प्लॉटनिहाय माहिती नाही`
- new: `अजून प्लॉटची माहिती नाही`

**#196** · overview · line 346 — literal

- old: `पैसे · money`
- new: `पैसे`

**#198** · overview · line 362 — literal

- old: `काम झालं · एकूण नोंदवलं`
- new: `काम झालं — त्याची मजुरी`

### features/labour/components/LabourUiKit.tsx

**#203** · person-detail · line 254 — literal

- old: `काम झालं`
- new: `कामाचे पैसे`

**#207** · person-detail · line 117 — literal

- old: `द्यायचे / उचल बाकी / जास्त दिलं`
- new: `बाकी / उचल बाकी / जास्त दिलं`
- note: SAME EDIT AS #208 — the state label and the rendered line are one literal

**#208** · person-detail · line 117 — literal · was PASS, changed anyway

- old: `₹N द्यायचे`
- new: `₹N बाकी`

### features/labour/components/MukadamDetail.tsx

**#225** · mukadam-detail · line 46 — literal

- old: `{name} नी नेमला`
- new: `{name}नी नेमला`

**#226** · mukadam-detail · line 46 — literal

- old: `सर्व कारकुनी काम · तुम्ही नेमला`
- new: `सगळं काम · तुम्ही नेमला`

**#229** · mukadam-detail · line 81 — literal

- old: `याची माणसं · his team`
- new: `याच्यासोबत आलेली माणसं`

### features/profile/components/TeamMemberCard.tsx

**#230** · responsibility · line 121 — literal

- old: `कामगार · Worker`
- new: `कामाला येणारे`

**#231** · responsibility · line 121 — literal

- old: `भागीदार · Partner`
- new: `भागीदार`

**#234** · responsibility · line 142 — literal

- old: `हा सदस्य काय करू शकतो? · What can they do?`
- new: `याला काय करता येईल?`

**#235** · responsibility · line 183 — literal

- old: `कामगारांची जबाबदारी आहे`
- new: `माणसांची जबाबदारी आहे`

### i18n/labourOversightTranslations.ts

**#246** · guide-card · `readyToLogLabel` (line 130)

- old: `कामे सांगण्यासाठी तयार`
- new: `कामं सांगायला तयार`

**#249** · guide-card · `selectedCountUnit*` (line 137)

- old: `निवडला / निवडले`
- new: `निवडला / निवडलेत`
- note: two keys — selectedCountUnitSingular:136 'निवडला' stays, Plural:137 'निवडले' → 'निवडलेत'

### i18n/syncTranslations.ts

**#257** · saved · `sync.correctionsFiledTail*` (line 240)

- old: `{count} दुरुस्त्या शेतनोंदीत गेल्या.`
- new: `{count} दुरुस्ती शेतनोंदीत गेली.`

### i18n/translations.ts

**#266** · day-summary · `workSummary.labour` (line 563)

- old: `कामगार`
- new: `मजुरी`

**#267** · day-summary · `workSummary.maleWorkers` (line 569)

- old: `पुरुष कामगार / महिला कामगार`
- new: `पुरुष / महिला`
- note: two keys — maleWorkers:569, femaleWorkers:570

**#268** · day-summary · `workSummary.noLabour` (line 578)

- old: `आज कामगार वापरलेले नाहीत`
- new: `आज कोणी कामावर नव्हतं`

**#270** · day-summary · `settings.labourRates` (line 588)

- old: `कामगार दर`
- new: `मजुरीचे दर`

**#272** · day-summary · `settings.dailyWage` (line 599)

- old: `दैनंदिन मजुरी`
- new: `रोजची मजुरी`

**#273** · day-summary · `settings.labourShifts` (line 602) · was PASS, changed anyway

- old: `कामगार पाळ्या`
- new: `कामाच्या पाळ्या`

### features/logs/components/manual-entry/components/LabourReview.tsx

**#274** · manual-entry-labour · line 60 — literal

- old: `Total workers: N (a + b)`
- new: `एकूण N जण (a + b)`

**#275** · manual-entry-labour · line 107 — literal

- old: `N मजूर`
- new: `N जण`
- note: template — `${formatCount(count)} मजूर`

### features/consent/gate/consentNotice.ts

**#276** · consent-gate · `intro` (line 270)

- old: `तुमच्या शेताची माहिती तुमच्याच ताब्यात राहते. ॲप चालण्यासाठी फक्त खालील माहिती वापरतो.`
- new: `तुमच्या शेताची माहिती तुमच्याच ताब्यात राहते. श्रम सफल चालण्यासाठी फक्त खालची माहिती वापरली जाते.`

**#277** · consent-gate · `brandLine` (line 271)

- old: `श्रम सफल हे Agriryot Value Enterprises Private Limited चं ॲप आहे; ते AgriSync प्लॅटफॉर्मवर चालतं.`
- **new: DELETE THIS LINE** (founder: "remove this")

**#278** · consent-gate · `diagnostics.data` (line 309)

- old: `फोन, ॲप, सिंक आणि सुरक्षेची मर्यादित माहिती`
- new: `फोन, वापर, माहिती पाठवणं आणि सुरक्षा — यांची मर्यादित माहिती`

---

## B. PREVIEW ONLY — behind the disabled door — 7 changes


### features/labour/components/Attendance.tsx

**#108** · capture-anchored · line 49 — literal · was PASS, changed anyway

- old: `नाही`
- new: `आला नाही`

**#109** · capture-anchored · line 77 — literal

- old: `आज किती लोक आली?`
- new: `आज किती जण होते?`

**#110** · capture-anchored · line 80 — literal

- old: `N लोक`
- new: `N जण`
- note: template — `{toMr(count)} लोक`

**#111** · capture-anchored · line 83 — literal

- old: `🎙 "आज ४ लोक कामाला आली" — व्हॉइस लॉगमधून`
- new: `🎙 "आज ४ लोक कामाला आली" — तुम्ही बोललात त्यातून`

**#116** · capture-anchored · line 120 — literal

- old: `किमान एक नाव आवश्यक. बाकीचे "+ २ जण" म्हणून मोजले जातील. हिरवा ✓ = अ‍ॅप कामगार, राखाडी = फक्त नाव.`
- new: `किमान एक नाव द्या. बाकीचे "+ २ जण" असे मोजले जातील.`
- note: split by <b> tags across one JSX line

**#117** · capture-anchored · line 125 — literal

- old: `जतन करा → मंजुरीसाठी`
- new: `बरोबर — तपासणीसाठी`

### features/labour/components/LabourFeature.tsx

**#259** · hub · line 194 — literal

- old: `🎙 आवाज नोंद लॉग स्क्रीनवर होते`
- new: `🎙 बोलून नोंद करायची असेल तर कामाच्या पानावर जा.`

---

## C. UNREACHABLE TODAY — code exists, no route reaches it — 16 changes


### features/logs/components/shramsathi/ShramSathiUnderstanding.tsx

**#19** · processing-character · line 27 — literal

- old: `दिवसभराच्या कामातून दिलेला एक मिनिट, शेतातलं प्रत्येक काम सांभाळण्याच्या दिशेने तुमचं पहिलं पाऊल आहे.`
- new: `दिवसातला एक मिनिट दिलात — शेतावरची पकड इथूनच सुरू होते.`

**#21** · processing-character · line 29 — literal

- old: `जे नोंद ठेवत नाहीत त्यांच्यासाठी असतो अंदाज; जे ठेवतात त्यांच्यासाठी असते नियोजनबद्ध दिशा.`
- new: `आजचं काम आज नोंदवलं, तर उद्याचा निर्णय अंदाजावर राहत नाही.`

**#23** · processing-character · line 31 — literal

- old: `प्रगतशील शेतकरी शंकेवर नाही, स्वतःच्या नोंदींवरून निर्णय घेतो.`
- new: `हुशार शेतकरी शंकेवर नाही, स्वतःच्या नोंदींवर निर्णय घेतो.`

**#25** · processing-character · line 33 — literal

- old: `तुम्ही मोजायला लागता, त्याच क्षणी नशीब तुमच्या शेतीवर राज्य करणं थांबवतं.`
- new: `मोजायला लागलात, की शेती नशिबावर राहत नाही.`

**#30** · processing-character · line 38 — literal

- old: `हंगामाचा अंदाज बांधण्यापासून त्याचं नियोजन करण्यापर्यंत — हाच खरा बदल आहे.`
- new: `पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे.`

### features/labour/components/ReviewSheet.tsx

**#182** · review · line 68 — literal

- old: `मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे.`
- new: `या नोंदीवर शंका आहे — एकदा विचारून घ्यायचं आहे.`

### features/labour/components/PersonDetail.tsx

**#214** · person-detail · line 60 — literal

- old: `विश्वास · trust`
- new: `विश्वास`

**#215** · person-detail · line 75 — literal

- old: `{name}च्या नोंदींवर विश्वास ठेवायचा?`
- new: `{name} सांगेल त्यावर विश्वास ठेवायचा?`

**#217** · person-detail · line 86 — literal

- old: `सध्या याच्या नोंदी तुम्ही तपासता`
- new: `सध्या याच्या नोंदी तुमच्याकडे मंजुरीसाठी येतात`

**#218** · person-detail · line 87 — literal

- old: `{n} दिवस झाले · २५ दिवस + स्वच्छ रेकॉर्ड नंतर विश्वास देता येईल`
- new: `{n} दिवस झाले · २५ दिवस आणि वाद नाही, मग विश्वास देता येईल`

**#220** · person-detail · line 210 — literal

- old: `विश्वास {n} — 30 दिवसांत वाद नाही`
- new: `30 दिवसांत वाद नाही`

**#222** · person-detail · line 95 — literal

- old: `टीम सेटअपमध्ये 'कोण नोंद करू शकतो' ठरतं. इथे 'त्याच्या नोंदींवर विश्वास' ठरतो — या दोन वेगळ्या गोष्टी आहेत.`
- new: `'माझा शेत संघ'मध्ये कोणाला नोंद करता येईल ते ठरतं. इथे त्याच्या नोंदींवर विश्वास ठेवायचा का — हे वेगळं.`

### features/labour/components/MukadamDetail.tsx

**#227** · mukadam-detail · line 52 — literal

- old: `सेटल`
- new: `पैसे द्या`

### i18n/syncTranslations.ts

**#253** · saved · `sync.onPhoneFull` (line 236)

- old: `श्रम साथी ने समजले व लक्षात ठेवले`
- new: `श्रम साथीने समजून घेतलं आणि लक्षात ठेवलं`

**#254** · saved · `sync.onServerFull` (line 237)

- old: `श्रम सफल मध्ये साठवून ठेवले`
- new: `श्रम सफलमध्ये साठवून ठेवलं`

### features/labour/components/LabourFeature.tsx

**#261** · mukadam-detail · line 302 — literal

- old: `सेटल — नमुना`
- new: `पैसे द्या — नमुना`

---

## D. LEAVE AS THEY ARE — 18 strings, no edit

| # | screen | wording kept |
|---|---|---|
| 17 | processing-character | तुम्ही शेतात केलेली कामे आणि तुमची शेती करण्याची कार्यपद्ध… |
| 22 | processing-character | आज तुम्ही फक्त पीक घेत नाही — स्वतःचं आणि तुमच्या शेतजमिनी… |
| 26 | processing-character | नोंदवलेलं शहाणपण पुढच्या पिढीला कामी येतं; विसरलेली चूक पु… |
| 28 | processing-character | आकड्यांवर चालणारी शेती, हीच खऱ्या अर्थाने तुमच्या हातातली … |
| 29 | processing-character | इतिहास त्यांनाच मार्ग दाखवतो जे तो लिहितात — आज तुम्ही तुम… |
| 31 | processing-character | आज तुम्ही फक्त शेतकरी नाही — स्वतःची शेती पुढे नेणारे प्रग… |
| 58 | hub | टीमची हजेरी, मजुरी व नोंदींची तपासणी — सगळं एका जागी. |
| 69 | hub | तात्पुरता |
| 71 | hub | टीम N |
| 75 | chrome | माहिती आणत आहोत… |
| 112 | capture-anchored | शिफ्ट · shift |
| 166 | review | चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो. ज्याच्यावर वि… |
| 201 | overview | सर्व दिवसांची हजेरी पहा |
| 202 | person-detail | कामगार |
| 241 | responsibility | टीममधून काढा · Remove |
| 243 | guide-card | आज कोणत्या प्लॉटवर कोणी काम केलं, त्यांची हजेरी घ्या किंवा… |
| 244 | guide-card | तुमच्या शेतातले रोजचे कामगार असू शकतात, किंवा मुकादमाकडून … |
| 248 | guide-card | प्लॉट |
