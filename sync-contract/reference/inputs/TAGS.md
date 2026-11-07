# Mixing tags in catalog.json (for the agronomist's check)

Tags sit on fertilisers only. A product is tagged only when its composition is certain from its own name,
grade or ingredient in the dosage guide. Rules R1 (calcium x phosphate) and R2 (calcium x sulphate) in
`mix-rules.json` read these tags. Tick or strike each line; a struck line is removed from `catalog.json`.

The rules apply only to tank solutions, meaning products given together by drip (fertigation) or by
spray. They never apply to dry soil doses (basal or broadcast). A tag says what a product contains;
the rule's `appliesTo` says when that matters. Two lines of the same product in one tank are never a pair.

## calcium-source

- p-calcium-nitrate [g280] Calcium nitrate: Ca(NO3)2, calcium by name.
- p-cab-calcium-27 [g297] caB (calcium 27%): the guide states calcium 27%.
- p-ssp [g293] SSP (single super phosphate): monocalcium phosphate plus calcium sulphate (gypsum).
- p-polysulphate [g294] Polysulphate: polyhalite, a hydrated sulphate of potassium, calcium and magnesium.

## phosphate-source

- p-mono-ammonium-phosphate-12-61-0 [g272] Mono ammonium phosphate 12:61:0: phosphate by name, P2O5 61.
- p-npk-19-19-19 [g273] NPK 19:19:19: middle number (P2O5) 19.
- p-npk-0-60-20 [g274] NPK 0:60:20: P2O5 60.
- p-npk-fe-2-8-0-42-47 [g275] NPK 0:42:47 (+Fe): P2O5 42.
- p-npk-13-40-13 [g276] NPK 13:40:13: P2O5 40.
- p-npk-0-52-34 [g278] NPK 0:52:34 (mono potassium phosphate grade): P2O5 52.
- p-dap-18-46-0 [g282] DAP 18:46:0: diammonium phosphate, P2O5 46.
- p-npk-24-24-0 [g283] NPK 24:24:0: P2O5 24.
- p-npk-20-20-0-13 [g284] NPK 20:20:0:13: P2O5 20.
- p-npk-10-26-26 [g287] NPK 10:26:26: P2O5 26.
- p-npk-15-15-15 [g289] NPK 15:15:15: P2O5 15.
- p-npk-20-20-0 [g290] NPK 20:20:0: P2O5 20.
- p-npk-9-24-24 [g291] NPK 9:24:24: P2O5 24.
- p-ssp [g293] SSP: single super phosphate, monocalcium phosphate.
- p-npk-12-32-16 [g295] NPK 12:32:16: P2O5 32.

## sulphate-source

- p-magnesium-sulphate [g281] Magnesium sulphate: MgSO4, sulphate by name.
- p-ammonium-sulphate [g288] Ammonium sulphate: (NH4)2SO4, sulphate by name.
- p-polysulphate [g294] Polysulphate: polyhalite, sulphate by name.
- p-npk-0-0-50 [g279] NPK 0:0:50: the 0:0:50 grade is sulphate of potash (K2SO4).
- p-potassium-schoenite-ko-23-mgo-11 [g277] Potassium schoenite (K2O 23%, MgO 11%): K2SO4.MgSO4.6H2O.
- p-npk-20-20-0-13 [g284] NPK 20:20:0:13: the fourth number is sulphur, from ammonium sulphate (ammonium phosphate sulphate).
- p-ssp [g293] SSP: carries calcium sulphate (gypsum) alongside the phosphate.

## Not tagged (uncertain from the guide entry alone)

- p-yaramila-complex [g296] YaraMila Complex: the guide gives no grade or composition, so neither phosphate nor sulphate is certain.
- p-silicon-sio2-70-to-75 [g292] Silicon (SiO2): no calcium, phosphate or sulphate stated.
- p-mop-k-60 [g285] MOP, p-urea-n-46 [g286] Urea, p-potassium-nitrate-13-0-45 [g271] Potassium nitrate 13:0:45: no calcium, phosphate or sulphate.
- Copper sulphate fungicides (p-copper-sulfate-pentahydrate-23-99 [g156], p-copper-sulphate [g157], p-copper-sulphate-47-15-mancozeb-30-wdg [g158], p-tribasic-copper-sulfate-34-5-sc [g200]) and other non-fertilisers carry no tags; tags are
  set on fertilisers only (IT1 brief).
