/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-7) — the LAST first-run screen says,
 * for the person's REAL role on the open farm (`role` from the server, never chosen by him), what he
 * will do in this app. Pure, so the words for each role are tested without rendering.
 *
 * Every line names something the app really does for that role TODAY (doctrine P5 — no promise the
 * app cannot keep). Where the approved preview (plr-d1a `FirstRunFlow.tsx` HELLO) promised more than
 * the real app has, the line was cut or narrowed, and the report says so:
 *   - owner "कामं ठरवा आणि सोपवा": assigning work to a person is not built (PLR-D6) → "कामं ठरवा";
 *   - mukadam "रोज हजेरी घ्या": attendance opens only when the owner has granted it
 *     (`features/labour/attendanceDoor.ts`) → said with that condition;
 *   - worker "आजचं तुमचं काम इथे दिसेल": no per-worker work list exists yet → not promised;
 *   - "प्लॉट: …": plot scope is not real until PLR-D7 → never shown;
 *   - an adviser role (not in the preview) gets the farm and the role, and no list.
 */
import type { Language } from '../../../i18n/language';
import { getOperatorRoleLabel } from '../../../shared/roles/roleLabels';

export type WelcomeRole = 'owner' | 'coOwner' | 'mukadam' | 'worker' | 'other';
export type JobIcon = 'mic' | 'plan' | 'team' | 'attendance' | 'type';

export interface RoleWelcome {
    role: WelcomeRole;
    title: string;
    /** One line naming the farm and the role, or null when the farm has no name to show. */
    line: string | null;
    jobs: { icon: JobIcon; text: string }[];
}

/** Server role codes (PascalCase) and the profile's SCREAMING_SNAKE both read the same. */
export const toWelcomeRole = (role: string | null | undefined): WelcomeRole => {
    const r = (role ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (r === 'primaryowner' || r === 'owner') return 'owner';
    if (r === 'secondaryowner') return 'coOwner';
    if (r === 'mukadam') return 'mukadam';
    if (r === 'worker') return 'worker';
    return 'other';
};

const roleName = (role: string | null | undefined, language: Language): string => {
    const label = getOperatorRoleLabel(role);
    return language === 'en' ? label.en : label.mr;
};

export function buildRoleWelcome(role: string | null | undefined, farmName: string | null | undefined, language: Language): RoleWelcome {
    const kind = toWelcomeRole(role);
    const farm = farmName?.trim() || null;
    const en = language === 'en';
    const name = roleName(role, language);

    if (kind === 'owner') {
        return {
            role: kind,
            title: en ? 'Your farm is ready' : 'तुमचं शेत तयार आहे',
            line: farm ? (en ? `You are the owner of ${farm}.` : `तुम्ही ${farm} चे मालक आहात.`) : null,
            jobs: [
                { icon: 'mic', text: en ? 'Tell what happened each day, by voice' : 'रोज काय झालं ते बोलून सांगा' },
                { icon: 'plan', text: en ? 'Plan the work' : 'कामं ठरवा' }, // PROPOSED (Marathi) — the preview's line without "आणि सोपवा"
                { icon: 'team', text: en ? 'Add your team — show the QR' : 'टीम जोडा — QR दाखवा' },
            ],
        };
    }

    const team = en ? 'You are in the team' : 'तुम्ही टीममध्ये आहात';
    const seat = farm ? (en ? `On ${farm} you are: ${name}` : `${farm} वर तुम्ही ${name} आहात`) : null;

    if (kind === 'coOwner') {
        return {
            role: kind,
            title: team,
            line: seat,
            jobs: [
                { icon: 'mic', text: en ? 'Tell what happened each day, by voice' : 'रोज काय झालं ते बोलून सांगा' },
                { icon: 'plan', text: en ? 'Plan the work' : 'कामं ठरवा' }, // PROPOSED (Marathi)
            ],
        };
    }
    if (kind === 'mukadam') {
        return {
            role: kind,
            title: team,
            line: seat,
            jobs: [
                { icon: 'mic', text: en ? 'Tell the work done, by voice' : 'झालेलं काम बोलून सांगा' },
                // PROPOSED (Marathi) — attendance needs the owner's grant (attendanceDoor.ts)
                { icon: 'attendance', text: en ? 'Take attendance once the owner allows it' : 'मालकाने परवानगी दिली की हजेरी घ्या' },
            ],
        };
    }
    if (kind === 'worker') {
        return {
            role: kind,
            title: en ? 'Welcome' : 'स्वागत आहे',
            line: seat,
            jobs: [
                { icon: 'mic', text: en ? 'When the work is done, say it by voice' : 'काम झालं की बोलून सांगा' },
                // PROPOSED (Marathi) — manual entry is always open (devicePermissions.ts MANUAL_ENTRY_ALWAYS_AVAILABLE)
                { icon: 'type', text: en ? 'You can also type it' : 'हाताने लिहूनही सांगता येतं' },
            ],
        };
    }
    // An adviser role (कृषितज्ज्ञ, सल्लागार…): what they may do depends on grants this screen cannot
    // see, so it names the farm and the role and promises nothing more.
    return { role: kind, title: team, line: seat, jobs: [] };
}
