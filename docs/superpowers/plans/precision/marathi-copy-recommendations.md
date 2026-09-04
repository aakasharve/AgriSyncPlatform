# Marathi copy — the recommendation layer

**spec:** 2026-08-28-labour-v2-release-1
**Branch:** `feat/labour-v2-r1` · **Date:** 2026-09-04
**Written by:** marathi-copy-chief — one hand, every line.
**Data:** `docs/superpowers/plans/precision/marathi-copy-recommendations.json` (278 rows, joined to the
audit by `id`)
**Input:** `marathi-screen-audit-data.json` (161 PASS · 80 FLAG · 37 FAIL) — evidence.
**Status:** STILL A REVIEW ARTEFACT. No production copy, component, translation key, test or internal
`Labour*` identifier was touched. Every line below is a recommendation awaiting your yes or your change.

---

## What changed about the workflow

The audit proposed no replacement word anywhere — deliberately, but it left you inventing 117 lines of
Marathi yourself. This pass closes that. Every audited string now carries:

> **current wording → doctrine judgement → recommended Marathi → your approval or change.**

Your part is the last box, and only the last box: **does it mean the right thing, and does it fit a
farmer.** The Marathi is mine and I own it.

| Disposition | Rows | What it means |
|---|---:|---|
| **KEEP** | **162** | Already satisfies the doctrine. Named so the picture is complete, and so nothing good gets renamed by accident. |
| **REWRITE** | **104** | Ordinary microcopy. I wrote the replacement. Read it, change it if the meaning is off. |
| **FOUNDER_DECISION** | **12** | Strategic naming. I give you at most two directions and stop. |

For a FOUNDER_DECISION row, `recommended` and `alternative` are **directions, not a draft** — direction 1
is the one I lean to, direction 2 means something genuinely different. For a REWRITE row, `alternative`
is filled only where two readings are both defensible and you must pick the meaning.

**Authority, per row, never dressed up:** 45 rewrites rest on **CANON** (the tone guide, its banned list,
its Avoid list, the spelling rule, MDR-002 Accepted), 63 on my **JUDGEMENT** as copy chief, and **8** on
**MDR-021, which is Proposed and unsigned**. Those 8 are marked `MDR-021-PROPOSED` and are explained below.

---

## 1. The register ruling

**One register for the whole product: the spoken `-चं / -लं / -तंय` family.** That is how a farmer in
Pune, Nashik or Sangli actually talks, it is what the tone guide's first rule asks for ("write how farmers
speak, not how textbooks write"), and it is already the house style — the audit counted **86 spoken against
25 written**. Written is the exception, which is exactly why each written string sticks out instead of
blending in.

MDR-021 calls the split *"a shipping defect, not a style note — one person cannot be both."* I agree, and I
have not waited for the signature on that point: the register rule is the **tone guide's own**, so every
register fix below is **CANON**, not proposal-dependent.

**Register corrections made: 22.** Every written-register string I rewrote moved to spoken. They are ids
4, 7, 17, 21, 23, 28, 31, 75, 92, 116, 142, 164, 171, 182, 193, 194, 246, 249, 253, 254, 259, 268.

The three written-labelled rows I did **not** move:

- **#20** `आतापासून तुमची शेती अंदाजावर नाही…` and **#24** `आज केलेली प्रत्येक नोंद, उद्याचा निर्णय सोपा करते.`
  — the audit tagged these written, but neither carries an actual `-चे` defect; they are participles that a
  farmer says out loud in exactly this shape. They stand.
- **#262** `पैसे दिले ✓ — नमुना` — see §5. The audit is wrong here; `दिले` is correct agreement.

