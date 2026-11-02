# Website — shramsafal.in

The public Shram Safal site, live since 2026-11-02. Plain static pages built by one Python script
(`site-src/build.py`, standard library only), with Marathi at `/` and English at `/en/`. It replaced
`src/clients/Static_V2`, which now publishes only the privacy and delete-account pages.

Hosting is S3 `shramsafal-marketing-prod` behind CloudFront `E2M06A2B71ZW1O`. A CloudFront function
serves `/x` as `/x/index.html`, and a strict Content-Security-Policy forbids inline scripts, which is why
Google Analytics (`G-BBWVLKTLXQ`) loads from the file `site/analytics.js`.

Edit the site here. `E:\FInal Website Design` was the working copy before the site came into git; the
first commit of this folder was byte-identical to it and to what was live.

## What is in git

| Path | What it is |
|---|---|
| `site-src/build.py` | The build. Settings at the top: `SHOW_PLAY` (Google Play is hidden while `False`), `TODAY`, the GA tag. |
| `site-src/*.html`, `site-src/partials/` | Page sources. Each holds both languages (`class="mr"` / `class="en"`); the build splits them. |
| `site-src/blog/posts/*.json` | Blog posts, each with its own illustration SVG. |
| `site/assets/css/site.css`, `site/assets/js/site.js` | The one stylesheet and script, kept by hand. |
| `site/assets/img/`, `site/assets/blog/*.jpg` | Images, kept by hand. |
| `site/analytics.js` | The GA loader. |
| `deploy.py`, `test_deploy.py` | Publishing, and offline tests of its safety checks. |

Everything else in `site/` is written by the build and is not committed (see `.gitignore`): every
`*.html`, `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, `assets/blog/*.svg`, and the redirect
pages `vision/`, `farmers/`, `join/`, `privacy-trust/` that send the old site's addresses to the new pages.
Files here are stored byte-for-byte (`.gitattributes`: `-text`), because the bytes of `site.css` and
`site.js` set the `?v=` cache-busting hash in every page.

## Build

```bash
cd src/clients/Website/site-src
python build.py             # preview build: review ribbon, yellow notes, design previews (_*.html)
python build.py --publish   # the live build: none of those, Google Analytics added
```

Needs Python 3 and nothing else (checked with 3.14). It prints `done: 24 pages x 2 languages, 16 posts` and stops with
an error if Google Play is hidden but a page still mentions it.

## Preview

```bash
cd src/clients/Website
python -m http.server 3092 --directory site
```

Open http://localhost:3092/ (Marathi) and http://localhost:3092/en/ (English). Analytics counts visits on
shramsafal.in only, never on a preview.

## Publish

Needs the AWS CLI signed in to the account that owns the bucket.

```bash
cd src/clients/Website
python deploy.py                      # dry run: builds, checks, shows what WOULD change. Uploads nothing.
python deploy.py --confirm PUBLISH    # the same, then goes live
```

What it does, in order:

1. Says which commit it is publishing. With `--confirm PUBLISH` it refuses if this folder has uncommitted
   changes, so the live site is always a commit you can roll back to.
2. Runs `build.py --publish` itself, then refuses unless the build is clean: no `pv-note` or `preview-bar`
   in any page, no `_*` preview files, no page left over from an earlier build, every expected file present.
3. Prints the AWS identity (no secrets), lists the bucket once and compares every built file with its live
   copy byte for byte (MD5 against the ETag), so the dry run names exactly what would change for visitors.
4. Runs every upload as an `aws s3 sync --dryrun` first and stops unless each built file goes out exactly
   once, in its own step, and nothing else does.
5. With `--confirm PUBLISH`: uploads in this order, pages last so no page goes live before its files:

   | Step | Files | Cache-Control | Content-Type |
   |---|---|---|---|
   | 1 | `assets/css/*`, `assets/js/*` | `public, max-age=31536000, immutable` | guessed (`text/css`, `application/javascript`) |
   | 2 | the rest of `assets/` | `public, max-age=86400` | guessed |
   | 3 | `*.txt` | `public, max-age=3600` | `text/plain; charset=utf-8` |
   | 4 | other root files (`sitemap.xml`, `analytics.js`) | `public, max-age=3600` | guessed |
   | 5 | every `*.html` | `no-cache` | `text/html; charset=utf-8` |

6. Invalidates `/*` on CloudFront and waits until it has completed.
7. Lists the bucket again and stops with an error unless every built file is live byte for byte and the
   Static_V2 files below are unchanged.

It never deletes anything from the bucket (no `--delete`). A page removed from the site stays online until
removed by hand (`aws s3 rm s3://shramsafal-marketing-prod/<key>`), which is deliberately the safer failure.

It never uploads `privacy/`, `privacy-mr/`, `delete-account/` or `googlef604748e4173278f.html` (the Search
Console proof): every upload excludes them, and the build check refuses if any of them appears in `site/`.
Those belong to Static_V2: `cd src/clients/Static_V2 && npm run deploy -- --privacy-only`.

Tests of these checks (offline, no AWS call):

```bash
cd src/clients/Website
python -m unittest test_deploy
```

## Roll back

**To an earlier version of this site** — publish the commit that was good. Pages added after it stay
online but unlinked (nothing is deleted); remove them by hand if they must go.

```bash
git switch --detach <good-commit>
cd src/clients/Website
python deploy.py                      # check the list of changed files
python deploy.py --confirm PUBLISH
git switch -                          # back to your branch
```

**To the old site (Static_V2) that was live until 2026-11-02** — the full pre-deploy backup of the bucket
is on the founder's PC at `E:\FInal Website Design\archive\live-backup-2026-11-02\` (52 files; not in git).
Upload it with `cp --recursive`, not `sync`: the backup's files are older than the live ones, and `sync`
would skip any that happen to have the same size. Run each line with `--dryrun` first, then without; the
pages go last. The new site's own pages (for example `/fpo.html`, `/en/`) stay online but unlinked.

```bash
cd "/e/FInal Website Design/archive/live-backup-2026-11-02"
B=s3://shramsafal-marketing-prod
aws s3 cp assets "$B/assets" --recursive --cache-control "public, max-age=31536000, immutable"
aws s3 cp fonts  "$B/fonts"  --recursive --cache-control "public, max-age=31536000, immutable" --content-type font/woff2
aws s3 cp . "$B/" --recursive --exclude "*.html" --exclude "assets/*" --exclude "fonts/*" --cache-control "public, max-age=3600"
aws s3 cp . "$B/" --recursive --exclude "*" --include "*.html" --exclude "privacy/*" --exclude "privacy-mr/*" --exclude "delete-account/*" --exclude "googlef604748e4173278f.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8"
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id E2M06A2B71ZW1O --paths "/*"
```

`MSYS_NO_PATHCONV=1` matters in Git Bash, which otherwise rewrites `/*` into a Windows path and the
invalidation is rejected.
