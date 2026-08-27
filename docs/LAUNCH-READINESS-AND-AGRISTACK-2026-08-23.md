# Launch Readiness + AgriStack Eligibility — Cross-Verification

**Date:** 2026-08-23 · **Branch:** `feat/server-authoritative-architecture` @ `a09723e7`
**Method:** 14 agents — 5 read the repo, 6 verified claims against primary sources
(agristack.gov.in, sandbox.agristack.gov.in, ufsi.agristack.gov.in, pib.gov.in, meity.gov.in,
uidai.gov.in, trai.gov.in, indiankanoon, PRS), 3 adversarially stress-tested the conclusions.

**Not legal advice.** Three items at the end genuinely need an Indian lawyer.

---

## 1. Verdict on the pasted AgriStack brief

**It is substantially correct.** All nine eligibility claims came back CONFIRMED or PARTLY_TRUE.
None was false. Five corrections matter:

| Claim | Correction |
|---|---|
| Sandbox is open to startups | **True**, but it is **not** open testing. Five gated steps: Submit Registration → **Approval from Agri-Tech Committee** → Integrate & Test → Certification → Go Live. T&C: access "limited to registered users engaged in agricultural innovation or research", approvable/revocable "at its sole discretion". You cannot self-serve in. |
| UFSI has an "Access Manager" | **No such component.** The string appears nowhere on any AgriStack domain. Its functions belong to the **Network Manager**. Using the wrong name in an application reads as unfamiliarity. |
| PIB release dated 3 Aug 2026 | The **number** (10.31 crore Farmer IDs) is exact. The release is **PRID 2296209, published 7 Aug 2026** (Rajya Sabha written reply); 3 Aug is the data as-of date. Cite it correctly. |
| "₹1 crore is UIDAI AUA/KUA eligibility" | **Stale.** That Schedule A was **omitted w.e.f. 27 Feb 2023**. Current Schedule A governs *Authentication Service Agencies* and its bar is **₹100 crore turnover**. Current reg. 12(1) imposes no financial test at all. The real ₹2 crore figure is the **DPDP Consent Manager** net-worth bar — a different regime entirely, and not something AgriSync would ever be. |
| No published production checklist | **Confirmed** — and worse than the brief implies. There is no `/production`, `/certification` or `/go-live` route in the sandbox app at all, no published SLA, no fee schedule, and **no named private agritech publicly documented as live on UFSI.** The only published case studies are state-government ones. |

### What the pasted brief missed entirely

Labour law, bonded labour, children's data, CERT-In, the two duties that bind **today**,
and the entire Maharashtra state route. Those are covered below and several matter more than AgriStack.

---

## 2. The reframe: AgriStack is not on your critical path — and cannot be

The sandbox Terms & Conditions state it directly:

> "Users must use the Sandbox solely for development, experimentation, and testing. The use of the
> platform for **commercial deployment, accessing real farmer data**, or engaging in harmful or
> malicious activity is **strictly prohibited**."

And FAQ 5: sandbox data is "anonymized and simulated".

So AgriStack access **cannot** serve your 20-farmer pilot even if approved tomorrow. It buys a
synthetic-data test bed. Separately, the **entire UFSI API surface is registry READ, not write** —
there is no endpoint for pushing farm activity, labour, expenses or voice logs into AgriStack.
AgriStack can never be AgriSync's system of record. It is an enrichment and verification source,
one day, for onboarding.

**Conclusion: build so that zero government API access is required. Treat AgriStack as upside, never
as a dependency, and never put a dated UFSI line in a plan or a deck.**

### Eligibility, plainly

Both live registration forms were driven in a browser. Fields collected: Organization name,
Operating Area, Service Domain (Advisory/Input/Finance), Category (Private), Sub-Category
(Pvt Ltd / LLP / FPO / MNC), State, Address, authorised person details, **ID proof under 2MB**.

**There is no field anywhere for turnover, revenue, funding, net worth, company age, DPIIT
recognition, farmer count, GSTIN, CIN or PAN.** Sandbox access is currently free ("Currently…"
— the hedge is theirs).

AgriSync fits: Category `Private`, Service Domain `Advisory`, Operating Area `State wide`,
State `Maharashtra`.

