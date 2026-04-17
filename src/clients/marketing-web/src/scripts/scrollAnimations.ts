type GSAP = typeof import('gsap')['gsap'];
type ST = typeof import('gsap/ScrollTrigger')['ScrollTrigger'];

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

  initSceneVisibility(ScrollTrigger);
  initSplitHeadlines(gsap, ScrollTrigger);
  initBasicReveals(gsap, ScrollTrigger);
  initThreeDRevealGroups(gsap, ScrollTrigger);
  initParallax(gsap, ScrollTrigger);
  initPathDraw(gsap, ScrollTrigger);
  initCounters(gsap, ScrollTrigger);
  initZoomSections(gsap, ScrollTrigger);
  initHeroPin(gsap, ScrollTrigger);
  initScrollProgressBar(ScrollTrigger);
  initCursorGlow(gsap);
  initMagneticButtons(gsap);

  requestAnimationFrame(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

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

function initBasicReveals(gsap: GSAP, ScrollTrigger: ST): void {
  const nodes = Array.from(
    new Set(
      [
        ...Array.from(document.querySelectorAll<HTMLElement>('.scene-stagger')),
        ...Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]')),
      ],
    ),
  );

  nodes.forEach((node) => {
    if (node.closest('[data-reveal-3d-group]')) {
      return;
    }

    const distance = parseFloat(node.dataset.revealDistance ?? '34');
    const delay = parseFloat(node.dataset.revealDelay ?? '0');
    const duration = parseFloat(node.dataset.revealDuration ?? '0.9');
    const trigger = node.closest<HTMLElement>('[data-scene]') ?? node;

    gsap.set(node, {
      opacity: 0,
      y: distance,
      willChange: 'transform, opacity',
    });

    ScrollTrigger.create({
      trigger,
      start: node.dataset.revealStart ?? 'top 84%',
      once: true,
      onEnter: () => {
        gsap.to(node, {
          opacity: 1,
          y: 0,
          duration,
          delay,
          ease: 'expo.out',
          clearProps: 'willChange',
        });
      },
    });
  });
}

function prepareSplitHeadlines(markVisible: boolean): void {
  document.querySelectorAll<HTMLElement>('[data-split-headline]').forEach((headline) => {
    if (headline.dataset.splitReady === 'true') {
      if (markVisible) {
        headline.querySelectorAll<HTMLElement>('.split-word').forEach((word) => {
          word.style.opacity = '1';
          word.style.transform = 'none';
        });
      }
      return;
    }

    const parts = headline.innerHTML.split(/(<br\s*\/?>)/gi);
    const nextHtml = parts
      .map((part) => {
        if (/^<br/i.test(part)) {
          return part;
        }

        return part
          .split(/(\s+)/)
          .map((token) => {
            if (!token.trim()) {
              return token;
            }
            return `<span class="split-word">${token}</span>`;
          })
          .join('');
      })
      .join('');

    headline.innerHTML = nextHtml;
    headline.dataset.splitReady = 'true';

    if (markVisible) {
      headline.querySelectorAll<HTMLElement>('.split-word').forEach((word) => {
        word.style.opacity = '1';
        word.style.transform = 'none';
      });
    }
  });
}

function initSplitHeadlines(gsap: GSAP, ScrollTrigger: ST): void {
  prepareSplitHeadlines(false);

  document.querySelectorAll<HTMLElement>('[data-split-headline]').forEach((headline) => {
    const words = headline.querySelectorAll<HTMLElement>('.split-word');
    if (words.length === 0) {
      return;
    }

    gsap.set(words, {
      opacity: 0,
      yPercent: 120,
      rotateX: -70,
      transformOrigin: '50% 100%',
      display: 'inline-block',
      willChange: 'transform, opacity',
    });

    ScrollTrigger.create({
      trigger: headline,
      start: 'top 84%',
      once: true,
      onEnter: () => {
        gsap.to(words, {
          opacity: 1,
          yPercent: 0,
          rotateX: 0,
          duration: 0.95,
          stagger: 0.035,
          ease: 'expo.out',
          clearProps: 'willChange',
        });
      },
    });
  });
}

