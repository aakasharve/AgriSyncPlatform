# Weather Widget Graceful States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weather card's silent infinite gray skeleton with cause-aware states — "add farm location", "weather unavailable / retry", loading, and the working card — so a data failure is visible and actionable instead of looking "missing".

**Architecture:** The backend already returns distinct signals — `400 FarmCentreMissing` (no farm centre) vs `503 WeatherProviderNotConfigured` (no Tomorrow.io key). The frontend currently discards these (throws a generic error) and swallows it (`console.error` only), leaving `weatherData` undefined → permanent skeleton. We (1) surface the backend status/code as a typed error, (2) give `useWeatherMonitor` a real status model (`loading | ready | no-location | error`) plus a `refetchWeather` action, (3) render matching states in the widget, and (4) thread status + retry + "add location" navigation through the existing route context. Frontend-only; no backend code change.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest + @testing-library/react (jsdom per-file), Tailwind, lucide-react, i18n via `useLanguage()` / `t('group.key')`.

## Global Constraints

- **Repo is truth** — verify every path/symbol in the live repo before relying on it.
- **KISS / DRY / YAGNI** — smallest change that solves it; no new libraries; no client-side weather fallback provider (`TomorrowIoWeatherService` stays unwired by design — weather is backend-anchored).
- **Marathi-first copy** — every user-facing string added to BOTH `en` and `mr` in `src/i18n/translations.ts`; the app renders Devanagari via the global font stack (mobile-web HTML text needs no explicit `font-family`, matching existing `DwcReminderChip`/`BottomNavigation`).
- **Weather anchored to farm centre** — do NOT fall back to device GPS; "no coordinates" is a real, user-actionable state (prompt to set farm location), not an error to auto-work-around.
- **File focus** — keep `WeatherWidget.tsx` focused; the fallback (non-data) states live in a separate small component.
- **Tests are `node` env by default** — React-rendering specs opt in with a `// @vitest-environment jsdom` first line and `import '@testing-library/jest-dom/vitest'`.
- **Verify commands** (run from `src/clients/mobile-web/`): `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:file-sizes`.
- **Build-only** — implement on branch `feat/weather-graceful-states`; NO merge/deploy without founder go.

---

## Change Surface (DoD)

- **DB:** None.
- **Backend:** None (Part A prod config only — see Operational Prerequisites).
- **Frontend:** Yes — `BackendWeatherClient`, `useWeatherMonitor`, `WeatherWidget` + new `WeatherFallbackCard`, `routeContext`, `mainView`, i18n.
- **Cross-cutting:** i18n strings (en + mr); route navigation to `farm-boundary`.

## Operational Prerequisites (Part A — founder/ops, NOT code; required for weather to actually populate)

- **A.1 — Tomorrow.io key:** set env var `TOMORROW_IO_API_KEY=<key>` on the prod API host (EC2 `i-024b3537191712c76`) and restart the service. Config binding: `src/apps/ShramSafal/ShramSafal.Infrastructure/DependencyInjection.cs:372-379` (PostConfigure reads `TOMORROW_IO_API_KEY`; also honors config `Weather:TomorrowIo:ApiKey`). Unset ⇒ `GetFarmWeatherHandler` returns `WeatherProviderNotConfigured` ⇒ HTTP 503.
- **A.2 — Farm centre:** the test farm must have `CanonicalCentreLat/Lng` set (draw boundary in-app: route `farm-boundary` ⇒ `PUT /shramsafal/farms/{id}/boundary`). Unset ⇒ `GetFarmWeatherHandler` returns `FarmCentreMissing` ⇒ HTTP 400 (`GetFarmWeatherHandler.cs:35-38`).
- **Verify (once A.1+A.2 done):** authenticated `GET /shramsafal/farms/{farmId}/weather/current` returns HTTP 200 with a snapshot. (Blocked today by a separate prod bug: `POST /user/auth/login` 500s for test user `8888888888` — tracked separately.)

---

## File Structure