**The load-bearing caveat:** approval is discretionary with unpublished criteria. "No published
threshold" ≠ "no threshold". Submitting costs nothing and commits you to nothing — so submit and
forget, do not wait.

**Contact:** Director (Digital Agriculture), Shri Vijay Singh, 011-23383980 — the right first human.
Not the `supp.agristack@gmail.com` address on the T&C page.

---

## 3. What actually blocks real users — all of it in our own code

The adversarial pass tried hard to refute each of these. These are what survived.

### 3.1 Farmers get logged out permanently by bad signal — and their data appears to vanish
`AuthProvider.tsx:138-151` fires one session refresh on every app launch.
`AgriSyncClient.ts:567-573` catches **any** failure — including a network timeout — and wipes the
Android Keystore token. The same path re-points the local database to `UNIDENTIFIED_DATABASE_NAME`,
so the farmer opens an empty app.

A farmer on rural 2G opens the app in a field and is logged out for good, with his 40 days of records
apparently gone. The data is recoverable; the trust is not. **This codebase already has the right
network-vs-rejection discriminator one layer down** (`RejectionPolicy.ts`) — the two layers disagree.

~20-line fix. **Must land before the pilot APK is cut**, because the APK cannot be hot-fixed.

### 3.2 Nightly hibernation is still armed
`agrisync-prod-nap` stops EC2 + RDS roughly 19:30–00:30 UTC. On its own that is an annoyance.
Combined with 3.1 it is fatal: every farmer who opens the app in that window is **permanently logged
out**. The wake time is documented inconsistently (README 05:30 IST vs Lambda docstring 06:00 IST),
which overlaps exactly when smallholders work. One command (`aws/hibernate/nap-teardown.sh`) fixes it.

### 3.3 Every new farmer is shown a fabricated identity
`useAppData.ts:76-90` seeds — unconditionally, not behind any demo guard — name **"Shetkari Raja"**,
village **"Nashik"**, and three invented team members with fake phone numbers (9876543210/11).
These render directly in `IdentitySection.tsx` until a sync pull lands.

And `farmLabels.ts:24` labels the farm's **random 6-character display code** as the farmer's
**७/१२ land record** — while a second tile on the same screen honestly says सातबारा is
"अजून जोडलेले नाही". The app tells him two contradictory things at once, about his land record.

Violates doctrine **P4** (no fabricated numbers) and **P8** (provenance). In a village where the 7/12
is the most emotionally loaded document that exists, this ends the conversation. **~2 hours.**

### 3.4 Every farmer is named "User 4567", in English
`OtpVerifyForm.tsx:64` calls `setAuthSession` which unmounts the page **before** the name field can
render, so `VerifyOtpHandler.cs:100-102` falls back to the literal `$"User {phone[^4..]}"`.
And `LanguageContext.tsx:32-33` **defaults to English** — the server-side Marathi preference arrives
only after login, so it cannot help the login screen or any offline session.

A Marathi-first voice app for semi-literate farmers opens in English and calls every user by an
English placeholder. Both are one-liners.

### 3.5 Farmer-created plots never reach the server — and their logs silently don't sync
`AddPlotWizard` writes only to local storage; `create_plot` / `create_crop_cycle` are enqueued by
nothing. Worse, `logSyncMutationService.ts:540-620` cannot resolve a **plot-scoped** log against a
plot the device created locally — it returns null rather than downgrading to farm scope. Farm-scoped
logs ("संपूर्ण शेत") are explicitly rescued and do sync.

**Zero-engineering mitigation:** seed all 20 farmers' plots server-side during onboarding so they
arrive via sync with real IDs, and keep AddPlotWizard out of the pilot flow. One afternoon of data
entry replaces 2–4 days of code.

### 3.6 Login itself — but you have two escape hatches
Production defaults to the fake SMS sender (`DependencyInjection.cs:95`, `defaultValue: true`), and
the guard the code comment promises **does not exist**. But:
- A **phone + password** login is already UI-reachable (`LoginPage.tsx:120-123`), and
  `LoginHandler.cs:48-52` marks the phone verified on any successful password login.
