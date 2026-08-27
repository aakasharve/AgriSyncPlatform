# Decisions Before First Farmers — A Working Tool

**Date:** 2026-08-23 · **For:** founder · **Evidence behind every claim:**
[LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md](LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md)

How to use this: **Part 1** is the six facts that change what you'd decide. **Part 2** is every
decision, one card each, with what happens either way. **Part 3** is the order to do things in.
**Part 4** is what you are deliberately *not* deciding, and when each comes back.

Nothing here is legal advice. Part 5 lists the three things that need a real lawyer.

---

# PART 1 — Six facts that change your decisions

If you only read one page, read this one. Each of these makes a decision easier.

### Fact 1 — AgriStack can't be your gate, because it isn't allowed to be

You assumed it might block you. It can't. The government's own sandbox rules say the platform must
**not** be used for *"commercial deployment, accessing real farmer data."* The data in it is fake by
design. And the whole API only lets you **read** government records — there is **no way to put your
farm data into it, ever.**

**What this means:** AgriStack can, one day, help a farmer *sign up faster* by pulling his land
details. That's all it will ever do for you. It cannot hold your data and it cannot approve or block
your pilot.

**Decision impact:** removes AgriStack from your critical path entirely. Also removes it as an excuse.

---

### Fact 2 — You are eligible, and there is no money bar

I opened both government registration forms in a browser and listed every field. There is **no box**
for turnover, funding, net worth, company age, startup recognition, number of farmers, GST, or company
number. The only document is a photo ID under 2MB. It's free right now.

The one caveat: approval goes through a committee whose standards are **not published**. So "no
published bar" is not the same as "no bar" — someone could apply a standard you can't read in advance.

**Decision impact:** submitting costs nothing and commits you to nothing. So submit, and stop thinking
about it. Don't wait for it, and never write a dated AgriStack line into a plan or an investor deck.

---

### Fact 3 — The data-protection law does not apply to you yet

Everyone talks about DPDP as if it's live. The real calendar, from the government's own two
notifications:

| When | What starts |
|---|---|
| Nov 2025 | Just the definitions and the regulator's own setup |
| Nov 2026 | Registration for "Consent Managers" — **nothing for you** |
| **13 May 2027** | **Everything real** — consent, notices, security, breach reporting, all fines |

On top of that, the regulator **has no chairman and no members**. There is currently nobody who could
hear a case against you.

**What this means:** you have roughly **nine months**. Your enforcement risk for a 20-farmer pilot
starting now is **zero**.

**But** — the shape of what you build in the pilot is what you'll have to make legal in 2027. Two
things are cheap now and painful later: a record of *what consent each farmer gave and when*, and
deciding how you handle **worker** data.

---

### Fact 4 — Only two legal things bind you on day one, and they're small

Under the older 2011 rules (still alive until May 2027) you need exactly:

1. **A privacy policy on a public web page** — not a PDF, not behind a login.
2. **A named person as grievance officer**, contact published, who answers within a month.

That's the whole day-one list. Google Play needs the same privacy policy, so it's one job, not two.

One extra that almost nobody knows: if you're ever hacked, Indian rules require you to report it
**within 6 hours**. That's been law since 2022. Three cheap technical steps cover it.

---

### Fact 5 — On labour law, you were worried about the wrong thing

Two facts, both in your favour.