function initThreeDRevealGroups(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-reveal-3d-group]').forEach((group) => {
    const items = group.querySelectorAll<HTMLElement>('[data-reveal-3d-item]');
    if (items.length === 0) {
      return;
    }

    gsap.set(items, {
      opacity: 0,
      y: 36,
      rotateX: 16,
      scale: 0.94,
      transformPerspective: 1200,
      transformOrigin: '50% 100%',
      willChange: 'transform, opacity',
    });

    ScrollTrigger.create({
      trigger: group,
      start: group.dataset.revealStart ?? 'top 84%',
      once: true,
      onEnter: () => {
        gsap.to(items, {
          opacity: 1,
          y: 0,
          rotateX: 0,
          scale: 1,
          duration: 0.95,
          stagger: 0.09,
          ease: 'expo.out',
          clearProps: 'willChange',
        });
      },
    });
  });
}

function initParallax(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((layer) => {
    const rate = parseFloat(layer.dataset.parallaxRate ?? '6');
    const trigger = layer.closest<HTMLElement>('[data-scene]') ?? layer;

    gsap.to(layer, {
      yPercent: -rate,
      ease: 'none',
      scrollTrigger: {
        trigger,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });
}

function initPathDraw(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<SVGElement>('[data-draw-path]').forEach((rawEl) => {
    const el = rawEl as SVGElement & { getTotalLength?: () => number };
    const totalLength = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 320;
    const delay = parseFloat(rawEl.dataset.drawDelay ?? '0');
    const duration = parseFloat(rawEl.dataset.drawDur ?? '1.2');
    const trigger = rawEl.closest<HTMLElement>('[data-scene]') ?? rawEl;

    gsap.set(rawEl, {
      strokeDasharray: totalLength,
      strokeDashoffset: totalLength,
    });

    ScrollTrigger.create({
      trigger,
      start: rawEl.dataset.drawStart ?? 'top 80%',
      once: true,
      onEnter: () => {
        gsap.to(rawEl, {
          strokeDashoffset: 0,
          duration,
          delay,
          ease: 'power2.inOut',
        });
      },
    });
  });
}

function initCounters(gsap: GSAP, ScrollTrigger: ST): void {
  const counterNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-counter]'));

  document.querySelectorAll<HTMLElement>('[data-target], [data-count]').forEach((node) => {
    if (!counterNodes.includes(node)) {
      counterNodes.push(node);
    }
  });

  counterNodes.forEach((node) => {
    const rawTarget = node.dataset.counter ?? node.dataset.target ?? node.dataset.count;
    if (!rawTarget) {
      return;
    }

    const target = parseFloat(rawTarget);
    if (Number.isNaN(target)) {
      return;
    }

    const prefix = node.dataset.counterPrefix ?? '';
    const suffix = node.dataset.counterSuffix ?? node.dataset.suffix ?? '';
    const duration = parseFloat(node.dataset.counterDur ?? '1.6');
    const decimals = Number.isInteger(target) ? 0 : 1;
    const trigger = node.closest<HTMLElement>('[data-scene]') ?? node;
    const state = { value: 0 };

    node.textContent = `${prefix}${decimals ? target.toFixed(decimals).replace(/\d/g, '0') : '0'}${suffix}`;

    ScrollTrigger.create({
      trigger,
      start: node.dataset.counterStart ?? 'top 84%',
      once: true,
      onEnter: () => {
        gsap.to(state, {
          value: target,
          duration,
          ease: 'power2.out',
          snap: decimals === 0 ? { value: 1 } : undefined,
          onUpdate: () => {
            const nextValue = decimals > 0 ? state.value.toFixed(decimals) : Math.round(state.value).toString();
            node.textContent = `${prefix}${nextValue}${suffix}`;
          },
        });
      },
    });
  });
}

function initZoomSections(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-zoom-section]').forEach((node) => {
    const fromScale = parseFloat(node.dataset.zoomFromScale ?? '0.88');
    const fromY = parseFloat(node.dataset.zoomFromY ?? '56');
    const scrub = node.dataset.zoomScrub === 'true';
    const trigger = node.closest<HTMLElement>('[data-scene]') ?? node;

    gsap.set(node, {
      opacity: 0,
      scale: fromScale,
      y: fromY,
      willChange: 'transform, opacity',
    });

    if (scrub) {
      gsap.to(node, {
        opacity: 1,
        scale: 1,
        y: 0,
        ease: 'none',
        scrollTrigger: {
          trigger,
          start: node.dataset.zoomStart ?? 'top 78%',
          end: node.dataset.zoomEnd ?? 'bottom 52%',
          scrub: true,
        },
      });
      return;
    }

    ScrollTrigger.create({
      trigger,
      start: node.dataset.zoomStart ?? 'top 84%',
      once: true,
      onEnter: () => {
        gsap.to(node, {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 1,
          ease: 'expo.out',
          clearProps: 'willChange',
        });
      },
    });
  });
}