- `src/clients/mobile-web/src/infrastructure/weather/WeatherFetchError.ts` — **new.** Typed error carrying `status` + optional backend `code`.
- `src/clients/mobile-web/src/infrastructure/weather/BackendWeatherClient.ts` — **modify.** Throw `WeatherFetchError` (with parsed status/code) instead of a generic `Error`.
- `src/clients/mobile-web/src/features/weather/useWeatherMonitor.ts` — **modify.** Add `WeatherStatus`, expose `weatherStatus` + `refetchWeather`; stop silently swallowing.
- `src/clients/mobile-web/src/features/weather/components/WeatherFallbackCard.tsx` — **new.** Renders the `no-location` and `error` states.
- `src/clients/mobile-web/src/features/weather/components/WeatherWidget.tsx` — **modify.** Branch on `status`; delegate non-data states to `WeatherFallbackCard`.
- `src/clients/mobile-web/src/i18n/translations.ts` — **modify.** New `weatherWidget` group (interface + en + mr).
- `src/clients/mobile-web/src/core/navigation/routeContext.ts` — **modify.** Add `weatherStatus` + `refetchWeather` to `AppRouterContext`.
- `src/clients/mobile-web/src/core/navigation/mainView.tsx` — **modify.** Pass `status`, `onRetry`, `onAddLocation` to `WeatherWidget`.
- Tests: `WeatherFallbackCard.test.tsx`, `WeatherWidget.states.test.tsx` (co-located under `features/weather/components/__tests__/`), `useWeatherMonitor.status.test.ts` (under `features/weather/__tests__/`).

---

### Task 1: Typed weather fetch error + BackendWeatherClient surfaces status/code

**Files:**
- Create: `src/infrastructure/weather/WeatherFetchError.ts`
- Modify: `src/infrastructure/weather/BackendWeatherClient.ts:88-94, 126-133`
- Test: `src/infrastructure/weather/__tests__/BackendWeatherClient.error.test.ts`

**Interfaces:**
- Produces: `class WeatherFetchError extends Error { readonly status: number; readonly code?: string }` and `isFarmCentreMissing(e: unknown): boolean` / `isProviderUnavailable(e: unknown): boolean` helpers.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackendWeatherClient } from '../BackendWeatherClient';
import { WeatherFetchError, isFarmCentreMissing } from '../WeatherFetchError';

const geo = { lat: 20, lon: 73, source: 'approx' as const };

afterEach(() => vi.restoreAllMocks());

