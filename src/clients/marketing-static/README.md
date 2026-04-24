# marketing-static

Single-file static landing page served at `https://shramsafal.in/`.

This is the **minimal** marketing site — one hand-written `index.html`, all CSS inline, zero JS framework, zero build step. Use this until the full Astro site at `../marketing-web/` is content-complete.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire page. Edit in place, no build required. |

## Deploy one-liner (copy-paste)

```bash
aws s3 cp src/clients/marketing-static/index.html \
  s3://shramsafal-marketing-prod/index.html \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html; charset=utf-8" && \
aws cloudfront create-invalidation \
  --distribution-id E2M06A2B71ZW1O \
  --paths "/*" \
  --query "Invalidation.Id" --output text
```

Wait ~60s for CF, then hard-refresh `https://shramsafal.in/`.

## Rules

1. **"Open App" link must always be `https://app.shramsafal.in`** (not `.com`, not a bare domain, not `shramsafal.in/app`).
2. **"Download APK" link** must match the current shipped APK version. Bump both the `href` and the visible label together:
   ```html
   <a class="button-muted" href="/download/ShramSafal-vX.Y.Z.apk">Download APK (vX.Y.Z)</a>
   ```
3. When you bump the APK version, also upload the new binary:
   ```bash
   aws s3 cp Credential/release-backups/ShramSafal-vX.Y.Z.apk \
     s3://shramsafal-marketing-prod/download/ShramSafal-vX.Y.Z.apk \
     --cache-control "public, max-age=3600" \
     --content-type "application/vnd.android.package-archive"
   ```
4. **Do NOT commit the APK binary to this folder.** It lives in S3 only. Source-of-truth copy stays in `Credential/release-backups/` (outside the repo).

## When to retire this

When `src/clients/marketing-web/` (Astro) is content-complete and you want the scrolling hero back, switch the deploy target back to the marketing-web one-liner in `_COFOUNDER/Projects/AgriSync/Operations/Protocols/DEPLOY_CONFIG.md`. No other changes needed — both builds target the same S3 bucket + CloudFront.
