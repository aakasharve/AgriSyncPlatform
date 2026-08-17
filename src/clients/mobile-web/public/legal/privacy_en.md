<!-- spec: dfes-companion-2026-07-11 (wave-4.3) -->
<!-- LEGAL_REVIEW_PENDING: ENTIRE FILE — founder-authored, not counsel-reviewed. -->
<!--
  HOW THIS DOCUMENT WAS WRITTEN, and the rule for editing it.

  Every factual claim below was read out of the code before it was written down, not
  copied from a plan or a template. Where the code does something the company would
  rather it did not — an erasure request that does not reach the raw voice files, a
  consent toggle whose "off" does not delete what is already saved — this document says
  so. That is the whole point of a founder-authored privacy notice: counsel can write
  the law, but only the engineer can say what the software actually does.

  So when you edit this file: change the CODE first, verify it, then change the words.
  Never the other way round.

  The retention numbers here come from src/domain/privacy/RetentionPolicy.ts and a test
  (features/legal/__tests__/legalDocuments.test.ts) fails if they stop matching.
-->

# Privacy Notice — Shram Safal

**Version `privacy-2026-08-17.1` · in force from 17 August 2026**

> **This is a founder-authored draft. It has not been reviewed by a lawyer.**
> It is published so that nobody is asked to accept a document that does not exist. It
> describes what the software actually does today. It does not claim compliance with the
> Digital Personal Data Protection Act 2023 or any other law, and it will be replaced by
> a counsel-reviewed version before that claim is ever made.

---

## 1. Who we are

**Shram Safal** is the app you use. **AgriSync** is the platform it runs on. Both are
built and operated by:

**Agriryot Value Enterprises Private Limited** ("ARVE", "we", "us")
Corporate Identity Number (CIN): **U62099PN2026PTC256337**
Registered office: H. No. 2992, Near Indira Gandhi Bhaji Market, Pandharpur,
Dist. Solapur, Maharashtra – 413304, India
Incorporated: 1 June 2026

**Privacy contact:** arvesystems@gmail.com

We are being straight with you about that last line: it is a personal email address, not
a company one. A company mailbox is owed and is not yet set up. Until it is, mail sent to
the address above does reach us — which is why it is printed here rather than an address
that would bounce.

---

## 2. What we collect, and why

Everything in this table is collected because the app cannot do the job without it. Each
row is one of the five things the first-open notice showed you before you agreed.

| What | Specifically | Why |
|---|---|---|
| **Your account** | Mobile number, your name, account and session details | To sign you in by OTP, to keep your account yours, and to detect misuse |
| **Your farm work** | Farms, plots, crops, work done, labour, costs, income, your team | To turn what you tell us into a day's record and show you clear totals |
| **Voice and uploads** | What you speak, type, photograph or upload | To understand the work you describe and file it in the right place. The microphone runs only when you start it |
| **Farm location** | Your farm's location or drawn boundary | To fetch weather for that field. Your phone is not continuously tracked |
| **Technical information** | Device, app version, sync state, security signals | To hold your work safely while you are offline, sync it later, and detect misuse |

### 2a. The people who work on your farm

This one is not on the first-open screen, and it is the most important paragraph in this
document, so it gets its own section.

When you speak or type a day's work, the app **reads your workers' and mukadams' names
out of what you said and stores them**, together with which farm they worked on, how many
times they have worked, what was agreed and what was paid. It does this automatically —
you do not have to type a name into a form for it to be saved.

Those workers are not the people who agreed to this notice. **You did.** We have made two
choices about that:

- A worker's record **cannot leave the farm it belongs to** without a further check. This
  is enforced in code and it fails closed — if the check cannot be satisfied, the record
  is refused rather than shared.
- We ask every farmer, face to face during onboarding, to **tell his workers that their
  names go into the app.** We cannot do that for you. Please do it.

Whether a farmer can lawfully provide his workers' details at all is a question for a
lawyer, and it is open. We are not going to pretend it is settled.

---

## 3. What we will not do

- **We will not sell your personal data.**
- **We will not use it for advertising** without separate permission.
- **We will not use your voice to train AI models.** Not with permission, not without —
  this one has no exception, and it says the same thing in Marathi and in English. (See
  §7 for what the software can and cannot do here.)
- **We will not make lending, insurance or market decisions from your data** — that would
  need separate, specific consent that we have not asked for.

---

## 4. Who else handles your information

These are the outside companies the app actually calls. This is the complete list as of
17 August 2026, taken from the code, not from a supplier register.

