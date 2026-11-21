/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q) - Sathi's pattern sentences.
 *
 * Every Sathi sentence is wording the founder approved (his rule, 2026-08-16). These patterns are DRAFTS until he ticks them on
 * the approval page: `approved: false` keeps them off every screen. Slots are filled only with what the saved record holds
 * (his work, his products, his counts), never with a guess (P4). No praise or motivation words: the line names his work, which
 * is the respect (founder 2026-11-21: "not motivation but kind of appreciation for each work log he said").
 */
export interface SathiPattern {
    id: string;
    mr: string;
    en: string;
    /** The founder's tick. False = never shown. */
    approved: boolean;
}

export const SATHI_PATTERNS = {
    /** Names each piece of work he logged. Slot: {items}. */
    appreciation: {
        id: 'sathi.appreciation.v1',
        mr: 'आज तुम्ही केलेलं काम नोंदवलं: {items}.',
        en: 'Noted the work you did today: {items}.',
        approved: false,
    },
    /** Added when he also said work still to be done. Slot: {planned}. */
    appreciationPlanned: {
        id: 'sathi.appreciation.planned.v1',
        mr: 'पुढे करायचं म्हणून ठेवलं: {planned}.',
        en: 'Kept as still to do: {planned}.',
        approved: false,
    },
} as const satisfies Record<string, SathiPattern>;

/** Words a Sathi line never uses: praise and motivation (shared with the server's guard). */
export const SATHI_BLACKLIST: readonly string[] = [
    'शाब्बास', 'खूप छान', 'छान', 'उत्तम', 'अभिनंदन', 'भारी', 'keep it up', 'great', 'well done', 'good job',
];

/** Fills `{name}` slots. A slot with no value is an error in the caller, never filled with a guess. */
export function fillPattern(text: string, slots: Readonly<Record<string, string>>): string {
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = slots[name];
        if (value === undefined) throw new Error(`fillPattern: no value for {${name}}`);
        return value;
    });
}
