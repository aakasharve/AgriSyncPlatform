# Device-GPS Weather + Boundary Caution — Implementation Plan

> **For agentic workers:** implement task-by-task with TDD. Checkbox steps.

**Goal:** When a farm has no drawn boundary/centre, show live weather from the **device's GPS** with a **red caution** ("boundary not set") that taps through to the boundary drawer — instead of hiding weather. When a boundary exists, weather stays farm-anchored (no caution).

**Architecture:** The weather backend is hard-anchored to the farm's stored centre (`/farms/{id}/weather/*` ignores sent coords). Add a small **coordinate-based** endpoint (`/shramsafal/weather/current|forecast?lat&lon`) that calls `IWeatherProvider` directly (no farm read). Frontend adds a **consent-gated** device-GPS fallback in `useWeatherMonitor`, a `boundaryUnset` flag, the red caution on `WeatherWidget`, and a sessionStorage handoff that opens the boundary drawer in Profile.

**Tech Stack:** .NET 10 minimal API (backend); React 19 + Vite + Vitest (frontend).

## Change Surface (DoD)
- **DB:** None. No migration.
- **Backend:** Yes — new coord weather endpoint (handler + 2 command records + 2 routes + 1 DI line). Reuses existing `IWeatherProvider`, DTOs, error records, `ToErrorResult`. No port/DTO change.
- **Frontend:** Yes — `BackendWeatherClient` coord methods, `WeatherPort` widened, `useWeatherMonitor` device-GPS fallback + `boundaryUnset`, `WeatherWidget` caution, `mainView` wiring, `ProfilePage` flag-consume.
- **Cross-cutting:** DPDP location consent (respect `gps_consent` via `useLocationConsent`/`useLocationCapture` — NOT raw geolocation); i18n caution copy (feature-local strings + explicit font-family); sessionStorage nav handoff.

## Global Constraints
- Repo is truth; KISS/DRY/YAGNI. No secrets in git. `--max-warnings 0` on staged mobile-web TS. C# must pass `dotnet format` + arch tests.
- **Consent (compliant default):** device-GPS weather only when `gps_consent === 'granted'`. If not granted → keep the existing "add your farm location" no-location card (which routes to boundary drawing). Do NOT copy `GooglePlotMap.locateUser()`'s raw-geolocation bypass.
- Weather anchored to farm centre when available; device GPS is the fallback ONLY when no centre.
- Build-only on branch `feat/weather-graceful-states` (continues the weather work). No merge/deploy without founder go.

## Design decision flagged for founder
Device weather shows for users who've **allowed location** (`gps_consent` granted). Users who haven't see the "set your farm location" card (→ draw boundary → farm weather). A one-tap "use my location for weather" (that requests consent inline) can be added if wanted — noted as a follow-up, not in this plan.

---

### Task 1 (backend): coordinate weather handler + command records
**Files:**
- Create: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Farms/GetFarmWeather/GetCoordinateWeatherHandler.cs`
- Modify: `src/apps/ShramSafal/ShramSafal.Application/UseCases/Farms/GetFarmWeather/GetFarmWeatherCommand.cs` (add 2 records)
- Test: `src/tests/AgriSync.ShramSafal.Domain.Tests/` (or the existing ShramSafal handler test project) — `GetCoordinateWeatherHandlerTests.cs`

**Interfaces produced:** `GetCoordinateWeatherHandler(IWeatherProvider)` with `HandleAsync(GetCoordinateWeatherCommand)`→`Result<WeatherSnapshotDto>` and `HandleAsync(GetCoordinateForecastCommand)`→`Result<IReadOnlyList<DailyForecastDto>>`.

- [ ] Add records to `GetFarmWeatherCommand.cs`:
```csharp
public sealed record GetCoordinateWeatherCommand(double Latitude, double Longitude);
public sealed record GetCoordinateForecastCommand(double Latitude, double Longitude, int Days);
```
- [ ] Write the failing test (uses a fake IWeatherProvider): out-of-range lat/lon → `InvalidCommand`; `IsConfigured==false` → `WeatherProviderNotConfigured`; valid → `Result.Success` with the provider's snapshot; forecast clamps days to 1..7.
- [ ] Create `GetCoordinateWeatherHandler`:
```csharp
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.GetFarmWeather;

