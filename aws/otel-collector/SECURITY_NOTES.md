# OTel Collector — Security and VPC Wiring Notes
T-IGH-05-OTEL-PROD

## Ports

| Port | Protocol | Purpose | Exposed where |
|------|----------|---------|---------------|
| 4317 | TCP (gRPC) | OTLP gRPC ingest from backend | VPC-internal SG only |
| 4318 | TCP (HTTP/1.1) | OTLP HTTP ingest from backend | VPC-internal SG only |
| 13133 | TCP | Collector health_check extension | VPC-internal (ALB health target) |
| 1777 | TCP | pprof debug endpoint | NOT exposed; disable in prod or restrict to bastion |

## Hard rules

1. **No public internet exposure for 4317/4318.** The collector task must run in a private subnet with no public IP. The security group for the collector must allow inbound 4317 and 4318 ONLY from the backend task security group (`sg-agrisync-backend`). No `0.0.0.0/0` inbound rules.

2. **Outbound HTTPS only for exporter traffic.** The collector needs outbound 443 to reach Grafana Cloud (or Honeycomb). The ECS task security group outbound rule: port 443 to `0.0.0.0/0` is acceptable. No other outbound ports needed.

3. **Backend task VPC endpoint for OTLP.** The backend ECS task must be able to reach the collector on port 4317. This is satisfied by placing both tasks in the same VPC private subnet and allowing the backend SG to talk to the collector SG on 4317/4318.

4. **No Secrets in config files.** Grafana Cloud credentials (`GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, `GRAFANA_API_TOKEN`) are referenced in `task-definition.json` via AWS Secrets Manager ARNs. Never place them in `otel-collector-config.yaml`.

## Security Group rules (reference)

### sg-agrisync-otel-collector (new)

Inbound:
- Port 4317, TCP — source: `sg-agrisync-backend` (gRPC)
- Port 4318, TCP — source: `sg-agrisync-backend` (HTTP)
- Port 13133, TCP — source: `sg-agrisync-internal-alb` (health check) [optional if no internal ALB]

Outbound:
- Port 443, TCP — destination: `0.0.0.0/0` (Grafana Cloud / Honeycomb egress)

### sg-agrisync-backend (modification required)

Add outbound rule:
- Port 4317, TCP — destination: `sg-agrisync-otel-collector`

## IAM roles

### agrisync-otel-collector-execution (ECS execution role)
Must have:
- `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:agrisync/prod/grafana-*`
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` (if using ECR image)
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` for `/ecs/agrisync-otel-collector`

### agrisync-otel-collector-task (ECS task role)
Minimum permissions for MVP: none beyond default. The collector does not access AWS services directly; all backend/exporter credentials are environment-injected. If future exporters use S3 or Kinesis, add those permissions here.

## Secrets Manager layout

```
agrisync/prod/grafana-otlp-endpoint   → "https://<stack-id>.grafana.net/otlp"
agrisync/prod/grafana-instance-id     → "<numeric-instance-id>"
agrisync/prod/grafana-api-token       → "<base64-encoded-token>"
```

Create with:
```bash
aws secretsmanager create-secret \
  --name agrisync/prod/grafana-otlp-endpoint \
  --secret-string "https://<stack-id>.grafana.net/otlp" \
  --region ap-south-1
```

## Backend environment variable (cutover)

After the collector task is running and healthy, set in the backend ECS task definition:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector-task-private-ip>:4317
```

Or (preferred): use a Service Discovery DNS name so the endpoint survives task restarts:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.agrisync.internal:4317
```

Register the collector service in AWS Cloud Map under namespace `agrisync.internal`, service name `otel-collector`.

## What this does NOT do

- Does not expose a scrape endpoint for Prometheus pull (the backend already has `/metrics` for that).
- Does not store traces locally — the collector is stateless; all storage is in the chosen backend (Grafana Cloud / Honeycomb).
- Does not encrypt inter-service traffic (OTLP gRPC is plaintext within the VPC). Add TLS if compliance requires it; for ap-south-1 MVP, VPC isolation is sufficient.
