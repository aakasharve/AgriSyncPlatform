# Production Environment Variables

Set these on EC2 or the production process manager. Do not store secrets in git.

## Database

```bash
ConnectionStrings__UserDb="Host=<rds-endpoint>;Port=5432;Database=agrisync;Username=agrisync_app;Password=<strong-password>;Ssl Mode=Require"
ConnectionStrings__ShramSafalDb="Host=<rds-endpoint>;Port=5432;Database=agrisync;Username=agrisync_app;Password=<strong-password>;Ssl Mode=Require"
```

## Auth

```bash
Jwt__SigningKey="<min-64-char-random-string>"
Jwt__AccessTokenMinutes="1440"
```

## AI Providers

```bash
GEMINI_API_KEY="<key>"
SARVAM_API_SUBSCRIPTION_KEY="<key>"
```

## Storage

```bash
ShramSafal__Storage__Provider="S3"
ShramSafal__Storage__BucketName="shramsafal-uploads-prod"
AWS_REGION="ap-south-1"
```

## Runtime

```bash
ASPNETCORE_ENVIRONMENT="Production"
ASPNETCORE_URLS="http://localhost:5000"
BUILD_SHA="<git-sha>"
DEPLOYED_AT="<iso-timestamp>"
```

## Seeding

```bash
SEED_RAMU_DEMO="false"
SEED_PURVESH_DEMO="false"
CLEAR_PURVESH_DEMO="false"
```

## Notes

- `secrets/local/credentials.json` is a local-development convenience file only. It must not exist on EC2.
- Override `Serilog__WriteTo__1__Args__path` only if the production log file path needs to move off `/var/log/agrisync/api-.log`.
