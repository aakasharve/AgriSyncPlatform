# Marathi screen audit — findings

**spec:** 2026-08-28-labour-v2-release-1
**Branch:** `feat/labour-v2-r1` · **Scanned at:** `0a9569ea` · **Date:** 2026-09-04
**Data:** `docs/superpowers/plans/precision/marathi-screen-audit-data.json` (278 rows — this is what
the interactive page renders)
**Status:** READ-ONLY EVIDENCE + JUDGEMENT. No production code, copy, key or identifier was changed.
No replacement word is proposed anywhere in this document.

## What this adds to the audit you already have

`farmer-facing-vocabulary-audit.md` answered *which words exist*. It has no screen dimension and no
doctrine verdict, so it cannot answer the two questions a naming session actually needs:
**where does the farmer meet this word, and does it pass the Marathi gate?** This audit answers
those, one row per string per screen. A string used on three screens is three rows — that
duplication is the whole point.

The authority is the doctrine bundle, read in full: `MARATHI_TONE_GUIDE.md` (canon),
`MDR-002-marathi-first-copy.md` (Accepted), `MDR-021-two-layer-voice-sathi-vs-safal.md`
(**Proposed — not canon**), the copy-chief gate and its checklist, the language bank and the copy bank.

**Verdict discipline.** `FAIL` only where a **canon** rule decides it — the tone guide's Avoid list,
the banned-word list, the spelling rule, the review checklist, or MDR-002. `FLAG` for everything
resting on MDR-021 (Proposed), on your 2026-09-03 vocabulary rule, or on judgement; each FLAG row
says which. `PASS` rows are included because you asked for the whole picture.

---

## The six counts

| | |
|---|---|
| **Strings inspected** (one per string per screen) | **278** — 255 distinct strings |
| **Unique terms** (distinct Devanagari/Latin word tokens, placeholders removed) | **536** |
| **PASS / FLAG / FAIL** | **161 / 80 / 37** |
| **live / preview-only / unreachable-today** | **222 / 18 / 38** |
| **sathi / chrome / ambiguous** | **45 / 174 / 59** |
| **spoken (-चं) / written (-चे) / n/a** | **86 / 25 / 167** |

> The 536 is **not** comparable to the earlier audit's 259. That number counted hand-built rows in a
> vocabulary column; this one counts every distinct word token in the strings themselves. Both
> definitions are stated in the JSON's `aggregates.definitions`.

Cross-tabs worth having in front of you:

- **FAILs by reachability:** 22 live · 4 preview-only · 11 unreachable-today.
- **Register by voice layer:** Sathi speaks spoken 26 times and written 8; chrome is spoken 27,
  written 6. The split is not a chrome/character split — **both layers do both**, which is exactly
  MDR-021's complaint.

---

## The FAILs, by the rule that produced them

### 1. Bilingual `mr · en` labels — MDR-002 (Accepted), 8 live strings

MDR-002 did not merely prefer Marathi; it **considered and rejected** "bilingual everything" as
clutter that dilutes the message for a low-literacy reader. These ship that rejected option:

| Screen | String | File |
|---|---|---|
| responsibility | `हा सदस्य काय करू शकतो? · What can they do?` | `TeamMemberCard.tsx:142` |
| responsibility | `कामगार · Worker` / `भागीदार · Partner` | `TeamMemberCard.tsx:121` |
| responsibility | `टीममधून काढा · Remove` | `TeamMemberCard.tsx:281` |
| mukadam-detail | `याची माणसं · his team` | `MukadamDetail.tsx:81` |
| overview | `पैसे · money` · `कुठे काम झालं · plots` | `WeeklyDashboard.tsx:346,294` |
| setup-hub | `पैसे व हिशोब · Finance` | `SetupHubMenu.tsx:296` |
| person-detail *(flag-off)* | `विश्वास · trust` | `PersonDetail.tsx:60` |

The sharpest of these is `हा सदस्य काय करू शकतो? · What can they do?` — it sits directly above the
single most consequential control on the responsibility card, which is the exact position MDR-002's
"clutters low-literacy visuals" reasoning was written about.

### 2. Untranslated English on a live Marathi screen — MDR-002, 2 live strings