describe('BackendWeatherClient error surfacing', () => {
  it('throws WeatherFetchError with status + backend code on 400 FarmCentreMissing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'ShramSafal.FarmCentreMissing', message: 'no centre' }),
      { status: 400 },
    )));
    const client = new BackendWeatherClient(() => 'farm-1');
    const err = await client.getCurrentWeather(geo).catch(e => e);
    expect(err).toBeInstanceOf(WeatherFetchError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('ShramSafal.FarmCentreMissing');
    expect(isFarmCentreMissing(err)).toBe(true);
  });

  it('throws WeatherFetchError with status 503 when provider unconfigured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'ShramSafal.WeatherProviderNotConfigured', message: 'no key' }),
      { status: 503 },
    )));
    const client = new BackendWeatherClient(() => 'farm-1');
    const err = await client.getForecast(geo).catch(e => e);
    expect(err).toBeInstanceOf(WeatherFetchError);
    expect(err.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/infrastructure/weather/__tests__/BackendWeatherClient.error.test.ts`
Expected: FAIL — `WeatherFetchError` module not found.

- [ ] **Step 3: Create `WeatherFetchError.ts`**

```ts
/**
 * Typed transport error for weather fetches. Carries the HTTP status and the
 * backend's error code (e.g. "ShramSafal.FarmCentreMissing",
 * "ShramSafal.WeatherProviderNotConfigured") so callers can distinguish a
 * missing-farm-centre (user-actionable) from a service outage (retryable).
 */
export class WeatherFetchError extends Error {
    constructor(
        public readonly status: number,
        public readonly code?: string,
        message?: string,
    ) {
        super(message ?? `Weather request failed with HTTP ${status}.`);
        this.name = 'WeatherFetchError';
    }
}

export const isFarmCentreMissing = (e: unknown): boolean =>
    e instanceof WeatherFetchError &&
    (e.status === 400 || (e.code?.endsWith('FarmCentreMissing') ?? false));

export const isProviderUnavailable = (e: unknown): boolean =>
    e instanceof WeatherFetchError && e.status === 503;
```

- [ ] **Step 4: Update `BackendWeatherClient` to throw it**

In `BackendWeatherClient.ts`, add at top: `import { WeatherFetchError } from './WeatherFetchError';`

Replace the two `if (!response.ok) { throw new Error(...); }` blocks (currently lines 92-94 and 131-133) with a shared parse+throw. Add this private helper to the class and call it from both methods:

```ts
    private async throwFromResponse(response: Response): Promise<never> {
        let code: string | undefined;
        let message: string | undefined;
        try {
            const body = await response.json() as { error?: string; message?: string };
            code = body?.error;
            message = body?.message;
        } catch {
            /* non-JSON body — status alone is enough */
        }
        throw new WeatherFetchError(response.status, code, message);
    }
```

Then in `getCurrentWeather`: `if (!response.ok) { await this.throwFromResponse(response); }`
And in `getForecast`: `if (!response.ok) { await this.throwFromResponse(response); }`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/infrastructure/weather/__tests__/BackendWeatherClient.error.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/clients/mobile-web/src/infrastructure/weather/WeatherFetchError.ts \
        src/clients/mobile-web/src/infrastructure/weather/BackendWeatherClient.ts \
        src/clients/mobile-web/src/infrastructure/weather/__tests__/BackendWeatherClient.error.test.ts
git commit -m "feat(weather): surface backend status/code as WeatherFetchError"
```

---

### Task 2: useWeatherMonitor status model + refetch

**Files:**
- Modify: `src/features/weather/useWeatherMonitor.ts`
- Test: `src/features/weather/__tests__/useWeatherMonitor.status.test.ts`

**Interfaces:**
- Consumes: `WeatherFetchError`, `isFarmCentreMissing` (Task 1).
- Produces: `export type WeatherStatus = 'loading' | 'ready' | 'no-location' | 'error';` and the hook return additionally exposes `weatherStatus: WeatherStatus` and `refetchWeather: () => void`.

**Status rules:**
- initial: `'loading'`.
- No lat/lon resolvable (guard fails) ⇒ `'no-location'` (and no fetch).
- Before the fetch, when coords resolved ⇒ `'loading'`.
- Fetch success ⇒ `'ready'`.
- Fetch throws and `isFarmCentreMissing(err)` ⇒ `'no-location'`; else ⇒ `'error'` (still `console.error` for diagnostics).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWeatherMonitor } from '../useWeatherMonitor';
import { WeatherFetchError } from '../../../infrastructure/weather/WeatherFetchError';

const baseProfile = (location?: { lat: number; lon: number }) => ({
  name: 'T', operators: [], activeOperatorId: null, location,
}) as any;

const okProvider = {
  getForecast: vi.fn(async () => []),
  getCurrentWeather: vi.fn(async () => ({
    id: 'w', plotId: 'farm', timestampLocal: '', timestampProvider: '',
    provider: 'tomorrow.io', tempC: 25, humidity: 50, windKph: 5, precipMm: 0,
    cloudCoverPct: 10, conditionText: 'Sunny', iconCode: '1000', rainProbNext6h: 0,
  })),
  detectWeatherChanges: vi.fn(() => null),
} as any;

const props = (over: Partial<any>) => ({
  farmerProfile: baseProfile(), crops: [], setCrops: vi.fn(),
  logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
  hasActiveLogContext: false, activeCropId: null, activePlotId: null, activeFarmId: null,
  setError: vi.fn(), provider: okProvider, farmGeography: undefined, ...over,
}) as any;