- So: provision 20 accounts, hand each farmer a slip of paper. Zero SMS, zero DLT, zero rupees.
  "Remember this device" is pre-checked; the session lasts 30 days.

### 3.7 The gaps nobody had looked at
- **The app has never been run end-to-end on this branch.** The Playwright E2E suite triggers only on
  `main`; this branch is 252 commits ahead with no upstream. Every "this works" belief is inference
  from reading code, not observation.
- **You cannot see that a farmer is stuck.** Sentry is wired but `VITE_SENTRY_DSN` is set in no
  workflow, so it is disabled in **every APK ever built**. `ClientErrorReporter.ts:68` posts to a
  *relative* path — inside the Capacitor WebView that never reaches the API. The admin
  "farmer suffering" view is fed by that endpoint, so **it will read empty and look green.**
- **No support channel exists.** The only support string in the app is an English `window.alert`
  pointing at `support@shramsafal.in`.
- **Backups are unproven.** The snapshot workflow header says "DO NOT RUN UNTIL FOUNDER ISSUES FRESH
  FIRST-RUN APPROVAL"; the restore smoke test does not exist. RPO unknown.
- **An owner cannot remove someone he let in.** `RevokeMembershipHandler` is explicitly deferred; the
  QR invite has no expiry and is unlimited-use. A QR shared into a WhatsApp group is permanent access
  to another farmer's wage records.
- **Losing the phone destroys the account.** No change-phone, no ownership transfer. And Indian
  operators recycle numbers — a stranger issued that number later inherits the farm.
- **The 14-day trial expires mid-pilot.** `SubscriptionReconciliationJob` is live and flips
  Trialing→Expired; an Expired owner can neither write nor read. Every integration test replaces the
  real policy with `AllowAll`, so what actually happens on day 15 is untested. Billing is an
  `alert('coming soon')`.
- **The agronomy we already ship is unsourced.** `CropScheduleTemplateSeeds.cs` prescribes named
  chemical interventions on fixed day-offsets (GA3 day 22, powdery mildew day 28, thrips day 45,
  pre-harvest spray day 140) for Grape/Pomegranate/Onion with **no cited source, no reviewer, no
  KVK/ICAR attribution, no variety qualifier and no disclaimer.**
- **Twelve launch-deciding unknowns all resolve in one 20-minute session on the box** — and nobody
  owns that session. (Is the SMS flag set? Is RDS encrypted? Is the nap Lambda armed? Does the S3
  delete permission exist — i.e. is every "deleted" claim in the erasure ledger true?)

---

## 4. What legally binds you on day one — only two things

**DPDP is not one of them.** Verified against both gazette notifications:

| Date | What commences |
|---|---|
| 13/14 Nov **2025** | Definitions + the Data Protection Board machinery only |
| 13/14 Nov **2026** | Consent Manager *registration* — **imposes nothing on AgriSync** |
| 13/14 May **2027** | **Everything** — notice, consent, security, breach, children, rights, all penalties |

As of today **none** of the substantive DPDP obligations is in force. The Board has **no chairperson
and no members** (MeitY was still advertising the posts in May 2026), so there is no forum to hear a
case even after May 2027. There is no agriculture exemption, no small-business exemption, and the
startup exemption power (s.17(3)) has never been exercised — do not plan around one arriving.

**Your DPDP enforcement exposure for a 20-farmer pilot starting now is zero. You have ~8.7 months.**

### What DOES bind today — SPDI Rules 2011 (they survive until May 2027)

1. **A published privacy policy** — Rule 4. Public URL, not a PDF, not behind a login. Must state
   data types, purpose, disclosure, security practices, and **the name and address of the retaining
   agency** (i.e. name your cloud provider and region).
2. **A named Grievance Officer** with published contact and a **one-month** redressal SLA — Rule 5(9).

That is the entire day-one legal artifact list. Both are also Google Play requirements, so you build
them once. **Publish in Marathi *and* English** — IT Rules 2021 Rule 3(1)(a) requires the policy in
the user's preferred Eighth Schedule language, and Marathi is one.

