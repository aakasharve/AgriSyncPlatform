// Type aliases for brevity
type GSAP = typeof import('gsap')['gsap'];
type ST = typeof import('gsap/ScrollTrigger')['ScrollTrigger'];

export async function initScrollAnimations(): Promise<void> {
  // Respect reduced motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('[data-scene]').forEach((el) => {
      el.classList.add('scene-visible');
      el.classList.remove('scene-hidden');
    });
    return;
  }

  // Dynamic import to keep main bundle lean
  const { gsap } = await import('gsap');
  const { ScrollTrigger } = await import('gsap/ScrollTrigger');

  gsap.registerPlugin(ScrollTrigger);

  // ──────────────────────────────────────────────────────────
  //  CINEMATIC AMBIENT SYSTEMS
  // ──────────────────────────────────────────────────────────
  initHillsParallax(gsap, ScrollTrigger);
  initCursorTransforms();
  initHeroLoadTimeline(gsap);
  initRevealAnimations(gsap, ScrollTrigger);

  const scenes = document.querySelectorAll<HTMLElement>('[data-scene]');

  scenes.forEach((section) => {
    const sceneName = section.dataset.scene;
    const staggerEls = section.querySelectorAll<HTMLElement>('.scene-stagger');

    // Default entrance: fade-in + slide-up for stagger children
    if (staggerEls.length > 0) {
      gsap.set(staggerEls, { opacity: 0, y: 40 });

      ScrollTrigger.create({
        trigger: section,
        start: 'top 80%',
        once: true,
        onEnter: () => {
          gsap.to(staggerEls, {
            opacity: 1,
            y: 0,
            duration: 0.8,
            stagger: 0.12,
            ease: 'expo.out',
          });
          section.classList.add('scene-visible');
          section.classList.remove('scene-hidden');
        },
      });
    } else {
      gsap.set(section, { opacity: 0, y: 30 });

      ScrollTrigger.create({
        trigger: section,
        start: 'top 80%',
        once: true,
        onEnter: () => {
          gsap.to(section, {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: 'expo.out',
          });
          section.classList.add('scene-visible');
          section.classList.remove('scene-hidden');
        },
      });
    }

    // Scene-specific animations
    switch (sceneName) {
      case 'hero':
        animateHeroScene(section, gsap, ScrollTrigger);
        break;
      case 'problem-hit':
        animateProblemHitScene(section, gsap, ScrollTrigger);
        break;
      case 'before-after':
        animateBeforeAfterScene(section, gsap, ScrollTrigger);
        break;
      case 'identity-shift':
        animateIdentityShiftScene(section, gsap, ScrollTrigger);
        break;
      case 'guided':
        animateGuidedScene(section, gsap, ScrollTrigger);
        break;
      case 'workflow':
        animateWorkflowScene(section, gsap, ScrollTrigger);
        break;
      case 'clarity':
        animateClarityScene(section, gsap, ScrollTrigger);
        break;
      case 'value-ladder':
        animateValueLadderScene(section, gsap, ScrollTrigger);
        break;
      case 'trust':
        animateTrustScene(section, gsap, ScrollTrigger);
        break;
      case 'participation':
        animateParticipationScene(section, gsap, ScrollTrigger);
        break;
      case 'legacy':
        animateLegacyScene(section, gsap, ScrollTrigger);
        break;
    }
  });

  // Global: parallax on all illustration-parallax elements
  initIllustrationParallax(gsap, ScrollTrigger);

  // Question chip highlighting on scroll
  initQuestionChipNavigation(gsap, ScrollTrigger);

  // Global: scroll progress bar
  initScrollProgressBar(ScrollTrigger);

  // Global: cursor glow that follows mouse
  initCursorGlow(gsap);

  // Global: text scramble for data-scramble elements
  initTextScramble(ScrollTrigger);

  // Global: magnetic effect on CTA buttons
  initMagneticButtons(gsap);
}

/* ===========================================
   HERO — cinematic parallax depth layers
   Motion grammar: DRIFT (uncertainty → clarity)
   =========================================== */
function animateHeroScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  // Layer 1: bg image parallax (moves fastest — 25% of scroll)
  const bgLayer = section.querySelector<HTMLElement>('.hero-layer-bg');
  if (bgLayer) {
    gsap.to(bgLayer, {
      yPercent: 25,
      ease: 'none',
      scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: 0.8 },
    });
  }
  // Layer 2: overlay (medium speed)
  const midLayer = section.querySelector<HTMLElement>('.hero-layer-mid');
  if (midLayer) {
    gsap.to(midLayer, {
      yPercent: 12,
      ease: 'none',
      scrollTrigger: { trigger: section, start: 'top top', end: 'bottom top', scrub: 0.8 },
    });
  }
  // Layer 3: content (slowest — fades as scrolls away)
  const contentLayer = section.querySelector<HTMLElement>('.hero-layer-content');
  if (contentLayer) {
    gsap.to(contentLayer, {
      yPercent: 8,
      opacity: 0.2,
      ease: 'none',
      scrollTrigger: { trigger: section, start: '50% top', end: 'bottom top', scrub: 0.4 },
    });
  }
  // Word-by-word reveal
  const words = section.querySelectorAll<HTMLElement>('.hero-word');
  if (words.length > 0) {
    gsap.set(words, { opacity: 0, y: 20 });
    ScrollTrigger.create({
      trigger: section, start: 'top 60%', once: true,
      onEnter: () => { gsap.to(words, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, ease: 'expo.out' }); }
    });
  }
}

/* ===========================================
   PROBLEM HIT — scrubbed paper note reveal
   Motion grammar: DRIFT (scattered, uncertain)
   =========================================== */
function animateProblemHitScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const notes = section.querySelectorAll<HTMLElement>('.paper-note');
  notes.forEach((note, i) => {
    const fromX = i % 2 === 0 ? -80 : 80;
    gsap.set(note, { opacity: 0, x: fromX, rotate: i % 2 === 0 ? -2 : 2 });
    ScrollTrigger.create({
      trigger: note, start: 'top 85%', once: true,
      onEnter: () => {
        gsap.to(note, { opacity: 1, x: 0, rotate: 0, duration: 0.7, delay: i * 0.12, ease: 'expo.out' });
      }
    });
  });

  // Chaos illustration — scale up with slight shake
  const chaosImg = section.querySelector<HTMLElement>('img[src*="problem-mental-load"], img[src*="chaos"]');
  if (chaosImg) {
    gsap.set(chaosImg, { opacity: 0, scale: 0.85, rotate: -2 });
    gsap.to(chaosImg, {
      opacity: 0.85,
      scale: 1,
      rotate: 0,
      duration: 1.2,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: section,
        start: 'top 65%',
        once: true,
      },
    });
  }

  const ropePath = section.querySelector<SVGPathElement>('.problem-rope-path');
  if (ropePath) {
    gsap.fromTo(
      ropePath,
      {
        attr: { d: 'M54 82 C 210 170, 515 176, 708 106' },
      },
      {
        attr: { d: 'M54 92 C 232 126, 520 136, 708 110' },
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top 70%',
          end: 'bottom 35%',
          scrub: 0.9,
        },
      }
    );
  }
}

/* ===========================================
   BEFORE/AFTER — blur-to-clear transformation
   Motion grammar: SNAP (chaos → structure)
   =========================================== */
function animateBeforeAfterScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const before = section.querySelector<HTMLElement>('.before-panel');
  const after = section.querySelector<HTMLElement>('.after-panel');

  // Panels slide in from opposite sides
  if (before) gsap.set(before, { opacity: 0, x: -50 });
  if (after) gsap.set(after, { opacity: 0, x: 50 });

  ScrollTrigger.create({
    trigger: section,
    start: 'top 65%',
    once: true,
    onEnter: () => {
      if (before) gsap.to(before, { opacity: 1, x: 0, duration: 0.9, ease: 'expo.out' });
      if (after) gsap.to(after, { opacity: 1, x: 0, duration: 0.9, delay: 0.15, ease: 'expo.out' });
    },
  });

  // Blur → Clear transformation on images (scrub-based)
  const beforeVisual = section.querySelector<HTMLElement>('.before-visual img');
  const afterVisual = section.querySelector<HTMLElement>('.after-visual img');

  if (beforeVisual) {
    // Before image: starts blurry, gets MORE blurry as you scroll
    gsap.to(beforeVisual, {
      filter: 'blur(6px)',
      opacity: 0.5,
      scale: 0.97,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 40%',
        end: 'bottom 60%',
        scrub: 0.5,
      },
    });
  }

  if (afterVisual) {
    // After image: starts slightly muted, becomes crisp and vibrant
    gsap.set(afterVisual, { filter: 'saturate(0.7)', scale: 0.98 });
    gsap.to(afterVisual, {
      filter: 'saturate(1.1)',
      scale: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 40%',
        end: 'bottom 60%',
        scrub: 0.5,
      },
    });
  }
}

/* ===========================================
   IDENTITY SHIFT — chain reveal with emphasis
   Motion grammar: SNAP (transformation moment)
   =========================================== */
function animateIdentityShiftScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const lines = section.querySelectorAll<HTMLElement>('.identity-line');
  if (lines.length === 0) return;

  gsap.set(lines, { opacity: 0, y: 20, filter: 'blur(2px)' });

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    once: true,
    onEnter: () => {
      gsap.to(lines, {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.6,
        stagger: 0.25,
        ease: 'power2.out',
      });
    },
  });
}

/* ===========================================
   GUIDED — question chips with bounce
   Motion grammar: FLOW (conversation feel)
   =========================================== */
function animateGuidedScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const chips = section.querySelectorAll<HTMLElement>('.question-chip');
  if (chips.length === 0) return;

  gsap.set(chips, { opacity: 0, y: 15, scale: 0.9 });

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    once: true,
    onEnter: () => {
      gsap.to(chips, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.5,
        stagger: 0.1,
        ease: 'back.out(1.5)',
      });
    },
  });
}

/* ===========================================
   WORKFLOW — bucket tags snap into categories
   Motion grammar: SNAP (data categorization)
   =========================================== */
function animateWorkflowScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const bucketTags = section.querySelectorAll<HTMLElement>('.bucket-tag');
  if (bucketTags.length === 0) return;

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    once: true,
    onEnter: () => {
      gsap.fromTo(
        bucketTags,
        { opacity: 0, y: -20, scale: 0.8, rotate: -3 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          rotate: 0,
          duration: 0.5,
          stagger: 0.1,
          delay: 0.8,
          ease: 'back.out(1.7)',
        },
      );
    },
  });

  // Phone frame glow pulse
  const phoneFrame = section.querySelector<HTMLElement>('.phone-frame');
  if (phoneFrame) {
    gsap.to(phoneFrame, {
      boxShadow: '0 0 40px rgba(5, 150, 105, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 50%',
        end: 'bottom 50%',
        scrub: 0.5,
      },
    });
  }

  // Parallax on the pattern bg
  const patternBg = section.querySelector<HTMLElement>('img[src*="pattern-field-rows"]');
  if (patternBg) {
    gsap.to(patternBg, {
      yPercent: 8,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  }
}

/* ===========================================
   CLARITY — cards cascade in
   Motion grammar: CALM (settled, clear)
   =========================================== */
function animateClarityScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const cards = section.querySelectorAll<HTMLElement>('.clarity-card');
  if (cards.length === 0) return;

  gsap.set(cards, { opacity: 0, x: -30, y: 20 });

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    once: true,
    onEnter: () => {
      gsap.to(cards, {
        opacity: 1,
        x: 0,
        y: 0,
        duration: 0.9,
        stagger: 0.18,
        ease: 'expo.out',
      });
    },
  });

  // Parallax on the clear farm field bg
  const bgImage = section.querySelector<HTMLElement>('img[src*="farm-field-clear"]');
  if (bgImage) {
    gsap.to(bgImage, {
      yPercent: 10,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  }
}

/* ===========================================
   VALUE LADDER — growing bars (scrub-based)
   Motion grammar: ACCUMULATE (building over time)
   =========================================== */
function animateValueLadderScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const periods = section.querySelectorAll<HTMLElement>('.value-period');
  const bars = section.querySelectorAll<HTMLElement>('.value-bar');
  if (periods.length === 0) return;

  gsap.set(periods, { opacity: 0, y: 30 });

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    once: true,
    onEnter: () => {
      gsap.to(periods, {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.2,
        ease: 'expo.out',
      });
    },
  });

  // Scrub-based bar growth for visual accumulation
  bars.forEach((bar) => {
    const targetWidth = bar.style.getPropertyValue('--target-width') || '33%';
    gsap.set(bar, { width: '0%' });
    gsap.to(bar, {
      width: targetWidth,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: section,
        start: 'top 60%',
        end: 'center center',
        scrub: 0.5,
      },
    });
  });

  // Animated number counters that increment as bars grow
  const counters = section.querySelectorAll<HTMLElement>('.value-counter');
  counters.forEach((counter) => {
    const target = parseInt(counter.dataset.count || '0', 10);
    const suffix = counter.dataset.suffix || '';
    if (target === 0) return;
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 60%',
        end: 'center center',
        scrub: 0.5,
        onUpdate: () => {
          counter.textContent = Math.round(obj.val) + suffix;
        },
      },
    });
  });
}