function initHeroPin(gsap: GSAP, ScrollTrigger: ST): void {
  document.querySelectorAll<HTMLElement>('[data-hero-pin]').forEach((section) => {
    const content = section.querySelector<HTMLElement>('[data-hero-content]');
    const phone = section.querySelector<HTMLElement>('[data-hero-phone]');
    const whiteCard = section.querySelector<HTMLElement>('[data-hero-white-card]');
    const scrollHint = section.querySelector<HTMLElement>('[data-hero-scrollhint]');
    const rim = section.querySelector<HTMLElement>('[data-hero-rim]');

    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: '+=130%',
        pin: true,
        scrub: 1,
        anticipatePin: 1,
      },
    });

    if (content) {
      timeline.to(content, {
        y: -64,
        opacity: 0.34,
        ease: 'none',
      }, 0);
    }

    if (phone) {
      timeline.to(phone, {
        x: -18,
        y: -96,
        scale: 1.08,
        rotateY: -4,
        rotateX: 1,
        ease: 'none',
      }, 0);
    }

    if (whiteCard) {
      timeline.to(whiteCard, {
        x: -24,
        y: -72,
        scale: 1.05,
        rotation: -3,
        ease: 'none',
      }, 0.05);
    }

    if (rim) {
      timeline.to(rim, {
        opacity: 0.46,
        scale: 1.12,
        ease: 'none',
      }, 0);
    }

    if (scrollHint) {
      timeline.to(scrollHint, {
        opacity: 0,
        y: -12,
        ease: 'none',
      }, 0);
    }
  });
}

function initScrollProgressBar(ScrollTrigger: ST): void {
  const bar = document.getElementById('scroll-progress');
  if (!bar) {
    return;
  }

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self: { progress: number }) => {
      bar.style.width = `${self.progress * 100}%`;
    },
  });
}

function initCursorGlow(gsap: GSAP): void {
  const glow = document.getElementById('cursor-glow');
  if (!glow || !window.matchMedia('(pointer:fine)').matches) {
    return;
  }

  let targetX = -320;
  let targetY = -320;
  let currentX = -320;
  let currentY = -320;

  document.addEventListener('mousemove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    glow.style.opacity = '1';
  });

  document.addEventListener('mouseleave', () => {
    glow.style.opacity = '0';
  });

  gsap.ticker.add(() => {
    currentX += (targetX - currentX) * 0.12;
    currentY += (targetY - currentY) * 0.12;
    glow.style.left = `${currentX}px`;
    glow.style.top = `${currentY}px`;
  });
}

function initMagneticButtons(gsap: GSAP): void {
  document.querySelectorAll<HTMLElement>('.magnetic-btn').forEach((button) => {
    button.addEventListener('mousemove', (event: MouseEvent) => {
      const rect = button.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      gsap.to(button, {
        x: x * 0.18,
        y: y * 0.18,
        duration: 0.25,
        ease: 'power2.out',
      });
    });

    button.addEventListener('mouseleave', () => {
      gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.45,
        ease: 'elastic.out(1, 0.45)',
      });
    });
  });
}

function initCursorTransforms(): void {
  if (!window.matchMedia('(pointer:fine)').matches) {
    return;
  }

  const body = document.body;
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scene][data-cursor]'));
  if (sections.length === 0) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      const nextCursor = visible?.target instanceof HTMLElement ? visible.target.dataset.cursor : undefined;
      if (nextCursor) {
        body.dataset.cursor = nextCursor;
      }
    },
    {
      threshold: [0.2, 0.4, 0.6],
      rootMargin: '-20% 0px -20% 0px',
    },
  );

  sections.forEach((section) => observer.observe(section));
}
