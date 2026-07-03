/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShramSathiPreviewPage — DEV-ONLY founder preview of the Understanding Meter.
 *
 * A standalone page (no login, no backend, no Dexie, no real data) that renders
 * the REAL meter — MeterDisplay wired to the real engine (scoreVlog output shape
 * + rankMeterGaps + computeMeterArrival) driving the Codex Shram Sathi visuals
 * (ShramSathiFace + thought-bubble + comprehension bar + arrival gate) — across
 * all five comprehension bands, the silhouette → arrived reveal, and a sample
 * Daily Closure Receipt.
 *
 * Mounted ONLY in dev via index.tsx when the URL path is /dev/shram-sathi.
 * NEVER shipped to production. The Understanding Meter flag is force-enabled
 * locally through .env.local (VITE_UNDERSTANDING_METER=1) so MeterDisplay renders
 * here without touching the featureFlags default.
 *
 * Font rules: Marathi headings 'Noto Serif Devanagari', Marathi body
 * 'Noto Sans Devanagari', English/numbers 'DM Sans'. Palette is warm (never red).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import React from 'react';
import { MeterDisplay } from '../components/MeterDisplay';
import { ClosureReceiptCard } from '../components/ClosureReceiptCard';
import {
    BAND_SAMPLES,
    ARRIVED_LOGS,
    ARRIVING_LOGS,
    SAMPLE_CLOSURE_RECEIPT,
} from './shramSathiSampleData';

const SERIF_MR = "'Noto Serif Devanagari', serif";
const SANS_MR = "'Noto Sans Devanagari', sans-serif";
const SANS_EN = "'DM Sans', sans-serif";

/** Small warm English caption for a preview section (dev scaffolding only). */
function DevCaption({ children }: { children: React.ReactNode }): React.ReactElement {
    return (
        <p
            style={{ fontFamily: SANS_EN }}
            className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8A817C]"
        >
            {children}
        </p>
    );
}

export function ShramSathiPreviewPage(): React.ReactElement {
    return (
        <div className="min-h-screen bg-[#FBF7EF] px-4 py-8">
            <div className="mx-auto max-w-md space-y-8">
                {/* Dev-preview banner — clearly labelled, warm amber (never red). */}
                <header className="rounded-2xl border border-[#F6C66B] bg-[#FFF7E6] p-4">
                    <p
                        style={{ fontFamily: SANS_EN }}
                        className="text-[11px] font-black uppercase tracking-[0.18em] text-[#B8860B]"
                    >
                        Dev preview · not shipped
                    </p>
                    <h1
                        style={{ fontFamily: SERIF_MR }}
                        className="mt-1 text-xl font-black text-[#2E7D52]"
                    >
                        श्रम साथी — समजून घेण्याचं मीटर
                    </h1>
                    <p
                        style={{ fontFamily: SANS_MR }}
                        className="mt-1 text-sm font-semibold text-[#5A3B22]"
                    >
                        खालचं मीटर खऱ्या इंजिनवर चालतं — नमुना माहितीसह.
                    </p>
                    <p style={{ fontFamily: SANS_EN }} className="mt-1 text-xs text-[#8A817C]">
                        Real engine (scoreVlog → rankMeterGaps → computeMeterArrival) · sample data · no backend
                    </p>
                </header>

                {/* SECTION 1 — Silhouette → arrived reveal. */}
                <section>
                    <h2
                        style={{ fontFamily: SANS_EN }}
                        className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-[#5A3B22]"
                    >
                        1 · Arrival reveal
                    </h2>

                    <DevCaption>Still arriving — 12 / 20 rich logs (silhouette)</DevCaption>
                    <MeterDisplay allLogs={ARRIVING_LOGS} />

                    <div className="h-4" />

                    <DevCaption>Arrived — 20 / 20 rich logs (face revealed)</DevCaption>
                    <MeterDisplay score={BAND_SAMPLES[3].score} allLogs={ARRIVED_LOGS} />
                </section>

                {/* SECTION 2 — All five comprehension bands (arrived). */}
                <section>
                    <h2
                        style={{ fontFamily: SANS_EN }}
                        className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-[#5A3B22]"
                    >
                        2 · Five comprehension bands
                    </h2>

                    <div className="space-y-5">
                        {BAND_SAMPLES.map((sample) => (
                            <div key={sample.key}>
                                <DevCaption>{sample.label}</DevCaption>
                                <MeterDisplay score={sample.score} allLogs={ARRIVED_LOGS} />
                            </div>
                        ))}
                    </div>
                </section>

                {/* SECTION 3 — Daily Closure Receipt. */}
                <section>
                    <h2
                        style={{ fontFamily: SANS_EN }}
                        className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-[#5A3B22]"
                    >
                        3 · Daily closure receipt
                    </h2>
                    <DevCaption>End-of-day receipt (sample)</DevCaption>
                    <ClosureReceiptCard receipt={SAMPLE_CLOSURE_RECEIPT} />
                </section>

                <footer
                    style={{ fontFamily: SANS_EN }}
                    className="pt-4 text-center text-[11px] text-[#B8ADA0]"
                >
                    Local dev preview · branch feat/shram-sathi-local-preview · not merged, not deployed
                </footer>
            </div>
        </div>
    );
}

export default ShramSathiPreviewPage;