public sealed class GetCoordinateWeatherHandler(IWeatherProvider weatherProvider)
{
    public async Task<Result<WeatherSnapshotDto>> HandleAsync(GetCoordinateWeatherCommand command, CancellationToken ct = default)
    {
        if (!IsValid(command.Latitude, command.Longitude))
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.InvalidCommand);
        if (!weatherProvider.IsConfigured)
            return Result.Failure<WeatherSnapshotDto>(ShramSafalErrors.WeatherProviderNotConfigured);
        var snapshot = await weatherProvider.GetCurrentAsync(command.Latitude, command.Longitude, ct);
        return Result.Success(snapshot);
    }

    public async Task<Result<IReadOnlyList<DailyForecastDto>>> HandleAsync(GetCoordinateForecastCommand command, CancellationToken ct = default)
    {
        if (!IsValid(command.Latitude, command.Longitude))
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.InvalidCommand);
        if (!weatherProvider.IsConfigured)
            return Result.Failure<IReadOnlyList<DailyForecastDto>>(ShramSafalErrors.WeatherProviderNotConfigured);
        var days = command.Days <= 0 ? 5 : Math.Min(command.Days, 7);
        var forecast = await weatherProvider.GetForecastAsync(command.Latitude, command.Longitude, days, ct);
        return Result.Success(forecast);
    }

    private static bool IsValid(double lat, double lon) =>
        lat is >= -90 and <= 90 && lon is >= -180 and <= 180;
}
```
- [ ] Run test → pass. `dotnet format` clean. Commit.

### Task 2 (backend): routes + DI
**Files:**
- Modify: `src/apps/ShramSafal/ShramSafal.Api/Endpoints/FarmEndpoints.cs` (2 MapGet inside `MapFarmEndpoints`)
- Modify: `src/apps/ShramSafal/ShramSafal.Api/DependencyInjection.cs` (1 line, next to `AddScoped<GetFarmWeatherHandler>()`)

- [ ] In `MapFarmEndpoints`, add (no `ICallerFarmTenantScope`, no farm read):
```csharp
group.MapGet("/weather/current", async (
    double lat, double lon, ClaimsPrincipal user,
    GetCoordinateWeatherHandler handler, CancellationToken ct) =>
{
    if (!EndpointActorContext.TryGetUserId(user, out _)) return Results.Unauthorized();
    var result = await handler.HandleAsync(new GetCoordinateWeatherCommand(lat, lon), ct);
    return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
}).WithName("GetCoordinateWeatherCurrent");

