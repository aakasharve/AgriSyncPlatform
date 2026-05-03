# AgriSync OTel Collector — Deploy Guide
Status: **FUTURE_SCOPE** — not a launch blocker before first users.
Trigger condition: first users live AND tracing operationally needed.

## Two deployment paths

| Path | Status | When to use | Docker required? |
|---|---|---|---|
| **EC2-native ADOT** (§EC2) | **RECOMMENDED** (FUTURE_SCOPE) | Current stage — EC2 backend already running | No |
| **ECS/Fargate/Grafana** (§ECS, this directory) | FUTURE_SCOPE_ECS_PATH | When ECS is active deployment model + Grafana needed | Yes |

For the EC2-native ADOT path, see:
`_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/T-IGH-05-OTEL-EC2-ADOT_2026-05-03.md`

The sections below document the ECS/Fargate/Grafana path.

---

## EC2-native ADOT path (recommended for current stage)

Architecture:
```
Backend (EC2 i-024b3537191712c76) → OTLP localhost:4317 → ADOT systemd service → AWS X-Ray
```

Key facts:
- No Docker required.
- Uses existing EC2 instance `shramsafal-api` (t3.small, ap-south-1).
- Auth via IAM instance profile `shramsafal-api-profile` (add `AWSXRayDaemonWriteAccess`).
- Zero additional infrastructure cost (ADOT RPM installs directly on EC2).
- Pre-requisite AWS resources already provisioned: CW Log group `/agrisync/otel-collector/prod`.

Summary steps (full detail in the task doc above):
1. SSH/SSM into EC2 instance.
2. Install ADOT RPM.
3. Write config (OTLP receiver → X-Ray exporter).
4. Start + enable systemd service.
5. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317` in backend env.
6. Smoke verify in AWS X-Ray console.

---

## ECS/Fargate/Grafana path (this directory's artifacts)

T-IGH-05-OTEL-PROD | Owner: Kiro (AWS) + Akash (backend config)

### Overview

This directory contains the deployment-ready artifacts for the production
OpenTelemetry collector in the AgriSync VPC (ECS/Fargate variant). The backend
(AgriSync.Bootstrapper) already exports OTLP traces and metrics when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set
(see `src/AgriSync.Bootstrapper/Composition/OpenTelemetryConfig.cs`). This
collector is the missing "last mile" — it receives that OTLP traffic and
ships it to the chosen observability backend.

Use this path only when ECS/Fargate is already the active deployment model
and Grafana Cloud Tempo dashboarding is specifically needed.

## Files

| File | Purpose |
|------|---------|
| `otel-collector-config.yaml` | Collector structural config (receivers, processors, exporters, pipelines) |
| `task-definition.json` | ECS Fargate task definition template; fill in `<PLACEHOLDERS>` before use |
| `SECURITY_NOTES.md` | VPC wiring, SG rules, IAM roles, Secrets Manager layout |
| `README.md` | This file |

## Pre-deploy checklist

- [ ] Akash has chosen an observability backend (Grafana Cloud OR Honeycomb).
  Default: Grafana Cloud. Decision deadline: 2026-05-15.
- [ ] Grafana Cloud stack provisioned; OTLP endpoint URL, instance ID, and API
  token obtained from https://grafana.com/profile/api-keys.
- [ ] Three secrets created in AWS Secrets Manager (ap-south-1):
  - `agrisync/prod/grafana-otlp-endpoint`
  - `agrisync/prod/grafana-instance-id`
  - `agrisync/prod/grafana-api-token`
  (See SECURITY_NOTES.md §Secrets Manager layout for exact commands.)
- [ ] IAM roles created:
  - `agrisync-otel-collector-execution` (with SecretsManager + ECR + CloudWatch Logs)
  - `agrisync-otel-collector-task` (empty for MVP)
- [ ] VPC private subnet ID(s) identified (same VPC as the backend ECS service).
- [ ] Security groups planned per SECURITY_NOTES.md:
  - New: `sg-agrisync-otel-collector`
  - Modified: `sg-agrisync-backend` (add outbound 4317 → collector SG)
- [ ] AWS Cloud Map namespace `agrisync.internal` exists (or note the collector
  task's private IP for direct addressing — less robust).

## Deploy steps

### 1. Build or pull the collector image

For MVP, the public image is sufficient:
```
otel/opentelemetry-collector-contrib:0.103.0
```

For deterministic config delivery (recommended):
```dockerfile
FROM otel/opentelemetry-collector-contrib:0.103.0
COPY otel-collector-config.yaml /etc/otelcol/otel-collector-config.yaml
```
Push to ECR:
```bash
aws ecr create-repository --repository-name agrisync-otel-collector --region ap-south-1
docker build -t agrisync-otel-collector:0.103.0 .
docker tag agrisync-otel-collector:0.103.0 <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/agrisync-otel-collector:0.103.0
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/agrisync-otel-collector:0.103.0
```

If using the custom ECR image, update `task-definition.json` `"image"` field to the ECR URI and remove the `volumes` block (config is baked in).

### 2. Fill in task-definition.json placeholders

Replace all occurrences of:
- `<ACCOUNT_ID>` → your 12-digit AWS account ID
- `<REGION>` → `ap-south-1`

Then register:
```bash
aws ecs register-task-definition \
  --cli-input-json file://aws/otel-collector/task-definition.json \
  --region ap-south-1
