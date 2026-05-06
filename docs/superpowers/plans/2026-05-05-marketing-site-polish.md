# Marketing Site Polish — Full Redesign Pass (Option C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the ShramSafal marketing site by normalizing the color token system, unifying animation authority under GSAP, reducing page structure from 12 to 9 sections, simplifying the hero, adding connective scroll motion, a mobile sticky CTA, and purging dead code.

**Architecture:** Single GSAP animation authority (no competing CSS scroll transitions); all greens route through `--brand-fresh` / `--brand` tokens; 9-section narrative with consistent soil-stratum dividers; new `StickyCta` island for mobile conversion.

**Tech Stack:** Astro 4, React 19, GSAP 3, Tailwind CSS, TypeScript

**Spec:** `docs/superpowers/specs/2026-05-05-marketing-site-polish-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/clients/marketing-web/src/styles/tokens.css` | Add 2 new opacity tokens |
| `src/clients/marketing-web/src/styles/global.css` | Remove `.scene-hidden/.scene-visible`, fix all off-token greens, remove 5 dead blocks, add stratum colors |
| `src/clients/marketing-web/src/scripts/scrollAnimations.ts` | Delete `initSceneVisibility` + `initHeroPin`, add `initSectionHandoff`, calibrate scrub |
| `src/clients/marketing-web/src/components/sections/HeroSection.astro` | Remove grain div, badges, APK CTA, fix glow, remove `will-change` on static elements |
| `src/clients/marketing-web/src/components/islands/WindCanvas.tsx` | Add Page Visibility API guard |
| `src/clients/marketing-web/src/components/sections/WorkflowSection.astro` | Embed Clarity pull-quote |
| `src/clients/marketing-web/src/components/sections/LegacySection.astro` | Embed IdentityShift pull-quote |
| `src/clients/marketing-web/src/components/sections/CtaSection.astro` | Ch.09, embed 4-item FAQ accordion, add APK link, fix off-token green |
| `src/clients/marketing-web/src/components/islands/PloughNav.tsx` | 9-item SECTIONS, token-aligned colors |
| `src/clients/marketing-web/src/components/islands/StickyCta.tsx` | **New file** |
| `src/clients/marketing-web/src/layouts/BaseLayout.astro` | Remove DM Serif Display font, add `<StickyCta>` |
| `src/clients/marketing-web/src/pages/en/index.astro` | Remove 3 sections, replace bag dividers with soil-stratum |
| `src/clients/marketing-web/src/pages/mr/index.astro` | Same as en/index.astro |
| Dead island files (5) | Delete |

---

### Task 1: Add two opacity tokens to `tokens.css`

**Files:**
- Modify: `src/clients/marketing-web/src/styles/tokens.css`

- [ ] **Step 1: Add the two new tokens after `--brand-fresh`**

Open `src/clients/marketing-web/src/styles/tokens.css`. After line `--brand-hover: #0F3D22; /* deep canopy */`, add:

```css
  /* ── Brand green opacity scale (for subtle bg/border tints) ── */
  --brand-fresh-10: rgba(22, 163, 74, 0.10);
  --brand-fresh-15: rgba(22, 163, 74, 0.15);
```

The `/* ── Brand greens ── */` block should now read:

```css
  /* ── Brand greens ── */
  --brand:           #14532D;   /* forest canopy  */
  --brand-fresh:     #16A34A;   /* field green    */
  --brand-hover:     #0F3D22;   /* deep canopy    */

  /* ── Brand green opacity scale (for subtle bg/border tints) ── */
  --brand-fresh-10: rgba(22, 163, 74, 0.10);
  --brand-fresh-15: rgba(22, 163, 74, 0.15);
```

- [ ] **Step 2: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/styles/tokens.css
git commit -m "feat(marketing): add brand-fresh-10/15 opacity tokens"
```

---

### Task 2: `global.css` — remove competing CSS transitions, fix off-token greens, add stratum colors, remove dead blocks

**Files:**
- Modify: `src/clients/marketing-web/src/styles/global.css`

This task has many small find-and-replace edits within one file. Work top to bottom through the file.

- [ ] **Step 1: Remove `.scene-hidden` and `.scene-visible` animation blocks**

Find and delete the entire block (approximately lines 125-135):
```css
/* Scene reveal animations */
.scene-hidden {
  opacity: 0;
  transform: translateY(40px);
}

.scene-visible {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.8s var(--ease-out-expo), transform 0.8s var(--ease-out-expo);
}
```

Replace with nothing. GSAP (via `initSectionHandoff`) sets the `.scene-visible` class; child CSS rules that depend on `.scene-visible` still work because the class is still toggled by JS.

- [ ] **Step 2: Add stratum band colors to `.soil-stratum` block**

Find:
```css
.soil-stratum::before,
.soil-stratum::after,
.soil-stratum > span {
  display: block;
  height: 2px;
}
```

Replace with:
```css
.soil-stratum::before,
.soil-stratum::after,
.soil-stratum > span {
  display: block;
  height: 2px;
}

