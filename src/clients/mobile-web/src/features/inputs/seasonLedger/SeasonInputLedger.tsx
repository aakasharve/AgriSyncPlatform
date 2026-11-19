/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C) - "हंगामाचा हिशोब": every medicine and fertilizer the farm used, one line
 * per product, with the amount in HIS words and units, the method, the day of the season, the stage and the ingredients; sortable and
 * filterable here, and the same table as a file for Excel. It is a read of what the server holds (the server counts and works things out,
 * the phone only shows): a blank is a value nobody stated or the server could not work out, never a guess (P4); a total appears only when
 * every use of that product states an amount in one unit. Owner only (the server refuses any other seat).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowDownUp, Download, FlaskConical, RefreshCw } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { GlassCard, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import { arrange, downloadLedgerCsv, loadLedger, rebuildLedger, type Ledger, type LedgerRow, type SortKey } from './seasonLedgerClient';

const WORDS = {
    mr: {
        title: 'हंगामाचा हिशोब', hint: 'औषधे व खते — काय, किती, कधी, कोणत्या अवस्थेत', open: 'उघडा', close: 'बंद करा', loading: 'वाचत आहे…',
        offline: 'नेट नाही — हिशोब नेट आल्यावर दिसेल.', refused: 'हा हिशोब फक्त शेताच्या मालकाला दिसतो.', failed: 'हिशोब आत्ता वाचता आला नाही.',
        empty: 'या काळात औषध किंवा खताची एकही नोंद नाही.', filter: 'औषध, प्लॉट किंवा घटक शोधा', sortBy: 'क्रम',
        date: 'तारीख', product: 'औषध', day: 'दिवस', stage: 'अवस्था', plot: 'प्लॉट', amount: 'प्रमाण', method: 'पद्धत', ingredients: 'घटक',
        notSaid: 'सांगितलं नाही', dayAfter: 'दिवस', byProduct: 'औषधानुसार', byIngredient: 'घटकानुसार', uses: 'वेळा', total: 'एकूण',
        csv: 'Excel साठी फाईल', refresh: 'ताजे करा', pending: (n: number) => `${n} नोंदींचे तपशील अजून तयार नाहीत`, per: 'प्रति',
        water: 'पाणी', litres: 'लि.',
    },
    en: {
        title: 'Season ledger', hint: 'Medicines and fertilizers: what, how much, when, at which stage', open: 'Open', close: 'Close', loading: 'Reading…',
        offline: 'No network: the ledger shows when the network is back.', refused: 'Only the farm owner can see this ledger.', failed: 'The ledger could not be read right now.',
        empty: 'No medicine or fertilizer was recorded in this period.', filter: 'Search a product, plot or ingredient', sortBy: 'Sort',
        date: 'Date', product: 'Product', day: 'Day', stage: 'Stage', plot: 'Plot', amount: 'Amount', method: 'Method', ingredients: 'Ingredients',
        notSaid: 'not said', dayAfter: 'Day', byProduct: 'By product', byIngredient: 'By ingredient', uses: 'uses', total: 'Total',
        csv: 'File for Excel', refresh: 'Refresh', pending: (n: number) => `${n} uses are not worked out yet`, per: 'per',
        water: 'Water', litres: 'L',
    },
} as const;

type State = { kind: 'closed' } | { kind: 'loading' } | { kind: 'offline' } | { kind: 'refused' } | { kind: 'failed' } | { kind: 'ledger'; ledger: Ledger };

/** The amount in his words and units; "not said" when he said none. Never a number he did not say. */
export function amountOf(row: LedgerRow, notSaid: string, per: string): string {
    if (row.amount === null) return row.amountSpokenText ?? notSaid;
    const base = `${row.amount}${row.unit ? ' ' + row.unit : ''}`;
    return row.perQuantity !== null ? `${base} ${per} ${row.perQuantity}${row.perUnit ? ' ' + row.perUnit : ''}` : base;
}

const SeasonInputLedger: React.FC<{ farmId: string }> = ({ farmId }) => {
    const words = WORDS[useOptionalLanguage()?.language === 'en' ? 'en' : 'mr'];
    const [state, setState] = useState<State>({ kind: 'closed' });
    const [sort, setSort] = useState<SortKey>('date');
    const [descending, setDescending] = useState(true);
    const [filter, setFilter] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setState({ kind: 'loading' });
        const result = await loadLedger(farmId);
        setState(result.kind === 'ledger' ? { kind: 'ledger', ledger: result.ledger } : { kind: result.kind });
    }, [farmId]);

    const refresh = useCallback(async () => {
        setBusy(true);
        await rebuildLedger(farmId);
        await load();
        setBusy(false);
    }, [farmId, load]);

    const rows = useMemo(() => (state.kind === 'ledger' ? arrange(state.ledger.rows, sort, descending, filter) : []), [state, sort, descending, filter]);

    const pick = (key: SortKey): void => {
        if (key === sort) setDescending(d => !d);
        else { setSort(key); setDescending(key === 'date'); }
    };

    return (
        <GlassCard testId="season-ledger">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="m-0 flex items-center gap-1.5 text-[16px] font-extrabold text-stone-800"><FlaskConical size={18} aria-hidden="true" />{words.title}</p>
                    <p className="m-0 text-[12.5px] font-bold leading-snug text-stone-500">{words.hint}</p>
                </div>
                <Tap onClick={() => (state.kind === 'closed' ? void load() : setState({ kind: 'closed' }))} data-testid="season-ledger-toggle"
                    className="min-h-[44px] shrink-0 rounded-full bg-emerald-700 px-4 text-[14px] font-extrabold text-white">
                    {state.kind === 'closed' ? words.open : words.close}
                </Tap>
            </div>

            {state.kind === 'loading' && <p className="m-0 mt-3 text-[13.5px] font-bold text-stone-600" data-testid="season-ledger-loading">{words.loading}</p>}
            {state.kind === 'offline' && <p className="m-0 mt-3 text-[13.5px] font-bold text-stone-600" data-testid="season-ledger-offline">{words.offline}</p>}
            {state.kind === 'refused' && <p className="m-0 mt-3 text-[13.5px] font-bold text-stone-600" data-testid="season-ledger-refused">{words.refused}</p>}
            {state.kind === 'failed' && <p className="m-0 mt-3 text-[13.5px] font-bold text-stone-600" data-testid="season-ledger-failed">{words.failed}</p>}

            {state.kind === 'ledger' && (
                state.ledger.rows.length === 0 ? (
                    <p className="m-0 mt-3 text-[13.5px] font-bold text-stone-600" data-testid="season-ledger-empty">{words.empty}</p>
                ) : (
                    <div className="mt-3 space-y-3">
                        {state.ledger.notYetDerived > 0 && (
                            <div className="flex items-center justify-between gap-2 rounded-2xl bg-amber-50 p-2.5 ring-1 ring-amber-200" data-testid="season-ledger-pending">
                                <span className="text-[13px] font-bold text-amber-900">{words.pending(state.ledger.notYetDerived)}</span>
                                <Tap onClick={() => void refresh()} disabled={busy} data-testid="season-ledger-refresh"
                                    className="flex min-h-[40px] items-center gap-1 rounded-full bg-white px-3 text-[13px] font-extrabold text-amber-900">
                                    <RefreshCw size={15} aria-hidden="true" />{words.refresh}
                                </Tap>
                            </div>
                        )}

                        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={words.filter} data-testid="season-ledger-filter"
                            className="min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white px-3 text-[14px] font-bold text-stone-800" />

                        <div className="flex flex-wrap items-center gap-1.5" data-testid="season-ledger-sort">
                            <span className="flex items-center gap-1 text-[12.5px] font-bold text-stone-500"><ArrowDownUp size={14} aria-hidden="true" />{words.sortBy}</span>
                            {(['date', 'product', 'day', 'stage'] as const).map(key => (
                                <Tap key={key} onClick={() => pick(key)} data-testid={`season-ledger-sort-${key}`}
                                    className={`min-h-[36px] rounded-full px-3 text-[13px] font-extrabold ${sort === key ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700'}`}>
                                    {words[key]}{sort === key ? (descending ? ' ↓' : ' ↑') : ''}
                                </Tap>
                            ))}
                        </div>

                        <div className="space-y-2" data-testid="season-ledger-rows">
                            {rows.map(row => (
                                <div key={row.inputItemId} className="rounded-2xl bg-stone-50 p-2.5 ring-1 ring-stone-200" data-testid="season-ledger-row">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="text-[15px] font-extrabold text-stone-900" data-testid="season-ledger-product">{row.productSaid}</span>
                                        <span className="shrink-0 text-[12.5px] font-bold text-stone-500">{row.date}</span>
                                    </div>
                                    <p className="m-0 text-[13.5px] font-bold text-stone-700" data-testid="season-ledger-amount">
                                        {words.amount}: {amountOf(row, words.notSaid, words.per)}{row.method ? ` · ${row.method}` : ''}
                                        {row.carrierWaterLitres !== null ? ` · ${words.water} ${row.carrierWaterLitres} ${words.litres}` : ''}
                                    </p>
                                    <p className="m-0 text-[12.5px] font-bold text-stone-500" data-testid="season-ledger-when">
                                        {[row.plotName, row.dayOfSeason !== null ? `${words.dayAfter} ${row.dayOfSeason}` : null, row.stageName].filter(Boolean).join(' · ')}
                                    </p>
                                    {row.ingredients.length > 0 && (
                                        <p className="m-0 text-[12.5px] font-bold text-stone-500" data-testid="season-ledger-ingredients">
                                            {words.ingredients}: {row.ingredients.join(', ')}{row.groupCodes ? ` (${row.groupCodes})` : ''}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>

                        <SectionHead title={words.byProduct} />
                        <div className="space-y-1.5" data-testid="season-ledger-products">
                            {state.ledger.products.map(p => (
                                <div key={p.libraryProductId ?? p.product} className="flex items-baseline justify-between gap-2 text-[13.5px] font-bold text-stone-700" data-testid="season-ledger-product-total">
                                    <span className="min-w-0 truncate">{p.product} · {p.uses} {words.uses}</span>
                                    <span className="shrink-0 text-stone-900">{p.total !== null ? `${words.total} ${p.total}${p.unit ? ' ' + p.unit : ''}` : '—'}</span>
                                </div>
                            ))}
                        </div>

                        {state.ledger.ingredients.length > 0 && (
                            <>
                                <SectionHead title={words.byIngredient} />
                                <div className="space-y-1.5" data-testid="season-ledger-ingredient-totals">
                                    {state.ledger.ingredients.map(i => (
                                        <div key={i.key ?? i.ingredient} className="flex items-baseline justify-between gap-2 text-[13.5px] font-bold text-stone-700">
                                            <span className="min-w-0 truncate">{i.ingredient}{i.groupCode ? ` (${i.groupCode})` : ''}</span>
                                            <span className="shrink-0 text-stone-900">{i.uses} {words.uses}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        <Tap onClick={() => void downloadLedgerCsv(farmId, state.ledger.from, state.ledger.to)} data-testid="season-ledger-csv"
                            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full bg-white text-[14.5px] font-extrabold text-blue-800 ring-1 ring-blue-200">
                            <Download size={17} aria-hidden="true" />{words.csv}
                        </Tap>
                    </div>
                )
            )}
        </GlassCard>
    );
};

export default SeasonInputLedger;
