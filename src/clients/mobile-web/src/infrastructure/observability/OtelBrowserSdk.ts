/**
 * OtelBrowserSdk.ts
 *
 * Browser-side OpenTelemetry SDK initialisation.
 *
 * Call `startBrowserTracing()` once — before React renders — when
 * VITE_OTEL_ENABLED === '1'. The function is intentionally idempotent:
 * a second call is a no-op (guarded by `_started`).
 *
 * SDK version notes (sdk-trace-web v2 / sdk-trace-base v2):
 *   - SpanProcessors are passed as `spanProcessors` in the constructor config,
 *     NOT via `provider.addSpanProcessor()` (method removed in v2).
 *   - `ZoneContextManager` and `contextManager` are passed to `provider.register()`.
 *
 * Instrumentation:
 *   - FetchInstrumentation: propagates W3C `traceparent` on all fetch calls.
 *   - XMLHttpRequestInstrumentation: propagates W3C `traceparent` on all XHR
 *     calls (covers the axios HTTP adapter used by AgriSyncClient).
 *
 * Headers are injected automatically by the OTel SDK into any request whose
 * URL matches `VITE_API_BASE_URL` (default: http://localhost:5000).
 * No changes to AgriSyncClient are required.
 *
 * Production notes:
 *   - Leave VITE_OTEL_ENABLED unset (or set to '0') in all production builds
 *     until a production OTLP collector is provisioned.
 *   - The OTLP exporter default endpoint is http://localhost:4318/v1/traces —
 *     the same collector that the backend dev stack points at.
 */

import {
  BatchSpanProcessor,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// Guard: ensure we only initialise once even if the module is evaluated
// multiple times (e.g. HMR during development).
let _started = false;

export function startBrowserTracing(): void {
  if (_started) return;
  _started = true;

  // -------------------------------------------------------------------------
  // Resource — identifies this service in traces.
  // -------------------------------------------------------------------------
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'agrisync-mobile-web',
    // VITE_APP_VERSION is set by the CI build pipeline; falls back to '0.0.0'
    // in local dev where it may be undefined.
    [ATTR_SERVICE_VERSION]:
      (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0',
  });

  // -------------------------------------------------------------------------
  // Provider — with OTLP batch exporter pointed at local collector.
  // In sdk-trace-base v2, spanProcessors are passed in the constructor config;
  // `provider.addSpanProcessor()` no longer exists.
  // -------------------------------------------------------------------------
  const exporterUrl: string =
    (import.meta.env.VITE_OTEL_ENDPOINT as string | undefined) ??
    'http://localhost:4318/v1/traces';

  const exporter = new OTLPTraceExporter({ url: exporterUrl });
  const processor = new BatchSpanProcessor(exporter);

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [processor],
  });

  // Use ZoneContextManager for correct async-context propagation in the
  // browser. Zone.js is bundled by @opentelemetry/context-zone — no separate
  // zone.js import is needed at the application level.
  provider.register({
    contextManager: new ZoneContextManager(),
  });

  // -------------------------------------------------------------------------
  // Instrumentation — auto-inject W3C traceparent header on outgoing requests
  // that match the API base URL.
  // -------------------------------------------------------------------------
  const propagateUrls: RegExp[] = [
    new RegExp(
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
        'http://localhost:5000',
    ),
  ];

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateUrls,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: propagateUrls,
      }),
    ],
    tracerProvider: provider,
  });
}