group.MapGet("/weather/forecast", async (
    double lat, double lon, int? days, ClaimsPrincipal user,
    GetCoordinateWeatherHandler handler, CancellationToken ct) =>
{
    if (!EndpointActorContext.TryGetUserId(user, out _)) return Results.Unauthorized();
    var result = await handler.HandleAsync(new GetCoordinateForecastCommand(lat, lon, days ?? 5), ct);
    return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
}).WithName("GetCoordinateWeatherForecast");
```
- [ ] DI: `services.AddScoped<GetCoordinateWeatherHandler>();` (namespace `ShramSafal.Application.UseCases.Farms.GetFarmWeather` already imported).
- [ ] `dotnet build` src/AgriSync.sln → success. Run `dotnet test` ShramSafal handler tests + `AgriSync.ArchitectureTests`. Commit.

### Task 3 (frontend): coord client methods + widen WeatherPort
**Files:**
- Modify: `src/clients/mobile-web/src/application/ports/WeatherPort.ts` (2 optional methods)
- Modify: `src/clients/mobile-web/src/infrastructure/weather/BackendWeatherClient.ts` (2 methods)
- Test: `src/clients/mobile-web/src/infrastructure/weather/__tests__/BackendWeatherClient.coords.test.ts`

- [ ] `WeatherPort`: add optional `getCurrentWeatherByCoords?(lat:number,lon:number):Promise<WeatherStamp>;` and `getForecastByCoords?(lat:number,lon:number,days:number):Promise<DailyForecast[]>;`
- [ ] Failing test: mock `fetch` → assert `getCurrentWeatherByCoords(20.1,73.7)` GETs `.../shramsafal/weather/current?lat=20.1&lon=73.7` and returns a WeatherStamp with `plotId:'device'`; on 503 throws `WeatherFetchError(503)`.
- [ ] Implement both methods on `BackendWeatherClient` (mirror `getCurrentWeather`/`getForecast`, reuse `resolveBaseUrl`/`authHeaders`/`throwFromResponse`/coercers; cache key `coord:${lat.toFixed(4)},${lon.toFixed(4)}` (+`:${days}` for forecast); `plotId:'device'`).
- [ ] Test → pass. eslint `--max-warnings 0` on changed files. Commit.

### Task 4 (frontend): consent-gated device-GPS fallback in useWeatherMonitor
**Files:**
- Modify: `src/clients/mobile-web/src/features/weather/useWeatherMonitor.ts`
- Modify: `src/clients/mobile-web/src/core/navigation/routeContext.ts` (WeatherState: add `boundaryUnset`, `weatherSource`)
- Test: extend `src/clients/mobile-web/src/features/weather/__tests__/useWeatherMonitor.status.test.ts`

- [ ] Accept `consentState` + `captureLocation` via new hook props (from `useLocationConsent`/`useLocationCapture`, wired in `compositionRoot`) OR call the hooks inside `useWeatherMonitor`. (Prefer passing in, to keep the hook testable — pass `getDeviceLocation?: () => Promise<{lat:number;lon:number}|null>` + `locationConsentGranted:boolean`.)
- [ ] Add `const [boundaryUnset, setBoundaryUnset] = useState(false)` and `const [weatherSource, setWeatherSource] = useState<'farm-centre'|'profile'|'device'|null>(null)`.
- [ ] In the effect: when farm centre resolves → `weatherSource='farm-centre'`, `boundaryUnset=false`. When it does NOT resolve:
  - set `boundaryUnset=true`;
  - if `farmerProfile.location` present → fetch as today (source `'profile'`);
  - else if `locationConsentGranted` and `getDeviceLocation()` returns coords → `provider.getCurrentWeatherByCoords`/`getForecastByCoords`, `weatherSource='device'`, status `'ready'`;
  - else → `'no-location'` (unchanged).
- [ ] Return `boundaryUnset`, `weatherSource`; add both to `WeatherState` in routeContext.
- [ ] Tests: device-GPS branch → `ready` + `boundaryUnset===true` + data defined; no consent + no coords → `no-location`. Pass. Commit.

### Task 5 (frontend): red caution on WeatherWidget + boundary nav
**Files:**
- Modify: `src/clients/mobile-web/src/features/weather/components/WeatherWidget.tsx` (props `boundaryUnset?`, `onOpenBoundary?`; caution bar)
- Modify: `src/clients/mobile-web/src/core/navigation/AppRouter.tsx` + `mainView.tsx` (thread `boundaryUnset`, `onOpenBoundary`)
- Test: extend `WeatherWidget.states.test.tsx`

- [ ] WeatherWidget: when `boundaryUnset && data` (status ready), render a red caution bar INSIDE the blue card, below the condition row (per approved mock), as a `role="button"` span with `e.stopPropagation()` calling `onOpenBoundary`. Feature-local `STRINGS{en,mr}` + explicit `fontFamily` by language. Copy: en "Boundary not set — set it for accurate weather" / mr "सीमा आखलेली नाही — अचूक हवामानासाठी आखा", CTA "Set ›".
- [ ] Thread `boundaryUnset` (from ctx) + `onOpenBoundary={() => { window.sessionStorage.setItem('open_farm_boundary','1'); setCurrentRoute('profile'); }}` in mainView; add fields to AppRouter ctx.
- [ ] Test: `<WeatherWidget status="ready" data={...} boundaryUnset onOpenBoundary=fn/>` shows caution + fires `onOpenBoundary` on click (and does NOT open the modal). Pass. eslint clean. Commit.

### Task 6 (frontend): ProfilePage consumes 'open_farm_boundary' → opens drawer
**Files:**
- Modify: `src/clients/mobile-web/src/features/profile/ProfilePage.tsx` (two-effect consume, myFarm race)

- [ ] Effect 1 (mount): if `sessionStorage.getItem('open_farm_boundary')` → `setActiveTab('identity')`, `removeItem`, set a `pendingOpenBoundary` ref true.
- [ ] Effect 2 (keyed on `farmAdmin.myFarm`): if `pendingOpenBoundary.current && farmAdmin.myFarm` → `farmAdmin.setShowFarmBoundary(true)`, clear the ref.
- [ ] Manual/typecheck verification (hard to unit-test the modal); ensure no eslint/type errors. Commit.

### Task 7: full verification + adversarial review
- [ ] Backend: `dotnet build` + `dotnet test` (ShramSafal + ArchitectureTests) green.
- [ ] Frontend: `npm run typecheck`, `npm run lint` (no new), `npm test`, `npm run check:file-sizes` green.
- [ ] Adversarial code-review of the diff; fix confirmed findings.

## Founder Acceptance Gate (before deploy)
- [ ] No boundary + location allowed → blue card shows device weather + red "boundary not set" caution; tapping it opens the Draw-Farm-Boundary screen.
- [ ] Boundary drawn → farm-anchored weather, no caution.
- [ ] Marathi copy correct.

## Deployment (founder-gated; NOTE: now includes BACKEND)
- Backend: new endpoint → requires a **backend deploy** to the EC2 (agrisync-deploy lane / SSM). No DB migration.
- Frontend: web bundle (S3+CloudFront) + APK (workflow) with the maps key.
- One coordinated release. Add DEPLOYMENT_TRACKER rows.
