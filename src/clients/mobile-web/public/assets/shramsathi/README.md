# Shram Sathi Assets

This folder holds the Shram Sathi meter assets from `04A_SHRAM_SATHI_ASSET_BRIEF.md`.

Deterministic assets:
- `bar-comprehension.svg`
- `bar-arriving.svg`
- `ring-comprehension.svg`
- `sparkle.svg`
- `bubble.svg`
- `icon-listening-ear.svg`
- `icon-half-leaf.svg`
- `icon-full-leaf-check.svg`

Runtime PNGs:
- `face-still-learning@2x.png`
- `face-concerned@2x.png`
- `face-neutral@2x.png`
- `face-content@2x.png`
- `face-delighted@2x.png`
- `silhouette@2x.png`
- `reveal-frame-02@2x.png` through `reveal-frame-05@2x.png`

Generated source candidates are stored outside the public runtime folder:
- `_COFOUNDER/Projects/AgriSync/Operations/Logs/shram-sathi-generated-sources-2026-07-03/shram-sathi-expression-sheet-candidate.png`
- `_COFOUNDER/Projects/AgriSync/Operations/Logs/shram-sathi-generated-sources-2026-07-03/shram-sathi-arriving-reveal-candidate.png`

Placeholder status:
- `ShramSathiFace.tsx` renders a code-drawn fallback if the PNG files above are absent.
- When final art is ready, drop transparent files here as `face-still-learning@2x.png`, `face-concerned@2x.png`, `face-neutral@2x.png`, `face-content@2x.png`, `face-delighted@2x.png`, and `silhouette@2x.png`.
- Rive is not authored here. If `shram_sathi.riv` lands later, wire it as the runtime replacement for the SVG/CSS fallback.
- TTS output goes in `tts/{phrase-key}.mp3`; use `scripts/generate-shramsathi-tts.mjs` from the mobile-web package.