**First**, the laws everyone quotes — Minimum Wages Act 1948, Payment of Wages Act 1936 — were
**repealed** in November 2025. (We don't cite them anywhere, I checked.)

**Second, and this is the important one:** the new law says an employer of **five or fewer farm
workers owes no wage register, no notice board, no wage slip at all.** Your typical smallholder owes
nothing.

So **never sell AgriSync as "the register you're legally required to keep."** That's false for your
core user, and it invites an inspector to demand something the farmer doesn't owe.

The honest pitch is much stronger. The new law puts the **burden of proof on the employer** to show he
paid — and stretches a worker's claim window to **three years**. A farmer with no record **loses a wage
dispute automatically.**

> **AgriSync is armour, not a confession.** That's the line.

---

### Fact 6 — Your real risk isn't legal or governmental. It's that you can't see failure.

Two things nobody had checked:

- **The app has never been run end-to-end on this branch.** The automatic tests only run on the main
  branch; this one is 252 commits ahead. Everything anyone believes "works" is inference from reading
  code, not from watching it work.
- **You cannot tell when a farmer is stuck.** Crash reporting is switched off in every APK ever built.
  The error-reporting code sends to an address that never leaves the phone. And the admin screen that
  shows "which farmer is struggling" is fed by *that*. So **it will look empty and green** while
  farmers quietly stop opening the app.

**Decision impact:** this reframes the whole pilot. In a supervised pilot, being blind is worse than
being buggy — a bug you can see is a bug you can fix.

---

# PART 2 — The decisions

Each card: what it is · your options · what actually happens · what I'd do · cost · when it's due ·
can you change your mind later.

---

## 🔴 THIS WEEK — three decisions that gate everything else

### DECISION 1 — How do farmers log in?

**Why this exists:** login sends a code by SMS, and production is wired to a fake sender that writes
the code to a log file instead of texting it. Real SMS in India needs a government registration called
DLT that takes weeks.

| Option | What happens | Cost | Time |
|---|---|---|---|
| **A. Paper passwords** | You create 20 accounts, write each farmer's phone + password on a slip. Works **today**, code already in the app. | ₹0 | 1 hour |
| **B. WhatsApp code** | Farmer gets the code on WhatsApp. 250 free per day — that's ~12 logins per farmer per day. **No DLT needed.** Business verification not required to start. | ₹0 | 1–2 days setup |
| **C. Real SMS** | The "proper" way. Needs DLT: company paperwork, ~₹5,900 per operator, and your login code must be registered as a specific type — one marketing sentence in the template and it **stops reaching most rural numbers entirely**. | ~₹6,000–24,000 | **2–4 weeks** |

> **My recommendation: A now, B during the pilot, C never until you're past 100 farmers.**
> Paper slips sound crude but you are handing this app to twenty people you know, in person. The slip
> is *less* friction than a code that has to arrive. And it removes a three-week wait from your
> critical path for zero rupees.

**Reversible?** Completely. All three can coexist.

---

### DECISION 2 — Do we fix the five code problems before cutting the APK?

**Why this matters more than it sounds:** the Android app **bundles its code at build time.** Once a
farmer has the APK on his phone, **you cannot push him a fix.** Every one of these has to be right
before you hand out phones, or it stays wrong for the whole pilot.

| # | Problem | What the farmer experiences | Fix size |
|---|---|---|---|
| 1 | One network hiccup at app launch logs him out **permanently** and points the app at an empty database | Opens the app in a field on bad signal. Logged out. **His 40 days of records appear gone.** | ~20 lines |
| 2 | The server still shuts down nightly to save cost | Anyone opening the app in that window hits problem 1 → logged out for good | 1 command |
| 3 | Every new farmer sees a **fake identity** — name "Shetkari Raja", village "Nashik", 3 invented team members with fake phone numbers. And his farm's random code is **labelled as his ७/१२** | Opens the app, sees a stranger's name and someone else's village, and a wrong claim about **his land record** | ~2 hours |
| 4 | Every farmer is named **"User 4567"** and the app opens in **English** | A Marathi voice app that doesn't speak Marathi and doesn't know his name | 2 one-liners |
| 5 | Plots he creates never reach the server; logs against them **silently never sync** | He records work for weeks. Nothing saves. Nothing tells him. | 2–4 days *or* zero |

**On #5 there's a free way out:** enter the 20 farms' plots yourself on the server during onboarding,
and keep the "add plot" screen out of the pilot. One afternoon of typing replaces four days of code.

| Option | What happens |
|---|---|
| **A. Fix 1–4, work around 5** | ~1 day of code + one afternoon of data entry. Everything above is closed. |
| **B. Fix all five properly** | 3–5 days. Farmers can add their own plots and it survives a lost phone. |
| **C. Ship as-is** | Farmers get logged out one by one, see a stranger's name, and lose logs silently. |

> **My recommendation: A.** Items 1 and 2 are genuinely non-negotiable — without them farmers drop out
> of the pilot one at a time and blame the app, and you can't push a fix. Item 5's workaround is
> honestly better than the code for a 20-farmer pilot.

**Reversible?** Items 1–4, no — they must be right before the APK is cut. Item 5, yes.

---

### DECISION 3 — Exactly how many farmers?

**Why this exists:** two separate thresholds sit right at your number, and nobody had noticed.

- **Google's free "limited distribution" account covers up to 20 devices** with no government ID
  required. **21 farmers breaks it** and you need a full developer account.
- The labour-law exemption in Fact 5 applies to farmers with **five or fewer workers.** A farmer with
  eight workers has different (small) obligations, and it changes how you should describe the product
  to *him*.

| Option | What happens |
|---|---|
| **A. Exactly 20, each with ≤5 workers** | Every simplification in this document holds. Cleanest possible pilot. |
| **B. 20, mixed worker counts** | Fine — just never tell the bigger farmers it's their legal register. |
| **C. More than 20** | You need a full Play developer account ($25 + ID) — still easy, just don't discover it on the day. |

> **My recommendation: A or B.** Pick the twenty deliberately rather than letting the number drift.

**Reversible?** Yes, but going past 20 has a setup step you should do in advance, not on the day.

---

## 🟡 THIS MONTH — three decisions worth real thought

### DECISION 4 — Do we chase the Maharashtra grant?

**This is the biggest opportunity in the whole review, and it isn't AgriStack.**

Maharashtra runs its own **AI & AgriTech Innovation Centre (AIAIC)** under a **₹500 crore** state
policy. Its funding call has a **Track 2 "Pilot & Validation" of up to ₹2 crore**, for one crop season,
requiring a local partnership and on-the-ground implementation in Maharashtra.

Winners get money, **official permission to run a field pilot**, state data access, and introductions
to KVKs, FPOs and extension officers.

**Your 20-farmer Maharashtra pilot maps almost exactly onto how they describe Track 2.**

And the strategic point: the government's own statement says **data ownership sits with the States, not
Delhi.** Chasing a central approval is chasing the wrong signature.

| Option | What happens |
|---|---|
| **A. Contact AIAIC now, prepare for round 2** | Round 1 closed Nov 2025; the portal is still live and a second form exists. Costs a few hours. |
| **B. Ignore it and self-fund** | You keep full control and move faster, but leave ₹2 crore and official field-pilot cover on the table. |

> **My recommendation: A, but as a parallel track — never let it delay the pilot.** Contact
> `contact@aiaic.maharashtra.gov.in`. Being *mid-pilot* when you apply makes you a stronger applicant,
> not a weaker one.

**Reversible?** Yes. No downside to asking.

---

### DECISION 5 — Who is the named grievance officer?

**Why this exists:** the law needs a **real human's name** and contact published, answering within a
month. Google Play needs a "privacy point of contact" — the same person. It cannot be "support@".

| Option | What happens |
|---|---|
| **A. You** | Simplest, honest, and it's twenty farmers. Your name and a phone number on a web page. |
| **B. Someone else on the team** | Fine — but they must actually answer. |

> **My recommendation: A.** This is a formality at your size, but it must be a person, and it must be
> published before the first farmer logs in.

**Related and separate — nobody can currently reach you.** There is **no support number, no WhatsApp
link, no help contact anywhere in the app.** The only support string is an English pop-up pointing at
an email address. Whatever you decide here, put **a Marathi line with a phone number** in the app.

**Reversible?** Yes, easily changed later.

---

### DECISION 6 — Do we spend a few hours of a lawyer's time now?

Three questions genuinely need one. In priority order:

**1. When a farmer records his *worker's* name and wages — are you legally responsible for that
worker's data?**
The worker never installed your app and never agreed to anything. The law gives the *employer* an
exemption for employment records — but **that exemption belongs to the farmer, and there's no rule
that passes it to a supplier.** The moment you use worker data for **your own** purposes — the trust
ledger, scoring, analytics — you likely become responsible in your own right, owing notices to people
you've never met.

**This shapes the database, not just paperwork.** It's the one worth paying for.

**2. The under-18 farm worker.** A 15-year-old on a non-hazardous farm task is usually *lawful* labour.
But under the data law a "child" is anyone under 18, and recording him creates child data with no
workable consent path at your size. *(Good news: we don't collect worker age anywhere — I checked. Keep
it that way. And do **not** build an "is this worker a minor?" warning — that creates the very
knowledge that creates the duty.)*

**3. The "advance paid to worker" feature — before it's ever built.** In Maharashtra's sugarcane belt,
an advance worked off against days is the textbook bonded-labour pattern under a 1976 law. A
timestamped, farmer-written record of exactly that arrangement is not something to build casually.

| Option | What happens |
|---|---|
| **A. One session covering all three now** | A few hours of fees. Answers arrive before the pilot creates a worker dataset. |
| **B. Defer to after the pilot** | Zero enforcement risk for 20 farmers — but Q1 shapes the data model, so you may rebuild. |

> **My recommendation: A, but only question 1 is urgent.** Questions 2 and 3 are answered for now by
> *not building those features* — which is already my recommendation.

---

## 🟢 QUICK CALLS — low stakes, decide in a minute

| Decision | Recommendation | Why |
|---|---|---|
| **Submit the AgriStack sandbox form?** | **Yes, this week** | Free, commits nothing, starts a clock you don't control. Then forget it. |
| **Google Play: internal testing or production track?** | **Internal testing** | Skips the 12-testers-for-14-days rule *and* the Data Safety form entirely. 100 testers by email. Your `targetSdk` is already correct, so the 31 Aug deadline is met. |
| **Ask farmers for their Farmer ID?** | **Yes, optional field** | ~86% of Maharashtra holdings have one — highest in India. Free join key to future government rails. **Never mandatory**, never gate anything on it. |
| **Save the village we already collect?** | **Yes** | The signup wizard already asks for it and the server **throws it away**. Half a day. It's the one thing you can't recover later. |
| **Buy insurance?** | **No** | Neither professional indemnity nor cyber cover is legally required. Buy when a partner contract demands it. |
| **Store Aadhaar numbers?** | **Never. Write it down as a rule.** | This single rule keeps you permanently outside the expensive half of Indian identity regulation. Your pilot needs **zero** relationship with UIDAI. |
| **Turn off the nightly server shutdown?** | **Yes, before the pilot** | It's what turns a bad-signal moment into a permanent logout. *(I have not costed the monthly increase — worth checking, but it is small against losing a farmer.)* |

---

# PART 3 — The order to do things in

**Before the APK is cut** *(these cannot be fixed afterwards)*
1. Fix the permanent-logout bug (Decision 2, item 1)
2. Turn off the nightly shutdown (item 2)
3. Delete the fake identity and the false ७/१२ label (item 3)
4. Fix the name capture and default the app to Marathi (item 4)
5. Add a Marathi support phone number to the app (Decision 5)

**Before the first farmer logs in**
6. Publish the privacy policy — public page, Marathi + English, names you as grievance officer
7. Pick the login channel and set it up (Decision 1)
8. Enter the 20 farms' plots on the server (Decision 2, item 5 workaround)
9. **Run the app end-to-end yourself, on a real phone, on mobile data** (Fact 6)

**During week one of the pilot**
10. Turn crash reporting on so you can see failures (Fact 6)
11. Submit the AgriStack sandbox form
12. Contact AIAIC (Decision 4)

**Within the month**
13. The lawyer session (Decision 6)
14. Save the village field + add the optional Farmer ID field
15. Write the one ADR recording what we deliberately did *not* build

---

# PART 4 — What you are deliberately NOT doing, and when it comes back

Being explicit about this is the point — each of these is a thing someone will tell you is urgent.

| Deferred | Why it's safe to defer | When it returns |
|---|---|---|
| **DLT / real SMS** | WhatsApp or paper slips carry a 20-farmer pilot | When you outgrow 250 logins/day |
| **Incorporating a company** | Doesn't block the pilot — **but see the warning below** | Before you take money, or when a partner asks |
| **The full data-protection stack** | Not in force until May 2027; regulator has no members | **13 May 2027** — and you owe every pilot farmer a Marathi notice then |
| **AgriStack integration** | Forbidden for real pilots by its own rules | When onboarding friction becomes your bottleneck |
| **Anything Aadhaar** | Not needed, and expensive to touch | Ideally never |
| **Insurance** | Not legally required | First partner contract or term sheet |
| **Survey / gat numbers in the database** | At 20 farmers you can collect these **on a spreadsheet** for the cost of asking | At real integration time |
| **"Advance paid to worker"** | Legal minefield (Decision 6, Q3) | Only after a lawyer clears it |
| **Sharing the trust ledger with anyone** | Private, it's a feature. Shared, it becomes a profile of the farmer — and drags in the lending regulator | When you have a partner and a lawyer |
| **Minimum-wage comparison in the app** | Rates change every six months; showing one tells a farmer he's committing an offence | Probably never |

> ⚠️ **The one warning inside the "defer" column.** You are personally treated as a business under the
> IT Act **whether or not a company exists** — the definition explicitly includes a sole
> proprietorship. So staying unincorporated does **not** remove the obligations. It removes your
> personal **shield**. That's the real argument for incorporating — not compliance, but your own
> exposure if farmer data ever leaks. It's still not a pilot blocker.

---

# PART 5 — Three sentences to remember

1. **Nothing outside your control is blocking you.** Not AgriStack, not the data law, not the
   government. What's blocking you is about a week of fixing your own code.
2. **The most dangerous thing in this review isn't a rule — it's that you'd be flying blind.** Fix the
   ability to *see* a farmer struggling before you worry about anything on a government website.
3. **Your product is a farmer's proof that he paid his workers.** That's legally accurate, it's
   genuinely valuable, and it's a better story than "the register you must keep" — which isn't even
   true for the farmers you're building for.

---

*Every fact in this document traces to a primary source or a specific file and line number in the
repo. The evidence is in
[LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md](LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md).*
