# FOUNDER DECISIONS — Launch Cohort, Scope and the Owner's Loop

**Date:** 2026-08-14 · **Method:** structured brainstorm, one question at a time
**Status:** DECIDED. These are rulings, not proposals. An agent may not reopen them; it may only escalate if repository evidence proves one technically impossible.
**Supersedes:** the "Option A / constrained onboarding" framing in `../plans/2026-08-14-labour-lane-to-live-PLAN.md` §5. That assumed a labour-only launch. **It is withdrawn.**

---

## D1 · Who the first farmers are

**50–100 real farmers with large and medium land holdings, who already manage labour teams.**

The founder's framing, and it sets the bar for everything below:

> *"They are trust builders. By their validation our system will work in masses, so we should make it trustworthy enough."*

**This is a harder bar than a small pilot, not an easier one.** Their endorsement is the product's credibility. A wrong number in front of them does not lose data — it loses the validation the whole go-to-market depends on. A farmer who loses a season does not file a bug; he tells other farmers.

---

## D2 · Scope at launch: everything

**A full farm ledger.** Labour, expenses, income, harvest. Not a subset.

Rejected: a labour-only launch. A partial ledger invites *"come back when it's finished"* from exactly the growers whose respect is the point.

---

## D3 · Scope holds, the date moves

**Nothing reaches a farmer until it works.** Weeks, not this week.

Explicitly rejected: shipping everything now and accepting that some entries silently disappear. Also rejected: a staged reveal where farmers watch features arrive.

**Rationale:** harvest has no server-side existence at all — it is construction, not repair — so "everything" and "this week" could not both be true. Scope won.

---

## D4 · Only harvest sits behind "Coming soon"

Everything else — planned tasks, income, expense corrections, machinery, activity expenses — is **fixed and wired before launch.**

One honest "coming soon" screen for harvest. Nothing else hidden, because nothing else needs to be.

**Why this is affordable:** most of "everything" is wiring, not building.

| | State today | Size |
|---|---|---|
| Planned tasks | Commands exist on **both** sides; nothing calls them | **Days** — pure wiring |
| Income | The pipe exists; money reaches the server carrying no in/out flag, so income arrives as spending | **Days** |
| Expense corrections | Server rejects two unrecognised fields, so the whole correction bounces | **Days** — a fix |
| Machinery | Reaches the server flattened into text, returns as the wrong record type | ~a week |
| Activity expenses | Never sent. Same pattern as labour, which is now proven | ~a week |
| **Harvest** | **Genuinely absent.** The screen exists, the save button does nothing, the backend has no such type | **Weeks — construction** |

