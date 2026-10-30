// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * F69 (lane RF2 fix pass) — the app reports ONE version, the real release (`buildInfo.APP_VERSION`, kept in lockstep with
 * the Android versionName). It used to send `package.json`'s "0.9.0": the server refused `revise_log_content` ("requires
 * app >= 1.0.0; client reports 0.9.0"), parked as REJECTED_USER_REVIEW on the phone, and the same wrong value went into
 * consent records.
 */
import { describe, expect, it } from 'vitest';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { APP_VERSION as RELEASE } from '../../../buildInfo';
import { APP_VERSION } from '../transport';
import { AgriSyncClient } from '../AgriSyncClient';

type Handler = { fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig> };
const handlersOf = (instance: AgriSyncClient['http']): Handler[] =>
    ((instance.interceptors.request as unknown as { handlers: Array<Handler | null> }).handlers).filter((h): h is Handler => !!h);

const run = async (instance: AgriSyncClient['http']): Promise<InternalAxiosRequestConfig> => {
    let config = { headers: new AxiosHeaders(), url: '/x' } as InternalAxiosRequestConfig;
    for (const h of handlersOf(instance)) config = await h.fulfilled(config);
    return config;
};

describe('F69 — one app version, the real release', () => {
    it('transport re-exports buildInfo\'s release version (never package.json\'s 0.9.0)', () => {
        expect(APP_VERSION).toBe(RELEASE);
        expect(APP_VERSION).not.toBe('0.9.0');
    });

    it('every request carries X-App-Version = buildInfo.APP_VERSION (the app API and the auth API)', async () => {
        const client = new AgriSyncClient();
        expect((await run(client.http)).headers.get('X-App-Version')).toBe(RELEASE);
        expect((await run(client.authHttp)).headers.get('X-App-Version')).toBe(RELEASE);
    });
});
