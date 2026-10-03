# Static_V2 — shramsafal.in

The public ShramSafal site, live since 2026-10-03. React 19 + Vite, prerendered
to static HTML per route. English by default (the copy search and answer
engines index); first-time visitors are offered Marathi.

## Build and test

```bash
npm install
npm test          # copy contract: approved Marathi lines, structure, language
npm run build     # tsc → vite → prerender of / /vision /farmers /join /privacy-trust
npm run perf:load # LCP / CLS / hydration warnings per route, throttled phone
```

`npm run build` fails if any route prerenders under 400 characters, and prints
any Marathi string the English dictionary missed.

## Deploy

Hosting is S3 `shramsafal-marketing-prod` behind CloudFront `E2M06A2B71ZW1O`
(the `shramsafal-index-rewrite` function maps `/vision` → `/vision/index.html`).

```bash
cd dist
aws s3 sync assets s3://shramsafal-marketing-prod/assets --cache-control "public, max-age=31536000, immutable"
aws s3 sync fonts  s3://shramsafal-marketing-prod/fonts  --cache-control "public, max-age=31536000, immutable" --content-type font/woff2
aws s3 sync . s3://shramsafal-marketing-prod/ --exclude "*" --include "*.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws s3 sync . s3://shramsafal-marketing-prod/ --exclude "*.html" --exclude "assets/*" --exclude "fonts/*" --cache-control "public, max-age=3600"
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id E2M06A2B71ZW1O --paths "/*"
```

`MSYS_NO_PATHCONV=1` matters in Git Bash, which otherwise rewrites `/*` into a
Windows path and the invalidation is rejected.

## How the language works — read before changing it

Page copy is written in Marathi directly in the JSX. `src/i18n-jsx/jsx-runtime.ts`
translates it to English **while React renders**, using the dictionary in
`src/i18n.ts`. That is what lets the prerendered English HTML *hydrate*: React's
first render produces the same English, so it reuses the page instead of
repainting it. Translating after render (the old DOM walker) or switching
`main.tsx` back to `createRoot` costs ~3.5 s of LCP and a large layout jump.

A new Marathi string needs an English entry in `englishTranslations`, or it
shows in Marathi on the English page — the build prints any it finds.

## Images

`assets/` on disk holds ~46 MB of design drafts; only the images `src/App.tsx`
imports are committed. Importing a new image means adding a `!/assets/...` line
to `.gitignore`, or a fresh clone will fail to build.