| Company | What it receives | Where |
|---|---|---|
| **Amazon Web Services (AWS)** | Hosting, the database, your uploaded files, encryption keys | Mumbai, India (`ap-south-1`) |
| **Sarvam AI** | Your voice recording, for Marathi speech-to-text and language understanding | India |
| **Google (Gemini API)** | Your transcript, and **on the fallback path the voice recording itself**, to turn it into a structured record | **Outside India — see §5** |
| **Tomorrow.io** | Your farm's coordinates, to return that field's weather | Outside India (United States) |
| **MSG91** | Your mobile number, to send your login OTP by SMS | India |
| **Google Maps Platform** | Your device's network address and the map area you are viewing, when you draw a farm boundary | Google's network |
| **Google Fonts** | Your device's network address, each time the app loads its typefaces | Google's network |

We do not yet hold signed data-processing contracts with any of them. That paperwork is
owed and is being chased; we are telling you rather than implying it is done.

---

## 5. Your voice may be processed outside India

Most of what we hold sits on servers in Mumbai. Two things do not:

- **Speech understanding.** When the main Indian speech service cannot handle a
  recording, the app sends **the recording itself** to Google's Gemini API to be
  understood. Google decides where that runs; our own register records the United States.
  Only text comes back to us.
- **Weather.** Your farm's coordinates go to Tomorrow.io, a United States company, to get
  that field's forecast.

We are not able to tell you what Google or Tomorrow.io do with what they receive beyond
what their own terms say. We can only tell you what we send, and that is what §4 does.

---

## 6. How long we keep things

Version `retention-2026-08-17.1`.

| What | How long |
|---|---|
| **Voice recording on your phone**, while it is being turned into a record | Deleted automatically **30 days** after you record it |
| **Voice recording kept on our servers** as the evidence behind a saved record | **No automatic deletion date.** Kept while your account is open. Deleted when you ask us to |
| **Voice Diary recordings** — only if you switched "keep my recordings" on | Kept while that setting is on and your account is open. Deleted automatically when you ask us to erase your data |
| **Farm work records** — logs, labour, costs | Kept while your account is open. If you ask us to erase your data, your name and personal notes are removed and the farm figures are kept **without you attached to them** |
| **Database backups** | Up to **607 days** (about 20 months), then deleted automatically |
| **Consent and audit records** | Kept for the life of the service. These record what you were shown and what you agreed to — they are your proof, and the app is technically prevented from editing or deleting them |

**Three honest notes on that table**, because a retention promise nothing performs is
worse than none:

1. The **no automatic deletion date** on server-held voice recordings is a deliberate
   decision, not an oversight. There is no timer on those files today, and deleting them
   is something a person at ARVE does when you ask.
2. Switching the optional **"keep my recordings"** setting **off stops new recordings
   being saved, but does not yet delete the ones already saved.** To have those removed,
   ask us to erase your data.
3. An erasure request today removes your account, your voice diary and your personal
   details, and anonymises your farm records. It does **not** currently reach the raw
   voice files described in row two — those are removed by hand. We would rather write
   that down than let you assume otherwise.

---

## 7. Artificial intelligence, plainly

- Your voice is **converted to text and structured into a record**. That is the whole job.
- **No AI model is trained on your voice or your words.** There is no switch in the app
  that lets you turn that on, and the two background jobs in the code that could ever
  build a training set are switched off and are not enabled in production.
- The app **does not invent numbers.** If a quantity, a rate or a wage appears in your
  records, it is because you said it or typed it. Where the app is unsure, it asks you.
- Anything the app suggests is a **suggestion**. You confirm it. A record you have not
  confirmed is shown to you as unconfirmed.

---

## 8. Your rights

From **Settings → Data & Privacy** you can:

- Review or withdraw the permissions you gave.
- Access, correct or download your information.
- Request deletion of your account and your data.
- Raise a grievance with us, or nominate someone to exercise these rights for you.

Withdrawing essential consent may disable some or all of the app. It does not undo
processing already lawfully done, and some information may have to be kept where the law
requires it.

If we do not resolve your grievance, you have the right to complain to the
**Data Protection Board of India.** We deliberately do not print an address or a form for
the Board here, because we have not verified one — the Board publishes its own procedure,
and sending you to an invented channel would be worse than sending you to none.

---

## 9. Children

**Shram Safal is not for anyone under 18.** You confirmed you were 18 or older before you
could continue, and we record that confirmation with your consent. We do not knowingly
collect information from anyone under 18. If you believe someone under 18 is using the
app, write to us at the address in §1 and we will close the account.

---

## 10. Security

- Voice recordings are **encrypted on your phone** before they are written to storage, and
  the key is held per-tenant rather than in the app.
- Your data sits behind row-level database rules that scope every read to your own farm
  and your own account.
- Consent records are **append-only by database privilege** — the application role is
  physically prevented from rewriting them.

No system is perfect and we are not going to tell you one is.

---

## 11. Changes

If this notice changes materially, the version string at the top changes with it and the
app asks you again. A version you never saw is never recorded against your name.

**Questions:** arvesystems@gmail.com
