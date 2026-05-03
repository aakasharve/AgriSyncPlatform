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
Jwt__AccessTokenMinutes="15"
```

## AI Providers

```bash
Gemini__ApiKey="<key>"
Sarvam__ApiSubscriptionKey="<key>"
```

## Storage

```bash
ShramSafal__Storage__Provider="S3"
ShramSafal__Storage__BucketName="shramsafal-uploads-prod"
AWS_REGION="ap-south-1"
```

## CORS

```bash
Cors__AllowedOrigins__0="https://app.shramsafal.in"
Cors__AllowedOrigins__1="https://shramsafal.in"
Cors__AllowedOrigins__2="capacitor://localhost"
Cors__AllowedOrigins__3="https://localhost"
Cors__AllowedOrigins__4="http://localhost"
```

## Runtime

```bash
ASPNETCORE_ENVIRONMENT="Production"
ASPNETCORE_URLS="http://localhost:5000"
BUILD_SHA="<git-sha>"
DEPLOYED_AT="<iso-timestamp>"
ALLOW_PRODUCTION_STARTUP_MIGRATIONS="false"
```

## Seeding

```bash
SEED_RAMU_DEMO="false"
SEED_PURVESH_DEMO="false"
CLEAR_PURVESH_DEMO="false"
```

## Observability (OTel)

```bash
# Set this ONLY after the OTLP collector ECS service is running and healthy.
# Until then, leave unset — traces stay in-process and nothing is shipped.
# See aws/otel-collector/README.md for the full deploy flow.
#
# gRPC endpoint (preferred): uses HTTP/2, lower overhead
OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector.agrisync.internal:4317"

# Optional: per-environment service name for Grafana/Honeycomb filtering
OTel__ServiceName="agrisync-prod"
```

## Notes

- `secrets/local/credentials.json` is a local-development convenience file only. It must not exist on EC2.
- Override `Serilog__WriteTo__1__Args__path` only if the production log file path needs to move off `/var/log/agrisync/api-.log`.
- Production startup no longer auto-applies pending EF migrations unless `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` is set intentionally for a controlled maintenance window.
- Preferred production flow: run database migrations as a separate deployment step, then start the API and validate `/health` plus `/health/ready`.
