# Labour R1 mockup tokens — lifted VERBATIM from the built components

**Do not invent a visual language.** Founder final direction §15: the existing हजेरी is the
design baseline — "one of the clearest UIs built". Every class below is copied out of
`features/labour/components/HajeriLedger.tsx` and `LabourUiKit.tsx`. Use these exact classes.

## Shell (every mockup)

```html
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;800;900&family=Noto+Sans+Devanagari:wght@400;600;700;800&family=Noto+Serif+Devanagari:wght@600;700&display=swap">
```

Fonts (CLAUDE.md, non-negotiable): Marathi body `'Noto Sans Devanagari', sans-serif` ·
Marathi headings `'Noto Serif Devanagari', serif` · English/brand/**all numbers**
`'DM Sans', sans-serif`. Never `system-ui`, never `Arial`, never a generic fallback.

Page frame: `max-width:390px` centred, with a visible label saying it is a MOCKUP at 390px
reference width — never dressed up as the live app.
Page body: `flex flex-col gap-2.5 px-4 pb-24 pt-2` on `bg-slate-50`.

## The हजेरी cell — the load-bearing token

| State | Classes | Glyph |
|---|---|---|
| present | `bg-emerald-50 text-emerald-700` | ✓ (lucide Check, 13px, stroke 3.2) |
| half | `bg-amber-100 text-amber-700` | `½` |
| absent | `bg-slate-100 text-slate-300` | `–` |
| **unknown / no fact yet** | `border border-dashed border-slate-200 bg-white text-slate-200` | **nothing — blank** |

Cell box: `flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[12px] font-extrabold`

🔴 **Blank ≠ `–`.** A dashed empty cell means "nobody said". `–` means "he did not come".
Rendering unknown as `–` is the fabricated-absence bug this release exists to remove.

## Grid structure

- name column: `w-[82px] flex-none text-[12.5px] font-extrabold text-slate-700` + avatar
- avatar sm: `h-7 w-7 rounded-[9px] text-[12px] font-black`, tones:
  `or`=`bg-orange-100 text-orange-600` `em`=`bg-emerald-50 text-emerald-700`
  `bl`=`bg-blue-100 text-blue-600` `vi`=`bg-violet-100 text-violet-600`
  `rs`=`bg-rose-100 text-rose-600` `am`=`bg-amber-100 text-amber-700`
- day cells row: `flex flex-1 gap-1.5`
- total column: `w-9 flex-none text-center text-[15px] font-black text-slate-800 [font-variant-numeric:tabular-nums]`
- header row: `flex items-center gap-2 border-b border-slate-100 pb-2`, day letters
  `text-[11px] font-bold text-slate-400`, weekday letters `र सो मं बु गु शु श`
- totals row: `mt-1 flex items-center gap-2 border-t border-slate-100 pt-2`, label `एकूण`
- **an absent week total renders `—`, never `0`**

## Containers

- card: `rounded-[18px] border border-slate-100 bg-white p-2.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]`
- header pill: `flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-2`
  with `text-[13px] font-extrabold text-slate-800`
- footnote: `rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-600`
- empty state: `flex flex-col items-center gap-2 rounded-[20px] border border-dashed border-slate-200 bg-white px-5 py-8 text-center`,
  icon chip `h-12 w-12 rounded-full bg-slate-100 text-slate-400`,
  title `text-[14px] font-bold text-slate-700`, subtitle `text-[12px] leading-relaxed text-slate-500`
- primary button: `w-full rounded-[14px] bg-emerald-600 py-3.5 text-[13px] font-extrabold text-white active:scale-[0.98]`
- secondary button: same box, `border border-slate-200 bg-white text-slate-700`
- legend row: `flex justify-center gap-4 p-1`, item `text-[12px] font-semibold text-slate-600`,
  swatch `h-5 w-5 rounded-md`

## Semantic colours

- **मुकादम accent is violet** (`border-violet-100`, `bg-violet-50 text-violet-700`) — used for
  the Mukadam person card in the built app. Do not restyle him green.
- temporary/तात्पुरता chip: `rounded-lg bg-orange-100 px-2.5 py-1 text-[15px] font-bold text-orange-700`
- name-only worker chip: `rounded-lg bg-stone-100 px-2.5 py-1 text-[15px] font-bold text-stone-500` `फक्त नाव`
- error card: `rounded-[18px] border border-rose-100 bg-rose-50` with `text-rose-700`

## Copy rule (founder final direction §14)

Never invent farmer-facing Marathi. Where the wording is not already approved, render the
real layout with a visible placeholder:

```html
<span class="rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] font-bold text-yellow-800">[FOUNDER COPY REQUIRED]</span>
<span class="block text-[11px] italic text-slate-500">English meaning: "…"</span>
```

Copy is a UI gate. It is NOT a data-model gate — the layout ships for approval with the
placeholder visible.

## Marathi that IS approved (use verbatim, do not reword)

- `बोलून हजेरी घ्या` — the hero (shipped, `LabourHub.tsx:331`)
- `या 12 जणांमध्ये कोण होते?` — count known (spec D9.6)
- `आज किती जण होते आणि कोण कोण होते?` — count unknown (D9.6)
- `आज कोण आले होते आणि काम का झालं नाही?` — no work, labour present (D9.6)
- `बरोबर` / `बदल करा` — the confirm pair (D9.6)
- `ShramSafalला समजलं` · `12 पैकी 12 समजले` · `Shankarसोबत 8` — founder's own words
- `हजेरी वही` · `आला` · `अर्धा` · `नाही` · `दिवस` · `एकूण` — shipped ledger copy
- `अजून हजेरी नोंदवली नाही` — shipped empty state
- `एक गोष्ट स्पष्ट करा` — the contradiction question (founder direction §8)

---

# Founder rulings that decide what you draw (2026-09-01, Phase 0 closed)

## Hours = DURATION, never a clock range

**Attendance remembers duration. Work memory remembers operational timing.**

The five realities render as: `पूर्ण` · `अर्धा` · `रात्र` · `जादा 2 तास` · `4 तास`.

🔴 **Do NOT draw start/end times.** No `7:00–11:00`, no clock pickers, no from/to fields
anywhere in attendance. Operational clock timing (fertigation at 11pm because three-phase
power was on) belongs to the Work Log, not to हजेरी.

"गणेश रात्री 3 तास होता" must render as TWO preserved facts side by side:

```
रात्र = होता      तास = 3
```

Never `0.5 दिवस`, never `1.5 दिवस`, never a wage. **No derived attendance arithmetic.**
Extra hours and hours-worked are stated facts and stay stated.

## The week is never one number

`5 पूर्ण · 1 अर्धा · 2 रात्री · 3 तास जादा` — dimensions preserved. Never a single `6.5`.

## Mukadam authority starts OFF

```
Mukadam            = who this person is on the farm
Allow Labour Management = whether the owner trusts him with this responsibility
```

Existing Mukadams begin **OFF**. Nothing is backfilled to ON to preserve the old role
behaviour. The owner then chooses `ON` · `ON until a date` · `OFF`. Once ON, the Mukadam acts
independently — the owner is NOT involved in every attendance action.

## The three views are the only perspectives that exist

Owner (whole book) · authorised Mukadam (his crew's labour view, **no browsable wage roster**)
· Worker (own row only). Do not draw a fourth. Suspended or not-yet-approved members are not a
perspective — never draw the new हजेरी surface for them.

## The one test every screen must pass

> **Where is ShramSafal asking me for something I already told it?**

If a screen asks for a plot, a crop, a count, or a name the farmer already gave, that screen
has drifted and is wrong — no matter how good it looks.
