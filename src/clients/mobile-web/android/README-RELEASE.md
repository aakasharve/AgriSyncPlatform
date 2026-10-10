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