The two purest seams are now closed. `sync.onPhoneFull` / `sync.onServerFull` (#253, #254) were the same
claim as the live `लक्षात ठेवलं ✓` in a second register **and** with the postposition detached
(`श्रम साथी ने` is Hindi word-shape, not Marathi) — both fixed. And on the log page, `कामे` → **कामं** and
`निवडले` → **निवडलेत** (#246, #249) put the guide card back into one voice.

---

## 2. The Copy Bank lines I reused verbatim — 4

Free credibility: these already passed this gate, so they carry no new risk. All four land on the
character's chalkboard (`ShramSathiUnderstanding.tsx`), which is where the writing was weakest.

| Row | Replaced | Copy Bank line, verbatim |
|---|---|---|
| **#21** | `जे नोंद ठेवत नाहीत त्यांच्यासाठी असतो अंदाज…` — the line that sorts farmers into record-keepers and the rest, which the guide's pride section bans outright | **आजचं काम आज नोंदवलं, तर उद्याचा निर्णय अंदाजावर राहत नाही.** |
| **#26** | `नोंदवलेलं शहाणपण… ; विसरलेली चूक…` — two full ideas on one line | **काम विसरतं, नोंद विसरत नाही.** |
| **#30** | `हंगामाचा अंदाज बांधण्यापासून… पर्यंत` — written `…पासून…पर्यंत` frame | **पुढची शेती अंदाजावर नाही, नोंदीवर चालणार आहे.** *(the hero recurring line)* |
| **#31** | `प्रगतशील आणि नियोजनबद्ध शेतकरी आहात` — government-circular adjectives stacked on a man, on the screen meant to praise him | **काम करणारा शेतकरी मजबूत; कामाची नोंद ठेवणारा अजून मजबूत.** |

Note #30 and #20 will now both sit in the same 15-line rotation, both built on *अंदाजावर नाही*. That is a
motif, not a collision — the hero line is meant to recur.

---

## 3. The strategic-naming items — 12 rows, 8 questions, yours

These are the ones I will not settle with a quiet rewrite. Each is a **permanent noun**: change it later and
you change it on every screen, in every farmer's mouth, and in every screenshot already taken.

### N1 — the subsystem's name · rows #1, #11, #13, #33
**Current:** `कामाच्या नोंदी` (Setup Hub door · hub title · log-banner back-pill) and `कामाच्या नोंदींसाठी`
(banner headline). Your 2026-09-03 rule already removed `कामगार व्यवस्थापन` from all five sites, and the four
surviving surfaces **agree with each other** — that agreement is itself worth money.
- **Direction 1 — keep `कामाच्या नोंदी`.** Work-centred, classifies no human, and it is UI chrome, so it
  survives MDR-021 even if you sign the नोंद ban. Nothing further to do.
- **Direction 2 — `कामाचा हिशोब`.** Settlement-centred; `हिशोब` is a canon lean-on word and it matches the
  money cards. But it narrows the feature to money, and हजेरी — who was present — is the larger half.

**I lean to direction 1.** It is not a compromise: it is the more honest name for what the feature does.

### N2 — the permanent human-category word · rows #202, #230
**Current:** `कामगार` as the fallback title of one man's detail screen (#202) and as his role badge
(`कामगार · Worker`, #230). Eight words are live for one countable human — `मजूर · लोक · जण · माणसं · कामगार ·
व्यक्ती · सदस्य · चालक`.
- **#202 direction 1 — `माणूस`** (the human word the picker already ships: `माणूस निवडा`). Names a person,
  not what he sells. **Direction 2 — `कामाचा हिशोब`**: the screen stops naming him at all and names what it
  shows.
- **#230 direction 1 — `कामगार`** alone: drop only the English half (that half is MDR-002 regardless) and
  leave the noun standing until you settle it. **Direction 2 — `कामाला येणारे`**: describes coming to work
  instead of naming a class.

**What I did NOT wait for you on, and why:** wherever the word only **counts** people, I rewrote it to
**जण** — the neutral counter this app already ships and the audit already passes (#42 `आज कामावर N जण`).
Counting presence is not categorising a human, and that is the dignity rule's own instruction: *describe the
work, the presence, the responsibility.* That covers #12, #57, #109, #110, #146, #181, #267, #274, #275.
Wherever the word named a **class** in a sentence, I described the people instead — #63
`अजून कोणाचंही नाव जोडलेलं नाही`, #244 `रोज तुमच्या शेतात येणारी माणसं…`, #268 `आज कोणी कामावर नव्हतं`.
None of those picks a permanent noun; all of them stop using one. **N2 is still open.**

### N4 — farm मुकादम vs crew organiser · row #66
**Current:** one badge, `मुकादम`, covering a QR-issuable farm authority **and** a man who brings ten people
and has no phone. Spelling is canon-correct everywhere (`मुकादम`, never `मुखादम`).
- **Direction 1 — split the noun.** `मुकादम` stays with the crew organiser, which is its true field meaning;
  the farm-side authority becomes **`जबाबदार`**, which the app's responsibility vocabulary already carries.
- **Direction 2 — one badge, no new noun.** Keep `मुकादम` and let the existing appointment sub-line
  (`तुम्ही नेमला` / `{name}नी नेमला`) carry the difference.

Direction 2 is cheaper; direction 1 is the one that survives the day a crew organiser needs different
money rules. Row #67 (`उप-मुकादम`) and #223 (screen title) are KEEP and follow whichever you choose.

### N5 — the approval screen's name · row #160
**Current:** `तपासणी`, and the act is six words across four screens. `तपासणी` also **collides with identity
verification** (`ओळख तपासली जात आहे`) and with a reliability metric (`तपासणी प्रमाण`).
- **Direction 1 — keep `तपासणी`**, and free the word elsewhere: identity verification must stop using it.
- **Direction 2 — `मंजुरी`.** Name the screen by the act the farmer performs; `मंजूर करा` is already its own
  button, and `तपासणी` is released back to identity.

Meanwhile I aligned the **verb forms** without waiting — that is microcopy, not naming: #190 `तपासायचं` →
`तपासा` (the hub tile's form), and #117's save becomes `बरोबर — तपासणीसाठी` so the capture screen and the
result screen stop using two different words for saving.

### N7 — is `काम झालं` allowed to be a money label? · rows #198, #203
**Current:** `काम झालं · एकूण नोंदवलं` (farm money card) and `काम झालं` (the balance tile on every person
and mukadam, directly above `दिलं` and `बाकी`). It reads *"the work got done"* and carries a rupee figure.
This is the most load-bearing ambiguity in the feature: it is the card a farmer uses to decide what he owes
a named man.
- **Direction 1 — name the money.** `एकूण मजुरी` (card) / `मजुरी झाली` (tile). Unambiguous; the card becomes
  a money card end to end.
- **Direction 2 — keep the work frame and say the money out loud.** `काम झालं — त्याची मजुरी` /
  `कामाचे पैसे`. Preserves the idea that the figure is *earned*, at the cost of length.

### N11 — a number scoring a named human · row #220
**Current:** `विश्वास {n} — 30 दिवसांत वाद नाही` (flag-off). The Marathi is clean; the artefact is the
question, and a **live** reputation vocabulary already sits beside it (`विश्वासार्हता गुण`, `तपासणी प्रमाण`).
- **Direction 1 — `30 दिवसांत वाद नाही`.** State the fact, drop the score. Nothing is fabricated, nothing is
  ranked.
- **Direction 2 — keep `विश्वास {n}`**, but then the basis must be stated on the same screen, or the number
  is a claim without proof.

### N15 — `प्लॉट` · row #248
**Current:** an English loan carried in Devanagari across the whole app. It may well be **settled field
usage** — plenty of farmers say प्लॉट — which is exactly why it is not mine to overturn.
- **Direction 1 — keep `प्लॉट`.** Settled usage; changing it is an app-wide surface, not a labour one.
- **Direction 2 — `गट`.** The Marathi land word, at the cost of retraining every user who already reads प्लॉट.

**I lean to direction 1.**

---

## 4. नोंद, and the 8 rows that wait on your signature

MDR-021 is **Proposed and unsigned**. I have not written as though you had signed it.

- **Outside / marketing voice:** `नोंद` is canon and stays. Untouched here.
- **UI chrome:** `नोंद` is permitted. I judged each instance on whether it reads as **furniture** or as **the
  app speaking**, and kept the furniture ones: `आजच्या नोंदी` (a group heading, #52), `नोंदलेली` (a qualifier
  on a figure, #39), `N नोंदी — मंजूर करा` (a count line, #161), `नोंदी` (a stat tile, #189),
  `अजून हजेरी नोंदवली नाही` (#91). None of those has a speaker; nobody is talking.
- **Sathi's voice:** MDR-021 would ban it. **8 rows** — #75, #124, #125, #128, #140, #142, #158, #215 — carry
  `authority: MDR-021-PROPOSED`. For each, `why` says plainly: *this passes canon today*, and `recommended`
  shows **what the line becomes if you sign**. Nothing there is a defect until you say so.

The one that makes the case best is **#158**: `{name} ची नोंद झाली, पण या कामाला लावता आलं नाही` — a **human**
was नोंद-ed, filed. If you sign, it becomes `{name}चं नाव यादीत आलं, पण…`: the name went on the list; the man
was not filed. That is the whole of MDR-021's argument in one toast.

**Two speakers, one product.** The app ships `मी` on the processing screen and `आम्ही` in the labour feature
(`माहिती आणत आहोत…`, `माणसं आणत आहोत…`). For both (#75, #142) I recommend a form with **no speaker at all**
(`माहिती येत आहे…`, `नावांची यादी येत आहे…`) — safe under either outcome — and give the `मी` form as the
alternative for the day you rule that Sathi speaks there. `माणसं आणत आहोत…` had a second problem the audit
did not name: read aloud it sounds like *people* are being fetched.

**#118 `ShramSafalला समजलं`** I treated as canon, not proposal: Latin script inside a Marathi sentence while
the app's own i18n ships `श्रम सफल` in Devanagari. Recommended `श्रम सफलला समजलं` fixes the script and settles
nothing strategic; the alternative `मला समजलं` is the line if you sign MDR-021 and the inside voice becomes
श्रम साथी the person.

---

## 5. Where I read the evidence differently from the audit

I am the Marathi authority on this; the audit was the evidence. Six places I departed from it.

1. **#262 `पैसे दिले ✓ — नमुना` — the audit is wrong.** It calls `दिले` a written-register slip against the
   app's live `दिलं`. It is not. `पैसे` is a masculine plural, so `दिले` is the **correct** agreement;
   `दिलं` elsewhere agrees with a different (neuter) subject. **KEEP.** Changing it would introduce an error.
2. **#85 `4त = 4 तास`, #86 `+2 जादा`, #87 `उक्ते काम` — right complaint, wrong workshop.** The words are
   correct field Marathi. What is broken is that the convention is taught once in a legend and then used
   inside 26px cells with no word. That is a **design** fix (repeat the unit in the cell), not a copy fix,
   and rewording it would hide the problem instead of solving it. **KEEP.**
3. **#149 `नवीन माणसाचं नाव` — the defect belongs to its neighbour.** The audit flags this aria-label for a
   mismatch that actually lives on the **second** field's placeholder. This string is good Marathi; I fixed
   #151 instead so the field reads the same to an eye and to a screen reader. **KEEP.**
4. **#216 (the trust eligibility card) — the false promise is on the other row.** The audit flags this card
   for promising auto-approval. On this card the promise **is** what the control does. The unbacked claim is
   the **live** ReviewSheet line (#166), which promises auto-approval on a screen where
   `GetLabourDataHandler.cs` hardcodes `Access: "review"` for everyone. I removed the sentence there and left
   this card intact. **KEEP #216, REWRITE #166.**
5. **Two-word collisions: I named an anchor rather than rewriting both sides.** The audit flags both halves
   of each pair. A pair needs one winner, not two rewrites: `आला नाही` beats a bare `नाही` (#96 KEEP, #82
   and #108 move to it); `बंद करा` beats `बंद` (#153, #163 KEEP, #98 moves); `आला` beats `पूर्ण` (#80 KEEP,
   #94 moves); `सर्व दिवस` beats `सर्व दिवसांची हजेरी पहा` (#48 KEEP, #201 moves); `संघ` beats `टीम` (#5 KEEP,
   five टीम sites move).
6. **Four rows the audit passed that I rewrote anyway** — stated plainly so you can overrule me:
   - **#6** `अजून संघ सदस्य नाहीत` → `अजून कोणी संघात नाही`. `सदस्य` is form register.
   - **#108** `नाही` → `आला नाही`. Follows the anchor above.
   - **#208** `₹N द्यायचे` → `₹N बाकी`. Leaving it re-creates on the list screen exactly the collision I fixed
     one line above it (#207). One number, one word.
   - **#273** `कामगार पाळ्या` → `कामाच्या पाळ्या`. The audit passed it for `पाळी`, which is right and stays —
     but the heading still carries the flagged human noun for no reason. The shifts belong to the work.

---

## 6. What must not be reopened

Stated so a naming session does not rename it by accident. All KEEP, all protected:

- **`कुणी माहिती नाही`** (#99) — an absence named as an absence. Doctrinally the strongest string you own.
- **The capture ladder** (#126, #127, #130–#136) — five questions, one idea each, `दिसतोय` instead of an
  assertion, no blame, and `"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.` — the trust gate in one line.
- **`मी आजचं काम समजून घेतोय…`** (#14) — the MDR-021 exemplar, and the best line in the product.
- **`"रोकडेचे दहा लोक आले" — असं बोला`** (#35) — verbatim field speech. The `लोक` is right *because* it is a
  quotation; do not "fix" it to जण.
- **`मदत कराल का?`** (#252) — अहो-जाहो politeness, asks instead of instructing.
- **`शक्य तेवढ्या सगळ्यांची नावं घ्या — म्हणजे नंतर तुम्हाला माहीत असेल, कोणतं काम कोणी केलं.`** (#245).
- **`लक्षात ठेवलं ✓`** (#88, #104, #250, #264) — one claim, four surfaces, no fourth dialect. It says
  *remembered*, not *filed*, so it survives MDR-021 whichever way you rule.

---

## 7. The live canon breaches, and what each becomes

The 22 live FAILs, in the order I would ship them.

| # | Now | Recommended |
|---|---|---|
| 15 | `Listening carefully to your log...` | **तुम्ही सांगताय ते नीट ऐकतोय…** |
| 171 | `फार्म बुक अद्ययावत आहे` | **सगळ्या नोंदी तपासून झाल्या** |
| 166 | `…ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर.` | **चुका आधीच पकडल्या जातात, म्हणून हिशोब बरोबर राहतो.** *(the promise goes until the mechanism ships)* |
| 268 | `आज कामगार वापरलेले नाहीत` | **आज कोणी कामावर नव्हतं** |
| 234 | `हा सदस्य काय करू शकतो? · What can they do?` | **याला काय करता येईल?** |
| 241 | `टीममधून काढा · Remove` | **संघातून काढा** |
| 230 | `कामगार · Worker` | *(N2 — direction 1 drops the English half)* |
| 231 | `भागीदार · Partner` | **भागीदार** |
| 3 | `पैसे व हिशोब · Finance` | **पैसे व हिशोब** |
| 191 | `कुठे काम झालं · plots` | **कुठे काम झालं** |
| 196 | `पैसे · money` | **पैसे** |
| 229 | `याची माणसं · his team` | **याच्यासोबत आलेली माणसं** |
| 4 | `कुटुंब आणि कामगारांचा प्रवेश व्यवस्थापित करा` | **कोणाला काय जबाबदारी, ते इथे ठरवा.** |
| 7 | `शेत व्यवस्थापनासाठी कुटुंब किंवा कामगार जोडा.` | **शेतात मदत करणाऱ्यांची नावं जोडा — घरातली किंवा बाहेरची.** |
| 58 | `टीमची हजेरी, मजुरी व नोंदींची तपासणी — सगळं एका जागी.` | **संघाची हजेरी, मजुरी आणि नोंदी — सगळं एका जागी.** |
| 60 | `'टीम सेटअप'मध्ये…` | **'माझा शेत संघ'मध्ये कोणाला नोंद करता येईल ते ठरतं. इथे त्यांनी काय केलं ते दिसतं.** |
| 68 | `{task} टीम` | **फक्त {task}साठी** |
| 71 | `टीम N` | **सोबत N जण** |
| 274 | `Total workers: N (a + b)` | **एकूण N जण (a + b)** |
| 276 | `…ॲप चालण्यासाठी…` | **…श्रम सफल चालण्यासाठी फक्त खालची माहिती वापरली जाते.** |
| 277 | `…चं ॲप आहे; ते AgriSync प्लॅटफॉर्मवर चालतं.` | **श्रम सफल हे Agriryot Value Enterprises Private Limited यांचं आहे.** |
| 278 | `फोन, ॲप, सिंक आणि सुरक्षेची मर्यादित माहिती` | **फोन, वापर, माहिती पाठवणं आणि सुरक्षा — यांची मर्यादित माहिती** |

Two notes on the consent gate (#276–#278): the banned words (`ॲप`, `प्लॅटफॉर्म`, `सिंक`) are canon and mine
to fix, but **the legal name stays** and **legal review owns** whether the AgriSync platform clause must
appear at all. I removed it as farmer-facing clutter, not as a legal judgement.

---

## 8. How to work through this

Read the JSON beside the audit page — they join on `id`, so every string shows you *where the farmer meets
it*, *what the doctrine says*, and *what I recommend*, in one row.

1. **The 12 FOUNDER_DECISION rows first.** Nothing downstream is final until N1, N2 and N7 are settled —
   they are permanent nouns and they appear on the door, the detail screen and the money card.
2. **The 22 live FAILs (§7).** These cost you something today.
3. **The 8 MDR-021 rows.** One signature settles all of them, plus the two-first-persons question.
4. **Everything else** is register and consistency, and can ship as one pass.

*End. Recommendations only — nothing was renamed, replaced, added or removed in the product.*
