// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// The two optional switches of the permissions page, as he left them when he tapped "मी वाचलं, पुढे चला", kept on the
// phone until there is an account to write them to. The page runs BEFORE sign-in, and each switch is its own optional
// purpose with its own server record that only a signed-in person can write; so the choice is held here as
// UNSYNCHRONISED INTENT (doctrine P10) and written once the person has signed in (`heldSwitchChoices.ts`).
//
// Same storage rules as `ConsentGateLinkStore` (read that header): uiPrefs (no Dexie bump, not cleared on a user
// switch); saved into the active database (the pre-login one on the number screen); read from the active one and then
// the pre-login one; bound to the FIRST account that signs in after it, never re-bound; cleared from both. Nothing here
// throws.

import { getDatabase, type AgriLogDatabase } from './DexieDatabase';
import { withPreLoginDatabase } from './preLoginDatabase';

export const HELD_SWITCH_CHOICES_PREF_KEY = 'shramsafal_permissions_page_switches';

export interface HeldSwitchChoices {
    /** "मूळ आवाज ऐकू देणे" as he left it on the page. */
    voicePlayback: boolean;
    /** "माझ्या अनुभवातून श्रमसफल अधिक सक्षम होऊ द्या" as he left it on the page. */
    improvement: boolean;
    /** The language the page was shown in. */
    language: 'mr' | 'en';
    /** The pre-registration session id of the acceptance it came with (one acceptance, one set of choices). */
    preRegistrationSessionId: string;
    /** The first account that signed in after it; set once, never overwritten. */
    claimedByUserId?: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function isHeldSwitchChoices(value: unknown): value is HeldSwitchChoices {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.voicePlayback === 'boolean'
        && typeof v.improvement === 'boolean'
        && (v.language === 'mr' || v.language === 'en')
        && isText(v.preRegistrationSessionId)
        && (v.claimedByUserId === undefined || isText(v.claimedByUserId));
}

async function readFrom(db: AgriLogDatabase): Promise<HeldSwitchChoices | null> {
    const row = await db.uiPrefs.get(HELD_SWITCH_CHOICES_PREF_KEY);
    return isHeldSwitchChoices(row?.value) ? row.value : null;
}

/** Holds the choices of the acceptance just recorded. A newer acceptance replaces an older one. Never throws. */
export async function saveHeldSwitchChoices(choices: HeldSwitchChoices): Promise<void> {
    try {
        await getDatabase().uiPrefs.put({ key: HELD_SWITCH_CHOICES_PREF_KEY, value: { ...choices } });
    } catch {
        // Not held: the switches stay what the server holds (OFF for a new account). Never the farmer's problem.
    }
}

async function locate(): Promise<{ held: HeldSwitchChoices; home: 'active' | 'preLogin' } | null> {
    try {
        const active = await readFrom(getDatabase());
        if (active) return { held: active, home: 'active' };
    } catch {
        // fall through to the pre-login database
    }
    const preLogin = await withPreLoginDatabase(readFrom, null);
    return preLogin ? { held: preLogin, home: 'preLogin' } : null;
}

export async function readHeldSwitchChoices(): Promise<HeldSwitchChoices | null> {
    return (await locate())?.held ?? null;
}

/** Binds the held choices to the first account that signed in after them, and returns them as they now stand. */
export async function claimHeldSwitchChoices(userId: string): Promise<HeldSwitchChoices | null> {
    const found = await locate();
    if (!found) return null;
    const { held, home } = found;
    if (held.claimedByUserId || !isText(userId)) return held;
    const claimed: HeldSwitchChoices = { ...held, claimedByUserId: userId };
    if (home === 'active') {
        await saveHeldSwitchChoices(claimed);
    } else {
        await withPreLoginDatabase(async (db) => {
            await db.uiPrefs.put({ key: HELD_SWITCH_CHOICES_PREF_KEY, value: claimed });
        }, undefined);
    }
    return claimed;
}

async function clearFrom(db: AgriLogDatabase, sessionId: string): Promise<void> {
    const held = await readFrom(db);
    if (held && held.preRegistrationSessionId !== sessionId) return; // a newer acceptance's choices: keep them
    await db.uiPrefs.delete(HELD_SWITCH_CHOICES_PREF_KEY);
}

/** Drops the choices of THAT acceptance from both databases, once they are written. Never throws. */
export async function clearHeldSwitchChoices(preRegistrationSessionId: string): Promise<void> {
    try {
        await clearFrom(getDatabase(), preRegistrationSessionId);
    } catch {
        // written again next start: each write first reads what the server holds, so a replay changes nothing
    }
    await withPreLoginDatabase((db) => clearFrom(db, preRegistrationSessionId), undefined);
}