.soil-stratum::before { background: var(--stratum-top);  }
.soil-stratum > span  { background: var(--stratum-mid);  }
.soil-stratum::after  { background: var(--stratum-deep); }
```

- [ ] **Step 3: Fix `.glow-green` off-token green**

Find:
```css
.glow-green {
  background: radial-gradient(ellipse at center, rgba(5, 150, 105, 0.15) 0%, rgba(5, 150, 105, 0.05) 40%, transparent 70%);
}
```

Replace with:
```css
.glow-green {
  background: radial-gradient(ellipse at center, rgba(22,163,74,0.15) 0%, rgba(22,163,74,0.05) 40%, transparent 70%);
}
```

- [ ] **Step 4: Fix `.mic-3d` off-token greens**

Find:
```css
.mic-3d {
  background: linear-gradient(145deg, #10B981 0%, #059669 50%, #047857 100%);
  box-shadow:
    0 4px 6px rgba(5, 150, 105, 0.35),
    0 8px 20px rgba(5, 150, 105, 0.25),
    0 2px 4px rgba(0, 0, 0, 0.12),
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.mic-3d:hover {
  transform: translateY(-1px);
  box-shadow:
    0 6px 10px rgba(5, 150, 105, 0.4),
    0 12px 28px rgba(5, 150, 105, 0.3),
    0 3px 6px rgba(0, 0, 0, 0.15),
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.1);
}
```

Replace with:
```css
.mic-3d {
  background: linear-gradient(145deg, var(--brand-fresh) 0%, var(--brand) 50%, #0F3D22 100%);
  box-shadow:
    0 4px 6px rgba(22,163,74,0.35),
    0 8px 20px rgba(22,163,74,0.25),
    0 2px 4px rgba(0, 0, 0, 0.12),
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.mic-3d:hover {
  transform: translateY(-1px);
  box-shadow:
    0 6px 10px rgba(22,163,74,0.4),
    0 12px 28px rgba(22,163,74,0.3),
    0 3px 6px rgba(0, 0, 0, 0.15),
    inset 0 2px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.1);
}
```

- [ ] **Step 5: Fix `.card-hover-glow` off-token green**

Find:
```css
.card-hover-glow:hover {
  box-shadow: 0 0 20px rgba(5, 150, 105, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06);
}
```

Replace with:
```css
.card-hover-glow:hover {
  box-shadow: 0 0 20px var(--brand-fresh-10), 0 4px 12px rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 6: Remove dead `.bento-grid` and `.bento-card` blocks**

Find and delete the entire block:
```css
/* ── Bento card grid ── */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.bento-card {
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(5, 150, 105, 0.12);
  border-radius: 20px;
  padding: 1.75rem;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8);
  transition: transform 0.3s var(--ease-out-expo), box-shadow 0.3s ease;
  will-change: transform;
}

.bento-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px rgba(5,150,105,0.1), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8);
}
```

- [ ] **Step 7: Fix `.shimmer` off-token green**

Find:
```css
.shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(5,150,105,0.08) 50%, transparent 100%);
```

Replace with:
```css
.shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(22,163,74,0.08) 50%, transparent 100%);
```

- [ ] **Step 8: Fix `#cursor-glow` off-token green**

Find:
```css
#cursor-glow {
  position: fixed;
  width: 320px;
  height: 320px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(5,150,105,0.06) 0%, transparent 70%);
```

Replace `rgba(5,150,105,0.06)` with `rgba(22,163,74,0.06)`:
```css
#cursor-glow {
  position: fixed;
  width: 320px;
  height: 320px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(22,163,74,0.06) 0%, transparent 70%);
```

- [ ] **Step 9: Fix `.crop-bar` off-token greens**

Find:
```css
.crop-bar {
  width: 0%;
  height: 100%;
  background: linear-gradient(180deg, #10B981 0%, #059669 60%, #064E3B 100%);
```

And the `::after`:
```css
.crop-bar::after {
  ...
  background: #10B981;
```

Replace with:
```css
.crop-bar {
  width: 0%;
  height: 100%;
  background: linear-gradient(180deg, var(--brand-fresh) 0%, var(--brand) 60%, #0F3D22 100%);
```

```css
.crop-bar::after {
  ...
  background: var(--brand-fresh);
```

- [ ] **Step 10: Fix `.input-glow` off-token green**

Find:
```css
.input-glow:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(16,185,129,0.25), 0 0 20px rgba(16,185,129,0.15);
}
```

Replace with:
```css
.input-glow:focus {
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-fresh-15), 0 0 20px var(--brand-fresh-10);
}
```

- [ ] **Step 11: Fix `.green-particle` off-token green**

Find:
```css
.green-particle {
  background: rgba(5, 150, 105, 0.35);
  box-shadow: 0 0 6px rgba(5, 150, 105, 0.2);
}
```

Replace with:
```css
.green-particle {
  background: rgba(22,163,74,0.35);
  box-shadow: 0 0 6px rgba(22,163,74,0.2);
}
```

- [ ] **Step 12: Remove dead `#bullock-wheel` CSS block**

Find and delete:
```css
/* ── Bullock cart wheel (top-right corner) ── */
#bullock-wheel {
  position: fixed;
  top: 0;
  right: 0;
  width: 120px;
  height: 120px;
  transform: translate(40%, -40%);
  z-index: 3;
  pointer-events: none;
  opacity: 0.6;
  display: none;
}

@media (min-width: 1024px) {
  #bullock-wheel { display: block; }
}

#bullock-wheel img {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 13: Search for and remove remaining dead blocks**

Grep for each of the following selectors. If found, delete the entire CSS block:

```bash
grep -n "#audio-toggle\|\.section-page\|body\[data-festival\]" \
  "src/clients/marketing-web/src/styles/global.css"
```

Delete any blocks found for: `#audio-toggle`, `.section-page`, `.section-page-edge`, `body[data-festival]`.

- [ ] **Step 14: Verify build passes with no TypeScript errors**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

Expected: exits 0, no red errors.

- [ ] **Step 15: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/styles/global.css
git commit -m "feat(marketing): remove competing CSS transitions, normalize green tokens, purge dead blocks"
```

---

### Task 3: `scrollAnimations.ts` — delete dead functions, add `initSectionHandoff`, calibrate scrub

**Files:**
- Modify: `src/clients/marketing-web/src/scripts/scrollAnimations.ts`

- [ ] **Step 1: Update `initScrollAnimations` — remove old calls, add `initSectionHandoff`**

Replace the body of `initScrollAnimations` (lines 4-38). The new version removes `initSceneVisibility` and `initHeroPin` calls, adds `initSectionHandoff` at the end:

```typescript
export async function initScrollAnimations(): Promise<void> {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  initCursorTransforms();

  if (reduceMotion) {
    document.querySelectorAll<HTMLElement>('[data-scene]').forEach((section) => {
      section.classList.add('scene-visible');
      section.classList.remove('scene-hidden');
    });
    prepareSplitHeadlines(true);
    return;
  }

  const { gsap } = await import('gsap');
  const { ScrollTrigger } = await import('gsap/ScrollTrigger');

  gsap.registerPlugin(ScrollTrigger);

  initSplitHeadlines(gsap, ScrollTrigger);
  initBasicReveals(gsap, ScrollTrigger);
  initThreeDRevealGroups(gsap, ScrollTrigger);
  initParallax(gsap, ScrollTrigger);
  initPathDraw(gsap, ScrollTrigger);
  initCounters(gsap, ScrollTrigger);
  initZoomSections(gsap, ScrollTrigger);
  initScrollProgressBar(ScrollTrigger);
  initCursorGlow(gsap);
  initMagneticButtons(gsap);
  initSectionHandoff(gsap, ScrollTrigger);

  requestAnimationFrame(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}
```

- [ ] **Step 2: Delete the `initSceneVisibility` function**

Find and delete the entire function:
```typescript
function initSceneVisibility(ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((section) => {
    ScrollTrigger.create({
      trigger: section,
      start: 'top 82%',
      once: true,
      onEnter: () => {
        section.classList.add('scene-visible');
        section.classList.remove('scene-hidden');
      },
    });
  });
}
```

- [ ] **Step 3: Calibrate scrub in `initParallax`**

Find inside `initParallax`:
```typescript
      scrub: true,
```
(inside the `scrollTrigger` object of the parallax `gsap.to` call)

Replace with:
```typescript
      scrub: 0.8,
```

- [ ] **Step 4: Calibrate scrub in `initZoomSections`**

Find inside `initZoomSections` (the scrub path):
```typescript
      scrollTrigger: {
        trigger,
        start: node.dataset.zoomStart ?? 'top 78%',
        end: node.dataset.zoomEnd ?? 'bottom 52%',
        scrub: true,
      },
```

Replace with:
```typescript
      scrollTrigger: {
        trigger,
        start: node.dataset.zoomStart ?? 'top 78%',
        end: node.dataset.zoomEnd ?? 'bottom 52%',
        scrub: 0.8,
      },
```

- [ ] **Step 5: Delete the `initHeroPin` function**

Find and delete the entire function:
```typescript
function initHeroPin(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-hero-pin]').forEach((section) => {
    ...
  });
}
```

(It spans from `function initHeroPin` through the closing `}` — approximately 60 lines.)

- [ ] **Step 6: Add `initSectionHandoff` function**

Add this new function after `initMagneticButtons` (before `initCursorTransforms`):

```typescript
function initSectionHandoff(gsap: GSAP, ScrollTrigger: ST): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));

  sections.forEach((section) => {
    // Sections already in the viewport at init time are immediately visible
    const rect = section.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.75) {
      section.classList.add('scene-visible');
      return;
    }

    gsap.set(section, { scale: 0.985, opacity: 0 });

    ScrollTrigger.create({
      trigger: section,
      start: 'top 75%',
      onEnter: () => {
        section.classList.add('scene-visible');
        section.classList.remove('scene-hidden');
        gsap.to(section, { scale: 1, opacity: 1, duration: 0.7, ease: 'expo.out' });
      },
      onLeaveBack: () => {
        section.classList.remove('scene-visible');
        section.classList.add('scene-hidden');
        gsap.set(section, { scale: 0.985, opacity: 0 });
      },
    });
  });
}
```

- [ ] **Step 7: Verify TypeScript compiles clean**

```bash
cd "src/clients/marketing-web"
npx tsc --noEmit 2>&1 | head -30
```

Expected: no output (zero errors).

- [ ] **Step 8: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/scripts/scrollAnimations.ts
git commit -m "feat(marketing): GSAP single animation authority — add initSectionHandoff, remove dead functions, calibrate scrub"
```

