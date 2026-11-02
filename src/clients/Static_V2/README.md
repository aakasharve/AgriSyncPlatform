# Static_V2 — shramsafal.in

> **Not the live site any more.** shramsafal.in was replaced on 2026-11-02 by
> [`src/clients/Website`](../Website/README.md). Static_V2 now publishes only the privacy
> and delete-account pages (see Deploy below).

The public ShramSafal site from 2026-10-03 to 2026-11-02. React 19 + Vite, prerendered
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

## Deploy — Static_V2 no longer publishes the site

Since 2026-11-02 shramsafal.in is the site in [`src/clients/Website`](../Website/README.md),
published with `python deploy.py` there. Uploading this folder's `dist/` would put the old
pages back over it, so `npm run deploy` now refuses and points there. Do not run the old
manual `aws s3 sync` commands from this folder's history either.

Static_V2 still owns three pages on the bucket, which the app and the Google Play listing
link to: the privacy notice (`public/privacy/`, `public/privacy-mr/`) and the
account-deletion page (`public/delete-account/`). The new site's deploy never touches them.
To republish only those three (needs the AWS CLI signed in):

```bash
npm run deploy -- --privacy-only                     # dry run: compares with live, uploads nothing
npm run deploy -- --privacy-only --confirm PUBLISH   # uploads the three pages, clears their cache
```

It uploads the committed bytes (`git show HEAD:...`), refuses if those files have
uncommitted edits, and never deletes anything. Committed bytes, not the working copy,
because a Windows checkout turns their LF line endings into CRLF and the live pages are
the LF ones.

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
