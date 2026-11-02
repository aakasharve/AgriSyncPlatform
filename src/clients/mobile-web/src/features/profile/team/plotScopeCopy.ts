/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §6, §11.6, §11.7) — the words of WHICH PLOTS a person covers: the row on
 * his team card, the owner's three choices, the overview's title for a person who covers chosen plots, and his totals'
 * label. One language at a time (founder rule: Marathi mode shows only Marathi, English mode only English). The three
 * choice names are the MU design's own words (§2, decided); every other line is NEW wording, PROPOSED, awaiting the
 * founder's wording review. No "AI", no emoji; nothing points at the owner.
 */
import type { PlotScopeName } from '../data/membershipAdminClient';

export interface PlotScopeCopy {
    /** The card row: "प्लॉट: सर्व प्लॉट". */
    rowLabel: string;
    /** The three choices (design §2). */
    choice: Record<PlotScopeName, string>;
    /** One line under each choice. */
    choiceHint: Record<PlotScopeName, string>;
    /** "3 प्लॉट" — a chosen-plots summary when the names are not at hand. */
    countPlots: (n: number) => string;
    /** The sheet's heading. */
    sheetTitle: string;
    /** Under the plot ticks: at least one. */
    pickOne: string;
    /** No plot on this phone yet. */
    noPlots: string;
    save: string;
    cancel: string;
    /** The overview's title for a person who covers chosen plots (it must not say "whole farm" to him). */
    overviewTitle: string;
    /** A total that counts his plots only. */
    totalsLabel: string;
    /** A joining request's row before the owner chooses: what each preset starts from. */
    presetDefaults: string;
}

const mr: PlotScopeCopy = {
    rowLabel: 'प्लॉट', // PROPOSED (Marathi)
    choice: {
        AllPlots: 'सर्व प्लॉट', // MU design §2
        ChosenPlots: 'निवडलेले प्लॉट', // orchestrator call 1
        OwnWork: 'स्वतःचं काम', // MU design §2, §11.7
    },
    choiceHint: {
        AllPlots: 'शेतातल्या सगळ्या प्लॉटचं काम दिसेल.', // PROPOSED (Marathi)
        ChosenPlots: 'फक्त निवडलेल्या प्लॉटचं काम दिसेल व नोंदवता येईल.', // PROPOSED (Marathi)
        OwnWork: 'कोणत्याही प्लॉटवर स्वतःचं काम नोंदवतील; इतरांचं काम दिसणार नाही.', // PROPOSED (Marathi)
    },
    countPlots: n => `${n} प्लॉट`, // MU design §6 ("3 प्लॉट")
    sheetTitle: 'कोणते प्लॉट?', // PROPOSED (Marathi)
    pickOne: 'किमान एक प्लॉट निवडा.', // PROPOSED (Marathi)
    noPlots: 'या फोनवर अजून प्लॉट नाहीत.', // PROPOSED (Marathi)
    save: 'ठेवा', // PROPOSED (Marathi)
    cancel: 'राहू द्या', // the authority switches' word (lane 2b)
    overviewTitle: 'माझ्या प्लॉटचा आढावा', // PROPOSED (Marathi)
    totalsLabel: 'तुमच्या प्लॉटचे', // MU design §11.6 (PROPOSED there)
    presetDefaults: 'काम सांगणे: स्वतःचं काम · काम + हजेरी: सर्व प्लॉट', // PROPOSED (Marathi)
};

const en: PlotScopeCopy = {
    rowLabel: 'Plots', // PROPOSED (English)
    choice: {
        AllPlots: 'All plots', // PROPOSED (English)
        ChosenPlots: 'Chosen plots', // PROPOSED (English)
        OwnWork: 'Own work', // PROPOSED (English)
    },
    choiceHint: {
        AllPlots: "Sees the work of every plot on the farm.", // PROPOSED (English)
        ChosenPlots: 'Sees and records the work of the chosen plots only.', // PROPOSED (English)
        OwnWork: "Records his own work on any plot; does not see other people's work.", // PROPOSED (English)
    },
    countPlots: n => (n === 1 ? '1 plot' : `${n} plots`), // PROPOSED (English)
    sheetTitle: 'Which plots?', // PROPOSED (English)
    pickOne: 'Choose at least one plot.', // PROPOSED (English)
    noPlots: 'No plots on this phone yet.', // PROPOSED (English)
    save: 'Keep', // PROPOSED (English)
    cancel: 'Not now', // the authority switches' word (lane 2b)
    overviewTitle: 'My plots overview', // PROPOSED (English)
    totalsLabel: 'Your plots', // PROPOSED (English)
    presetDefaults: 'Tells work: own work · Work + attendance: all plots', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function plotScopeCopy(language: string | null | undefined): PlotScopeCopy {
    return language === 'en' ? en : mr;
}

/** The card row's value: the scope's word, or for chosen plots their names (or their count when names are missing). */
export function plotScopeSummary(
    copy: PlotScopeCopy,
    scope: PlotScopeName | undefined,
    plotIds: readonly string[] | null | undefined,
    plotNames: ReadonlyMap<string, string>,
): string {
    if (scope !== 'ChosenPlots') return copy.choice[scope ?? 'AllPlots'];
    const ids = new Set(plotIds ?? []);
    // In the farm's own plot order (the picker's), so the same choice always reads the same.
    const names = [...plotNames].filter(([id, name]) => ids.has(id) && !!name.trim()).map(([, name]) => name);
    return names.length === ids.size && names.length > 0 ? names.join(', ') : copy.countPlots(ids.size);
}