---

### Task 4: `HeroSection.astro` — simplify (remove grain, badges, APK CTA, fix glow, trim `will-change`)

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/HeroSection.astro`

- [ ] **Step 1: Remove `hero__grain` div**

Find:
```html
  <!-- Decorative texture grain -->
  <div class="hero__grain" aria-hidden="true"></div>
```

Delete those 2 lines. The body `.grain::after` pseudo-element handles grain site-wide.

- [ ] **Step 2: Remove APK download ghost CTA, keep only 2 CTAs**

Find the entire `hero__ctas` div:
```html
      <div class="hero__ctas">
        <a href="#cta" class="hero__cta-primary magnetic-btn">
          {t.hero.cta_primary}
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
        <a href="/download/shramsafal-latest.apk"
           class="hero__cta-ghost magnetic-btn"
           download="ShramSafal.apk"
           aria-label={isMr ? 'Android APK डाउनलोड करा' : 'Download Android APK'}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {isMr ? 'Android डाउनलोड' : 'Download for Android'}
        </a>
        <a href="#problem-hit" class="hero__cta-ghost magnetic-btn">
          {t.hero.cta_secondary}
        </a>
      </div>
```

Replace with (2 CTAs only — APK link moves to CtaSection):
```html
      <div class="hero__ctas">
        <a href="#cta" class="hero__cta-primary magnetic-btn">
          {t.hero.cta_primary}
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </a>
        <a href="#problem-hit" class="hero__cta-ghost magnetic-btn">
          {t.hero.cta_secondary}
        </a>
      </div>
```

- [ ] **Step 3: Remove the three floating badge divs**

Find and delete:
```html
      <!-- Floating feature badges around phone -->
      <div class="hero__badge hero__badge--voice">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
        {isMr ? 'आवाजाने नोंद झाली' : 'Logged by voice'}
      </div>

      <div class="hero__badge hero__badge--cost">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
        </svg>
        {isMr ? 'खर्च दिसतो' : 'Running cost live'}
      </div>

      <div class="hero__badge hero__badge--offline">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
        </svg>
        Offline ready
      </div>
```

- [ ] **Step 4: Fix `.hero__glow` — replace `filter: blur(72px)` with pre-composed gradients**

In the `<style>` block, find:
```css
  /* ── Ambient glow pools ─────────────────────────────────────────────── */
  .hero__glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    filter: blur(72px);
  }

  .hero__glow--green {
    width: 38rem;
    height: 38rem;
    top: 50%;
    left: 50%;
    transform: translate(-46%, -52%);
    background: radial-gradient(circle, rgba(20,83,45,0.14) 0%, transparent 68%);
  }

  .hero__glow--gold {
    width: 24rem;
    height: 24rem;
    bottom: 5%;
    right: 8%;
    background: radial-gradient(circle, rgba(217,119,6,0.10) 0%, transparent 68%);
  }