/* ===========================================
   TRUST — scroll-driven counter + growth line
   Motion grammar: ACCUMULATE (trust building)
   =========================================== */
function animateTrustScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const emphasisWords = section.querySelectorAll<HTMLElement>('.trust-emphasis');
  const counters = section.querySelectorAll<HTMLElement>('.trust-counter');
  const growthLine = section.querySelector<HTMLElement>('.trust-growth-line');
  const circles = section.querySelectorAll<HTMLElement>('.trust-circle');

  // Emphasis words: fade in with stagger
  if (emphasisWords.length > 0) {
    gsap.set(emphasisWords, { opacity: 0.2 });
    emphasisWords.forEach((word, i) => {
      gsap.to(word, {
        opacity: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: section,
          start: `${20 + i * 10}% center`,
          end: `${35 + i * 10}% center`,
          scrub: 0.3,
        },
      });
    });
  }

  // Scroll-driven counter animation
  counters.forEach((counter) => {
    const target = parseInt(counter.dataset.target || '0', 10);
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 60%',
        end: 'center center',
        scrub: 0.5,
        onUpdate: () => {
          counter.textContent = Math.round(obj.val).toString();
        },
      },
    });
  });

  // Growth line: scrub-based width
  if (growthLine) {
    gsap.set(growthLine, { width: '0%' });
    gsap.to(growthLine, {
      width: '100%',
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 60%',
        end: 'center center',
        scrub: 0.5,
      },
    });
  }

  // SVG path draw animation — trust growth curve
  const svgPath = section.querySelector<SVGPathElement>('.trust-growth-svg path');
  if (svgPath) {
    const pathLength = svgPath.getTotalLength();
    gsap.set(svgPath, { strokeDasharray: pathLength, strokeDashoffset: pathLength });
    gsap.to(svgPath, {
      strokeDashoffset: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 60%',
        end: 'center center',
        scrub: 0.5,
      },
    });
  }

  // Day circles: grow as you scroll
  if (circles.length > 0) {
    circles.forEach((circle, i) => {
      gsap.set(circle, { scale: 0.7, opacity: 0.5 });
      gsap.to(circle, {
        scale: 1,
        opacity: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: section,
          start: `${20 + i * 15}% center`,
          end: `${40 + i * 15}% center`,
          scrub: 0.3,
        },
      });
    });
  }
}

/* ===========================================
   QUESTION CHIP NAVIGATION — highlight active
   =========================================== */