- `Listening carefully to your log...` — `mainView.tsx:686`. **Every voice log passes through this
  screen.** It is the placeholder under the spinner until the first transcribed words arrive.
- `Total workers: N (a + b)` — `LabourReview.tsx:85`, the manual-entry labour block. The file's own
  comment says why: no founder-approved Marathi exists. A known gap, not an oversight.

### 3. Translated-English structure carried into Marathi — tone guide "Avoid", 3 live strings

Provable rather than suspected, because the English original sits in the same file two hundred lines up:

- `आज कामगार वापरलेले नाहीत` ← *"No labour used today"* (`translations.ts:578` / `:370`).
  The carried verb is **वापरणे** — people as something used or not used, on a live day summary.
- `कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा` ← *"Manage access for family & workers"*
  (`translations.ts:623`). Also government-circular (व्यवस्थापित करा) and it still says **प्रवेश**,
  the access word D5 removed one tap later.
- `शेत व्यवस्थापनासाठी कुटुंब किंवा कामगार जोडा.` ← *"Add family or workers to help manage the farm."*
  (`translations.ts:629`).

### 4. English loan where a clean Marathi word exists — tone guide "Avoid", 5 live + 2 flag-off

**टीम, when this same app already ships संघ.** `profile.myFarmTeam` = **माझा शेत संघ**.
Four live sites say **टीम** for the identical group: `LabourHub.tsx:459,461`, `LabourUiKit.tsx:142,178`,
`TeamMemberCard.tsx:281`. Two of them (`LabourHub.tsx:461`, `PersonDetail.tsx:95`) go further and
**name a destination screen "टीम सेटअप" that is actually labelled माझा शेत संघ** — the farmer is sent
to a screen by a name that is not on it.

**सेटल, when the sibling screen ships पैसे द्या.** `MukadamDetail.tsx:52` labels the settle button
**सेटल**; `PersonDetail.tsx:144` labels the identical action **पैसे द्या**. Both are behind
`SHOW_MONEY_ACTIONS = false` today, so nothing is live — but the English half is already written.

**रेकॉर्ड** appears in `PersonDetail.tsx:87` (`स्वच्छ रेकॉर्ड`, flag-off) — the tone guide's loan-word
row names this exact pair: *record→नोंद*.

### 5. Urban-corporate Marathi (English concepts in Devanagari) — tone guide "Avoid", 1 live + 3 gated

- **`फार्म बुक अद्ययावत आहे`** — `ReviewSheet.tsx:716`, **live**. Two breaches in four words:
  `फार्म बुक` is an English compound transliterated, and `अद्ययावत` is the government-circular
  register the guide's own ❌ example (*"कृषी कार्याची विश्वासार्ह अभिलेख प्रणाली"*) is built from.
  This is the one string that tells a farmer he is finished.
- `शिफ्ट · shift` — `Attendance.tsx:87`, preview-only. Neither half is Marathi. Note the app already
  ships the right word: `settings.labourShifts` = **कामगार पाळ्या**.
- `🎙 "आज ४ लोक कामाला आली" — व्हॉइस लॉगमधून` — `Attendance.tsx:83`, preview-only. The guide's bad-vs-good
  table has *"व्हॉइस लॉगिंग फीचर वापरा"* as its ❌ row for voice features.
- `🎙 आवाज नोंद लॉग स्क्रीनवर होते` — `LabourFeature.tsx:194`, preview-only. Two English words in a
  four-word sentence.

### 6. Banned words — canon list, 4 live strings, 3 of them outside Labour

`अ‍ॅप कामगार` in `Attendance.tsx:120` (preview-only) is the only labour-side hit — and it uses the
banned word to sort humans into two kinds by whether they hold a phone.

**The live hits are on the consent gate**, which is outside this audit's enumerated surfaces but is
the *first* screen every farmer meets, so it is in the data (rows 276–278):

- `consentNotice.ts:271` — **two** banned words in one sentence: `ॲप` **and** `प्लॅटफॉर्म`.
- `consentNotice.ts:270`, `:309` — `ॲप` again, plus `सिंक`.

Everything else is clean: no `AI`, no `डिजिटल`, no `सॉफ्टवेअर`, no `स्मार्ट`, no `पॉवरफुल`,
no `क्रांतिकारी`. **Spelling is clean too — `मुकादम` everywhere, `मुखादम` nowhere.**