**And the one nobody knows about — CERT-In Directions, 28 April 2022, live since 2022:**
cyber incidents must be reported to CERT-In **within 6 hours** (twelve times tighter than DPDP's 72).
Also required: NTP sync to NIC/NPL, 180 days of logs held **in India**, and a Point of Contact filed
with CERT-In. Our EC2/RDS are in ap-south-1 so the logs condition is probably met *by accident*.
Three cheap actions turn accident into control.

> **Important:** the founder is a "body corporate" under IT Act s.43A **whether or not** a company
> exists — the definition expressly includes a sole proprietorship. Staying unincorporated removes
> the liability *shield*, not the *obligation*. That is the real argument for incorporating, and it
> is about personal exposure, not compliance.

---

## 5. The two channel choices that delete weeks of waiting

### Google Play: use the **internal testing** track, not production
Production access is what triggers the 12-testers-for-14-days rule. Internal testing allows **up to
100 testers by email list**, needs no production review, and — critically — apps active only on
internal testing are **exempt from the Data safety form**. A 20-farmer pilot fits entirely inside it.
$25 personal account, same day. (Organisation account = same $25 **plus up to 30 days** waiting on a
D-U-N-S number. Don't.)

*Already handled:* `targetSdkVersion = 36` is set, so the 31 Aug 2026 Play deadline is met.

*Also:* Google's sideloading/"verified developer" change hits Brazil, Indonesia, Singapore and
Thailand on 30 Sep 2026 — **India is not in the first wave.** And Google now offers a free
"limited distribution account" for up to **20 devices** with no government ID. You sit exactly at
that cap; 21 farmers breaks it.

### OTP: use **WhatsApp**, not SMS
SMS OTP without DLT registration is not risky — it is **impossible**; carriers block at the SMSC.
DLT = Principal Entity + header + content template + the PE-TM chain binding, ~₹5,900 per operator
portal, **2–4 weeks**. Two traps: a non-bank login OTP must be registered as **Service (-S)**, not
Transactional; and one marketing sentence in a template reclassifies it Promotional, which **cannot
reach DND numbers** — rural Maharashtra has heavy DND enrolment.

WhatsApp: a new business portfolio starts at **250 business-initiated conversations per 24 hours**
and **business verification is not required to start sending**. Against 20 farmers that is ~12 logins
each per day. No DLT, no ₹5,900, no 3-week wait. Opt-in may be collected **in person or on paper** —
which is exactly how you are onboarding anyway.

---

## 6. Shaping for AgriStack: do almost nothing

The cost auditor killed 11 of 14 proposed "cheap now, expensive later" schema changes. Two facts
decided it:

1. **Backfill is not a cost at 20 farmers.** ~20 farm rows and ~80 plot rows. You are physically in
   the village with these people. Every "add the column now, backfilling later is painful" argument
   collapses against that number.
2. **Every client-side change is forward-incompatible.** The local database is at v24, whose own
   header says *"One-way for APK users: an older build opening a v24 database throws"* and *"This
   bump therefore ships ALONE."* Since APKs bundle assets at build time with no update check, a local
   schema bump is a break you **cannot push a fix for**. Client-side speculation is strictly more
   expensive and riskier than it looks.

### Do now (three small things)
- **Persist the village we already collect and throw away.** `FirstFarmWizard.tsx:227-250` asks the
  farmer for his village, `inviteApi.ts` sends it, and `FirstFarmBootstrapEndpoints.cs:229` declares
  the field and **never reads it**. One column, `farms.village_name_raw`. Half a day. This is the one
  datum obtainable only in a moment that will not recur.
- **Ask for the Farmer ID as an optional, self-declared field.** Maharashtra has **1,31,81,173**
  Farmer IDs as of 19 Mar 2026 — ~86% of holdings, highest in India. Your farmers almost certainly
  have one. It is an 11-digit random number, **not** an Aadhaar derivative. Never make it mandatory;
  never gate anything of value on it (it is an identifier, not an authenticator). Store the
  verification flag as a *separate column* so it can be populated later.
- **Write one ADR** recording the 11 dropped items and why. 1–2 hours preserves every future option
  at zero migration risk and zero empty fields.

### Explicitly dropped (do at integration time, if ever)
Per-plot geometry · provenance enums · crop/season code rails · CRS columns · a
`farmer_external_identities` table with zero rows · audit purpose columns · hash-chained audit rows ·
a consent-scoped tenant mode · reviving the dead consent-token layer · survey/gat/khasra columns.

> On survey numbers specifically: you can collect all 20 on a **spreadsheet** for the cost of asking.
> Building the column now means owning an empty field that either stays empty or fills with
> unverified self-declared data **wearing the appearance of a land record** — a P8 violation.

### One hard rule to write into CLAUDE.md today
**AgriSync never accepts, transmits, derives or stores an Aadhaar number — in any field, log, voice
transcript or backup.** This single rule keeps you permanently outside the expensive half of the
Aadhaar regime. For the pilot you need **no relationship with UIDAI whatsoever.**

Add a lint/schema guard: a voice-first app is exactly where a farmer says twelve digits out loud and
they land in a transcript nobody planned for.

**Landmine for later:** several live UFSI endpoints take Aadhaar as input — *Land Data based on
Aadhaar*, *Farmer ID by Aadhaar*, and a sync API requiring `aadhaar_hash_256`. An engineer could
reach for the convenient lookup and in one commit convert AgriSync into an entity holding a
reversible Aadhaar identifier. (UIDAI Circular 14 of 2025 para 7(k) forbids hashing as a reference
key precisely because a 12-digit space is trivially brute-forced.) Put those endpoints on a written
deny-list; use `/agristack/verify_farmer_id` (state code + Farmer ID only) instead.

---

## 7. The Maharashtra route — the actual opportunity, and it is not Delhi

> PIB 2296209, verbatim: *"The State Farmer Registry is built in a federated manner, which means the
> ownership of the data is with the respective States."*

Chasing a central approval is chasing the wrong signature.

- **AIAIC** (`aiaic.maharashtra.gov.in`) — the AI & AgriTech Innovation Center under the
  **MahaAgri-AI Policy 2025-29**, ₹500 crore state outlay. Its Call for Proposals has
  **Track 2: Pilot & Validation, up to ₹2 crore**, ~9–12 months or one crop season, requiring "a
  local partnership or plan for on-site implementation in Maharashtra". Winners get ADeX + sandbox
  access, **field pilot permissions**, and connections to KVKs, FPOs and extension officers.
  Round 1 closed 30 Nov 2025; the portal is still live and a second form ID exists.
  **A 20-farmer Maharashtra pilot maps almost exactly onto Track 2's description.**
  Contact: `contact@aiaic.maharashtra.gov.in`.
- **MahaAgX** (`mahaagx.maharashtra.gov.in`) — Maharashtra's own agri-data exchange, **live today**
  with public OpenAPI docs at `/controlplane/apis` and `/dataplane/apis`. Materially shorter path
  than central UFSI. Caveat: the published terms offer *anonymised/aggregate* datasets — **nowhere is
  farmer-level registry data offered.** Don't architect on the assumption that it is.
- **mhfr.agristack.gov.in** — live. Your farmers can check their own Farmer ID status.
  Helpdesk **020 25712712** is a real number your field team can hand out. Free trust win.
- **MahaVISTAAR** (`vistaar.maharashtra.gov.in`) — the state's own Marathi voice+text AI advisory,
  whose login field is literally **शेतकरी आयडी**. Two signals: Farmer ID is already the de-facto
  credential for Maharashtra agri services (so asking for it reads as competence, not bureaucracy);
  and **the state occupies the generic-advisory surface for free.** AgriSync's defensible ground is
  farm *operations* — labour, logs, ledger — not advisory.
- **e-Peek Pahani** — the state crop-logging app that gates crop insurance. Only **55.69%** of Rabi
  registrations were completed by the extended deadline. That is quantified, real user pain adjacent
  to our crop-logging surface — and also "yet another app" fatigue we compete with. Worth an explicit
  decision: nudge toward it, or ignore it.

---

## 8. Labour law — the section the pasted brief missed, and it is good news

**The two statutes everyone cites are dead law.** The Code on Wages 2019 s.69(1) repealed the
Minimum Wages Act 1948 and the Payment of Wages Act 1936; the four Labour Codes came into force
**21 Nov 2025**. *(Checked: we cite neither anywhere in the repo — clean.)*

**Code on Wages s.50(4), verbatim:** the register, notice board and wage-slip duties
*"shall not apply in respect of the employer to the extent he employs **not more than five persons
for agriculture** or domestic purpose"* — with a proviso that he must, on demand, produce
*"reasonable proof of the payment of wages"*.

**So your typical smallholder owes no statutory wage register at all.**

Two consequences:
- **Never market AgriSync as "the wage register you are required to keep."** That claim is false for
  your core user and it invites an inspector to ask a farmer for something he does not owe. In the
  Marathi UI call it the farmer's own record (**तुमची नोंद**), never a statutory हजेरी रजिस्टर.
- **The accurate positioning is far stronger:** s.59 puts the **burden of proof on the employer** to
  show wages were paid, and the claim window is now **three years**. A farmer with no record loses a
  wage dispute by default. **AgriSync is defensive armour, not a confession.**

Product rules that follow:
- **Retention must be ≥5 years** from last entry (Code on Wages Central Rules 2026 permit electronic
  registers and require 5-year preservation) — not 3, and certainly not "until the cache clears".
- **Never compute or surface an "underpaid" flag**, never colour a row red, never transmit wage data
  to a government endpoint, never let a buyer/lender/FPO query it. Maharashtra Zone III agricultural
  minimums sit around ₹319–389/day and are revised **half-yearly** — any hardcoded rate is stale in
  six months, and telling a farmer he is committing an offence is a landmine either way.
  **Ship no minimum-wage comparison in the pilot.** Also: never hardcode ₹178 (the 2019 national
  floor) — it is roughly *half* the Maharashtra rate and presenting it would encourage underpayment.
- **Do NOT ship an "advance paid to worker" feature.** Maharashtra's sugarcane *uchal* is the textbook
  bonded-labour fact pattern under the Bonded Labour System (Abolition) Act 1976. An advance plus
  days-worked-against-advance is a clean, timestamped, farmer-authored record of exactly the
  arrangement that Act criminalises — in the one state where it is most notorious. There is genuine
  ambiguity (the new Form IV normalises advances), and it is fact-specific. **Lawyer before building.**
- **Keep the trust ledger strictly farmer-visible.** As a private mirror it is a UX feature. The
  moment a score is shared with a buyer, lender, insurer or scheme it becomes a decision-relevant
  profile — and if worker data feeds it, a derived output about people who never consented. No
  third-party read path, no partner export, no worker-level inputs. Preserves every option at zero cost.
- **Do not collect worker age or date of birth.** *(Checked: we currently don't — keep it that way.)*
  Under DPDP a "child" is anyone under 18, s.9 requires **verifiable parental consent** via a
  DigiLocker-grade check, and s.9(3) bans behavioural monitoring outright with **no consent cure** —
  which a trust-ledger/AI-observation layer arguably is. The Fourth Schedule exemptions were read in
  full: there is **no employment, agriculture or labour exemption.** The one adjacent permitted
  purpose is processing *solely to confirm someone is not a child* — so an 18+ attestation gate is
  expressly allowed. **Do not build an "is this worker a minor?" warning — that manufactures the very
  knowledge that creates the duty.**
- **Money features, cheapest first:** UPI deep-link (you never touch funds, no licence) → market
  linkage (needs an APMC trader licence) → insurance (IRDAI corporate agent, ~₹8,000) → credit (you
  are an LSP; your partner bank carries the liability and sets the pace) → **handling funds yourself
  (RBI payment aggregator: ₹15 crore net worth rising to ₹25 crore)**. Never let that last one arrive
  by accident because someone added a "pay worker" button.
- **Free app ≈ outside Consumer Protection "service"** (s.2(42) excludes free services) — but the
  **CCPA misleading-advertisement** jurisdiction attaches to *advertisements* regardless. A "increases
  yield 20%" claim on the marketing site must be substantiable on demand, and a 20-farmer pilot cannot
  substantiate a yield claim. Audit the marketing copy separately from the app.
- **Pesticide advice is not licensed** — Insecticides Rules licence *commerce* and *pest-control
  operation*, not advice. But s.3(k)/s.29 misbranding liability attaches to claims about a product.
  Safe scope: reproduce only label-approved dose for label-approved crop and pest, never invent an
  off-label dose, prefer generics to brands, route ambiguity to "consult your KVK or licensed dealer."
  **An AI that hallucinates a dose is not a licensing problem, it is a poisoning problem.**
- **No insurance is mandatory.** Professional indemnity and cyber liability are contract-driven, not
  legal requirements. Buy nothing now.

---

## 9. Needs an Indian lawyer — three items, in priority order

1. **Is AgriSync a Data Fiduciary for worker data, or merely the farmer's processor?** The farmer
   determines the purpose; AgriSync determines the means (app, AI models, storage, retention). The
   farmer can rely on DPDP s.7(i) — "purposes of employment" — with **no worker consent needed**. But
   **s.7(i) belongs to the employer and there is no "on behalf of" exemption that passes it to a
   vendor.** The moment AgriSync uses worker data for its own purposes — the trust ledger, scoring,
   analytics, AI training — it determines the purpose and becomes a Data Fiduciary in its own right,
   owing notice and obligations to people who never installed the app. **This shapes the data model,
   not just the paperwork.** It is the single question most worth paying for.
2. **The under-18 farm worker** — DPDP s.9 and the Child & Adolescent Labour Act 1986 (**not** repealed
   in Nov 2025) collide. A 15-year-old on a non-hazardous farm task is usually *lawful* labour, but
   recording him creates *child data* with no compliant consent path at pilot scale. The right answer
   — block outright vs. record-and-flag vs. farmer attestation — is a legal call driving a schema
   decision you cannot cheaply reverse.
3. **Bonded labour / the advance feature** (§8 above) before it is ever built.

Lower priority but worth the same hour: whether AgriSync is an "intermediary" under IT Act s.2(1)(w)
— it flips the moment any feature lets one user see another's data (FPO dashboard, sathi viewing a
farmer's logs), and brings a 24-hour acknowledgement / 15-day resolution SLA.

---

## 10. One thing to design now because it is expensive to retrofit

DPDP s.6(10) puts the **burden of proof on AgriSync** to show *which* notice a user saw, *when*, in
*which language*, and *what affirmative action* they took. That is a consent-receipt table with a
versioned notice hash — **cheap to add before farmer #1, painful to reconstruct for 20 farmers'
historical data in 2027.**

Also note s.5(2) grandfathering: everything collected between now and May 2027 stays lawfully
processable — you will **not** have to re-paper the pilot or delete anything. But on commencement you
owe every pilot farmer a **retrospective notice in Marathi**, itemising what you collected and why.
So keep a contactable channel (the mobile number suffices) and a truthful record of which fields you
actually collected — reconstructing that from a schema later is exactly the retro-fabrication the
doctrine forbids.

And Rule 8(3) sets a **one-year minimum retention floor that overrides a deletion request** — so
"delete my account" must mean deactivate-and-retain-one-year. **A hard-delete implementation would
itself be the non-compliance.** Check the delete paths before they ship.

---

## 11. Bottom line

| Question | Answer |
|---|---|
| Are we eligible for AgriStack? | **Yes** — no financial, size or age bar exists. Approval is discretionary with unpublished criteria. |
| Should we wait for it? | **No.** The sandbox T&C forbid using it for a real pilot, and no private agritech is publicly live on UFSI. |
| Does it force architecture changes now? | **No.** Three small things (village field, optional Farmer ID, one ADR) and one hard rule (never touch Aadhaar). |
| What legally blocks the pilot? | **Two artifacts**: a Marathi+English privacy policy on a public URL, and a named grievance officer. Plus three cheap CERT-In actions. |
| What actually blocks the pilot? | **Our own code** — §3. Days, not weeks. |
| Biggest risk nobody was tracking? | The app has **never been run end-to-end on this branch**, and we have **no way to see a farmer is stuck** (Sentry off in every APK; error reporting posts to a dead path; the admin "suffering" view will look reassuringly green and empty). |
