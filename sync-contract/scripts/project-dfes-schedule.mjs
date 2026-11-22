// spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 2; founder D-B, D-G 2026-11-21)
//
// DFES reads only Shram Safal's OWN published schedule (the Schedule Maker's output), never a PDF. This script takes the Schedule
// Maker's file as delivered and keeps only what DFES needs to ask a stage question and prove its source: the stages, and every look
// line with its card's window, its question and its sources. No step, dose, quote or note is copied. Mechanical, never authored here:
// re-run it when the Schedule Maker publishes a new version.
//
//   node sync-contract/scripts/project-dfes-schedule.mjs "<path to the Schedule Maker's schedule .json>"
//
// Output: sync-contract/schedules/<scheduleId>.dfes.json, read by the phone (domain/schedule/dfesScheduleLines.ts) and embedded in the
// server (ShramSafal.Infrastructure, ScheduleSourceResolver). Line ids are qualified "<scheduleId>/<line id>" so two schedules never
// collide. Day numbers stay as the Schedule Maker writes them (pruning day = day 1, founder 22 Nov); `dayOne` says so.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPERT_DECIDES = 'तज्ज्ञ ठरवतील';

const input = process.argv[2];
if (!input) {
    console.error('usage: node sync-contract/scripts/project-dfes-schedule.mjs "<schedule .json>"');
    process.exit(2);
}

const src = JSON.parse(readFileSync(input, 'utf8'));
const lines = [];
for (const card of src.cards ?? []) {
    for (const line of card.look ?? []) {
        const askFarmer = typeof line.askFarmer === 'string' ? line.askFarmer : null;
        lines.push({
            id: `${src.scheduleId}/${line.id}`,
            cardId: card.id,
            cardType: card.type,
            n0: card.n0,
            n1: card.n1,
            startsWhenStageSeen: Boolean(card.startsWhenStageSeen),
            ourChoice: Boolean(card.ourChoice || line.ourChoice),
            // A line whose value the books leave to an expert states no value DFES may repeat: never asked, never a source.
            expertDecides: Boolean(askFarmer && askFarmer.includes(EXPERT_DECIDES)),
            askFarmer,
            askFarmerHasSample: Boolean(line.askFarmerHasSample),
            sources: (line.sources ?? []).map(s => ({ docId: String(s.docId), page: String(s.page) })),
        });
    }
}

const out = {
    scheduleId: src.scheduleId,
    schemaVersion: src.schemaVersion,
    projectedFrom: basename(input),
    crop: src.crop,
    season: src.season,
    dayOne: src.dayOne,
    stages: (src.stages ?? []).map(s => ({ code: s.code, nameMr: s.nameMr, nameEn: s.nameEn, dayFrom: s.dayFrom, dayTo: s.dayTo })),
    lines,
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schedules');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${src.scheduleId}.dfes.json`);
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`${outPath}: ${out.stages.length} stages, ${lines.length} look lines`);
