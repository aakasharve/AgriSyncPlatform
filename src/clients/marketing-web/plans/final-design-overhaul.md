# ShramSafal Marketing Site — Final Design Overhaul
**Date:** 2026-04-05  
**Audience:** Maharashtra farm owners, mukadams, family operators  
**Primary device:** Android phone (₹8K–15K), WhatsApp-first  
**Language:** Marathi-primary, English secondary

---

## The Story We Are Telling

ShramSafal is not a software product. It is a shift in how a farmer relates to his own day.

Every farmer in Maharashtra knows the weight of this moment: 9 PM, the field is quiet, the workers have left, and someone — a son, a wife, a banker — asks *"Papa, aaj kitna kharcha hua?"* And the farmer pauses. He worked 14 hours. He knows everything that happened. But he cannot recall the exact number. The mukadam has one figure, the notebook (if it wasn't rained on) has another, and the truth sits somewhere in between — invisible, untrusted, lost.

**This is the problem. Not technology. Not data. The disappearing day.**

ShramSafal gives that day back. Not through forms or spreadsheets. Through voice. You speak — in plain Marathi, the way you'd tell your wife what happened — and the phone catches it, structures it, and hands it back as a record that everyone can trust.

**The story arc:**
1. **The World** — Beautiful, hard, ancient. Dawn over the vineyard.
2. **The Pain** — The day that disappears. The argument that shouldn't happen.
3. **The Turn** — What if speaking was enough?
4. **The How** — 3 steps. Speak. Phone catches. Record sorts.
5. **The Proof** — What it looks like. What it earns. What others said.
6. **The Invitation** — Join early. Your voice shapes this.

---

## New Section Order (12 Chapters)

| Render # | Section | Chapter Mark | Theme |
|---|---|---|---|
| 1 | CinematicScrollHero | (no chapter mark) | Dark, atmospheric, pre-dawn |
| 2 | HeroSection | Ch.01 · शेत / The Field | Dark-to-warm photo blend |
| 3 | ProblemHitSection | Ch.02 · वेदना / The Pain | Pain cards on warm bg |
| 4 | BeforeAfterSection | Ch.03 · बदल / Before & After | Split reveal |
| 5 | WorkflowSection | Ch.04 · बोला आणि नोंद / Speak & Sort | 3-step process |
| 6 | ClaritySection | Ch.05 · तुम्हाला काय दिसेल / What You See | Phone mockup |
| 7 | ValueLadderSection | Ch.06 · ९० दिवसाचे फळ / 90-Day Return | Progression cards |
| 8 | **NEW FAQSection** | Ch.07 · तुमचे प्रश्न / Your Questions | Accordion (replaces 5 QA sections) |
| 9 | TrustSection | Ch.08 · विश्वास / Trust | Testimonials + counters |
| 10 | IdentityShiftSection | Ch.09 · बदल / Identity Shift | 4-state character arc |
| 11 | LegacySection | Ch.10 · वारसा / Legacy | Emotional peak |
| 12 | ParticipationSection | Ch.11 · तुमचा भाग / Your Part | The invitation |
| 13 | CtaSection | Ch.12 · सुरुवात / Begin | Dark soil close |

---

## Critical Design Decisions

### 1. Hero Image Integration — Dark Forest Merge

**Problem:** The hero farmer photo fades to white/light clay on the right. The cinematic scroll ends at `#0F1A10` (dark forest). The seam is jarring.

**Solution — "Dark Earth Bleeding Into Day":**
The photo edge blends through the exact dark tones from the cinematic scroll (`#0F1A10 → #1A2B17`) and *then* warms into Kachi Mati. The visitor's eye follows a continuous journey from pre-dawn darkness into the light of the farm day.

```css
/* Desktop: photo bleeds through dark forest into warm earth */
.hero-cont__photo-edge {
  background:
    linear-gradient(
      to right,
      transparent 30%,
      rgba(15,26,16,0.35) 50%,
      rgba(26,43,23,0.68) 65%,
      var(--bg-base) 86%
    ),
    linear-gradient(to bottom, #0F1A10 0%, rgba(15,26,16,0.55) 16%, transparent 34%);
}

/* Mobile: top seam flows down through dark into warm */
.hero-cont__photo-edge--mobile {
  background:
    linear-gradient(
      to bottom,
      #0F1A10 0%,
      rgba(15,26,16,0.75) 10%,
      rgba(26,43,23,0.38) 34%,
      transparent 58%,
      var(--bg-base) 86%
    );
}
```

**Visual metaphor:** Dawn breaking over the farm. The darkness of the pre-dawn world gradually warms into the golden light of Kachi Mati (raw earth).

### 2. FAQ Consolidation — From Wall to Accordion

**Problem:** 5 GuidedQuestion cards + 5 identical QASection components = 10 section-equivalents of repetitive content that kills reading momentum.

**Solution — Single `FAQSection.astro` with `<details>` accordion:**
- One section, Chapter 07
- 5 accordion items using HTML `<details>/<summary>` (zero JS, fully accessible)
- Questions as summaries, full answers expand inline
- Visual design: staggered ochre/green accents, not the off-palette purple/blue Tailwind colors

**Benefits:**
- Reduces 10 structural sections to 1
- `<details>` is keyboard accessible by default
- CSS-only, no bundle impact
- Narrative momentum preserved: questions answered, reader continues forward

### 3. Storytelling Principles Applied

**Hook per section — what makes you keep reading:**

| Section | Hook (what the reader feels) |
|---|---|
| CinematicHero | *I've seen this field. I know this silence.* |
| Hero | *Someone finally understands my problem.* |
| Problem | *Yes. Exactly. This is what happens every day.* |
| BeforeAfter | *Wait — this could actually be different?* |
| Workflow | *This simple? Even I can do this.* |
| Clarity | *This is what I would see? This is clear.* |
| ValueLadder | *90 days and I already earn back more?* |
| FAQ | *I had that exact question.* |
| Trust | *Real people like me said this.* |
| IdentityShift | *I want to be that fourth version.* |
| Legacy | *This is what I'm building for my children.* |
| Participation | *I want to be part of building this.* |
| CTA | *OK. I'm joining.* |

### 4. Visual Consistency — Palette Enforcement

All accent colors must come ONLY from the Kachi Mati token system:
- `var(--brand)` = forest green `#14532D`
- `var(--brand-fresh)` = field green `#16A34A`
- `var(--gold)` = terracotta `#92400E`
- `var(--gold-warm)` = ochre `#D97706`

**Banned:** `purple-*`, `blue-*`, `violet-*`, `red-*` (Tailwind generic colors)  
**Allowed:** `brand-fresh` (green), `gold-warm` (amber), `gold` (terracotta)

The GuidedQuestion cards previously used 5 different Tailwind colors (red, amber, blue, purple, emerald). Replaced with 2-color alternation: brand-fresh and gold-warm.

### 5. CTA Flow — Every CTA Points to Waitlist

**Problem:** Both hero CTAs (primary + secondary) and the sticky mobile CTA linked to `#guided-questions` (the FAQ section), not to the waitlist.

**Solution:**
- Hero primary CTA → `#cta` ("Join early access" / "लवकर सहभागी व्हा")
- Hero secondary CTA → `#problem-hit` ("See the problem" / "अडचण बघा")
- Sticky mobile CTA → `#cta`

---

## Images Status

All images already exist. No new generation needed for the redesign.

| Image | Used In | Status |
|---|---|---|
| `hero-observing-farmer.png` | HeroSection | ✓ Exists |
| `problem-burdened-farmer.png` | ProblemHitSection | ✓ Exists |
| `before-chaos-farmer.png` | BeforeAfterReveal | ✓ Exists |
| `after-clarity-farmer.png` | BeforeAfterReveal | ✓ Exists |
| `workflow-speaking-farmer.png` | WorkflowSection | ✓ Exists |
| `participation-ground-truth.png` | ParticipationSection | ✓ Exists |
| `identity-state-0{1-4}-*.png` | IdentityShiftSection | ✓ Exists (4 files) |

**If we want to add:** A single "farm family at dusk" photo for LegacySection would elevate the emotional peak. Currently it uses crop silhouette SVGs + sparrow animations, which is poetic but less human.

---

## Changes Checklist

### Structure
- [x] New section order in both `pages/en/index.astro` and `pages/mr/index.astro`
- [x] Chapter numbers sequential 01-12 across all sections
- [x] Remove 5 separate QASection renders + GuidedQuestionsSection
- [x] Add new consolidated FAQSection

### Visual
- [x] HeroSection photo edge: dark forest merge (not white fade)
- [x] HeroSection headline `line-height: 0.97` → `clamp` with safe Devanagari floor
- [x] Off-palette colors in GuidedQuestions → brand/gold tokens
- [x] `border-l-brand-blue` (broken token) → `border-l-[var(--brand)]`
- [x] ValueLadder third card `1` → `1yr`
- [x] ClaritySection phone screen: bilingual content

### Copy / UX
- [x] Hero primary CTA → `#cta`
- [x] Sticky mobile CTA → `#cta`
- [x] "Soon live" → "Coming soon"
- [x] IdentityShift alt text → descriptive

### Technical
- [x] `tokens.css` duplicate lines 26-28 removed
- [x] Footer `showFooterCopy: true` + `min-h-[70vh]` → `min-h-[24vh]`

---

## Execution Order (Code)

1. `tokens.css` — duplicate fix (2 lines deleted)
2. `HeroSection.astro` — photo blend + line-height + CTA targets
3. `FAQSection.astro` — NEW component (accordion, replaces 5 sections + GuidedQuestions)
4. All section files — chapter numbers only (ProblemHit, BeforeAfter, Workflow, Clarity, ValueLadder, Trust, Identity, Legacy, Participation, CTA)
5. `CtaSection.astro` — "Coming soon" badge fix
6. `ValueLadderSection.astro` — "1yr" fix
7. `Footer.astro` — enable content + height fix
8. `pages/en/index.astro` + `pages/mr/index.astro` — new order