```

Replace with:
```css
  /* ── Ambient glow pools ─────────────────────────────────────────────── */
  .hero__glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }

  .hero__glow--green {
    width: 38rem;
    height: 38rem;
    top: 50%;
    left: 50%;
    transform: translate(-46%, -52%);
    background: radial-gradient(ellipse 60% 60% at 46% 52%,
      rgba(22,163,74,0.13) 0%, rgba(22,163,74,0.05) 45%, transparent 72%);
  }

  .hero__glow--gold {
    width: 24rem;
    height: 24rem;
    bottom: 5%;
    right: 8%;
    background: radial-gradient(ellipse 50% 50% at 92% 95%,
      rgba(217,119,6,0.10) 0%, rgba(217,119,6,0.03) 50%, transparent 72%);
  }
```

- [ ] **Step 5: Remove `will-change` from rings and glow, keep on phone-wrap only**

In the ring CSS (currently the rings have no explicit `will-change` — confirm by searching). If found on `.hero__ring`, remove it.

Verify `.hero__phone-wrap` retains its animation (the `hero-float` keyframe is fine — it's a continuous CSS animation, not GSAP, so `will-change` here is justified).

- [ ] **Step 6: Remove badge CSS blocks from `<style>`**

Find and delete:
```css
  /* ── Floating feature badges ────────────────────────────────────────── */
  .hero__badge {
    ...
  }

  /* Voice badge — top left of phone */
  .hero__badge--voice {
    ...
  }

  /* Cost badge — middle right */
  .hero__badge--cost {
    ...
  }

  /* Offline badge — bottom left */
  .hero__badge--offline {
    ...
  }

  @keyframes badge-drift-a {
    ...
  }

  @keyframes badge-drift-b {
    ...
  }
```

Also remove the `.hero__grain` CSS:
```css
  /* ── Grain overlay (subtle depth texture) ───────────────────────────── */
  .hero__grain {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.022;
    background-image: url("data:image/svg+xml,...");
  }
```

Also remove the `@media (max-width: 639px)` reference to `.hero__badge` inside the mobile breakpoint:
```css
  @media (max-width: 639px) {
    .hero__badge { display: none; }
    .hero__ring  { display: none; }
    ...
  }
```

Leave only `.hero__ring { display: none; }` in the mobile block (badges no longer exist). The revised mobile block:
```css
  @media (max-width: 639px) {
    .hero__ring  { display: none; }
    .hero__phone {
      height: clamp(320px, 65vw, 420px);
      transform: none;
    }
    .hero__phone-wrap {
      transform: none;
    }
  }
```

- [ ] **Step 7: Fix offline badge off-token blue in the pill (already removed the badge, but check pills)**

In `hero__pills`, the offline pill icon was using `color:#60A5FA`. That pill is kept (it's in `hero__pills`, not `hero__badge`). Update it:

Find:
```html
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:#60A5FA">
```

Replace with:
```html
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--farm-sky)">
```

(`--farm-sky: #0EA5E9` is defined in tokens.css — same visual, now token-aligned.)

- [ ] **Step 8: Build check**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

