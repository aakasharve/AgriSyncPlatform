# Building a signed release

## Where the signing key lives

**Not in this repository.** The keystore is held in two places:

- the GitHub Actions secret `KEYSTORE_BASE64`, decoded at build time by
  [`.github/workflows/android-release.yml`](../../../../.github/workflows/android-release.yml)
- an offline backup held by the founder

`app/shramsafal-release.keystore` is matched by `android/.gitignore` and is not
tracked. If you see it in your working tree, it is a local copy you or a previous
build put there.

> **A note on history.** An earlier keystore *was* committed to this repository,
> which is public, so that key is permanently downloadable by anyone. It was
> rotated on 2026-08-30 and now signs nothing. Untracking the file does **not**
> remove it from history — only rotation made it harmless. Do not re-add a
> keystore to git on the assumption that `.gitignore` protects it: gitignore has
> no effect on a file that is already tracked, which is exactly how the first one
> got in.

## CI is the normal path

Release is **build once, verify, then promote the same artifacts** - three workflows:

1. **release-build** (manual, on the frozen protected-main SHA; also rehearsed on PRs that touch
   the release path). Builds the web bundle, the signed APK and the Play bundle once, verifies
   the *finished* APK (bundle bytes inside the package, application id, version, signature,
   signer continuity against `ops/release/expected-release.env`) and uploads them as
   artifacts. It holds **no AWS credentials**: it cannot publish or move any pointer.
2. **web-release** and 3. **android-release** only *promote* those artifacts. Dispatch each on
   the same commit with the release-build run id. They default to `dry_run=true` (verify only);
   a real publish needs `dry_run=false` and `confirm=PUBLISH`. They re-check that the run is
   `release-build`, succeeded and built this commit, and re-verify every hash. Nothing is rebuilt
   and there is no tag trigger.

Verifier logic and its negative-control tests: `ops/release/` (`python -m unittest`).

## The APK library (every delivered build is kept)

Canonical location: `https://app.shramsafal.in/apk/` (page) and
`https://app.shramsafal.in/apk/shramsafal-latest.apk` (stable "latest"). Both sit behind the
existing CloudFront basic-auth function (`shramsafal-apk-auth`, distribution `EFLL3RCLOOO60`);
nothing here is ever published through the public marketing site, and this tooling never reads,
changes or prints the credentials.

| Thing | Rule |
|---|---|
| Permanent link | `apk/shramsafal-<versionName>-<versionCode>-<commit7>-<apksha12>.apk`, created once with an S3 conditional write (`If-None-Match: *`). Different bytes under an existing key = **refusal**; identical bytes = no-op. Never deleted, never overwritten. |
| Record | `apk/meta/<same stem>.json`: versionName/versionCode/package/signer read from the **finished APK's compiled AndroidManifest** (not commit messages), commit, run id, kind, publication time, bundle manifest hash. |
| Kind | `test` (delivered for trial; the default) or `release` (founder-approved; needs `approval_ref`). The page labels them differently and says availability is not verification. A `test` record may later be promoted to `release` (same bytes); never the reverse. |
| Latest | `apk/shramsafal-latest.apk` + `apk/meta/latest.json` move **only** for `publication_kind=release` **and** `promote_latest=true`, and only to a strictly higher `versionCode` than the current latest (before the first catalog pointer exists the floor is `PREVIOUS_VERSION_CODE` in `expected-release.env`). Test/rehearsal publication never touches latest. |
| Page | `apk/index.html`, regenerated from the records on every publication by `ops/release/apk_catalog.mjs` (newest first, version + build, date, commit, run id, change notes from the real commit range). Builds published before the catalog (`shramsafal-<commit>.apk`) stay listed as "Legacy". |
| Cache | the same run invalidates `/apk/`, `/apk/index.html`, `/apk/shramsafal-latest.apk`, `/apk/meta/latest.json` and waits for completion. If that fails the run fails (content is already uploaded; rerun, it is idempotent). |

### Runbook: deliver a test build to the founder

1. `release-build` on the commit (manual dispatch) - note its run id. Wait for green.
2. Dispatch `android-release` with `--ref <same commit>`: `build_run_id=<id>`, `publication_kind=test`,
   leave `dry_run=true`. Read the "publication plan" step: it names the permanent key and states
   "latest NOT moved". Nothing is uploaded, no AWS credentials are loaded.
3. Re-dispatch with `dry_run=false`, `confirm=PUBLISH`, `publication_kind=test`.
4. The last step runs `ops/release/verify_publication.py` from the runner. It must be green: only then
   send the founder the permanent link from the job summary.

### Runbook: approved release (moves latest)