*(From the other lane's code audit — read, not yet demonstrated on a device.)*

---

## D5 · The product being validated is OVERSIGHT, not data entry

**Owner + mukadam + workers, on separate phones initially.**

The founder's words, and they reframe the product:

> *"Not every owner himself wants to test this app. He would test how he can control his farm by handing the app over to his mukadam or worker. That will build his trust — what he can SEE, and what clarity the app brings in his farm decisions."*

**So the loop being judged is: mukadam records → owner sees → owner approves or questions.**

**Consequence, and it re-ranks the entire defect list:** the audit found that **an owner's approval does not stick** — he approves in the Review Inbox, the server refuses the command, and the log returns as a draft. It was filed as one defect among fifty. Under D5 it is **the single most important thing on the list**, because it is the exact moment the owner tests whether he is really in control.

**Nothing in the owner's loop matters until that holds.**

---

## D6 · The owner's loop, as specified

1. **Everything the owner has not seen since he last opened the app** is surfaced for review.
2. A notification summarising **per person, per day** — *"Rokade has described 3 voice notes today"* — carrying a **one-line description of what was actually done**, not a count alone.
3. Tapping it opens the **Reflect page**.
4. From there, the **approval page**, where approval is needed.
5. In permissions, a customisation option for **who can approve logs** and **who can verify expenses** — **as separate grants.**

**What exists:** the Reflect page · the approval state machine · **one combined** permission grant (`can_manage_labour_records`, shipped 2026-08-13) · the Mukadam's ability to verify, restored this week.

**What does not exist:** any notion of "unseen since last visit" · the per-person per-day summary · the one-line description of what was done · **two separate grants** where there is currently one.

---

## D7 · The owner's loop is its own lane

**New branch, cut from `main` after `feat/labour-management-ui` merges. Not mixed into the labour branch.**

The founder has **UI changes** for this lane. They must be collected before design begins.

Brief already issued for a fresh session.

---

## D8 · Execution order

```
1  Fix the approval so it sticks        ← foundation; blocks the owner's loop
2  Wire the fast things                 planned tasks · income direction ·
                                        expense corrections
3  Fix the half-built                   machinery · activity expenses
4  Build the owner's oversight loop     unseen tracking · per-person daily
                                        summary · two separate grants
5  Build harvest                        behind "coming soon"
```

**4 outranks 5, deliberately.** An owner who can see and control his farm will wait for harvest. A finished harvest module will not rescue an app where his approval does not stick.

---

## D9 · Voice recordings are kept **forever**

**Not a retention window. A product privilege.**

> *"He can actually listen to everything that was spoken on that day, by whoever spoke."*

**This reverses the earlier 30-day ruling**, which was made believing the clips were encrypted. They are not.

**Three consequences, all binding:**

1. 🔴 **A working 30-day sweeper is deleting them right now.** It is the only retention policy in the client that actually functions, and it is destroying the feature. **It must be switched off before anything else in this area.**
2. **Encryption stops being optional.** The sealing code exists with **zero callers**, so every recording is plain, openable audio. Thirty days of that was a risk; forever is a permanently growing one.
3. **Cost is not a constraint.** Audio is properly compressed. Roughly 100 MB per farmer per year — about **a gigabyte per farmer per decade**, a rupee or two a year. *(Estimated from typical clip length and measured storage rates.)* **Photos remain 69× the problem.**

---

## D10 · Everyone's voice, forever, with consent captured at signup

**Including workers and mukadams, not only owners.**

**Consequence that must be built:** consent has to survive. The audit found GPS consent — a legal fact — stored in a **disposable cache that clears.** Voice consent would land in the same place. **If consent is what makes "keep forever" lawful, it cannot live somewhere that gets wiped.** This is a real work item, not a footnote.

---

## D11 · SMS / OTP — a dependency, not a gap

**India DLT registration is applied for, awaiting approval.** Nothing to build until it clears.

Correcting an earlier claim: `Msg91SmsSender` **is implemented**; production selects it, not the dev stub. The stale "prod SMS is a dev stub" note is withdrawn.

⚠️ **Still to verify against the live environment, not the repo:** `appsettings.Production.json` carries **no MSG91 section**, so the auth key and template must arrive from environment variables or Secrets Manager. That is the same pattern that silently produced an undocumented storage bucket. **Confirm before farmers arrive** — if OTP does not send, nobody gets past the login screen.

---

## Still open — small, and none blocks the plan

| | Question |
|---|---|
| **O1** | **Photo compression** — a day, own branch. Now that the date has moved it fits comfortably. Do it? |
| **O2** | **AI cost** — 50–100 farmers logging by voice daily is per-call billing with no economies of scale. It is the number that decides what a farmer costs to serve. Measure it? |
| **O3** | **Glacier at 365 days** — keep, lengthen or remove? A farmer comparing this season to last is the core use case, and 365 days is precisely the wrong boundary. |
| **O4** | **The data-export link** — reported as fabricated, unverified. A DPDP obligation. Trace it? |
| **O5** | **Chip contrast** — reserved by the founder for his own examination. Untouched. |
| **O6** | **The database credential** — the founder states he has ruled on this repeatedly. **The ruling was never recorded**, so project memory still carries it as an open P0 and every fresh session raises it again. **One line captured here would stop the loop permanently.** |

---

## Two safety items that are not decisions

- 🔴 **Two spray questions claim `agronomistApproved: true` and no agronomist reviewed them.** Advice about spraying in high wind and before rain. Flipping the flag is one boolean and should not wait for anything. Whether to obtain real agronomist review is a separate founder call.
- **An owner cannot remove anyone from his farm.** Only self-exit exists. Under **D5**, where the whole point is handing access to a mukadam, **the ability to withdraw that access is now clearly in scope.**

---

> **The bar these decisions set:** 50–100 respected growers hand this app to their mukadams and judge whether they can still see and control their own farms. Everything above serves that sentence.
