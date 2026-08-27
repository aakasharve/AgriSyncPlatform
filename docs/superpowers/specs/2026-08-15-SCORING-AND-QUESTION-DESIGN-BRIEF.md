# Shram Sathi — how the number works, and how to design the questions

**For:** founder + agronomist, drafting the question set.
**Verified against the code on 2026-08-15.** Every number below is read from the source, not from a
document. Where a document disagreed with the code, the code won.

---

## 1. Why this exists at all

A voice log is a blob of speech. On its own the product can do nothing with it — it cannot recognise
a good day, reward consistency, compare two sprays, or ever give advice back.

The score turns speech into structure. It measures **one thing only**:

> Of the things this day *could* have told us, how many did the farmer actually tell us?

It is **not** a grade of his farming. A farmer who sprays perfectly but says three words scores low.
A farmer who does one small job and describes it fully scores high. That is deliberate — the number
measures the conversation, not the agriculture.

Its job is to give him a reason to say more, and to give the product enough structure to eventually
be useful back to him.

---

## 2. The buckets — what a day is made of

Everything a farmer says lands in one of these. Each bucket is a **field the day can owe**:

| Bucket | Plain meaning | Weight |
|---|---|---|
| **WHAT** | Which job did you do? (spray / irrigate / prune / fertilise…) | **20** |
| **DOSE** | How much product? | **20** |
| **CARRIER** | How much water — or how the water was delivered | **10** |
| **COST** | What it cost | **12** |
| **WEATHER** | What the weather was doing | **8** |
| **OBSERVATION** | What he *noticed* in the field | **15** |
| **LEARNING** | What he concluded or will try next | **15** — dormant today |

**SCOPE (which plot) was deliberately removed.** He taps the plot before he speaks, so asking him to
name it earns nothing. This is correct and should stay.

**LEARNING is currently dormant** — nothing in the product reliably produces that signal yet, so
leaving it live would cap every farmer below full marks before he opened the app.

---

## 3. How the /10 is calculated

Two rules, and they are the whole engine:

**Rule 1 — a bucket only counts if the day could have filled it.**
An irrigation day is never asked for a spray dose. The bucket is dropped from *both* sides of the
sum, so he is never marked down for not describing work he did not do.

**Rule 2 — the score is what he filled, divided by what the day owed.**

### Worked example A — "आज छाटणी केली" (I pruned today)

Pruning owes: WHAT 20 + COST 12 + WEATHER 8 + OBSERVATION 15 = **55 possible**
He filled: WHAT 20
**20 ÷ 55 = 36% → 4/10**

### Worked example B — "आज फवारणी केली" (I sprayed today)

A spray also owes DOSE (20) and CARRIER (10) → **85 possible**
He filled: WHAT 20
**20 ÷ 85 = 24% → 2/10**

**Same effort, lower number** — because a spray day has more to tell. This is the single most
important thing to understand about the design, and it is why the follow-up questions matter: the
spray farmer is *supposed* to be asked for dose and water.

### Worked example C — the same spray, fully told

WHAT 20 + DOSE 20 + CARRIER 10 + COST 12 = 62 ÷ 85 = 73% → **7/10**
Add a noticing remark (OBSERVATION 15) → 77 ÷ 85 = 91% → **9/10**

**The target of 9 cannot be reached without a noticing remark.** A farmer who describes his *work*
perfectly — product, dose, water, cost, weather — tops out at **8**. Only noticing something in the
field gets him to 9.

**Nothing in the app currently asks him what he noticed.** That is the biggest single gap in the
question set.

---

## 4. Richness — what kind of day it was

Separately from the /10, every day is classified into one of seven kinds. This is what drives
rewards and the streak.

| Day type | What it means | Shram points |
|---|---|---|
| **Rich work day** | He worked, described it well, **and** noticed something | **10** |
| **Basic work day** | He worked and logged it | **5** |
| **Learning day** | No work, but he concluded something or reported an experiment | 5 base |
| **Observation day** | No work, but he noticed something real | 3 base |
| **Declared no-work day** | He said "no work today, and here's why" | **2** |
| **Unaccounted day** | Something was saved but nothing could be read from it | **0** |
| **Pending reconciliation** | The date looked implausible; held for checking | — |

