/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1d)
 *
 * WEATHER IS A SPINE — a multi-plot save and a farm-scoped save must capture it.
 *
 * THE RULE BEING ENCODED (founder, 2026-08-13). A quantity cannot be repeated
 * without fabricating — eight workers stated once are eight, and writing them
 * onto three plots invents sixteen people. An OBSERVATION can be repeated,
 * because it is one fact that is true in several places. The weather over A, B
 * and C is one observed condition; recording it against the record that names
 * all three invents nothing, and withholding it loses data the compare engine,
 * the understanding meter and the intelligence layer all read.
 *
 * WHAT THIS FILE PINS, and why each assertion exists rather than reading well:
 *
 *  - the multi-plot record captures weather, ONCE, with no plot named
 *  - the farm-scoped record (संपूर्ण शेत) captures weather — it never has, at
 *    any point in this app's history, because the enrichment gate has always
 *    required exactly one asserted plot
 *  - the single-plot record is unchanged, including which coordinates it asks
 *    about and the plot id it records
 *  - the weather clients' placeholder plot ids (`'farm'`, `'device'`,
 *    `'unknown'`) never survive onto a record. That is not tidiness: any of them
 *    reaching the wire fails the payload's `ZGuid`, throws out of
 *    `MutationQueue.enqueue`, and costs the farmer the WHOLE record with a bare
 *    "Failed to save logs". See `logSyncMutationService.weatherStamp.test.ts`
 *    for the wire half of the same guard.
 *  - with no farm location, NOTHING is captured — never a reading fetched at
 *    `0, 0`, which is a real place in the Gulf of Guinea (`P4`)
 *  - a provider failure still costs the farmer nothing (`P9`)
 */
// @vitest-environment jsdom
// `LogCommandService` pulls in the finance spine, which reaches Dexie at module
// scope — the same reason its sibling `captureMoneyEvents` suite does this.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogCommandServiceImpl } from '../LogCommandService';
import type { WeatherPort } from '../../ports/WeatherPort';
import type { LogsRepository } from '../../ports';
import type { WeatherStamp } from '../../../domain/types/weather.types';
import type {
    CropProfile,
    FarmerProfile,
    LabourEvent,
    LogScope,
    PlotGeo,
} from '../../../types';

const CROP_ID = 'crop-grapes';
const PLOT_A = 'plot-a';
const PLOT_B = 'plot-b';
const PLOT_C = 'plot-c';
const DATE = '2026-08-13';

/** The farm's own recorded location — the anchor a plot-less record uses. */
const FARM_LAT = 20.0;
const FARM_LON = 73.8;

/** Plot A carries its own coordinates; B and C do not. */
const PLOT_A_GEO: PlotGeo = { lat: 19.1, lon: 72.9, source: 'google_maps' };

/**
 * What the real clients return. `plotId: 'farm'` is verbatim what
 * `BackendWeatherClient.getCurrentWeather` writes (`:112`) — the placeholder
 * this suite exists to keep off the record.
 */
function providerStamp(): WeatherStamp {
    return {
        id: 'wx_1',
        plotId: 'farm',
        timestampLocal: '2026-08-13T09:00:00.000Z',
        timestampProvider: '2026-08-13T08:55:00.000Z',
        provider: 'tomorrow.io',
        tempC: 29.4,
        humidity: 61,
        windKph: 8,
        precipMm: 0,
        cloudCoverPct: 20,
        conditionText: 'Partly Cloudy',
        iconCode: 'partly_cloudy',
        rainProbNext6h: 10,
    };
}

interface FakeWeather {
    port: WeatherPort;
    calls: PlotGeo[];
}

function fakeWeather(overrides?: { fail?: boolean }): FakeWeather {
    const calls: PlotGeo[] = [];
    const port = {
        getCurrentWeather: vi.fn(async (geo: PlotGeo) => {
            calls.push(geo);
            if (overrides?.fail) throw new Error('weather backend down');
            return providerStamp();
        }),
        getForecast: vi.fn(async () => []),
    } as unknown as WeatherPort;

    return { port, calls };
}

