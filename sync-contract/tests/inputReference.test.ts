// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 1) — the input catalogue and the
// mixing rules live ONCE, here in `reference/inputs/`. `generate.mjs` copies them byte-for-byte to the
// phone and to the server domain; these tests pin the data's own invariants and that the copies match.
//
// Doctrine P4: a red verdict may only come from a rule that names a published source AND carries the
// founder's review tick. `shippableRules` (the phone's own implementation) must keep an unreviewed
// rule out, so an unreviewed rule never reaches a farmer as red.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    isShippable,
    shippableRules,
    type MixRule,
} from '../../src/clients/mobile-web/src/domain/inputs/mixRules';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const refDir = resolve(here, '../reference/inputs');

const readBytes = (p: string): Buffer => readFileSync(p);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

interface Product {
    id: string;
    category: string;
    activeIngredients: Array<{ en: string | null; mr: string | null; pct: string | null }>;
    brands: Array<{ en: string | null; mr: string | null }>;
    ingredientUnknown?: boolean;
    company?: string | null;
    companyMr?: string | null;
    npkGrade: string | null;
    tags: string[];
    aliases: string[];
    sourceRefs: Array<{ source: string; ref: string; entry?: string }>;
    benefits: Array<{ crop: string; mr: string; en: string; url: string; retrievedOn: string; checkedBy: string | null }>;
}

const catalog = readJson<{ version: string; sources: Array<{ id: string; title: string; kind: string; receivedOn: string; checkedBy: string | null }>; nonMatchingWords: string[]; products: Product[] }>(resolve(refDir, 'catalog.json'));
const mixRules = readJson<{ version: string; rules: MixRule[] }>(resolve(refDir, 'mix-rules.json'));

