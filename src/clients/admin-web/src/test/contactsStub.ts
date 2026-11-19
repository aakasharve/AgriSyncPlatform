import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { adminApi } from '@/lib/api';

/**
 * CR-2e: a transport stub that also sees `config.params`, which `stubAdapter` does not capture. The contacts
 * route is called as `get(path, { params: { ids } })`, so its ids are not in `config.url`.
 *
 * `answer(path, params)` returns the body (status 200) or `{ status, data }` for another status. Always `restore()`.
 */
export interface SeenRequest {
  path: string;
  url: string;
  params: Record<string, string>;
}

export interface ContactsStub {
  requests: SeenRequest[];
  /** The requests to the contacts route, in order. */
  contactCalls: () => SeenRequest[];
  /** The ids of one contacts request, sorted. */
  idsOf: (r: SeenRequest) => string[];
  restore: () => void;
}

export const CONTACTS_PATH = '/admin/farms/contacts';

export function installContactsStub(
  answer: (r: SeenRequest) => unknown | Promise<unknown> | { status: number; data: unknown },
  names: Record<string, string> = {},
): ContactsStub {
  const requests: SeenRequest[] = [];
  const previous = adminApi.defaults.adapter;
  adminApi.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    const path = url.split('?')[0];
    const params = { ...((config.params as Record<string, string> | undefined) ?? {}) };
    for (const [k, v] of new URL(url, 'http://x').searchParams.entries()) params[k] = v;
    const seen: SeenRequest = { path, url, params };
    requests.push(seen);

    let status = 200;
    let data: unknown;
    if (path.endsWith(CONTACTS_PATH)) {
      const ids = (params.ids ?? '').split(',').filter(Boolean);
      data = ids.filter((i) => names[i]).map((i) => ({ farmId: i, name: names[i], ownerPhone: '9876543210' }));
    } else {
      const out = (await answer(seen)) as { status?: number; data?: unknown; __raw?: boolean };
      if (out && typeof out === 'object' && 'status' in out && 'data' in out) {
        status = out.status as number;
        data = out.data;
      } else {
        data = out;
      }
    }
    const response = { data, status, statusText: String(status), headers: {}, config } as unknown as AxiosResponse;
    if (status >= 400) {
      return Promise.reject({ response, config, isAxiosError: true, message: `Request failed with status code ${status}` });
    }
    return response;
  }) as AxiosAdapter;

  const contactCalls = () => requests.filter((r) => r.path.endsWith(CONTACTS_PATH));
  const idsOf = (r: SeenRequest) => (r.params.ids ?? '').split(',').filter(Boolean).sort();
  return { requests, contactCalls, idsOf, restore: () => { adminApi.defaults.adapter = previous; } };
}
