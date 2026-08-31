import { buildSearchIndex, matchesQuery, searchHaystack } from '../searchIndex';

/**
 * THE HAYSTACK SHAPE, and what it costs.
 *
 * Task 6 shipped `searchKey` and deliberately did NOT ship a haystack helper,
 * leaving its shape to this task. The shape below is the one Task 6's numbers
 * were measured against and the one v3 uses (`app.js` `initSearch`):
 *
 *     (raw + ' ' + searchKey(raw)).toLowerCase().replace(/\s+/g, ' ')
 *
 * The memoisation the measured numbers demand is asserted in
 * `DataList.test.tsx` — it is a property of the component, not of these pure
 * functions, and asserting it here would prove nothing about the thing that
 * actually types.
 */

describe('the haystack', () => {
  it('carries the raw text so a Latin name is findable as itself', () => {
    expect(searchHaystack(['Ramesh Patil'])).toContain('ramesh patil');
  });

  it('appends every romanised spelling of a Devanagari name', () => {
    const hay = searchHaystack(['भोसले']);
    /* Both readings of the inherent vowel are indexed, because both are
       typed. Over-matching costs a support person one glance; under-matching
       costs a farmer a phone call that ends in "I cannot find you." */
    expect(hay).toContain('bhosale');
    expect(hay).toContain('bhosle');
  });

  it('keeps the original script in the haystack as well as the romanisation', () => {
    expect(searchHaystack(['कांबळे'])).toContain('कांबळे');
  });

  it('is lowercased once, on the way in', () => {
    expect(searchHaystack(['ACME Agri FPO'])).toBe(searchHaystack(['ACME Agri FPO']).toLowerCase());
  });

  it('drops absent parts instead of leaving a gap a query cannot match', () => {
    expect(searchHaystack(['Ramesh', null, undefined, '', 'Patil'])).toBe('ramesh patil');
  });

  it('is empty for a row with nothing to index', () => {
    expect(searchHaystack([null, undefined, ''])).toBe('');
  });

  it('collapses runs of whitespace, so a query never has to guess at spacing', () => {
    expect(searchHaystack(['Ramesh   Patil'])).toBe('ramesh patil');
  });
});

describe('the scan', () => {
  const hay = searchHaystack(['भोसले', '9764012345', 'Nashik']);

  it('finds a Devanagari name typed in Latin letters', () => {
    expect(matchesQuery(hay, 'bhosle')).toBe(true);
    expect(matchesQuery(hay, 'BHOSALE')).toBe(true);
  });

  it('finds a phone number', () => {
    expect(matchesQuery(hay, '9764')).toBe(true);
  });

  it('an empty query matches everything — it is not a filter', () => {
    expect(matchesQuery(hay, '')).toBe(true);
    expect(matchesQuery(hay, '   ')).toBe(true);
  });

  it('does not match what is not there', () => {
    expect(matchesQuery(hay, 'gaikwad')).toBe(false);
  });

  it('is a substring test and not a fuzzy one', () => {
    /* Fuzziness on the QUERY side would start returning rows a support person
       cannot explain to the farmer on the other end of the call. Every
       plausible spelling is paid for on the INDEX side instead. */
    expect(matchesQuery(hay, 'bhsle')).toBe(false);
  });
});

describe('the index', () => {
  it('is positionally aligned with the rows it was built from', () => {
    const rows = [{ n: 'Ana' }, { n: 'भोसले' }, { n: 'Bob' }];
    const index = buildSearchIndex(rows, (r) => [r.n]);
    expect(index).toHaveLength(3);
    expect(matchesQuery(index[1], 'bhosle')).toBe(true);
    expect(matchesQuery(index[0], 'bhosle')).toBe(false);
  });

  it('costs a Latin-only row nothing but a lowercase', () => {
    /* `searchKey` returns '' for a name with no Devanagari in it, so the
       haystack is the raw text and no second copy is held. */
    expect(buildSearchIndex([{ n: 'Ramesh Patil' }], (r) => [r.n])[0]).toBe('ramesh patil');
  });
});