describe('reference/inputs/catalog.json', () => {
    it('is version inputs-2', () => {
        expect(catalog.version).toBe('inputs-2');
    });

    // IT1b: the library is ShramSafal's; no source owns an id. Sources are listed, each product points at them.
    it('Catalog_EveryProduct_HasAtLeastOneSourceRef', () => {
        for (const p of catalog.products) expect(p.sourceRefs?.length ?? 0, p.id).toBeGreaterThanOrEqual(1);
    });

    it('Catalog_Ids_AreUniqueAndCarryNoSourcePrefix', () => {
        const ids = catalog.products.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(id, id).not.toMatch(/^gd+$/);
            expect(id, id).toMatch(/^p-[a-z0-9-]+$/);
        }
    });

    it('Catalog_SourceRef_PointsAtAListedSource', () => {
        const listed = new Set((catalog.sources ?? []).map(s => s.id));
        expect(listed.size).toBeGreaterThan(0);
        for (const s of catalog.sources) expect(['guide', 'company-list', 'university', 'label']).toContain(s.kind);
        for (const p of catalog.products) {
            for (const r of p.sourceRefs ?? []) {
                expect(listed.has(r.source), p.id).toBe(true);
                expect(r.ref.trim().length, p.id).toBeGreaterThan(0);
            }
        }
    });

    it('Catalog_IdsAreStoredNotDerived', () => {
        // Pinned: a regenerate that moves an id fails here. Ids are data from the day they were written.
        const pinned: Record<string, string> = {
            'line 38': 'p-abamectin-1-9-ec',
            'line 55': 'p-acephate-50-imidacloprid-1-8-sp',
            'line 1485': 'p-brand-dhaman-bio-303',
            'line 3149': 'p-npk-19-19-19',
            'line 3227': 'p-calcium-nitrate',
        };
        for (const [line, id] of Object.entries(pinned)) {
            expect(catalog.products.find(p => p.sourceRefs?.[0]?.ref === line)?.id).toBe(id);
        }
    });

    // The guide names only a brand for these five, no ingredient; inventing one would put a false fact
    // on his record (review B002). Each still carries its brand, so it can be found by name.
    const NO_INGREDIENT_IN_GUIDE = ['p-brand-dhaman-bio-303', 'p-brand-orondis-ultra', 'p-brand-diamore-combine', 'p-brand-mc-extra', 'p-brand-ralligold'];

    it('catalog has 297 products, unique ids, every product has >=1 activeIngredient (except the guide\'s brand-only five)', () => {
        expect(catalog.products).toHaveLength(297);
        const ids = catalog.products.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of catalog.products) {
            if (NO_INGREDIENT_IN_GUIDE.includes(p.id)) {
                expect(p.activeIngredients, p.id).toEqual([]);
                expect(p.brands.some(b => (b.en ?? '').trim().length > 0), p.id).toBe(true);
                continue;
            }
            expect(p.activeIngredients.length, p.id).toBeGreaterThanOrEqual(1);
            for (const a of p.activeIngredients) expect((a.en ?? '').trim().length, p.id).toBeGreaterThan(0);
        }
    });

    it('a strength that is a bare number is only one the guide itself prints without a unit', () => {
        // The guide prints these three SC/OD/EC strengths with no unit; every other strength carries one.
        const GUIDE_PRINTS_NO_UNIT = ['p-flubendiamide-90-deltamethrin-60-sc', 'p-spirotetramat-150-od', 'p-tebuconazole-250-ec'];
        for (const p of catalog.products) {
            for (const a of p.activeIngredients) {
                if (a.pct !== null && /^[\d\s.]+$/.test(a.pct)) {
                    expect(GUIDE_PRINTS_NO_UNIT, `${p.id} ${a.en} "${a.pct}"`).toContain(p.id);
                }
            }
        }
    });

    it('every product has >=1 ingredient or says ingredientUnknown: true (review B009)', () => {
        for (const p of catalog.products) {
            if (p.activeIngredients.length === 0) {
                expect(p.ingredientUnknown, p.id).toBe(true);
            } else {
                expect(p.ingredientUnknown, p.id).toBeUndefined();
            }
        }
        expect(catalog.products.filter(p => p.ingredientUnknown).map(p => p.id)).toEqual(NO_INGREDIENT_IN_GUIDE);
    });

    it('every brand entry has a non-empty name (review B010)', () => {
        for (const p of catalog.products) {
            for (const b of p.brands) expect((b.en ?? '').trim().length, p.id).toBeGreaterThan(0);
        }
        const neem = catalog.products.find(p => p.id === 'p-neem-oil-3000-ppm')!;
        expect(neem.company).toBe('Dr. Anand');
        expect(neem.brands).toEqual([]);
    });

    it('no ingredient string joins two ingredients (review B008)', () => {
        for (const p of catalog.products) {
            for (const a of p.activeIngredients) {
                expect(/ & | \+ |, | and /i.test(a.en ?? ''), `${p.id} "${a.en}"`).toBe(false);
            }
        }
    });

    it('nonMatchingWords is a list of single, lowercase, trimmed words, including the reviewed nine (review B008)', () => {
        expect(catalog.nonMatchingWords).toEqual(expect.arrayContaining(
            ['miticide', 'stop', 'blast', 'black', 'index', 'recent', 'root', 'activated', 'double']));
        expect(new Set(catalog.nonMatchingWords).size).toBe(catalog.nonMatchingWords.length);
        for (const w of catalog.nonMatchingWords) {
            expect(w, w).toBe(w.trim().toLowerCase());
            expect(/\s/.test(w), w).toBe(false);
        }
    });

    it('no brand name is purely a number (with or without a unit)', () => {
        for (const p of catalog.products) {
            for (const b of p.brands) {
                if (b.en === null) continue;
                expect(/^[\d\s.,:+%-]+(ppm|g\/l)?$/i.test(b.en.trim()), `${p.id} brand "${b.en}"`).toBe(false);
            }
        }
    });

    it('no alias equals an ingredient word of 2+ products unless every one of those products carries it', () => {
        const norm = (s: string) => s.toLowerCase().replace(/[-.,]/g, '').replace(/\s+/g, ' ').trim();
        const holders = new Map<string, Set<string>>();
        const hold = (w: string, id: string) => {
            if (w.length < 3) return;
            if (!holders.has(w)) holders.set(w, new Set());
            holders.get(w)!.add(id);
        };
        for (const p of catalog.products) {
            for (const a of p.activeIngredients) {
                for (const name of [a.en, a.mr]) {
                    if (!name) continue;
                    hold(norm(name), p.id);
                    for (const w of norm(name).split(/[^\p{L}\p{M}\p{N}]+/u)) hold(w, p.id);
                }
            }
        }
        const byId = new Map(catalog.products.map(p => [p.id, p]));
        for (const p of catalog.products) {
            for (const alias of p.aliases) {
                const h = holders.get(norm(alias));
                if (!h || h.size < 2) continue;
                const missing = [...h].filter(id => !byId.get(id)!.aliases.includes(alias));
                expect(missing, `${p.id} alias "${alias}" is an ingredient word of ${[...h].join(' ')}`).toEqual([]);
            }
        }
    });

    it('generic words: "bio" is no alias, and "neem" sits on every neem product', () => {
        for (const p of catalog.products) expect(p.aliases, p.id).not.toContain('bio');
        const neemHolders = catalog.products
            .filter(p => p.activeIngredients.some(a => /azadirachtin|neem/i.test(a.en ?? '')))
            .map(p => p.id);
        expect(neemHolders.length).toBeGreaterThanOrEqual(2);
        for (const id of neemHolders) {
            const p = catalog.products.find(x => x.id === id)!;
            for (const w of ['neem', 'neem oil', 'निंबोळी', 'निंबोळी तेल']) expect(p.aliases, `${id} ${w}`).toContain(w);
        }
    });

    it('every product.aliases entry is lowercase and trimmed', () => {
        for (const p of catalog.products) {
            for (const a of p.aliases) {
                expect(a, p.id).toBe(a.trim().toLowerCase());
                expect(a.length, p.id).toBeGreaterThan(0);
            }
        }
    });

    it('tags sit on fertilisers only and use the three known names', () => {
        const known = new Set(['calcium-source', 'phosphate-source', 'sulphate-source']);
        for (const p of catalog.products) {
            if (p.category !== 'fertilizer') expect(p.tags, p.id).toEqual([]);
            for (const t of p.tags) expect(known.has(t), `${p.id} ${t}`).toBe(true);
        }
        const tagged = (t: string) => catalog.products.filter(p => p.tags.includes(t)).map(p => p.id);
        expect(tagged('calcium-source')).toEqual(expect.arrayContaining(['p-calcium-nitrate', 'p-cab-calcium-27', 'p-ssp', 'p-polysulphate']));
        expect(tagged('sulphate-source')).toEqual(expect.arrayContaining(['p-magnesium-sulphate', 'p-npk-0-0-50', 'p-potassium-schoenite-ko-23-mgo-11', 'p-npk-20-20-0-13', 'p-ssp', 'p-polysulphate']));
        expect(tagged('phosphate-source')).toEqual(expect.arrayContaining(['p-npk-19-19-19', 'p-mono-ammonium-phosphate-12-61-0', 'p-dap-18-46-0']));
    });

    it('every tagged id is listed under its tag in TAGS.md, and TAGS.md lists no untagged id', () => {
        const md = readFileSync(resolve(refDir, 'TAGS.md'), 'utf8');
        for (const tag of ['calcium-source', 'phosphate-source', 'sulphate-source']) {
            const section = md.split(`## ${tag}`)[1]?.split('\n## ')[0] ?? '';
            const listed = [...section.matchAll(/^- (p-[a-z0-9-]+) /gm)].map(m => m[1]).sort();
            const tagged = catalog.products.filter(p => p.tags.includes(tag)).map(p => p.id).sort();
            expect(listed, tag).toEqual(tagged);
        }
    });

    it('benefits are empty in IT1 (lane IT1 Task 5 is a separate lane)', () => {
        for (const p of catalog.products) expect(p.benefits, p.id).toEqual([]);
    });

    it('no benefit text contains a digit (0-9 or ०-९)', () => {
        for (const p of catalog.products) {
            for (const b of p.benefits) {
                expect(/[0-9०-९]/.test(b.mr), p.id).toBe(false);
                expect(/[0-9०-९]/.test(b.en), p.id).toBe(false);
                expect(b.url, p.id).toMatch(/^https:\/\//);
                expect(b.retrievedOn, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        }
    });
});

describe('reference/inputs/mix-rules.json', () => {
    it('is version mix-rules-1 with exactly R1 and R2, both never', () => {
        expect(mixRules.version).toBe('mix-rules-1');
        expect(mixRules.rules.map(r => r.id)).toEqual(['R1', 'R2']);
        for (const r of mixRules.rules) expect(r.verdict).toBe('never');
    });

    it('every mix rule has >=1 source with title, url, retrievedOn', () => {
        for (const r of mixRules.rules) {
            expect(r.sources.length, r.id).toBeGreaterThanOrEqual(1);
            for (const s of r.sources) {
                expect(s.title.trim().length, r.id).toBeGreaterThan(0);
                expect(s.url, r.id).toMatch(/^https:\/\//);
                expect(s.retrievedOn, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        }
    });

    it('every rule carries why / nowDo / nextTime in both languages', () => {
        for (const r of mixRules.rules) {
            for (const t of [r.why, r.nowDo, r.nextTime]) {
                expect(t.mr.trim().length, r.id).toBeGreaterThan(0);
                expect(t.en.trim().length, r.id).toBeGreaterThan(0);
                expect(/[A-Za-z]/.test(t.mr), r.id).toBe(false);
                expect(/[ऀ-ॿ]/.test(t.en), r.id).toBe(false);
            }
        }
    });

    it('every rule applies only to tank solutions (review B007)', () => {
        for (const r of mixRules.rules) {
            expect(r.appliesTo, r.id).toEqual(['fertigation', 'spray']);
        }
    });

    it('every rule selector names a tag or a product that exists', () => {
        const ids = new Set(catalog.products.map(p => p.id));
        const tags = new Set(catalog.products.flatMap(p => p.tags));
        for (const r of mixRules.rules) {
            for (const side of [r.a, r.b]) {
                if (side.tag !== undefined) expect(tags.has(side.tag), `${r.id} ${side.tag}`).toBe(true);
                if (side.productId !== undefined) expect(ids.has(side.productId), `${r.id} ${side.productId}`).toBe(true);
            }
        }
    });

    it('a rule whose reviewedBy is null fails the "shippable" check (fixture)', () => {
        const fixture: MixRule = {
            ...mixRules.rules[0],
            reviewedBy: 'test-fixture',
            reviewedOn: '2026-11-07',
        };
        expect(isShippable(fixture)).toBe(true);
        expect(isShippable({ ...fixture, reviewedBy: null })).toBe(false);
        expect(isShippable({ ...fixture, reviewedOn: null })).toBe(false);
        expect(isShippable({ ...fixture, sources: [] })).toBe(false);
        expect(shippableRules([{ ...fixture, reviewedBy: null }, fixture]).map(r => r.id)).toEqual([fixture.id]);
    });

    it('every rule the live file ships carries both review fields (holds before and after the founder\'s tick)', () => {
        for (const r of shippableRules(mixRules.rules)) {
            expect(typeof r.reviewedBy, r.id).toBe('string');
            expect(typeof r.reviewedOn, r.id).toBe('string');
        }
    });

    it('rule copy is method-neutral (any tank, not only drip)', () => {
        for (const r of mixRules.rules) {
            for (const t of [r.why, r.nowDo, r.nextTime]) {
                expect(t.mr.includes('ठिबक'), r.id).toBe(false);
                expect(/drip/i.test(t.en), r.id).toBe(false);
            }
        }
    });
});

describe('generated copies', () => {
    const pairs: Array<[string, string]> = [
        ['catalog.json', 'src/clients/mobile-web/src/domain/inputs/generated/catalog.json'],
        ['mix-rules.json', 'src/clients/mobile-web/src/domain/inputs/generated/mixRules.json'],
        ['catalog.json', 'src/apps/ShramSafal/ShramSafal.Domain/Inputs/Generated/catalog.json'],
        ['mix-rules.json', 'src/apps/ShramSafal/ShramSafal.Domain/Inputs/Generated/mix-rules.json'],
    ];

    it.each(pairs)('generated copies equal the reference files byte-for-byte (%s -> %s)', (ref, copy) => {
        expect(readBytes(resolve(repo, copy)).equals(readBytes(resolve(refDir, ref)))).toBe(true);
    });
});
