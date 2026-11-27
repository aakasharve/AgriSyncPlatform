/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - the phone's two calls to the person's OWN card on the server:
 *
 *   GET /user/auth/me/identity   his card (version 0 and every part null for a person who never saved)
 *   PUT /user/auth/me/identity   a WHOLE replace; 200 = the card as stored (+ `downgraded`), 400 identity.*, 409 identity.stale (+ currentVersion)
 *
 * Through the app's signed-in axios client (`agriSyncClient.http`): it carries the access token, `X-App-Version` (stored by the server, E9) and the
 * device id, and refreshes the session once on a 401. NOT a sync mutation: the card is per person, not per farm (contract 3.1). The body never
 * names a user (the server takes the token's person) and never a Farmer ID status (always Unverified).
 *
 * Every answer becomes a value, never a throw. The card is read leniently: a field a newer server adds is dropped (P11).
 */
import { z } from 'zod';

const NameSchema = z.object({ value: z.string(), basis: z.string() });
const PlaceSchema = z.object({
    lgdCode: z.number().int().nullable(),
    nameMr: z.string().nullable(),
    nameEn: z.string().nullable(),
    basis: z.string(),
});

const CardSchema = z.object({
    userId: z.string(),
    version: z.number().int(),
    fullName: z.string(),
    fullNameScript: z.string(),
    nameMr: NameSchema.nullable(),
    nameEn: NameSchema.nullable(),
    phone: z.string(),
    phoneVerifiedAtUtc: z.string().nullable(),
    farmerId: z.object({ value: z.string(), status: z.string() }).nullable(),
    village: PlaceSchema.nullable(),
    taluka: PlaceSchema.nullable(),
    district: PlaceSchema.nullable(),
    placeListVersion: z.string().nullable(),
    pinCode: NameSchema.nullable(),
    photo: z.object({ pictureId: z.string(), sha256: z.string() }).nullable(),
    complete: z.boolean(),
    updatedAtUtc: z.string().nullable(),
    downgraded: z.array(z.string()).optional(),
});

export type MyIdentity = z.infer<typeof CardSchema>;
export type IdentityPlaceDto = z.infer<typeof PlaceSchema>;

export type NameBasis = 'Typed' | 'ConvertedConfirmed';
export type PinBasis = 'Typed' | 'FromVillageList';
export type PlacePart = { lgdCode: number; typedFallback?: string } | { typed: string };

export interface IdentityPutBody {
    expectedVersion: number;
    fullName: string;
    nameMr: { value: string; basis: NameBasis } | null;
    nameEn: { value: string; basis: NameBasis } | null;
    farmerId: string | null;
    village: PlacePart | null;
    taluka: PlacePart | null;
    district: PlacePart | null;
    placeListVersion: string | null;
    pinCode: { value: string; basis: PinBasis } | null;
}

export type IdentityCallResult =
    | { kind: 'ok'; card: MyIdentity }
    | { kind: 'stale'; currentVersion: number | null }
    | { kind: 'refused'; code: string }
    | { kind: 'offline' }
    | { kind: 'failed'; status: number };

/** The two requests, as the axios client answers them (a non-2xx throws with `response`). Injected in tests. */
export interface IdentityHttp {
    get(url: string): Promise<{ status: number; data: unknown }>;
    put(url: string, body: unknown): Promise<{ status: number; data: unknown }>;
}

const PATH = '/user/auth/me/identity';

async function defaultHttp(): Promise<IdentityHttp> {
    const { agriSyncClient } = await import('../../infrastructure/api/AgriSyncClient');
    return agriSyncClient.http;
}

function cardFrom(status: number, data: unknown): IdentityCallResult {
    const parsed = CardSchema.safeParse(data);
    return parsed.success ? { kind: 'ok', card: parsed.data } : { kind: 'failed', status };
}

function fromError(err: unknown): IdentityCallResult {
    const response = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (!response || typeof response.status !== 'number') return { kind: 'offline' };
    const body = (response.data ?? {}) as { error?: unknown; currentVersion?: unknown };
    const code = typeof body.error === 'string' ? body.error : '';
    if (response.status === 409 && code === 'identity.stale') {
        return { kind: 'stale', currentVersion: typeof body.currentVersion === 'number' ? body.currentVersion : null };
    }
    if (response.status === 400 && code.startsWith('identity.')) return { kind: 'refused', code };
    return { kind: 'failed', status: response.status };
}

export async function getMyIdentity(http?: IdentityHttp): Promise<IdentityCallResult> {
    try {
        const client = http ?? await defaultHttp();
        const response = await client.get(PATH);
        return cardFrom(response.status, response.data);
    } catch (err) {
        return fromError(err);
    }
}

export async function putMyIdentity(body: IdentityPutBody, http?: IdentityHttp): Promise<IdentityCallResult> {
    try {
        const client = http ?? await defaultHttp();
        const response = await client.put(PATH, body);
        return cardFrom(response.status, response.data);
    } catch (err) {
        return fromError(err);
    }
}