describe('useWeatherMonitor status', () => {
  it('is "no-location" when no farm centre and no profile location', async () => {
    const { result } = renderHook(() => useWeatherMonitor(props({})));
    await waitFor(() => expect(result.current.weatherStatus).toBe('no-location'));
  });

  it('is "ready" when coordinates resolve and fetch succeeds', async () => {
    const { result } = renderHook(() => useWeatherMonitor(props({
      farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }),
    })));
    await waitFor(() => expect(result.current.weatherStatus).toBe('ready'));
    expect(result.current.weatherData).toBeDefined();
  });

  it('is "error" when the fetch fails with a non-centre error', async () => {
    const failing = { ...okProvider, getForecast: vi.fn(async () => { throw new WeatherFetchError(503, 'ShramSafal.WeatherProviderNotConfigured'); }) };
    const { result } = renderHook(() => useWeatherMonitor(props({
      farmerProfile: baseProfile({ lat: 20.1, lon: 73.7 }), provider: failing,
    })));
    await waitFor(() => expect(result.current.weatherStatus).toBe('error'));
  });

  it('exposes a refetchWeather function', () => {
    const { result } = renderHook(() => useWeatherMonitor(props({})));
    expect(typeof result.current.refetchWeather).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/weather/__tests__/useWeatherMonitor.status.test.ts`
Expected: FAIL — `weatherStatus`/`refetchWeather` undefined.

- [ ] **Step 3: Implement the status model**

In `useWeatherMonitor.ts`:
- Add import: `import { isFarmCentreMissing } from '../../infrastructure/weather/WeatherFetchError';`
- Add exported type above the hook: `export type WeatherStatus = 'loading' | 'ready' | 'no-location' | 'error';`
- Add state near the other `useState`s: `const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('loading');` and a refetch nonce: `const [refetchNonce, setRefetchNonce] = useState(0);`
- Inside `fetchW`, after resolving `targetLat`/`targetLon`: replace the bare guard so the else-branch sets `no-location`:

```ts
            if (typeof targetLat !== 'number' || typeof targetLon !== 'number') {
                setWeatherStatus('no-location');
                return;
            }
            setWeatherStatus('loading');
            try {
                // ...existing PlotGeo + Promise.all + setWeatherData(displayData) + change-detection...
                setWeatherStatus('ready');
            } catch (err) {
                console.error('Weather init failed', err);
                setWeatherStatus(isFarmCentreMissing(err) ? 'no-location' : 'error');
            }
```

(Keep the existing body inside the `try`; only the guard, the `setWeatherStatus` calls, and the `catch` classification are new. `setWeatherData(displayData)` stays before `setWeatherStatus('ready')`.)
- Add `refetchNonce` to the effect dependency array.
- Add the refetch callback: `const refetchWeather = React.useCallback(() => setRefetchNonce(n => n + 1), []);` (import `useCallback` or use `React.useCallback`).
- Add `weatherStatus` and `refetchWeather` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/weather/__tests__/useWeatherMonitor.status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/weather/useWeatherMonitor.ts \
        src/clients/mobile-web/src/features/weather/__tests__/useWeatherMonitor.status.test.ts
git commit -m "feat(weather): status model (loading/ready/no-location/error) + refetch"
```

---

### Task 3: i18n strings for the fallback states

**Files:**
- Modify: `src/i18n/translations.ts` (interface block; `en` object; `mr` object)

**Interfaces:**
- Produces i18n keys: `weatherWidget.addLocationTitle`, `.addLocationCta`, `.unavailableTitle`, `.unavailableBody`, `.retryCta`.

- [ ] **Step 1: Add to the TypeScript interface** (near the `workSummary` group, ~line 95, as a new sibling group)

```ts
    // Weather widget fallback states
    weatherWidget: {
        addLocationTitle: string;
        addLocationCta: string;
        unavailableTitle: string;
        unavailableBody: string;
        retryCta: string;
    };
```

- [ ] **Step 2: Add the `en` values** (inside the `en` translations object, as a sibling of its `nav`/`workSummary` groups)

```ts
        weatherWidget: {
            addLocationTitle: 'Add your farm location to see weather',
            addLocationCta: 'Set farm location',
            unavailableTitle: 'Weather unavailable right now',
            unavailableBody: 'We could not load the latest weather.',
            retryCta: 'Retry',
        },
```

- [ ] **Step 3: Add the `mr` values** (inside the `mr` translations object)

```ts
        weatherWidget: {
            addLocationTitle: 'हवामान पाहण्यासाठी तुमच्या शेताचे स्थान जोडा',
            addLocationCta: 'शेताचे स्थान निवडा',
            unavailableTitle: 'हवामान सध्या उपलब्ध नाही',
            unavailableBody: 'ताजे हवामान लोड करता आले नाही.',
            retryCta: 'पुन्हा प्रयत्न करा',
        },
```

- [ ] **Step 4: Verify typecheck passes** (the interface + both language objects must all include the group)

Run: `npm run typecheck`
Expected: PASS (no missing-property errors on `translations`).

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/i18n/translations.ts
git commit -m "feat(i18n): weatherWidget fallback strings (en + mr)"
```

---

### Task 4: WeatherFallbackCard + WeatherWidget state branching

**Files:**
- Create: `src/features/weather/components/WeatherFallbackCard.tsx`
- Modify: `src/features/weather/components/WeatherWidget.tsx:47-55`
- Test: `src/features/weather/components/__tests__/WeatherFallbackCard.test.tsx`, `src/features/weather/components/__tests__/WeatherWidget.states.test.tsx`

**Interfaces:**
- Consumes: `WeatherStatus` (Task 2).
- Produces: `WeatherFallbackCard` props `{ variant: 'no-location' | 'error'; onAction: () => void }`; `WeatherWidget` gains optional props `status?: WeatherStatus; onRetry?: () => void; onAddLocation?: () => void`.

- [ ] **Step 1: Write the failing test for WeatherFallbackCard**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherFallbackCard from '../WeatherFallbackCard';

vi.mock('../../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en', setLanguage: vi.fn(),
    t: (k: string) => ({
      'weatherWidget.addLocationTitle': 'Add your farm location to see weather',
      'weatherWidget.addLocationCta': 'Set farm location',
      'weatherWidget.unavailableTitle': 'Weather unavailable right now',
      'weatherWidget.unavailableBody': 'We could not load the latest weather.',
      'weatherWidget.retryCta': 'Retry',
    }[k] ?? k),
  }),
}));

afterEach(cleanup);

describe('WeatherFallbackCard', () => {
  it('no-location: shows title + CTA and fires onAction', async () => {
    const onAction = vi.fn();
    render(<WeatherFallbackCard variant="no-location" onAction={onAction} />);
    expect(screen.getByText('Add your farm location to see weather')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Set farm location' }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('error: shows title + Retry and fires onAction', async () => {
    const onAction = vi.fn();
    render(<WeatherFallbackCard variant="error" onAction={onAction} />);
    expect(screen.getByText('Weather unavailable right now')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run src/features/weather/components/__tests__/WeatherFallbackCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Create `WeatherFallbackCard.tsx`**

```tsx
import React from 'react';
import { MapPin, CloudOff, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';

interface WeatherFallbackCardProps {
    variant: 'no-location' | 'error';
    onAction: () => void;
}

const WeatherFallbackCard: React.FC<WeatherFallbackCardProps> = ({ variant, onAction }) => {
    const { t } = useLanguage();
    const isNoLocation = variant === 'no-location';

    const title = isNoLocation ? t('weatherWidget.addLocationTitle') : t('weatherWidget.unavailableTitle');
    const cta = isNoLocation ? t('weatherWidget.addLocationCta') : t('weatherWidget.retryCta');
    const Icon = isNoLocation ? MapPin : CloudOff;

    return (
        <div
            data-testid="weather-fallback"
            data-variant={variant}
            className="w-full rounded-3xl mb-6 p-5 bg-stone-50 border border-stone-200 flex items-center justify-between gap-3"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-stone-500">
                    <Icon size={22} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-stone-700 leading-snug">{title}</p>
                    {!isNoLocation && (
                        <p className="text-xs text-stone-400 mt-0.5">{t('weatherWidget.unavailableBody')}</p>
                    )}
                </div>
            </div>
            <button
                onClick={onAction}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white px-3.5 py-2 text-xs font-bold active:scale-95 transition"
            >
                {!isNoLocation && <RefreshCw size={14} />}
                {cta}
            </button>
        </div>
    );
};

export default WeatherFallbackCard;
```

- [ ] **Step 4: Run WeatherFallbackCard test — expect PASS**

Run: `npx vitest run src/features/weather/components/__tests__/WeatherFallbackCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing WeatherWidget state test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherWidget from '../WeatherWidget';

vi.mock('../../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en', setLanguage: vi.fn(),
    t: (k: string) => ({
      'weatherWidget.addLocationTitle': 'Add your farm location to see weather',
      'weatherWidget.addLocationCta': 'Set farm location',
      'weatherWidget.unavailableTitle': 'Weather unavailable right now',
      'weatherWidget.unavailableBody': 'We could not load the latest weather.',
      'weatherWidget.retryCta': 'Retry',
    }[k] ?? k),
  }),
}));