/** No persistence in this suite — enrichment happens before `confirmAndSave`. */
const inertRepo = {
    batchSave: vi.fn(async () => undefined),
    getAll: vi.fn(async () => []),
} as unknown as LogsRepository;

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: [
        { id: PLOT_A, name: 'Plot A', geo: PLOT_A_GEO },
        { id: PLOT_B, name: 'Plot B' },
        { id: PLOT_C, name: 'Plot C' },
    ],
} as unknown as CropProfile;

function profileWith(location: FarmerProfile['location']): FarmerProfile {
    return { activeOperatorId: 'owner', location } as unknown as FarmerProfile;
}

const locatedProfile = profileWith({
    lat: FARM_LAT,
    lon: FARM_LON,
    source: 'manual',
    updatedAt: '2026-08-01T00:00:00.000Z',
});

const scopeFor = (plotIds: string[], cropIds: string[] = [CROP_ID]): LogScope => ({
    selectedPlotIds: plotIds,
    selectedCropIds: cropIds,
    mode: plotIds.length > 1 ? 'multi' : 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope);

const eightWorkers = (): LabourEvent[] => ([{
    id: 'lab-1',
    type: 'HIRED',
    engagementType: 'hired_daily',
    count: 8,
    totalCost: 4000,
} as LabourEvent]);

async function save(
    scope: LogScope,
    weather: FakeWeather,
    profile: FarmerProfile = locatedProfile,
    labour: LabourEvent[] = eightWorkers(),
) {
    const service = new LogCommandServiceImpl(inertRepo, weather.port);
    return service.createFromManual({ date: DATE, labour }, scope, [grapes], profile);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('B1d — a MULTI-PLOT save captures weather', () => {
    it('THE HEADLINE: the record naming A+B+C carries a weather stamp', async () => {
        const weather = fakeWeather();

        const logs = await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather);

        // One engagement, one record (O-2) — and that record now has weather,
        // where B1b left it with none at all.
        expect(logs).toHaveLength(1);
        expect(logs[0].weatherStamp).toBeDefined();
        expect(logs[0].weatherStamp?.tempC).toBe(29.4);
        expect(logs[0].weatherStamp?.conditionText).toBe('Partly Cloudy');
    });

    it('names NO plot on that stamp — it is one observation over a set', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather);

        // Not `PLOT_A`: naming the first plot is the pick founder decision O-1
        // closed. `weather_stamps.plot_id` is `uuid NULL` and the wire schema is
        // `ZGuid.optional()`, so absence is the shape every other layer models.
        expect(log.weatherStamp?.plotId).toBeUndefined();
    });

    it('asks ONCE, at the farm anchor — not once per plot, and not at plot A', async () => {
        const weather = fakeWeather();

        await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather);

        expect(weather.calls).toHaveLength(1);
        expect(weather.calls[0]).toEqual({ lat: FARM_LAT, lon: FARM_LON, source: 'approx' });
        // Plot A has its own coordinates and they are deliberately NOT used:
        // borrowing them would make one plot's reading the whole record's.
        expect(weather.calls[0].lat).not.toBe(PLOT_A_GEO.lat);
    });

    it("never lets the client's placeholder plot id onto the record", async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather);

        // The provider returned `plotId: 'farm'`. Left in place it fails the
        // payload's ZGuid, throws out of MutationQueue.enqueue, and the farmer
        // loses the entire record.
        expect(log.weatherStamp?.plotId).not.toBe('farm');
    });
});