- [ ] **Step 9: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/HeroSection.astro
git commit -m "feat(marketing): simplify hero — remove grain, badges, APK CTA, fix glow performance"
```

---

### Task 5: `WindCanvas.tsx` — add Page Visibility API guard

**Files:**
- Modify: `src/clients/marketing-web/src/components/islands/WindCanvas.tsx`

- [ ] **Step 1: Add `onVisibilityChange` handler and wire it up**

Inside the `useEffect`, after `rafId = requestAnimationFrame(frame);` (the initial RAF call), add:

```typescript
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else if (!killed) {
        lastT = performance.now();
        rafId = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
```

- [ ] **Step 2: Add cleanup in the return function**

Find the return cleanup:
```typescript
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
```

Replace with:
```typescript
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
```

- [ ] **Step 3: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/islands/WindCanvas.tsx
git commit -m "perf(marketing): pause WindCanvas RAF when tab hidden"
```

---

### Task 6: `WorkflowSection.astro` — embed Clarity pull-quote

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/WorkflowSection.astro`

- [ ] **Step 1: Add the Clarity pull-quote div after the `.wf-caption` paragraph**

Find (last element inside the `wf-visual-col` div):
```html
        <!-- Caption -->
        <p class="wf-caption">
          {isMr
            ? 'वर आवाज. मध्ये नोंद. खाली उद्याचा वापर.'
            : 'Voice comes in. Structure appears. Tomorrow becomes usable.'}
        </p>
      </div>
    </div>
  </div>
```

Replace with:
```html
        <!-- Caption -->
        <p class="wf-caption">
          {isMr
            ? 'वर आवाज. मध्ये नोंद. खाली उद्याचा वापर.'
            : 'Voice comes in. Structure appears. Tomorrow becomes usable.'}
        </p>
      </div>
    </div>

    <!-- Clarity bridge pull-quote (was Ch.05 · ClaritySection) -->
    <div class="wf-clarity-bridge" data-reveal data-reveal-delay="0.1">
      <p>
        {isMr
          ? '"एकच बोलणे — दोन प्रकारचे दृश्य. काय झाले, काय खर्च झाले, पुढे काय."'
          : '"One conversation — two views. What was done, what was spent, what comes next."'}
      </p>
    </div>
  </div>
```

- [ ] **Step 2: Add `.wf-clarity-bridge` CSS inside the `<style>` block**

Add before the `/* ── Reduced motion ── */` comment:
```css
  /* ── Clarity bridge pull-quote ─────────────────────────────────────────── */
  .wf-clarity-bridge {
    margin-top: 2.5rem;
    padding: 1.5rem 2rem;
    border-left: 3px solid var(--brand-fresh);
    background: rgba(22,163,74,0.04);
    border-radius: 0 1rem 1rem 0;
    max-width: 36rem;
    margin-inline: auto;
  }

  .wf-clarity-bridge p {
    font-family: var(--font-serif);
    font-size: clamp(1.05rem, 1.8vw, 1.3rem);
    font-style: italic;
    color: var(--text-secondary);
    line-height: 1.65;
    text-align: center;
  }
```

- [ ] **Step 3: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/WorkflowSection.astro
git commit -m "feat(marketing): embed Clarity pull-quote into WorkflowSection"
```

---

### Task 7: `LegacySection.astro` — embed IdentityShift pull-quote

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/LegacySection.astro`

- [ ] **Step 1: Add the IdentityShift pull-quote before the lines cards**

Find:
```html
      <div class="space-y-3 max-w-lg mx-auto">
        {t.legacy.lines.map((line: string) => (
```

Insert before it:
```html
      <!-- IdentityShift bridge pull-quote (was Ch.09 · IdentityShiftSection) -->
      <div class="legacy-identity-bridge" data-reveal data-reveal-delay="0.1">
        <p class="font-serif" set:html={t.identity_shift.headline.replace(/\n/g, '<br />')} />
        <p>{t.identity_shift.body}</p>
      </div>

      <div class="space-y-3 max-w-lg mx-auto">
        {t.legacy.lines.map((line: string) => (
```

- [ ] **Step 2: Add `.legacy-identity-bridge` CSS to the `<style>` block**

Add before the closing `</style>` tag:
```css
  .legacy-identity-bridge {
    margin-bottom: 2.5rem;
    padding: 1.4rem 1.8rem;
    border-left: 3px solid var(--gold-warm);
    background: rgba(217,119,6,0.06);
    border-radius: 0 1rem 1rem 0;
    text-align: left;
    max-width: 36rem;
    margin-inline: auto;
  }

  .legacy-identity-bridge p:first-child {
    font-family: var(--font-serif);
    font-size: clamp(1.1rem, 2vw, 1.45rem);
    color: var(--text-primary);
    line-height: 1.25;
    margin-bottom: 0.6rem;
  }

  .legacy-identity-bridge p:last-child {
    font-family: var(--font-sans);
    font-size: clamp(0.9rem, 1.4vw, 1rem);
    color: var(--text-secondary);
    line-height: 1.72;
  }
```

- [ ] **Step 3: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/LegacySection.astro
git commit -m "feat(marketing): embed IdentityShift pull-quote into LegacySection"
```

---

### Task 8: `CtaSection.astro` — Ch.09, FAQ accordion, APK link, fix off-token green

**Files:**
- Modify: `src/clients/marketing-web/src/components/sections/CtaSection.astro`

- [ ] **Step 1: Fix chapter number 12 → 09**

Find:
```html
          {lang === 'mr' ? 'Chapter 12 · सुरुवात' : 'Chapter 12 · Begin'}
```

Replace with:
```html
          {lang === 'mr' ? 'Chapter 09 · सुरुवात' : 'Chapter 09 · Begin'}
```

- [ ] **Step 2: Fix off-token green in future_items card top bar**

Find:
```html
              <div class="absolute inset-x-0 top-0 h-px" style={`background:${index % 2 === 0 ? 'linear-gradient(90deg, rgba(16,185,129,0.65), transparent)' : 'linear-gradient(90deg, rgba(245,158,11,0.65), transparent)'}`}></div>
```

Replace with:
```html
              <div class="absolute inset-x-0 top-0 h-px" style={`background:${index % 2 === 0 ? 'linear-gradient(90deg, rgba(22,163,74,0.65), transparent)' : 'linear-gradient(90deg, rgba(245,158,11,0.65), transparent)'}`}></div>
```

- [ ] **Step 3: Fix off-token green in form wrapper radial-gradient**

Find:
```html
        <div class="absolute -inset-4 rounded-[2rem] pointer-events-none" style="background:radial-gradient(ellipse at center, rgba(16,185,129,0.16) 0%, transparent 68%);filter:blur(24px);" aria-hidden="true"></div>
```

Replace with:
```html
        <div class="absolute -inset-4 rounded-[2rem] pointer-events-none" style="background:radial-gradient(ellipse at center, rgba(22,163,74,0.16) 0%, transparent 68%);filter:blur(24px);" aria-hidden="true"></div>
```

- [ ] **Step 4: Add 4-item FAQ accordion in left column, after future_items grid**

Find (end of left column `<div class="pt-4">`):
```html
        </div>

      </div>

      <div class="relative xl:pt-8" data-zoom-section
```

This closing `</div>` ends the left column. Insert the FAQ accordion before it:
```html
        </div>

        <!-- FAQ mini-accordion (4 essential questions from FAQSection) -->
        <div class="cta-faq mt-8">
          {([0, 1, 2, 3] as const).map((i) => (
            <details class="cta-faq__item">
              <summary class="cta-faq__q">
                <span class="cta-faq__num">{String(i + 1).padStart(2, '0')}</span>
                <span class="cta-faq__question">{t.guided.questions[i]}</span>
                <svg class="cta-faq__chevron" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </summary>
              <p class="cta-faq__a">
                {i === 0 ? (t.qa1 as any).body
                  : i === 1 ? (t.qa2 as any).body
                  : i === 2 ? (t.qa3 as any).body
                  :           (t.qa4 as any).body}
              </p>
            </details>
          ))}
        </div>

      </div>

      <div class="relative xl:pt-8" data-zoom-section
```

- [ ] **Step 5: Add APK download link below the form card in right column**

Find (end of right column, inside the zoom-section div):
```html
          <div class="mt-6 pt-5 border-t border-white/8 flex flex-wrap items-center gap-2 text-sm" style="color:var(--text-inverse-58);">
            <span>{t.scene8.whatsapp_prefix}</span>
            <a
              href="https://wa.me/919999999999"
              ...
            >
              WhatsApp
            </a>
          </div>
        </div>

      </div>
    </div>
  </div>
</section>
```

Insert the APK link after the form card's closing `</div>` (but still inside the right column `</div>`):

```html
          <div class="mt-6 pt-5 border-t border-white/8 flex flex-wrap items-center gap-2 text-sm" style="color:var(--text-inverse-58);">
            <span>{t.scene8.whatsapp_prefix}</span>
            <a
              href="https://wa.me/919999999999"
              target="_blank"
              rel="noopener noreferrer"
              class="font-bold transition-colors hover:text-white"
              style="color:var(--brand-fresh);"
            >
              WhatsApp
            </a>
          </div>
        </div>

        <div class="mt-4 text-center">
          <a
            href="/download/shramsafal-latest.apk"
            download="ShramSafal.apk"
            class="inline-flex items-center gap-1.5 text-sm transition-colors hover:text-white"
            style="color:var(--text-inverse-58);"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {lang === 'mr' ? 'Android APK डाउनलोड करा' : 'Download Android APK'}
          </a>
        </div>

      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 6: Add `<style>` block for FAQ accordion (dark-themed)**

CtaSection.astro currently has no `<style>` block. Add one at the end of the file:

```html
<style>
  /* ── CTA mini-FAQ accordion ─────────────────────────────────────────── */
  .cta-faq {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cta-faq__item {
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(255,255,255,0.04);
    transition: border-color 0.2s ease;
  }

  .cta-faq__item[open] {
    border-color: rgba(255,255,255,0.18);
  }

  .cta-faq__q {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .cta-faq__q::-webkit-details-marker { display: none; }

  .cta-faq__num {
    flex-shrink: 0;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: rgba(22,163,74,0.22);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-sans);
    font-size: 0.6rem;
    font-weight: 900;
    color: var(--brand-fresh);
    letter-spacing: 0.02em;
  }

  .cta-faq__question {
    flex: 1;
    font-family: var(--font-sans);
    font-size: clamp(0.84rem, 1.4vw, 0.94rem);
    font-weight: 700;
    color: var(--text-inverse-78);
    line-height: 1.4;
  }

  .cta-faq__chevron {
    flex-shrink: 0;
    color: var(--text-inverse-58);
    transition: transform 0.25s ease;
  }

  .cta-faq__item[open] .cta-faq__chevron {
    transform: rotate(180deg);
  }

  .cta-faq__a {
    padding: 0.75rem 1rem 1rem;
    border-top: 1px solid rgba(255,255,255,0.08);
    font-family: var(--font-sans);
    font-size: clamp(0.84rem, 1.3vw, 0.94rem);
    line-height: 1.72;
    color: var(--text-inverse-58);
    margin: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .cta-faq__item,
    .cta-faq__chevron { transition: none; }
  }
</style>
```

- [ ] **Step 7: Build check**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/sections/CtaSection.astro
git commit -m "feat(marketing): CtaSection → Ch.09, embed FAQ accordion, APK link, fix off-token greens"
```

---

### Task 9: `PloughNav.tsx` — 9-item SECTIONS array and token-aligned colors

**Files:**
- Modify: `src/clients/marketing-web/src/components/islands/PloughNav.tsx`

- [ ] **Step 1: Replace the entire `SECTIONS` constant**

Find:
```typescript
const SECTIONS = [
  { id: 'hero', en: 'Start', mr: 'सुरुवात', short: '01' },
  { id: 'problem-hit', en: 'Problem', mr: 'समस्या', short: '02' },
  { id: 'before-after', en: 'Compare', mr: 'तफावत', short: '03' },
  { id: 'workflow', en: 'Voice to Record', mr: 'आवाज ते नोंद', short: '04' },
  { id: 'clarity', en: 'Clarity', mr: 'स्पष्टता', short: '05' },
  { id: 'value-ladder', en: 'Value', mr: 'मूल्य', short: '06' },
  { id: 'participation', en: 'Your Part', mr: 'तुमचा भाग', short: '07' },
  { id: 'trust', en: 'Trust', mr: 'विश्वास', short: '08' },
  { id: 'legacy', en: 'Legacy', mr: 'वारसा', short: '09' },
  { id: 'cta', en: 'Join', mr: 'सुरू करा', short: '10' },
] as const;
```

Replace with (9 items, new page order, renumbered):
```typescript
const SECTIONS = [
  { id: 'hero', en: 'Start', mr: 'सुरुवात', short: '01' },
  { id: 'problem-hit', en: 'Problem', mr: 'समस्या', short: '02' },
  { id: 'before-after', en: 'Compare', mr: 'तफावत', short: '03' },
  { id: 'workflow', en: 'Voice to Record', mr: 'आवाज ते नोंद', short: '04' },
  { id: 'value-ladder', en: 'Value', mr: 'मूल्य', short: '05' },
  { id: 'trust', en: 'Trust', mr: 'विश्वास', short: '06' },
  { id: 'legacy', en: 'Legacy', mr: 'वारसा', short: '07' },
  { id: 'participation', en: 'Your Part', mr: 'तुमचा भाग', short: '08' },
  { id: 'cta', en: 'Join', mr: 'सुरू करा', short: '09' },
] as const;
```

- [ ] **Step 2: Fix off-token colors in the inline `<style>` template string**

Inside the `<style>{...}</style>` JSX block, replace all occurrences of Tailwind emerald values:

| Find | Replace |
|---|---|
| `rgba(16,185,129,0.06)` (hover bg) | `rgba(22,163,74,0.06)` |
| `rgba(16,185,129,0.2)` (active dot border) | `rgba(22,163,74,0.2)` |
| `linear-gradient(135deg, #10b981, #0f7b58)` (active dot bg) | `linear-gradient(135deg, #16A34A, #14532D)` |
| `rgba(16,185,129,0.12)` (active dot box-shadow) | `rgba(22,163,74,0.12)` |
| `rgba(16,185,129,0.2)` (story line gradient) | `rgba(22,163,74,0.2)` |

After replacements the style template should contain:

```
.story-rail__button:hover {
  transform: translateX(2px);
  background: rgba(22,163,74,0.06);
}

.story-rail__button[data-active='true'] .story-rail__dot {
  color: white;
  border-color: rgba(22,163,74,0.2);
  background: linear-gradient(135deg, #16A34A, #14532D);
  box-shadow: 0 0 0 4px rgba(22,163,74,0.12);
}

.story-rail__line {
  ...
  background: linear-gradient(180deg, rgba(22,163,74,0.2), rgba(19,50,36,0.08));
}
```

- [ ] **Step 3: Build check**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/islands/PloughNav.tsx
git commit -m "feat(marketing): PloughNav 10→9 sections, token-align colors"
```

---

### Task 10: Create `StickyCta.tsx` — mobile-only sticky conversion bar

**Files:**
- Create: `src/clients/marketing-web/src/components/islands/StickyCta.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useEffect, useState } from 'react';

export default function StickyCta() {
  const [isDesktop, setIsDesktop] = useState(true); // SSR-safe default: hide on server
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mq.matches);

    const onMqChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onMqChange);

    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    const cta = document.querySelector<HTMLElement>('[data-scene="cta"]');

    if (!hero || !cta) {
      return () => mq.removeEventListener('change', onMqChange);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target === hero) {
            setVisible(!entry.isIntersecting);
          }
          if (entry.target === cta && entry.isIntersecting) {
            setVisible(false);
          }
        });
      },
      { threshold: 0.05 },
    );

    observer.observe(hero);
    observer.observe(cta);

    return () => {
      mq.removeEventListener('change', onMqChange);
      observer.disconnect();
    };
  }, []);

  if (isDesktop) return null;

  return (
    <a
      href="#cta"
      aria-label="Quick join — go to waitlist"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: '52px',
        background: 'var(--brand)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        fontWeight: 800,
        fontSize: '0.95rem',
        textDecoration: 'none',
        letterSpacing: '0.01em',
        transition: 'transform 0.3s ease-out',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
      }}
    >
      Join the waitlist — free →
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/components/islands/StickyCta.tsx
git commit -m "feat(marketing): add StickyCta island — mobile sticky CTA bar"
```

---

### Task 11: `BaseLayout.astro` — remove duplicate font, wire StickyCta

**Files:**
- Modify: `src/clients/marketing-web/src/layouts/BaseLayout.astro`

- [ ] **Step 1: Remove `DM+Serif+Display` from Google Fonts URL**

Find:
```
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&family=Noto+Sans+Devanagari:wght@400;500;700&family=Noto+Serif+Devanagari:wght@400;700&display=swap"
      rel="stylesheet"
    />
