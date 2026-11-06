# Mixing tags in catalog.json (for the agronomist's check)

Tags sit on fertilisers only. A product is tagged only when its composition is certain from its own name,
grade or ingredient in the dosage guide. Rules R1 (calcium x phosphate) and R2 (calcium x sulphate) in
`mix-rules.json` read these tags. Tick or strike each line; a struck line is removed from `catalog.json`.

The rules apply only to tank solutions, meaning products given together by drip (fertigation) or by
spray. They never apply to dry soil doses (basal or broadcast). A tag says what a product contains;
the rule's `appliesTo` says when that matters. Two lines of the same product in one tank are never a pair.

## calcium-source

- g280 Calcium nitrate: Ca(NO3)2, calcium by name.
- g297 caB (calcium 27%): the guide states calcium 27%.
- g293 SSP (single super phosphate): monocalcium phosphate plus calcium sulphate (gypsum).
- g294 Polysulphate: polyhalite, a hydrated sulphate of potassium, calcium and magnesium.

## phosphate-source

- g272 Mono ammonium phosphate 12:61:0: phosphate by name, P2O5 61.
- g273 NPK 19:19:19: middle number (P2O5) 19.
- g274 NPK 0:60:20: P2O5 60.
- g275 NPK 0:42:47 (+Fe): P2O5 42.
- g276 NPK 13:40:13: P2O5 40.
- g278 NPK 0:52:34 (mono potassium phosphate grade): P2O5 52.
- g282 DAP 18:46:0: diammonium phosphate, P2O5 46.
- g283 NPK 24:24:0: P2O5 24.
- g284 NPK 20:20:0:13: P2O5 20.
- g287 NPK 10:26:26: P2O5 26.
- g289 NPK 15:15:15: P2O5 15.
- g290 NPK 20:20:0: P2O5 20.
- g291 NPK 9:24:24: P2O5 24.
- g293 SSP: single super phosphate, monocalcium phosphate.
- g295 NPK 12:32:16: P2O5 32.

## sulphate-source

- g281 Magnesium sulphate: MgSO4, sulphate by name.
- g288 Ammonium sulphate: (NH4)2SO4, sulphate by name.
- g294 Polysulphate: polyhalite, sulphate by name.
- g279 NPK 0:0:50: the 0:0:50 grade is sulphate of potash (K2SO4).
- g277 Potassium schoenite (K2O 23%, MgO 11%): K2SO4.MgSO4.6H2O.
- g284 NPK 20:20:0:13: the fourth number is sulphur, from ammonium sulphate (ammonium phosphate sulphate).
- g293 SSP: carries calcium sulphate (gypsum) alongside the phosphate.

## Not tagged (uncertain from the guide entry alone)

- g296 YaraMila Complex: the guide gives no grade or composition, so neither phosphate nor sulphate is certain.
- g292 Silicon (SiO2): no calcium, phosphate or sulphate stated.
- g285 MOP, g286 Urea, g271 Potassium nitrate 13:0:45: no calcium, phosphate or sulphate.
- Copper sulphate fungicides (g156, g157, g158, g200) and other non-fertilisers carry no tags; tags are
  set on fertilisers only (IT1 brief).