function initQuestionChipNavigation(gsap: GSAP, ScrollTrigger: ST): void {
  const chips = document.querySelectorAll<HTMLElement>('.question-chip');
  if (chips.length === 0) return;

  for (let i = 1; i <= 5; i++) {
    const qaSection = document.querySelector<HTMLElement>(`[data-scene="qa-${i}"]`);
    if (!qaSection) continue;

    ScrollTrigger.create({
      trigger: qaSection,
      start: 'top 60%',
      end: 'bottom 40%',
      onEnter: () => setActiveChip(chips, i - 1),
      onEnterBack: () => setActiveChip(chips, i - 1),
      onLeave: () => clearActiveChip(chips, i - 1),
      onLeaveBack: () => clearActiveChip(chips, i - 1),
    });
  }
}

function setActiveChip(chips: NodeListOf<HTMLElement>, index: number): void {
  chips.forEach((chip, i) => {
    if (i === index) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function clearActiveChip(chips: NodeListOf<HTMLElement>, index: number): void {
  chips[index]?.classList.remove('active');
}

/* ===========================================
   PARTICIPATION — partnership illustration
   Motion grammar: CALM (togetherness)
   =========================================== */
function animateParticipationScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const illustration = section.querySelector<HTMLElement>('img[src*="partnership"]');
  if (illustration) {
    gsap.set(illustration, { opacity: 0, y: 20, scale: 0.92 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 75%',
      once: true,
      onEnter: () => {
        gsap.to(illustration, {
          opacity: 0.85,
          y: 0,
          scale: 1,
          duration: 1,
          ease: 'expo.out',
        });
      },
    });
  }

  const lines = section.querySelectorAll<HTMLElement>('.participation-line');
  if (lines.length > 0) {
    gsap.set(lines, { opacity: 0, y: 15 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 65%',
      once: true,
      onEnter: () => {
        gsap.to(lines, {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.2,
          ease: 'power2.out',
        });
      },
    });
  }
}

/* ===========================================
   LEGACY — warm reveal with golden glow
   Motion grammar: CALM (settled, legacy)
   =========================================== */
function animateLegacyScene(section: HTMLElement, gsap: GSAP, ScrollTrigger: ST): void {
  const illustration = section.querySelector<HTMLElement>('img[src*="legacy"]');
  if (illustration) {
    gsap.set(illustration, { opacity: 0, scale: 0.9 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 75%',
      once: true,
      onEnter: () => {
        gsap.to(illustration, {
          opacity: 0.85,
          scale: 1,
          duration: 1.2,
          ease: 'expo.out',
        });
      },
    });
  }

  const lines = section.querySelectorAll<HTMLElement>('.legacy-line');
  if (lines.length > 0) {
    gsap.set(lines, { opacity: 0, y: 12 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 65%',
      once: true,
      onEnter: () => {
        gsap.to(lines, {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.15,
          ease: 'power2.out',
        });
      },
    });
  }

  // Golden radial glow that pulses in when section enters
  const goldenGlow = section.querySelector<HTMLElement>('.legacy-golden-glow');
  if (goldenGlow) {
    gsap.set(goldenGlow, { scale: 0, opacity: 0 });
    ScrollTrigger.create({
      trigger: section,
      start: 'top 70%',
      once: true,
      onEnter: () => {
        gsap.to(goldenGlow, {
          scale: 1,
          opacity: 1,
          duration: 1.5,
          ease: 'expo.out',
        });
      },
    });
  }
}

/* ===========================================
   GLOBAL — parallax on .illustration-parallax
   =========================================== */
function initIllustrationParallax(gsap: GSAP, ScrollTrigger: ST): void {
  const els = document.querySelectorAll<HTMLElement>('.illustration-parallax');
  els.forEach((el) => {
    const section = el.closest('section');
    if (!section) return;
    gsap.to(el, {
      yPercent: 8,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });
}

/* ===========================================
   GLOBAL — scroll progress bar
   =========================================== */
function initScrollProgressBar(ScrollTrigger: ST): void {
  const progressBar = document.getElementById('scroll-progress');
  if (!progressBar) return;

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self: { progress: number }) => {
      progressBar.style.width = (self.progress * 100) + '%';
    },
  });
}

/* ===========================================
   GLOBAL — cursor glow following mouse
   =========================================== */
function initCursorGlow(gsap: GSAP): void {
  const glow = document.getElementById('cursor-glow');
  if (!glow) return;

  // Hide on touch devices
  if ('ontouchstart' in window) {
    glow.style.display = 'none';
    return;
  }

  let mouseX = -400;
  let mouseY = -400;
  let currentX = -400;
  let currentY = -400;

  document.addEventListener('mousemove', (e: MouseEvent) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    glow.style.opacity = '1';
  });

  document.addEventListener('mouseleave', () => {
    glow.style.opacity = '0';
  });

  // Lerp loop for smooth following
  gsap.ticker.add(() => {
    const lerp = 0.1;
    currentX += (mouseX - currentX) * lerp;
    currentY += (mouseY - currentY) * lerp;
    glow.style.left = currentX + 'px';
    glow.style.top = currentY + 'px';
  });
}