```

Replace with (remove `&family=DM+Serif+Display`):
```
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;700&family=Noto+Serif+Devanagari:wght@400;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 2: Import StickyCta**

In the frontmatter (`---` block), add after the `WindCanvas` import:
```typescript
import StickyCta from '../components/islands/StickyCta';
```

- [ ] **Step 3: Add `<StickyCta client:idle />` before `</body>`**

Find:
```html
    <slot />
  </body>
```

Replace with:
```html
    <slot />
    <StickyCta client:idle />
  </body>
```

- [ ] **Step 4: Build check**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/layouts/BaseLayout.astro
git commit -m "feat(marketing): remove duplicate DM Serif Display font load, wire StickyCta"
```

---

### Task 12: Restructure `en/index.astro` and `mr/index.astro` — 12 → 9 sections

**Files:**
- Modify: `src/clients/marketing-web/src/pages/en/index.astro`
- Modify: `src/clients/marketing-web/src/pages/mr/index.astro`

- [ ] **Step 1: Update `en/index.astro` imports — remove 3 dead sections**

Find and delete these 3 import lines:
```typescript
import ClaritySection from '../../components/sections/ClaritySection.astro';
import FAQSection from '../../components/sections/FAQSection.astro';
import IdentityShiftSection from '../../components/sections/IdentityShiftSection.astro';
```

Also delete:
```typescript
import ParticipationSection from '../../components/sections/ParticipationSection.astro';
```

Wait — `ParticipationSection` IS in the new 9-section structure (Ch.08). Keep it. Only remove the 3 listed above.

- [ ] **Step 2: Rewrite the `<main>` body of `en/index.astro`**

Replace the entire `<main>...</main>` block with:

```html
  <main>
    <!-- Ch.01 · The Field -->
    <CinematicScrollHero client:load lang="en" />
    <HeroSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.02 · The Pain -->
    <ProblemHitSection />

    <!-- Ch.03 · The Shift -->
    <BeforeAfterSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.04 · Speak and We Sort (+ Clarity pull-quote inside) -->
    <WorkflowSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.05 · The 90-Day Return -->
    <ValueLadderSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.06 · Trust -->
    <TrustSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.07 · Legacy (+ IdentityShift pull-quote inside) -->
    <LegacySection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.08 · Your Part -->
    <ParticipationSection />

    <div class="soil-stratum" aria-hidden="true"><span></span></div>

    <!-- Ch.09 · Begin (+ 4-item FAQ accordion inside) -->
    <CtaSection />
  </main>