```

### 3. Create the ECS service

```bash
aws ecs create-service \
  --cluster agrisync-prod \
  --service-name agrisync-otel-collector \
  --task-definition agrisync-otel-collector \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE_SUBNET_1>,<PRIVATE_SUBNET_2>],securityGroups=[sg-agrisync-otel-collector],assignPublicIp=DISABLED}" \
  --service-registries "registryArn=arn:aws:servicediscovery:ap-south-1:<ACCOUNT_ID>:service/<SERVICE_ID>" \
  --region ap-south-1
```

### 4. Verify the collector is healthy

```bash
# Check ECS service stabilises (desired=running=1)
aws ecs describe-services \
  --cluster agrisync-prod \
  --services agrisync-otel-collector \
  --region ap-south-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'

# From inside the VPC (e.g., bastion or SSM session manager on the backend task):
curl http://otel-collector.agrisync.internal:13133/
# Expected: {"status":"Server available","upSince":"...","uptime":"..."}
```

### 5. Point the backend at the collector

Update the backend ECS task definition with:
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.agrisync.internal:4317
```
Redeploy the backend service.

### 6. Smoke verification

Send a request to the production backend and verify a trace appears in Grafana:
```bash
# Replace <PROD_API_URL> with the actual ALB/CloudFront URL
curl -v \
  -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  https://<PROD_API_URL>/health

# In Grafana Cloud → Explore → Tempo:
# Search for trace ID: 4bf92f3577b34da6a3ce929d0e0e4736
# Expected: a trace tree with spans for HTTP, EF Core, Npgsql
```

Expected span structure (matches the 2026-05-01 Jaeger evidence):
- `GET /health` (ASP.NET Core, span kind: server)
  - `GET /health/ready` (ASP.NET Core)
    - `agrisync_dev` × 2 (EF Core)
      - `postgresql SELECT 1` × 2 (Npgsql)

### 7. Enable frontend OTel (after backend traces confirmed)

Once backend traces are confirmed in Grafana:
1. Set `VITE_OTEL_ENABLED=1` in the mobile-web production build environment.
2. Redeploy mobile-web.
3. Verify end-to-end traces (browser span → backend span linked via `traceparent`).

## Rollback

```bash
# Revert to no-op (traces stay in-process, nothing shipped):
# 1. Remove OTEL_EXPORTER_OTLP_ENDPOINT from the backend task definition.
# 2. Redeploy the backend service.
# 3. Set collector desired-count=0 if needed:
aws ecs update-service \
  --cluster agrisync-prod \
  --service agrisync-otel-collector \
  --desired-count 0 \
  --region ap-south-1
```

## Config delivery options (Vol.2)

| Option | Complexity | Best for |
|--------|-----------|---------|
| Custom ECR image (COPY config in) | Low | MVP; deterministic; no S3 dependency |
| S3 sidecar init container | Medium | Dynamic config updates without image rebuild |
| AWS AppConfig | High | Multi-env config management at scale |

**Recommendation for MVP**: custom ECR image. Rebuild + push when config changes.

## Cost estimate

| Component | SKU | ~Monthly cost (ap-south-1) |
|-----------|-----|--------------------------|
| Fargate task (0.25 vCPU / 0.5 GB, 24×7) | Fargate pricing | ~$8-10 |
| Grafana Cloud (free tier up to 50GB traces) | Grafana Cloud Free | $0 for first 6 months (likely) |
| Secrets Manager (3 secrets) | $0.40/secret/month | ~$1.20 |
| CloudWatch Logs | $0.50/GB ingested | ~$1-3 depending on verbosity |

Total MVP estimate: **$10-15/month**. Well within the $50/month cap.

## References

- `src/AgriSync.Bootstrapper/Composition/OpenTelemetryConfig.cs` — backend OTel SDK wiring
- `src/AgriSync.Bootstrapper/PRODUCTION_ENVIRONMENT_VARIABLES.md` — full backend env-var list
- `_COFOUNDER/Projects/AgriSync/Operations/Runbooks/PRODUCTION_RUNBOOK_2026-04-27.md` §12 — OTel Collector Deployment section
- `_COFOUNDER/Projects/AgriSync/Operations/Evidence/IGH_03_OTEL_JAEGER_TRACE_2026-05-01.json` — local smoke evidence (Jaeger)
- `_COFOUNDER/Projects/AgriSync/Operations/Pending_Tasks/T-IGH-05-OTEL-PROD_2026-05-01.md` — task tracking
