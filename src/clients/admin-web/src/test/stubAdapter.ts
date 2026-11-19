import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { adminApi } from '@/lib/api';

/**
 * Swaps the axios ADAPTER rather than mocking the module.
 *
 * That distinction is the whole point of these tests. `adminApi` carries one
 * request interceptor (lib/api.ts:13-23) and one response interceptor
 * (lib/api.ts:55-87); mocking `adminApi.get` would skip both and characterise
 * nothing. Replacing only the transport leaves the real interceptor chain in
 * place, so what a test observes here is what a browser would send and what a
 * caller would catch.
 *
 * Always `restore()` in an afterEach — `adminApi` is a module singleton shared
 * by every test file in the run.
 */
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

export interface StubbedAdapter {
  /** Every request that reached the transport, in order. */
  requests: CapturedRequest[];
  restore: () => void;
}

/**
 * `handler` returns the status and body the server would send. A status >= 400
 * is rejected the way axios rejects a real HTTP error, so the 401/403/428
 * branches of the response interceptor run for real. A handler that returns a
 * promise which never settles reproduces an in-flight request — that is how the
 * "still loading" characterisations are written.
 */
export function installAdapter(
  handler: (req: CapturedRequest) => Promise<{ status: number; data: unknown }>,
): StubbedAdapter {
  const requests: CapturedRequest[] = [];
  const previous = adminApi.defaults.adapter;

  adminApi.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const req: CapturedRequest = {
      url: config.url ?? '',
      method: (config.method ?? 'get').toLowerCase(),
      headers: config.headers.toJSON() as Record<string, unknown>,
      signal: config.signal as AbortSignal | undefined,
    };
    requests.push(req);

    const { status, data } = await handler(req);
    const response = {
      data,
      status,
      statusText: String(status),
      headers: {},
      config,
    } as unknown as AxiosResponse;

    if (status >= 400) {
      return Promise.reject({
        response,
        config,
        isAxiosError: true,
        message: `Request failed with status code ${status}`,
      });
    }
    return response;
  }) as AxiosAdapter;

  return { requests, restore: () => { adminApi.defaults.adapter = previous; } };
}

/** A transport that accepts the request and never answers. */
export const neverSettles = () => new Promise<{ status: number; data: unknown }>(() => {});