```

- [ ] **Step 3: Apply the same changes to `mr/index.astro`**

The `mr/index.astro` mirrors `en/index.astro` exactly (same imports, same structure with `lang="mr"` on `CinematicScrollHero`). Apply identical changes:

- Remove 3 imports (`ClaritySection`, `FAQSection`, `IdentityShiftSection`)
- Replace `<main>` block with the same structure as above, but change the hero island to `lang="mr"`:
  ```html
  <CinematicScrollHero client:load lang="mr" />
  ```

- [ ] **Step 4: Build check**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

Expected: exits 0, Astro successfully builds all pages.

- [ ] **Step 5: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add src/clients/marketing-web/src/pages/en/index.astro
git add src/clients/marketing-web/src/pages/mr/index.astro
git commit -m "feat(marketing): restructure index 12→9 sections, replace bag dividers with soil-stratum"
```

---

### Task 13: Delete 5 dead island files

**Files:**
- Delete: `src/clients/marketing-web/src/components/islands/AppScreen3D.tsx`
- Delete: `src/clients/marketing-web/src/components/islands/RangoliLoader.tsx`
- Delete: `src/clients/marketing-web/src/components/islands/AudioSystem.tsx`
- Delete: `src/clients/marketing-web/src/components/islands/ChulhaSmoke.tsx`
- Delete: `src/clients/marketing-web/src/components/islands/WellIndicator.tsx`