afterEach(cleanup);

describe('WeatherWidget states', () => {
  it('renders the add-location fallback and fires onAddLocation', () => {
    const onAddLocation = vi.fn();
    render(<WeatherWidget status="no-location" onAddLocation={onAddLocation} onRetry={vi.fn()} />);
    const node = screen.getByTestId('weather-fallback');
    expect(node).toHaveAttribute('data-variant', 'no-location');
    screen.getByRole('button', { name: 'Set farm location' }).click();
    expect(onAddLocation).toHaveBeenCalledTimes(1);
  });

  it('renders the error fallback and fires onRetry', () => {
    const onRetry = vi.fn();
    render(<WeatherWidget status="error" onRetry={onRetry} onAddLocation={vi.fn()} />);
    expect(screen.getByTestId('weather-fallback')).toHaveAttribute('data-variant', 'error');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the loading skeleton when status is loading and no data', () => {
    const { container } = render(<WeatherWidget status="loading" />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('weather-fallback')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it — expect FAIL** (WeatherWidget ignores `status`)

Run: `npx vitest run src/features/weather/components/__tests__/WeatherWidget.states.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Wire `status` into WeatherWidget**

In `WeatherWidget.tsx`:
- Add import: `import WeatherFallbackCard from './WeatherFallbackCard';` and `import type { WeatherStatus } from '../useWeatherMonitor';`
- Extend the props interface:

```tsx
interface WeatherWidgetProps {
    data?: DetailedWeather;
    isLoading?: boolean;
    status?: WeatherStatus;
    onRetry?: () => void;
    onAddLocation?: () => void;
}
```

- Change the signature to destructure the new props, and replace the early-return block (currently lines 47-55) with state branching that runs BEFORE reading `data`:

```tsx
const WeatherWidget: React.FC<WeatherWidgetProps> = ({ data, isLoading, status, onRetry, onAddLocation }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'prev' | 'next'>('next');

    if (status === 'no-location') {
        return <WeatherFallbackCard variant="no-location" onAction={() => onAddLocation?.()} />;
    }
    if (status === 'error') {
        return <WeatherFallbackCard variant="error" onAction={() => onRetry?.()} />;
    }
    if (isLoading || !data) {
        return <div className="w-full h-24 bg-stone-200 animate-pulse rounded-3xl mb-6"></div>;
    }
    // ...unchanged: const { current, locationName, history, forecast } = data; ...
```

(The rest of the component — collapsed button + expanded modal — is unchanged.)

- [ ] **Step 8: Run WeatherWidget test — expect PASS**

Run: `npx vitest run src/features/weather/components/__tests__/WeatherWidget.states.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Check file sizes (WeatherWidget stays focused; fallback is its own file)**

Run: `npm run check:file-sizes`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/clients/mobile-web/src/features/weather/components/WeatherFallbackCard.tsx \
        src/clients/mobile-web/src/features/weather/components/WeatherWidget.tsx \
        src/clients/mobile-web/src/features/weather/components/__tests__/WeatherFallbackCard.test.tsx \
        src/clients/mobile-web/src/features/weather/components/__tests__/WeatherWidget.states.test.tsx
git commit -m "feat(weather): cause-aware fallback states in WeatherWidget"
```

---

### Task 5: Thread status + retry + add-location through the route context

**Files:**
- Modify: `src/core/navigation/routeContext.ts:107-108`
- Modify: `src/core/navigation/AppRouter.tsx:72-73, 172`
- Modify: `src/core/navigation/mainView.tsx:23, 102-121, 138`

**Interfaces:**
- Consumes: `weather.weatherStatus`, `weather.refetchWeather` (Task 2, via `useAppWeatherState`); `ctx.setCurrentRoute` (existing).
- Produces: `WeatherWidget` in the log view receives `status`, `onRetry`, `onAddLocation`.

- [ ] **Step 1: Extend `AppRouterContext`** — after the `weatherData` line (routeContext.ts:108):

```ts
    weatherData: WeatherState['weatherData'];
    weatherStatus: WeatherState['weatherStatus'];
    refetchWeather: WeatherState['refetchWeather'];
```

- [ ] **Step 2: Populate them in `AppRouter.tsx`** — where it reads weather (~line 73):

```tsx
    const weatherData = weather.weatherData;
    const weatherStatus = weather.weatherStatus;
    const refetchWeather = weather.refetchWeather;
```

and add to the `ctx` object literal (near line 172, next to `weatherData,`):

```tsx
        weatherData,
        weatherStatus,
        refetchWeather,
```

- [ ] **Step 3: Consume in `mainView.tsx` `renderLogView`** — add `weatherStatus`, `refetchWeather`, `setCurrentRoute` to the destructure from `ctx` (near line 102), then update the widget (line 138):

```tsx
            <WeatherWidget
                data={weatherData}
                status={weatherStatus}
                onRetry={refetchWeather}
                onAddLocation={() => setCurrentRoute('farm-boundary')}
            />
```

(Drop the old `isLoading={!weatherData}` — `status` now drives loading; when `status` is `loading`/`ready`, the widget falls through to its existing `isLoading || !data` skeleton / data render.)

- [ ] **Step 4: Verify typecheck + full test suite**

Run: `npm run typecheck`
Expected: PASS — `ctx.weatherStatus` / `ctx.refetchWeather` resolve; `setCurrentRoute('farm-boundary')` accepts the route (it is a member of the `AppRoute` union, `farm.types.ts:411`).

Run: `npm test`
Expected: PASS — all new specs plus the existing suite green.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/core/navigation/routeContext.ts \
        src/clients/mobile-web/src/core/navigation/AppRouter.tsx \
        src/clients/mobile-web/src/core/navigation/mainView.tsx
git commit -m "feat(weather): wire status/retry/add-location into the log view"
```

---

### Task 6: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 2: Lint** — `npm run lint` → no new errors.
- [ ] **Step 3: Tests** — `npm test` → PASS (new weather specs + existing suite).
- [ ] **Step 4: File sizes** — `npm run check:file-sizes` → PASS.
- [ ] **Step 5: Manual sanity (optional, dev server)** — `npm run dev`, open the log/home screen; with no farm centre the card shows the "add location" state and the button routes to `farm-boundary`; simulate a fetch failure to see the retry state.

---

## Founder Acceptance Gate (verify before any deploy)

- [ ] On the home/Daily-Log screen, a farm **without** a drawn centre shows the **"Add your farm location…"** card with a working button (no more gray box).
- [ ] With the backend weather call failing (key unset), the card shows **"Weather unavailable right now"** + **Retry**, and Retry re-attempts.
- [ ] After Part A.1 (`TOMORROW_IO_API_KEY` set) + A.2 (farm centre drawn), the card shows the real blue weather widget.
- [ ] Marathi copy renders correctly in `mr` mode.

## Deployment (founder-gated; separate from this build)

- Frontend change ships via the mobile-web bundle deploy (S3 `shramsafal-app-prod` + CloudFront) and/or a new APK build (`.github/workflows/android-release.yml`). Add a `DEPLOYMENT_TRACKER.md` row when deployed.
- Part A is a prod config/data action, independent of this code deploy.

## Out of scope (tracked separately)

- Prod `POST /user/auth/login` HTTP 500 for test user `8888888888` — blocks authed weather verification and possibly founder testing. Separate diagnosis item.
- Client-side weather fallback provider — intentionally NOT wired (weather is farm-anchored).
