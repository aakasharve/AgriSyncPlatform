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

## App release (the phone's "new version available" card)

Served anonymously at `GET /version/app`. Not secrets. Leave `LatestVersion` empty and phones show
nothing. Set it only AFTER the new version is really downloadable (Play listing live and/or the APK on
shramsafal.in/apk), or farmers are sent to a version they cannot get yet.

```bash
AppRelease__LatestVersion="1.0.18"
# Optional: phones below this see a card they cannot dismiss ("may stop working soon"); the app is never blocked.
AppRelease__MinimumVersion=""
# Defaults live in appsettings.json; override only if the places move. The phone opens only
# play.google.com (for com.agrisync.shramsafal) and https://shramsafal.in — anything else is ignored.
AppRelease__PlayStoreUrl="https://play.google.com/store/apps/details?id=com.agrisync.shramsafal"
AppRelease__ApkUrl="https://shramsafal.in/apk"
```

## Notes

- `secrets/local/credentials.json` is a local-development convenience file only. It must not exist on EC2.
- Override `Serilog__WriteTo__1__Args__path` only if the production log file path needs to move off `/var/log/agrisync/api-.log`.
- Production startup no longer auto-applies pending EF migrations unless `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true` is set intentionally for a controlled maintenance window.
- Preferred production flow: run database migrations as a separate deployment step, then start the API and validate `/health` plus `/health/ready`.

## Database pool cap and waits (lane OPS-1, F36)

A business request holds TWO database connections for its whole life (one per writing context, ShramSafal first, then User). Every
PostgreSQL connection string is therefore given its own pool (a distinct `Application Name`, `agrisync-<key>`, so that `UserDb` and
`ShramSafalDb` with identical text no longer share one pool) and a cap, when the API starts, through the Npgsql builder. A value
written in the connection string itself (`Maximum Pool Size=`, `Timeout=`, `Command Timeout=`, `Application Name=`) wins. A string the API
cannot parse is left alone and a warning names its key.

Optional settings (defaults in brackets):

| Setting | Meaning |
|---|---|
| `Database__MaxPoolSize` [24] | Cap of each WRITING pool (`ShramSafalDb`, `UserDb`). Keep the User pool at least as large as the ShramSafal pool. |
| `Database__AuxiliaryMaxPoolSize` [2] | Cap of every other key (`AccountsDb`, `AnalyticsDb`, `*_Migration`, `*_ReadOnly`). |
| `Database__ConnectionTimeoutSeconds` [15] | How long a request waits for a free connection before it fails ALONE with Npgsql's pool timeout. |
| `Database__CommandTimeoutSeconds` [30] | Longest a single database command may run. |

Arithmetic (production has `max_connections` 79, 76 usable): writing pools 24 + 24 = 48, auxiliary pools 6 x 2 = 12, idle baseline 12 =
72, 4 spare = 76. If you raise a cap, redo this sum; it must stay at or below 76.

## Reverse proxy for 10-minute recordings (lane OPS-1, F73; the proxy is not in this repository)

A 10-minute recording takes about 1 to 2.5 minutes to parse and is about 3 MB. Default nginx (60 s, 1 MB) cuts it. Set the timeouts for
`/shramsafal/ai/` and the body limit PER LOCATION, so that the voice limit does not also cap the photo routes (receipt and sale-slip
photos go to `/shramsafal/ai/document-sessions` and are not compressed by the app; Kestrel allows 50 MB):

```
location /shramsafal/ai/ {
    client_max_body_size    10m;     # voice: covers a 10-minute clip with headroom
    proxy_read_timeout      300s;    # twice the slowest measured parse
    proxy_send_timeout      300s;
    send_timeout            300s;
    proxy_request_buffering off;     # stream the upload to Kestrel instead of spooling it on the proxy
}
location /shramsafal/ai/document-sessions/ {
    client_max_body_size    50m;     # photos: the largest phone photo the app sends is not measured yet; Kestrel's own ceiling is 50 MB
    proxy_read_timeout      300s;
    proxy_send_timeout      300s;
    proxy_request_buffering off;
}
```

(A more specific `location` wins over `/shramsafal/ai/`.) If an AWS load balancer sits in front, its idle timeout must also be at least 300
seconds (default 60). Verify with a real 10-minute recording and with the largest receipt photo before release.
