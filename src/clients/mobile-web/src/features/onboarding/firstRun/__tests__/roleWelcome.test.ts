/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-7). The role welcome's words come from
 * the REAL role the server gives the seat (both spellings in use read the same), promise only what the
 * app does for that role today, and never invent a farm, plots or a role.
 */
import { describe, it, expect } from 'vitest';
import { buildRoleWelcome, toWelcomeRole } from '../roleWelcome';

describe('toWelcomeRole', () => {
    it.each([
        ['PrimaryOwner', 'owner'], ['PRIMARY_OWNER', 'owner'],
        ['SecondaryOwner', 'coOwner'], ['SECONDARY_OWNER', 'coOwner'],
        ['Mukadam', 'mukadam'], ['MUKADAM', 'mukadam'],
        ['Worker', 'worker'], ['worker', 'worker'],
        ['Agronomist', 'other'], [null, 'other'], ['', 'other'],
    ])('%s → %s', (role, kind) => {
        expect(toWelcomeRole(role)).toBe(kind);
    });
});

describe('buildRoleWelcome', () => {
    it('owner: names the farm he owns and three real jobs', () => {
        const w = buildRoleWelcome('PrimaryOwner', '  आर्वे शेती ', 'mr');
        expect(w.title).toBe('तुमचं शेत तयार आहे');
        expect(w.line).toBe('तुम्ही आर्वे शेती चे मालक आहात.');
        expect(w.jobs.map(j => j.icon)).toEqual(['mic', 'plan', 'team']);
    });

    it('co-owner is told he is सहमालक, not the owner, and gets no "add the team" promise', () => {
        const w = buildRoleWelcome('SecondaryOwner', 'आर्वे शेती', 'mr');
        expect(w.line).toBe('आर्वे शेती वर तुम्ही सहमालक आहात');
        expect(w.jobs.map(j => j.icon)).not.toContain('team');
    });

    it('mukadam: attendance is promised only with the owner\'s permission (the grant rule)', () => {
        const w = buildRoleWelcome('Mukadam', 'पवार मळा', 'mr');
        expect(w.jobs.find(j => j.icon === 'attendance')?.text).toBe('मालकाने परवानगी दिली की हजेरी घ्या');
    });

    it('worker: no work list he does not have, and the typing route', () => {
        const w = buildRoleWelcome('Worker', 'पवार मळा', 'mr');
        expect(w.jobs.map(j => j.text)).toEqual(['काम झालं की बोलून सांगा', 'हाताने लिहूनही सांगता येतं']);
        expect(w.jobs.map(j => j.text).join(' ')).not.toMatch(/आजचं तुमचं काम/);
    });

    it('an adviser role is named, with no list of things it may not be allowed to do', () => {
        const w = buildRoleWelcome('Agronomist', 'पवार मळा', 'mr');
        expect(w.line).toBe('पवार मळा वर तुम्ही कृषितज्ज्ञ आहात');
        expect(w.jobs).toEqual([]);
    });

    it('no farm name → no line (never a sample name)', () => {
        expect(buildRoleWelcome('Worker', null, 'mr').line).toBeNull();
        expect(buildRoleWelcome('PrimaryOwner', '   ', 'mr').line).toBeNull();
    });

    it('English only when English was chosen — one language, never both', () => {
        const w = buildRoleWelcome('Worker', 'Pawar farm', 'en');
        expect(w.title).toBe('Welcome');
        expect(w.line).toBe('On Pawar farm you are: Worker');
        expect(w.jobs.map(j => j.text).join(' ')).not.toMatch(/[ऀ-ॿ]/);
        const mr = buildRoleWelcome('Worker', 'पवार मळा', 'mr');
        expect([mr.title, mr.line, ...mr.jobs.map(j => j.text)].join(' ')).not.toMatch(/[A-Za-z]/);
    });
});
