/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B2) — "when this has been in view for a moment, do this", for the product
 * flash card: the check card that pops by itself when the "तपासायची" row is in view, and the snap back once its end has been in view.
 *
 * Driven by the browser's IntersectionObserver inside the card's own scroll box (`root`): the element must be at least `threshold` in
 * view for `delayMs` without leaving; leaving cancels. It fires once per mount while `enabled`. Where the browser has no
 * IntersectionObserver nothing fires by itself — every action it stands for also has a button.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface WhenInViewOptions {
    threshold: number;
    delayMs: number;
    enabled: boolean;
    onFire: () => void;
}

export function useWhenInView(target: RefObject<Element | null>, root: RefObject<Element | null>, { threshold, delayMs, enabled, onFire }: WhenInViewOptions): void {
    const fire = useRef(onFire);
    fire.current = onFire;
    useEffect(() => {
        const el = target.current;
        if (!enabled || !el || typeof IntersectionObserver === 'undefined') return undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (done) return;
                if (e.isIntersecting && e.intersectionRatio >= threshold) {
                    if (!timer) timer = setTimeout(() => { timer = null; done = true; fire.current(); }, delayMs);
                } else {
                    cancel();
                }
            }
        }, { root: root.current, threshold: [0, threshold] });
        io.observe(el);
        return () => { cancel(); io.disconnect(); };
    }, [target, root, threshold, delayMs, enabled]);
}