**Bonuses on top:** noticing **+3** · learning **+5** · following up on an earlier observation **+2**
**Daily cap: 15 points.**

**A day is "rich" only when all of this is true:** he worked · his execution buckets are at least
**60%** full · **and** he either noticed something, concluded something, or his insight buckets are
at least **50%** full.

So "rich" is not about working harder. It is about **working and noticing**.

---

## 5. The streak

- A day with **no log at all** is skipped entirely — silence never breaks a streak.
- A **declared no-work day advances** the streak. Honesty is rewarded, exactly as ruled.
- A **rest day is neutral** — it neither advances nor breaks.
- An **unaccounted day** is tolerated **once**. Two in a row breaks the streak.
- At **25 qualifying days**, the app considers itself to "know" the farm.

Note the label currently says **"सलग" (consecutive)** but the count is of *days that have a log*, not
consecutive calendar days. Log Monday and Saturday and it says "२ दिवस सलग". Generous, never
punitive — but the word claims more than the data. Worth deciding whether to change the word or the
rule.

---

## 6. What this means for designing the questions

This is the part that matters for your questionnaire.

### The two families you named — and they already exist in the code

**Family 1 — Gap-fill: "you told me this, now tell me the rest."**
Fires when a bucket the day *owed* was left empty. Directly raises the number.

**Family 2 — Context: "I noticed something, tell me about it."**
Fires from weather, the schedule, or his own earlier words. Builds the relationship and the record;
may or may not raise the number.

### Which gaps are worth asking about — ranked by what they earn

| Gap | Worth | When it should fire |
|---|---|---|
| **WHAT** | 20 | The day has no recognisable job. Always ask — the day is unreadable without it. |
| **DOSE** | 20 | A product was named but no quantity. **The most commonly skipped high-value field.** |
| **OBSERVATION** | 15 | **Nothing asks this today. It is the only route to 9/10.** |
| **COST** | 12 | Money was implied but not stated. |
| **CARRIER** | 10 | A spray or irrigation with no water quantity. |
| **WEATHER** | 8 | Often already known from the forecast — lowest value to ask. |

### Design principles that fall out of the arithmetic

1. **Never ask for the plot.** He tapped it. It earns nothing and reads as not listening.
2. **Ask DOSE and CARRIER together on a spray day.** They are 30 points and they always co-occur.
3. **Add a noticing question.** Without one, no farmer can reach the target the app shows him.
4. **One question per day.** More than one turns a ritual into a form.
5. **Ask the biggest gap first.** If both WHAT and WEATHER are missing, WHAT is worth 2.5×.
6. **A context question that earns nothing is still worth asking** — but the app must not promise
   the number will move. Say "मला अजून समजेल" (I'll understand more), not "आकडा वाढेल".

### The bifurcation to draft against

For each question you write, decide these five things:

| Field | Options |
|---|---|
| **Family** | Gap-fill · Context |
| **Fires when** | The precise condition — which bucket is empty, or what the app noticed |
| **Earns** | Which bucket it fills (or "nothing — conversation only") |
| **Frequency** | How many days before it may be asked again |
| **Safety** | Does the answer change what he *does* in the field? If yes → agronomist sign-off required |

That last row is the one that matters legally. A question that merely **asks** is safe. A question
that **advises** — "better to delay spraying in this wind" — needs a real agronomist behind it.

---

## 7. Where the current set stands

**Active and earning:** what · dose · carrier · cost · weather · plot *(to be dropped)* ·
why *(earns nothing)* · finished-or-not *(earns nothing)*

**Active, context:** crop stage · follow-up on an earlier observation · why do you think it happened ·
what will you try next

**Built but switched off** — all three are the context-rich weather ones:
rain coming before a spray · severe weather care-check · a planned task not logged

**Correctly blocked on safety:** "high wind — better to delay spraying"

**Missing entirely:** anything that asks him what he **noticed** in the field.
