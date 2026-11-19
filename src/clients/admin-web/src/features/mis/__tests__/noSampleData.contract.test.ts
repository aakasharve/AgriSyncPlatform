import { describe, expect, it } from 'vitest';

/**
 * CR-2b Task 1 — no sample number can reach a real page (decision 1, doctrine P4).
 *
 * The approved look came from a preview whose every number was generated
 * (`misData.ts` and the selectors built on it). The plan forbids copying those
 * modules, importing anything of their names, and any seeded or random number
 * source inside `src/features/mis`.
 *
 * Read like `tokens.contract.test.ts`: every first-party source file as raw
 * text, tests excluded, comments stripped (a comment explaining the rule is not
 * a breach of it).
 */

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith('/src/test/')),
);

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const TRAILING_COMMENT = /([;,{}()\]])\s*\/\/.*$/gm;
const code = (src: string) => src.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '').replace(TRAILING_COMMENT, '$1');

const SAMPLE_MODULES = ['misData', 'misSelectGrowth', 'misSelectHealth', 'misRange'];
const MIS_FILES = Object.keys(SOURCES).filter((p) => p.startsWith('/src/features/mis/'));

describe('no sample data in Company MIS (CR-2b Task 1)', () => {
  it('reads the MIS sources at all (guard against an empty glob)', () => {
    expect(MIS_FILES.length).toBeGreaterThanOrEqual(10);
    expect(MIS_FILES).toContain('/src/features/mis/misView.ts');
  });

  it('No_sample_module_exists_or_is_imported', () => {
    const files = Object.keys(SOURCES);
    for (const name of SAMPLE_MODULES) {
      const named = files.filter((p) => new RegExp(`/${name}\\.tsx?$`).test(p));
      expect(named, `a module named ${name} exists`).toEqual([]);
    }
    const importOf = new RegExp(
      `(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)['"][^'"]*\\b(${SAMPLE_MODULES.join('|')})(?:\\.tsx?)?['"]`,
    );
    const offenders = Object.entries(SOURCES)
      .filter(([, src]) => importOf.test(code(src)))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('No_seeded_or_random_number_source_in_mis', () => {
    const banned = [/mulberry32/, /hashNoise/, /Math\.random/, /\bINCIDENTS\b/, /getRandomValues/, /randomUUID/, /\bseededRandom\b/i];
    const offenders: string[] = [];
    for (const path of MIS_FILES) {
      const src = code(SOURCES[path]);
      for (const re of banned) if (re.test(src)) offenders.push(`${path}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it('No_sample_badge_or_data_up_to_text', () => {
    const offenders: string[] = [];
    for (const path of MIS_FILES) {
      const src = code(SOURCES[path]);
      if (/sample data/i.test(src)) offenders.push(`${path}: Sample data`);
      if (/data up to/i.test(src)) offenders.push(`${path}: Data up to`);
    }
    expect(offenders).toEqual([]);
  });
});
