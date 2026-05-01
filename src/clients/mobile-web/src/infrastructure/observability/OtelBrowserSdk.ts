/**
 * Browser OpenTelemetry SDK bootstrap.
 *
 * T-IGH-05-FRONTEND-OTEL-SDK
 *
 * This module wires the @opentelemetry/sdk-trace-web SDK so spans created in
 * mobile-web propagate the W3C `traceparent` header to the AgriSync backend,
 * giving us full browser → API → DB traces.
 *
 * Design constraints (see task spec):
 * - Strictly env-gated via `VITE_OTEL_ENABLED === '1'`. The caller is expected
 *   to wrap the `startBrowserTracing()` invocation in a top-level `if`-guard so
 *   Vite dead-code-elimination drops this module from the production bundle
 *   when the flag is absent.
 * - Default OTLP endpoint: `http://localhost:4318/v1/traces` (matches the dev
 *   collector the backend points at). Overridable via `VITE_OTEL_ENDPOINT`.
 * - Service name resource attribute: `agrisync-mobile-web`.
 * - Auto-instrumentation is intentionally narrow: fetch + XHR only. No
 *   DocumentLoad, no UserInteraction, no Navigation.
 * - `traceparent` is propagated ONLY to the AgriSync backend host, never to
 *   third-party origins. The host is derived from `VITE_AGRISYNC_API_URL`
 *   (the value the AgriSyncClient axios instance uses) with `VITE_API_BASE_URL`
 *   honored as a forward-compat alias. If neither is set or the value is a
 *   relative path, we fall back to a same-origin regex.
 */

import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const SERVICE_NAME = 'agrisync-mobile-web';
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

let started = false;

/**
 * Start the browser OpenTelemetry SDK.
 *
 * Idempotent: subsequent calls are no-ops. Returns `true` when the SDK was
 * actually initialized on this call, `false` otherwise.
 *
 * IMPORTANT: callers MUST gate this on `import.meta.env.VITE_OTEL_ENABLED === '1'`
 * so production builds dead-code-eliminate the import.
 */
export function startBrowserTracing(): boolean {
    if (started) {
        return false;
    }
    started = true;

    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    const endpoint = env.VITE_OTEL_ENDPOINT?.trim() || DEFAULT_OTLP_ENDPOINT;
    const propagateUrlPattern = buildPropagateCorsUrlPattern(
        env.VITE_AGRISYNC_API_URL ?? env.VITE_API_BASE_URL,
    );

    const provider = new WebTracerProvider({
        resource: resourceFromAttributes({
            'service.name': SERVICE_NAME,
        }),
        spanProcessors: [
            new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
        ],
    });

    // ZoneContextManager keeps async context (fetch, XHR, promise chains)
    // attached to the originating span. The default `register()` propagator is
    // W3C Trace Context (traceparent + tracestate), which matches the backend
    // OTel SDK contract — no override needed.
    provider.register({
        contextManager: new ZoneContextManager(),
    });

    registerInstrumentations({
        instrumentations: [
            new FetchInstrumentation({
                propagateTraceHeaderCorsUrls: propagateUrlPattern,
            }),
            new XMLHttpRequestInstrumentation({
                propagateTraceHeaderCorsUrls: propagateUrlPattern,
            }),
        ],
    });

    return true;
}

/**
 * Build a regex that matches ONLY the AgriSync backend host so we never leak
 * `traceparent` to third-party origins.
 *
 * - Absolute URL → match `^<scheme>://<host>(:<port>)?` (path/query ignored).
 * - Relative path or unset → match same-origin requests via the current
 *   `window.location.origin`.
 */
function buildPropagateCorsUrlPattern(rawApiUrl: string | undefined): RegExp {
    const trimmed = rawApiUrl?.trim();

    if (trimmed) {
        try {
            const parsed = new URL(trimmed);
            // Escape the origin and anchor at the start so we only match
            // requests to this exact scheme://host[:port].
            return new RegExp(`^${escapeRegExp(parsed.origin)}(?:/|$)`);
        } catch {
            // Fall through to same-origin handling below for relative paths
            // and malformed values.
        }
    }

    if (typeof window !== 'undefined' && window.location?.origin) {
        return new RegExp(`^${escapeRegExp(window.location.origin)}(?:/|$)`);
    }

    // SSR / non-browser fallback: do not propagate to anything.
    return /^$/;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
