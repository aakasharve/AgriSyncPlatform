import type { Page, Request } from '@playwright/test';

export interface CapturedTraceparent {
  url: string;
  traceparent: string;
}

export function captureTraceparents(page: Page): CapturedTraceparent[] {
  const captured: CapturedTraceparent[] = [];
  page.on('request', (req: Request) => {
    const headers = req.headers();
    const tp = headers['traceparent'];
    if (tp) {
      captured.push({ url: req.url(), traceparent: tp });
    }
  });
  return captured;
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function isWellFormedTraceparent(value: string): boolean {
  return TRACEPARENT_RE.test(value);
}