- [ ] **Step 1: Confirm each file is unreferenced**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform/src/clients/marketing-web"
for f in AppScreen3D RangoliLoader AudioSystem ChulhaSmoke WellIndicator; do
  echo "=== $f ===" && grep -r "$f" src/ --include="*.astro" --include="*.tsx" --include="*.ts" -l 2>/dev/null || echo "(no references)"
done
```

Expected: each shows `(no references)` — no `.astro` or `.tsx` file imports them.

If a file IS referenced, do NOT delete it. Add a note to the plan and skip that file.

- [ ] **Step 2: Delete the 5 files**

```bash
rm "src/clients/marketing-web/src/components/islands/AppScreen3D.tsx"
rm "src/clients/marketing-web/src/components/islands/RangoliLoader.tsx"
rm "src/clients/marketing-web/src/components/islands/AudioSystem.tsx"
rm "src/clients/marketing-web/src/components/islands/ChulhaSmoke.tsx"
rm "src/clients/marketing-web/src/components/islands/WellIndicator.tsx"
```

- [ ] **Step 3: Build check — confirm no broken imports**

```bash
cd "src/clients/marketing-web"
npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add -A src/clients/marketing-web/src/components/islands/
git commit -m "chore(marketing): delete 5 dead island files (AppScreen3D, RangoliLoader, AudioSystem, ChulhaSmoke, WellIndicator)"
```

---

### Task 14: Build verification and visual smoke test

**Files:**
- Read-only verification

- [ ] **Step 1: Full production build**

```bash
cd "src/clients/marketing-web"
npm run build
```

Expected: exits 0, no TypeScript errors, Astro renders all routes.

- [ ] **Step 2: Run dev server for visual inspection**

```bash
cd "src/clients/marketing-web"
npm run dev
```

Open `http://localhost:4321/en/` in browser.

- [ ] **Step 3: Visual smoke test checklist**

Scroll from top to bottom of the page. Verify:

| Check | Expected |
|---|---|
| Cinematic scroll hero | Plays frame sequence, no stutter |
| Hero section | 2 CTAs only, no floating badges, no grain overlay on top of body grain |
| Section enter animations | Each section scales in cleanly (no flash of content, no snap) |
| WorkflowSection | Pull-quote visible below the caption |
| LegacySection | IdentityShift pull-quote visible above the legacy lines |
| CtaSection chapter | Shows "Chapter 09" |
| CtaSection FAQ | 4 accordion items open/close cleanly |
| CtaSection APK link | Visible below the form |
| Scroll progress bar | Fills green from top to bottom |
| PloughNav | 9 dots visible on desktop (≥1180px), active dot green |
| Sticky CTA | Appears on mobile after scrolling past hero; hidden on desktop |
| Wind particles | Visible on desktop; disappear when tab is hidden (switch tabs to test) |
| Soil stratum | Thin 3-band dividers between every section pair |

- [ ] **Step 4: Definition of Done checklist (from spec)**

```
[ ] tokens.css has 2 new tokens, no off-token greens remain in any file
[ ] global.css has no .scene-hidden/.scene-visible animation block
[ ] scrollAnimations.ts has no initHeroPin, no initSceneVisibility; has initSectionHandoff
[ ] Page has 9 sections, PloughNav has 9 items
[ ] Hero has 2 CTAs, 0 floating badges, 0 hero__grain div
[ ] StickyCta.tsx exists, renders on mobile only, slides in after hero exits
[ ] 5 dead island files deleted
[ ] WindCanvas pauses on visibilitychange
[ ] npm run build exits 0 with no TypeScript errors
[ ] Visual smoke test: scroll from top to CTA, all sections enter cleanly, no stutter
```

- [ ] **Step 5: Final commit (if any last-minute fixes were made)**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git add -A src/clients/marketing-web/
git commit -m "fix(marketing): smoke test corrections"
```

---

### Task 15: Pending Tasks Handoff

**Files:**
- Read: `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/_INDEX.md`
- Create (if needed): `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/<TASK_NAME>_<DATE>.md`
- Update (if needed): `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/_INDEX.md`

- [ ] **Step 1: Scan this plan for unchecked `[ ]` items**

For each unchecked item:
- Still relevant, different agent or session → create pending task file
- No longer relevant → note as `dropped: <reason>` inline in the plan

- [ ] **Step 2: For each deferred item, create a pending task file**

```markdown
---
type: pending-task
status: READY_TO_EXECUTE
agent: Claude
priority: P1
created: <YYYY-MM-DD>
source_plan: 2026-05-05-marketing-site-polish.md
branch: akash_edits
estimated_effort: <Xh>
unblocks: <what this enables>
blocked_by: —
---

# <Task Title>

## Context
[Why this exists, what was already built, what remains]

## Pre-resolved decisions
[Decisions the agent does not need to re-ask]

## Execution Steps
1. [Concrete step]

## What NOT to do
- [Red line]

## Definition of Done
- [ ] [Checklist item]
```

- [ ] **Step 3: Add a row to `_INDEX.md`**

```markdown
| T-XXX | [Title](filename.md) | P1 | Claude | 2026-05-05-marketing-site-polish | READY | — |
```

- [ ] **Step 4: Update `SESSION_STATE.md` under "Recent Outputs"**

```
Completed plan: marketing-site-polish (Option C) — 9-section redesign, GSAP single authority, StickyCta
Created pending tasks: T-XXX (<title>) — or: No pending tasks. All items completed or explicitly dropped.
```

- [ ] **Step 5: Commit to `_COFOUNDER` repo**

```bash
cd "_COFOUNDER"
git add Projects/AgriSync/Operations/Pending_Tasks/
git commit -m "chore: flush pending tasks from marketing-site-polish plan"
```

If no unchecked items remain, skip Steps 2–5 and note it in Step 1.

---

*Plan generated 2026-05-05 · Spec: marketing-site-polish-c · Branch: akash_edits*