/* ===========================================
   GLOBAL — text scramble for data-scramble
   =========================================== */
function initTextScramble(ScrollTrigger: ST): void {
  const elements = document.querySelectorAll<HTMLElement>('[data-scramble]');
  if (elements.length === 0) return;

  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

  elements.forEach((el) => {
    const finalText = el.textContent || '';
    let scrambled = false;

    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        if (scrambled) return;
        scrambled = true;

        let iteration = 0;
        const maxIterations = 20;
        const interval = setInterval(() => {
          el.textContent = finalText
            .split('')
            .map((char, index) => {
              if (index < (iteration / maxIterations) * finalText.length) {
                return finalText[index];
              }
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join('');

          iteration++;
          if (iteration > maxIterations) {
            clearInterval(interval);
            el.textContent = finalText;
          }
        }, 30);
      },
    });
  });
}

/* ===========================================
   GLOBAL — magnetic effect on CTA buttons
   =========================================== */
function initMagneticButtons(gsap: GSAP): void {
  const buttons = document.querySelectorAll<HTMLElement>('.magnetic-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, { x: x * 0.2, y: y * 0.2, duration: 0.3, ease: 'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   CINEMATIC AMBIENT — Living Farm Day Systems
   ═══════════════════════════════════════════════════════════ */

/* ===========================================
   SAHYADRI HILLS — parallax 5%
   =========================================== */
function initHillsParallax(gsap: GSAP, ScrollTrigger: ST): void {
  const hills = document.getElementById('hills-img');
  if (!hills) return;

  gsap.to(hills, {
    y: () => window.innerHeight * 0.05,
    ease: 'none',
    scrollTrigger: {
      start: 0,
      end: 'max',
      scrub: true,
    },
  });
}

/* ===========================================
   CURSOR TRANSFORMS — per-section SVG cursors
   Uses IntersectionObserver to track sections
   =========================================== */
function initCursorTransforms(): void {
  // Only on desktop with fine pointer
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const cursorMap: Record<string, string> = {
    'hero':          'kite',
    'guided':        'seedling',
    'problem-hit':   'wilt',
    'before-after':  'seedling',
    'identity-shift':'seedling',
    'workflow':      'mic',
    'clarity':       'mic',
    'value-ladder':  'coin',
    'legacy':        'sun',
    'trust':         'hand',
    'participation': 'hand',
    'cta':           'pen',
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const scene = (entry.target as HTMLElement).dataset.scene ?? '';
          const cursorType = cursorMap[scene] ?? 'leaf';
          document.body.dataset.cursor = cursorType;
        }
      });
    },
    { threshold: 0.4 }
  );

  document.querySelectorAll('[data-scene]').forEach((el) => observer.observe(el));
}

/* ===========================================
   HERO LOAD TIMELINE — cinematic zoom-in
   Plays once on page load (not scroll-driven)
   =========================================== */