Same, with `publication_kind=release`, `approval_ref=<where the founder approved, e.g. date + message>`
and `promote_latest=true`. Verification asserts that latest now serves exactly these bytes. Publishing
an already-stored test build as `release` re-uses the stored bytes and only records the approval.

### Verifying by hand (outside CI)

```bash
export APK_CATALOG_USER=... APK_CATALOG_PASSWORD=...     # environment only, never arguments
python3 ops/release/verify_publication.py --key apk/shramsafal-1.0.13-21-<c7>-<s12>.apk \
  --apk app-release.apk --web-manifest web-dist.sha256 --version-name 1.0.13 --version-code 21 \
  --kind test --latest not-this          # --latest this after an approved-release promotion
```

It checks: anonymous requests to page and APK are refused (401/403); the authenticated page lists the
entry with the right version/build/kind/sha256; the download is a genuine APK (zip magic, not an HTML
fallback) with the published sha256; on the downloaded bytes, `release_verify.verify_apk` proves the
embedded web bundle equals the released bundle manifest, plus application id, version and signer
certificate (`expected-release.env`); latest behaves as the publication kind requires. Redirects are
refused so credentials cannot be forwarded elsewhere. `--web-base-url` additionally compares the live
web app's `index.html` with the bundle manifest.

### Preconditions for a real publication (what must exist, none is stored in git)

- Repository secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for a **dedicated publisher IAM user/role**
  holding only: `s3:PutObject`, `s3:GetObject`, on `arn:aws:s3:::shramsafal-app-prod/apk/*`;
  `s3:ListBucket` on the bucket restricted by `s3:prefix` = `apk/*`; `cloudfront:CreateInvalidation` and
  `cloudfront:GetInvalidation` on the `EFLL3RCLOOO60` distribution ARN. **No** `s3:DeleteObject`, no
  `s3:PutObjectAcl`, no bucket policy or other-prefix access: the tooling never deletes, and without
  `DeleteObject` a bug cannot erase history. (Enabling S3 bucket versioning is advisable defence in depth.)
- Repository secrets `APK_CATALOG_USER` / `APK_CATALOG_PASSWORD`: the existing basic-auth login of
  `shramsafal-apk-auth`, used only for the end-to-end verification step. Without them the publish step
  completes but the workflow turns red as "UNVERIFIED".
- Optional repository variable `APK_CF_DISTRIBUTION` (defaults to `EFLL3RCLOOO60`). A missing/invalid
  distribution id aborts before any upload: nothing is uploaded that cannot be invalidated.
- Founder approval for the dispatch itself (`dry_run=false`, `confirm=PUBLISH`), and for `release`, an `approval_ref`.

Tests for all of this: `cd ops/release && python -m unittest test_publish_apk test_verify_publication test_workflows`
and `node --test apk_catalog.test.mjs`; both run in `release-build` on every PR touching `ops/release/**`.

It produces both:

| Artifact | What it is for |
|---|---|
| `shramsafal-release-apk` | what a pilot farmer sideloads; published **privately** to `app.shramsafal.in/apk/` (basic-auth), never to the marketing site |
| `shramsafal-release-aab` | what Google Play requires; upload to Play Console by hand |

The workflow fails early, with a named message, if any signing secret is empty,
truncated, or does not match the keystore.

## Building one locally

You need the keystore file and its password, obtained out of band. The web assets
are not in git either, so they must be built and synced first.

```bash
cd src/clients/mobile-web
npm run build                     # build the web assets
npx cap sync android              # copy them into the Android project
cp /path/to/your.keystore android/app/shramsafal-release.keystore
cd android
KEYSTORE_PASSWORD='...' KEY_PASSWORD='...' ./gradlew assembleRelease bundleRelease
```

PowerShell:

```powershell
$env:KEYSTORE_PASSWORD='...'; $env:KEY_PASSWORD='...'; .\gradlew.bat assembleRelease bundleRelease
```

Outputs:

- `app/build/outputs/apk/release/app-release.apk`
- `app/build/outputs/bundle/release/app-release.aab`

A missing keystore or a missing password fails immediately with a named message
(the guard in `app/build.gradle`) rather than deep inside the build.

**`./gradlew assembleDebug` needs none of this** — use it for ordinary development.

## Versioning

There is no `version_bump` workflow input; one used to exist and did nothing.
The version is a commit: edit `versionCode` and `versionName` in
`app/build.gradle` and push.

`versionCode` must **increase** on every build you intend to publish. Google Play
permanently refuses a `versionCode` it has already accepted, so once the app is
on Play, check what is live there before bumping.

## Never change the signing key after users have installed

Android refuses an update signed with a different key. Rotating the key means
every existing user must uninstall and reinstall, losing whatever is stored on
their device. If the key ever needs rotating again, it has to happen **before**
the next distribution, not after.