### 7. A claim not backed by proof — the copy-chief checklist, 1 live string

`ReviewSheet.tsx:639` — *"ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर."*

The checklist item is *"Claim (if any) is backed by proof."* No auto-approval mechanism exists:
`GetLabourDataHandler.cs` hardcodes `Access: "review"` for every worker, and the विश्वास controls
that would grant it are behind `SHOW_TRUST_GRADUATION = false`. The promise is **live**; the
mechanism is not. This is a Marathi-gate failure, not only a truth failure — the gate owns it.

### 8. Over-Sanskritized / never-insult — the flag-off character screen, 4 strings

`ShramSathiUnderstanding.tsx` (the video-character processing screen) fails four ways, all
unreachable today:

- `:23` support line — `कार्यपद्धत` is प्रणाली/अभिलेख register, and it packs two ideas.
- `:29` — *"जे नोंद ठेवत नाहीत त्यांच्यासाठी असतो अंदाज…"*. The tone guide's pride section says
  **❌ Never insult: "शेतकरी नोंदी ठेवत नाहीत म्हणून नुकसान"**. This line sorts farmers into
  record-keepers and the rest, and leaves the rest to guesswork.
- `:37` — *"इतिहास त्यांनाच मार्ग दाखवतो जे तो लिहितात"* — an English relative clause carried whole.
- `:39` — `प्रगतशील आणि नियोजनबद्ध शेतकरी`: government-circular adjectives stacked on a man, on the
  screen meant to praise him.

---

## The register split, located

MDR-021 names it as *"a shipping defect, not a style note: the register is split between spoken (-चं)
and written (-चे) forms. One person cannot be both."* It is real, and the screen dimension shows
exactly where the seam runs.

**86 spoken vs 25 written.** Spoken is the house style; written is the exception — which is what
makes each written string stand out rather than blend in.

**The purest instance is inside one file, four lines apart** — `i18n/syncTranslations.ts`:

| Key | String | Register | Reachable |
|---|---|---|---|
| `sync.onPhone` | **लक्षात ठेवलं ✓** | spoken | live, on four surfaces |
| `sync.onPhoneFull` | **श्रम साथी ने समजले व लक्षात ठेवले** | written | **no surface today** |
| `sync.onServerFull` | **श्रम सफल मध्ये साठवून ठेवले** | written | **no surface today** |

Same claim, two registers. Both long forms also detach the postposition — `श्रम साथी ने`, `श्रम सफल मध्ये`
— which is Hindi word-shape, not Marathi (`श्रम साथीने`, `श्रम सफलमध्ये`). Both are FAILs, and both are
**unreachable today**: `mainViewComponents.tsx:157` records that the long form is explicitly not
authorised for the post-save headline. A flat term list would have shown you three strings of equal
weight. The screen dimension shows one shipping and two waiting.

**The second instance is a live one, on the log page.** `readyToLogLabel` = **कामे सांगण्यासाठी तयार**
(`labourOversightTranslations.ts:130`) uses the written plural **कामे** while every sibling string on
the same screen is spoken (काम / कामं / कामाच्या). Same file, same card, two registers.
`selectedCountUnitPlural` = **निवडले** is the same shape (spoken would be निवडलेत).

**Other live written-register strings to look at:** `दिवसागणिक` (`HajeriLedger.tsx:192`) on a screen
whose legend is spoken; `असोत वा` (`ReviewSheet.tsx:637`) inside a sentence that begins spoken;
`अधिक` where the sibling empty state uses the spoken `आणखी` (`WeeklyDashboard.tsx:164`);
`प्लॉटनिहाय` (`:298`), which is the `-निहाय` government form.

---

## The sathi / chrome boundary — where MDR-021 actually bites

174 chrome · 45 sathi · **59 ambiguous**. The ambiguous pile is the finding: **more than one string in
five has no settled speaker**, and MDR-021 predicted exactly this ("UI chrome is the soft edge").

Six boundary cases worth a ruling:

1. **`लक्षात ठेवलं ✓`** (`sync.onPhone`) — furniture by position (a legend key, a header chip), a
   person by grammar ("*someone* remembered it"). It ships on four surfaces at once: the post-save
   headline, the header chip, the save toast, and the register legend. If this is Sathi, MDR-021's
   नोंद ban applies to it — and it already complies, because it says **ठेवलं**, not **नोंदवलं**.
