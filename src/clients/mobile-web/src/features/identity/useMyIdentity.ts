/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; doctrine P10, P3) - the signed-in person's own card on the phone.
 *
 *   - The server's answer is the truth; a copy is kept on the phone for display only (`identity:card:<userId>`, disposable).
 *   - A save says "माहिती जतन झाली" ONLY after the server's 200. Offline or failed, the card waits in ONE pending slot per person
 *     (`identity:pending:<userId>`, unsynchronised intent) as "पाठवायचं बाकी", and is sent again when the network returns or the card opens again.
 *     The identity step is never पूर्ण from that slot: only the server's `complete` counts.
 *   - 409 identity.stale (another phone saved first): nothing is overwritten. The slot is cleared, the server's newer card is read again and shown,
 *     and his edits stay in the form for him to look at and save again (P3: never a silent overwrite).
 *   - 400 (a rule broken): the slot is cleared (the same card would be refused again) and the refusal is kept for the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { getMyIdentity, putMyIdentity, type IdentityCallResult, type IdentityPutBody, type MyIdentity } from './identityApi';
import { bodyFromForm, type IdentityForm } from './identityForm';

export interface IdentityApi {
    get(): Promise<IdentityCallResult>;
    put(body: IdentityPutBody): Promise<IdentityCallResult>;
}

const REAL_API: IdentityApi = { get: () => getMyIdentity(), put: body => putMyIdentity(body) };

export interface PendingSave {
    body: IdentityPutBody;
    /** The form as he left it, so the card shows his unsent edits when it opens again. */
    form: IdentityForm;
    at: string;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'pending' | 'stale' | 'refused';

export interface MyIdentityState {
    /** The server's card (this visit's answer, else the copy from the last one); null = never read. */
    card: MyIdentity | null;
    /** The phone's copies are read and the first ask of the server has answered (either way). */
    loaded: boolean;
    pending: PendingSave | null;
    saveState: SaveState;
    refusedCode: string | null;
    /** The form of a save another phone overtook (409): still shown to him beside the server's newer card, never thrown away silently. */
    unsentForm: IdentityForm | null;
    save(form: IdentityForm): Promise<void>;
    reload(): Promise<void>;
}

export const identityCardKey = (userId: string) => `identity:card:${userId}`;
export const identityPendingKey = (userId: string) => `identity:pending:${userId}`;

export function useMyIdentity(userId: string | null | undefined, api: IdentityApi = REAL_API): MyIdentityState {
    const who = userId ?? '__signed_out__';
    const [copy, setCopy, copyLoaded] = useUiPref<MyIdentity | null>(identityCardKey(who), null);
    const [pending, setPending, pendingLoaded] = useUiPref<PendingSave | null>(identityPendingKey(who), null);
    const [fresh, setFresh] = useState<MyIdentity | null>(null);
    const [asked, setAsked] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [refusedCode, setRefusedCode] = useState<string | null>(null);
    const [unsentForm, setUnsentForm] = useState<IdentityForm | null>(null);
    const sending = useRef(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    // A different person on the phone starts from nothing (never the previous person's card).
    const [forUser, setForUser] = useState(who);
    if (forUser !== who) {
        setForUser(who);
        setFresh(null);
        setAsked(false);
        setSaveState('idle');
        setRefusedCode(null);
        setUnsentForm(null);
    }

    // The copy is kept per person (its key names him), so it is his.
    const card = fresh ?? (userId ? copy : null);

    const keep = useCallback((next: MyIdentity) => {
        if (!alive.current) return;
        setFresh(next);
        setCopy(next);
        // setCopy is a fresh function each render; the key it writes is the one of this render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [who]);

    const reload = useCallback(async () => {
        if (!userId) return;
        const r = await api.get();
        if (r.kind === 'ok') keep(r.card);
        if (alive.current) setAsked(true);
    }, [api, userId, keep]);

    useEffect(() => { void reload(); }, [reload]);

    const send = useCallback(async (body: IdentityPutBody, form: IdentityForm) => {
        if (!userId || sending.current) return;
        sending.current = true;
        setSaveState('saving');
        setRefusedCode(null);
        setUnsentForm(null);
        try {
            const r = await api.put(body);
            if (!alive.current) return;
            if (r.kind === 'ok') {
                keep(r.card);
                setPending(null);
                setSaveState('saved');
            } else if (r.kind === 'stale') {
                setPending(null);
                setUnsentForm(form);
                setSaveState('stale');
                const again = await api.get();
                if (again.kind === 'ok') keep(again.card);
            } else if (r.kind === 'refused') {
                setPending(null);
                setRefusedCode(r.code);
                setSaveState('refused');
            } else {
                setPending({ body, form, at: new Date().toISOString() });
                setSaveState('pending');
            }
        } finally {
            sending.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, userId, keep, who]);

    const save = useCallback(async (form: IdentityForm) => {
        await send(bodyFromForm(form, card?.version ?? 0), form);
    }, [send, card?.version]);

    // An unsent card waits for the network: sent when the card opens again and whenever the phone comes back online.
    const pendingRef = useRef(pending);
    pendingRef.current = pending;
    useEffect(() => {
        if (!userId || !pendingLoaded || !pending) return;
        setSaveState(s => (s === 'idle' ? 'pending' : s));
        void send(pending.body, pending.form);
        // Only when the slot is first read: a slot written by a failed send waits for the network below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, pendingLoaded]);
    useEffect(() => {
        if (!userId) return undefined;
        const online = () => { const p = pendingRef.current; if (p) void send(p.body, p.form); };
        window.addEventListener('online', online);
        return () => window.removeEventListener('online', online);
    }, [userId, send]);

    return {
        card,
        loaded: copyLoaded && pendingLoaded && (asked || !userId),
        pending: pending && userId ? pending : null,
        saveState,
        refusedCode,
        unsentForm,
        save,
        reload,
    };
}