describe('B1d — a FARM-SCOPED save (संपूर्ण शेत) captures weather', () => {
    it('THE HEADLINE: it has weather at all — it never has before', async () => {
        const weather = fakeWeather();

        const logs = await save(scopeFor([], ['FARM_GLOBAL']), weather);

        expect(logs).toHaveLength(1);
        expect(logs[0].context.selection[0].selectedPlotIds).toEqual([]);
        expect(logs[0].weatherStamp).toBeDefined();
        expect(logs[0].weatherStamp?.tempC).toBe(29.4);
    });

    it('names no plot, and asks once at the farm anchor', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([], ['FARM_GLOBAL']), weather);

        expect(log.weatherStamp?.plotId).toBeUndefined();
        expect(weather.calls).toEqual([{ lat: FARM_LAT, lon: FARM_LON, source: 'approx' }]);
    });
});

describe('B1d — the SINGLE-PLOT path is unchanged', () => {
    it('records the plot id, and asks about that plot\'s own coordinates', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([PLOT_A]), weather);

        expect(log.weatherStamp?.plotId).toBe(PLOT_A);
        expect(weather.calls).toEqual([PLOT_A_GEO]);
    });

    it('falls back to the farm location for a plot with no coordinates', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([PLOT_B]), weather);

        expect(log.weatherStamp?.plotId).toBe(PLOT_B);
        expect(weather.calls).toEqual([{ lat: FARM_LAT, lon: FARM_LON, source: 'approx' }]);
    });

    it('records nothing when the selected plot belongs to no known crop', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor(['plot-nobody-knows']), weather);

        expect(log?.weatherStamp).toBeUndefined();
        expect(weather.calls).toHaveLength(0);
    });

    it('per-plot records the FARMER pinned each get their own plot\'s stamp', async () => {
        const weather = fakeWeather();

        const logs = await save(
            scopeFor([PLOT_A, PLOT_B, PLOT_C]),
            weather,
            locatedProfile,
            [
                { id: 'lab-a', type: 'HIRED', count: 5, targetPlotName: 'Plot A' } as LabourEvent,
                { id: 'lab-b', type: 'HIRED', count: 3, targetPlotName: 'Plot B' } as LabourEvent,
            ],
        );

        // Each record names exactly ONE plot, so each states that plot.
        expect(logs.map(log => log.weatherStamp?.plotId).sort()).toEqual([PLOT_A, PLOT_B]);
    });
});

describe('B1d — what it refuses to invent', () => {
    it('captures NOTHING when the farm has no recorded location', async () => {
        const weather = fakeWeather();

        const [log] = await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather, profileWith(undefined));

        expect(log.weatherStamp).toBeUndefined();
        // The alternative is a reading fetched at `0, 0` and stored as this
        // farm's weather. That is a fabricated observation, not a gap (`P4`).
        expect(weather.calls).toHaveLength(0);
    });

    it('refuses 0,0 specifically — Null Island is not a farm', async () => {
        const weather = fakeWeather();

        const [log] = await save(
            scopeFor([PLOT_A, PLOT_B, PLOT_C]),
            weather,
            profileWith({ lat: 0, lon: 0, source: 'unknown', updatedAt: 'T' }),
        );

        expect(log.weatherStamp).toBeUndefined();
        expect(weather.calls).toHaveLength(0);
    });

    it('a provider failure never costs the farmer the log (`P9`)', async () => {
        const weather = fakeWeather({ fail: true });

        const logs = await save(scopeFor([PLOT_A, PLOT_B, PLOT_C]), weather);

        expect(logs).toHaveLength(1);
        expect(logs[0].labour[0].count).toBe(8);
        expect(logs[0].weatherStamp).toBeUndefined();
    });

    it('captures nothing at all when no weather provider is wired', async () => {
        const service = new LogCommandServiceImpl(inertRepo);

        const logs = await service.createFromManual(
            { date: DATE, labour: eightWorkers() },
            scopeFor([PLOT_A, PLOT_B, PLOT_C]),
            [grapes],
            locatedProfile,
        );

        expect(logs[0].weatherStamp).toBeUndefined();
    });
});