2. **`मी आजचं काम समजून घेतोय…`** (`shramSathi.understanding`) vs **`माहिती आणत आहोत…`**
   (`LabourUiKit.tsx:68`) and **`माणसं आणत आहोत…`** (`FieldOperatorPicker.tsx:313`). The app ships
   **two different first persons**: Sathi is **मी** on the processing screen and **आम्ही** in the
   labour feature. One person cannot be both, and neither can one product.
3. **`ShramSafalला समजलं`** (`attendanceCopy.ts:12`) — the result heading. Two questions in one
   string: MDR-021 says the inside voice is **श्रम साथी the person**, but this names **श्रम सफल the
   system**; and it is written in **Latin script** inside a Marathi sentence, while the app's own
   i18n ships **श्रम सफल** in Devanagari (`sync.onServerFull`). Live, on the screen the farmer sees
   after every spoken labour log.
4. **The नोंद-in-Sathi's-voice family.** Five live strings put नोंद inside a sentence Sathi speaks:
   `आजच्या कामाच्या नोंदीत N जण आहेत.` · `दोन्ही नोंदी तशाच राहतील.` (both `AttendanceResult.tsx`) ·
   `एकदाच स्पष्ट करा; दोन्ही कामांच्या नोंदी तशाच राहतील.` (`attendanceCopy.ts:30`) ·
   `कोण काम करत होतं ते इथे नोंदवता येतं.` (`FieldOperatorPicker.tsx:310`) ·
   `{name} ची नोंद झाली, पण…` (`FieldOperatorPicker.tsx:258`). **All FLAG, none FAIL** — canon lists
   नोंद as a word to lean on, and MDR-021 is Proposed. The last one is the case the rule was written
   for: *a human* was नोंद-ed.
