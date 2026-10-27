/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The `weatherStamp` of a `create_daily_log` payload. MOVED VERBATIM out of `logSyncMutationService.ts`
 * (PLR-D10 I13) to bring that file back under the 800-line budget (`npm run check:file-sizes`) when the
 * voice auto-save added its one key there. Pure; same fields, same order, same conditions.
 *
 * B2.8 — carry the weather already captured at confirm-time to the server (persisted into
 * ssf.weather_stamps). Omit the client-only `id` (server generates).
 *
 * B1d — `plotId` is CONDITIONAL, by the same rule every other optional field on this payload follows:
 * a value we do not have is not sent, rather than sent as `undefined`. A record naming a set of plots
 * (or संपूर्ण शेत) has one observed condition and no single plot to record it against, and
 * `weather_stamps.plot_id` is `uuid NULL`, so absence is the shape the server already models.
 *
 * It is sent AS RECORDED and never repaired here. The producer (`LogCommandServiceImpl.stampWeather`) is
 * the one place that decides, and it sets the field explicitly on every path — because the weather
 * clients fill it with `'farm'` / `'device'` / `'unknown'`, and any of those reaching `ZGuid` would throw
 * out of `MutationQueue.enqueue` and cost the farmer the entire record.
 */
import type { WeatherStampPayload } from '../../../application/usecases/sync/CreateDailyLogCommand';
import type { DailyLog } from '../../../types';

export function buildWeatherStampPayload(stamp: DailyLog['weatherStamp']): WeatherStampPayload | undefined {
    return stamp
        ? {
              ...(stamp.plotId ? { plotId: stamp.plotId } : {}),
              timestampLocal: stamp.timestampLocal,
              timestampProvider: stamp.timestampProvider,
              provider: stamp.provider,
              tempC: stamp.tempC,
              humidity: stamp.humidity,
              windKph: stamp.windKph,
              precipMm: stamp.precipMm,
              cloudCoverPct: stamp.cloudCoverPct,
              conditionText: stamp.conditionText,
              iconCode: stamp.iconCode,
              rainProbNext6h: stamp.rainProbNext6h,
              windGustKph: stamp.windGustKph,
              soilMoistureVolumetric0To10: stamp.soilMoistureVolumetric0To10,
              uvIndex: stamp.uvIndex,
              alerts: stamp.alerts,
          }
        : undefined;
}
