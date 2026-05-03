# Custom OTel collector image with config baked in.
# Built and pushed to ECR via the deploy steps in README.md §1 (Image build).
# Source upstream: https://github.com/open-telemetry/opentelemetry-collector-releases
FROM otel/opentelemetry-collector-contrib:0.103.0

# Bake the config into the image at the canonical OTel location.
COPY otel-collector-config.yaml /etc/otelcol-contrib/config.yaml

# The base image's CMD already reads --config=/etc/otelcol-contrib/config.yaml.
# No CMD override needed.