5. **Toasts.** All 19 toast rows sit in the ambiguous pile. They narrate outcomes to the
   farmer (a person's job) from inside the system (chrome). If they are Sathi, the नोंद family above
   grows by four.
6. **Empty states.** `अजून कोणी कामगार जोडलेला नाही`, `कुणी माहिती नाही`, `अजून हजेरी नोंदवली नाही` —
   they state the app's own state of knowledge, which is Sathi's characteristic move, in furniture's
   characteristic position.

**Where the character is unambiguously right:** the capture ladder. `या N जणांमध्ये कोण होते?` ·
`यांच्याशिवाय अजून कोण होते?` · `हे बरोबर आहे का?` · `"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.` ·
`{name} आज दोन कामांत दिसतोय…` — spoken register, one idea each, a hedge instead of an assertion, and
no blame anywhere. These are the strings a naming session should protect, not reopen.

---

## What the flat audit could not see, because it had no screen dimension

This is the part that justifies the exercise.

1. **The live processing screen is not the one anyone has been reviewing.** `mainView.tsx:662` picks
   between two: `FEATURE_FLAGS.dailyLoop` ON gives the video-character screen with the 15 chalkboard
   lines; OFF gives the legacy spinner. **`.env.production.example` sets `VITE_DAILY_LOOP=0`.** So the
   17 strings on the character screen — including four canon FAILs and Sathi's whole personality —
   are **unreachable today**, and what a farmer actually reads while his voice is processed is
   `मी आजचं काम समजून घेतोय…` plus the English `Listening carefully to your log...`. The flat audit
   lists neither screen.

2. **11 of the 37 FAILs are unreachable today.** A term list would have you fix all 37. The screen
   dimension says: 22 are live and cost you something today; 4 are preview-only; 11 are written but
   never rendered. `सेटल`, `विश्वास · trust`, `स्वच्छ रेकॉर्ड` and the two long sync forms are all in
   the last group.

3. **Two words for one thing, one tap apart.** Only a screen walk finds these:
   - register legend says **नाही**; the tap-detail on the SAME cell says **आला नाही**.
   - register legend says **आला**; the tap-detail chip says **पूर्ण**.
   - register teaches the three marks by shape at the top and **re-teaches them by colour at the
     bottom of the same screen**, saying `अर्धा दिवस` where the top says `अर्धा`.
   - the tap-detail close is **बंद**; the review sheet close is **बंद करा**.
   - the hub's register tile sub-line is **सर्व दिवस**; the overview's identical button says
     **सर्व दिवसांची हजेरी पहा**.
   - the picker's name field has aria-label `पूर्ण नाव किंवा ओळख — ऐच्छिक` and placeholder
     `पूर्ण नाव / ओळख — ऐच्छिक`. One field, two strings.

4. **The approval act is three words on three consecutive screens.** `तपासा` (hub tile) →
   `तपासायचं` (overview strip) → `तपासणी` (the sheet) → and the capture screen's save is
   `जतन करा → मंजुरीसाठी` while the result screen's save is `बरोबर`. The farmer crosses all of these
   in one session.

5. **The countable human changes word every screen in one journey.** Hub: **जण**. Just-logged card:
   **मजूर**. Capture: **लोक**. Picker: **माणसं**, then **व्यक्ती** on the disambiguation line. Detail
   screen title: **कामगार**. Six words, one walk, the same people.

6. **A screen sends the farmer somewhere by a name that is not on the destination.**
   `LabourHub.tsx:461` and `PersonDetail.tsx:95` both say **'टीम सेटअप'**. The screen they mean is
   labelled **माझा शेत संघ** (`profile.myFarmTeam`). A term list shows टीम and संघ as two words; only
   the screen walk shows that one is *pointing at* the other.

7. **The right word already exists one screen away, twice.** `सेटल` (mukadam) vs `पैसे द्या` (person)
   — same action, same component, different `settleLabel` prop. `शिफ्ट · shift` (capture) vs
   `कामगार पाळ्या` (settings) — same concept, and the Marathi one is already shipped and approved.

8. **The hub's own money card was fixed on 2026-09-03 and the flat audit predates it.** `रोजंदारी`
   is gone from `LabourHub.tsx:364`; it now reads **दिवसाच्या हिशोबाने**. `कामगार व्यवस्थापन` is gone
   from all five of its sites — the hub title, the Setup Hub door, and the log banner now all read
   **कामाच्या नोंदी**, and they agree with each other. Anyone working from the flat audit alone would
   re-open decisions that are already closed. What was **not** fixed: the breakdown line still counts
   *people* under a settlement-basis phrase (`N दिवसाच्या हिशोबाने · N उक्ते`) — the word changed, the
   shape did not.

9. **A code comment claims a deletion that did not happen.** `mainViewComponents.tsx:111-114` says
   Task 7 *DELETED* `"हजेरी · "` from the log banner's subtitle. Line 115 still reads
   `हजेरी · मजूर · मजुरी बोला`. Not a Marathi verdict — but if you are reading comments to decide what
   ships, that one will mislead you.

---

## What is genuinely good, and should survive the naming session

Stated so it does not get renamed by accident:

- **`कुणी माहिती नाही`** (`HajeriCellDetail.tsx:71`) — an absence named as an absence, in plain
  spoken Marathi. Doctrinally the strongest string in the feature.
- **The capture ladder** (`attendanceCopy.ts`) — five questions, spoken register, one idea each,
  a hedge (`दिसतोय`) instead of an assertion, and `"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.` which is
  the trust gate in one line.
- **`मदत कराल का?`** (`sync.needsFix`) — अहो-जाहो politeness, asks instead of instructing.
- **`शक्य तेवढ्या सगळ्यांची नावं घ्या — म्हणजे नंतर तुम्हाला माहीत असेल, कोणतं काम कोणी केलं.`**
  (`labourGuideLine2`) — gives the reason in the farmer's own terms rather than issuing an order.
- **`“रोकडेचे दहा लोक आले” — असं बोला`** (`LabourHub.tsx:337`) — verbatim field speech, which is what
  the language bank exists to supply. The `लोक` here is correct precisely because it is a quotation.
- **`बरोबर असेल तर 'मंजूर', काही चुकलं असेल तर 'शंका' — नंतर विचारता येतं.`** (`ReviewSheet.tsx:638`) —
  quotes the two buttons by their own words and removes the fear of pressing either.

---

*End of findings. Evidence and judgement only; nothing was renamed, replaced, added or removed.*
