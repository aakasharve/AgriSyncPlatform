import { useEffect, useRef, useState } from 'react';

const INITIAL_BATCH = 40; // Load the opening sequence immediately for smooth first paint
export const FRAMESET_VERSION = 'improved-v2';

function framePath(n: number): string {
  return `/frames/shramsafal/ezgif-frame-${String(n).padStart(3, '0')}.jpg?v=${FRAMESET_VERSION}`;
}

export interface FrameSequence {
  getFrame: (index: number) => HTMLImageElement | null;
  loadedCount: number;
  totalFrames: number;
  firstBatchReady: boolean;
}

export function useFrameSequence(totalFrames = 240): FrameSequence {
  const images = useRef<(HTMLImageElement | null)[]>(Array(totalFrames).fill(null));
  const [loadedCount, setLoadedCount] = useState(0);
  const loadedRef = useRef(0);
  const [firstBatchReady, setFirstBatchReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = (n: number): Promise<void> =>
      new Promise((resolve) => {
        if (images.current[n - 1]) { resolve(); return; }
        const img = new Image();
        img.onload = () => {
          if (!mounted) { resolve(); return; }
          images.current[n - 1] = img;
          loadedRef.current += 1;
          setLoadedCount(loadedRef.current);
          resolve();
        };
        img.onerror = () => resolve(); // silent fail — canvas just skips
        img.src = framePath(n);
      });

    // Priority: first batch (greeting + opening landscape)
    const initial = Array.from({ length: INITIAL_BATCH }, (_, i) => load(i + 1));
    Promise.all(initial).then(() => {
      if (mounted) setFirstBatchReady(true);
      // Background: rest of frames in small chunks to avoid main-thread pressure
      const rest = totalFrames - INITIAL_BATCH;
      let idx = INITIAL_BATCH + 1;
      const loadChunk = () => {
        if (!mounted || idx > totalFrames) return;
        const chunk = Array.from({ length: Math.min(20, totalFrames - idx + 1) }, (_, i) =>
          load(idx + i)
        );
        idx += 20;
        Promise.all(chunk).then(() => requestIdleCallback ? requestIdleCallback(loadChunk) : setTimeout(loadChunk, 50));
      };
      if (rest > 0) requestIdleCallback ? requestIdleCallback(loadChunk) : setTimeout(loadChunk, 100);
    });

    return () => { mounted = false; };
  }, [totalFrames]);

  const getFrame = (index: number): HTMLImageElement | null =>
    images.current[Math.max(0, Math.min(totalFrames - 1, Math.round(index)))];

  return { getFrame, loadedCount, totalFrames, firstBatchReady };
}