function initHeroLoadTimeline(gsap: GSAP): void {
  const heroSection = document.querySelector<HTMLElement>('[data-scene="hero"]');
  if (!heroSection) return;

  const bgLayer = heroSection.querySelector<HTMLElement>('.hero-layer-bg');
  const midLayer = heroSection.querySelector<HTMLElement>('.hero-layer-mid');
  const words = heroSection.querySelectorAll<HTMLElement>('.hero-word');
  const statPills = heroSection.querySelectorAll<HTMLElement>('.stat-pill');

  // Build load timeline
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

  if (bgLayer) {
    tl.from(bgLayer, { scale: 1.4, opacity: 0, duration: 1.2 }, 0);
  }
  if (midLayer) {
    tl.from(midLayer, { opacity: 0, duration: 0.8 }, 0.2);
  }
  if (words.length > 0) {
    tl.from(words, { opacity: 0, y: 24, stagger: 0.06, duration: 0.6 }, 0.8);
  }
  if (statPills.length > 0) {
    tl.from(statPills, { opacity: 0, y: 16, stagger: 0.12, duration: 0.5 }, 1.1);
  }
}

// ──────────────────────────────────────────────────────────────────────
//  TERRA VIVA REVEAL SYSTEM
// ──────────────────────────────────────────────────────────────────────

export function initRevealAnimations(gsap: GSAP, ScrollTrigger: ST): void {
  // ── Standard fade-up reveals ──
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, y: 60 },
      {
        opacity: 1, y: 0,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 82%', once: true },
      }
    );
  });

  // ── 3D card reveals ──
  document.querySelectorAll<HTMLElement>('[data-reveal-3d]').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, rotateX: 18, scale: 0.93, transformPerspective: 1200 },
      {
        opacity: 1, rotateX: 0, scale: 1,
        duration: 0.9,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 80%', once: true },
      }
    );
  });

  // ── 3D staggered groups [data-reveal-3d-group] ──
  document.querySelectorAll<HTMLElement>('[data-reveal-3d-group]').forEach((group) => {
    const children = group.querySelectorAll<HTMLElement>('[data-reveal-3d-item]');
    if (!children.length) return;
    gsap.fromTo(children,
      { opacity: 0, rotateX: 18, scale: 0.93, transformPerspective: 1200 },
      {
        opacity: 1, rotateX: 0, scale: 1,
        duration: 0.9,
        ease: 'expo.out',
        stagger: 0.1,
        scrollTrigger: { trigger: group, start: 'top 80%', once: true },
      }
    );
  });

  // ── Chapter mark clip-path reveals ──
  document.querySelectorAll<HTMLElement>('[data-chapter]').forEach((el) => {
    gsap.fromTo(el,
      { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
      {
        clipPath: 'inset(0 0% 0 0)', opacity: 1,
        duration: 0.7,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      }
    );
  });

  // ── Headline word splits [data-split-headline] ──
  document.querySelectorAll<HTMLElement>('[data-split-headline]').forEach((el) => {
    // Manual word split — no SplitText plugin needed
    const original = el.innerHTML;
    const words = original.split(/(\s+)/);
    el.innerHTML = words
      .map((part) =>
        part.trim()
          ? `<span class="split-word" style="display:inline-block;overflow:hidden;vertical-align:bottom;"><span class="split-word-inner" style="display:inline-block;">${part}</span></span>`
          : part
      )
      .join('');

    const inners = el.querySelectorAll<HTMLElement>('.split-word-inner');
    gsap.fromTo(inners,
      { y: '110%', opacity: 0 },
      {
        y: '0%', opacity: 1,
        duration: 0.7,
        ease: 'expo.out',
        stagger: 0.04,
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      }
    );
  });

  // ── Sahyadri hills parallax [data-parallax] ──
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
    const rate = parseFloat(el.dataset.parallaxRate ?? '5') / 100;
    gsap.to(el, {
      y: () => -(window.scrollY * rate),
      ease: 'none',
      scrollTrigger: {
        trigger: document.body,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
      },
    });
  });

  // ── 3D phone entrance [data-phone-3d] ──
  document.querySelectorAll<HTMLElement>('[data-phone-3d]').forEach((el) => {
    gsap.fromTo(el,
      { opacity: 0, rotateY: -30, x: 60, transformPerspective: 800 },
      {
        opacity: 1, rotateY: -14, x: 0,
        duration: 1.2,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      }
    );
  });
}
