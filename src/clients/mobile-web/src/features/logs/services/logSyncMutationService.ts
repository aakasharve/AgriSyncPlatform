import { AddLogTaskCommand } from '../../../application/usecases/sync/AddLogTaskCommand';
import { CreateDailyLogCommand, type LabourItemPayload, type ManualDraftPayload } from '../../../application/usecases/sync/CreateDailyLogCommand';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { type CropCycleDto, type PlotDto } from '../../../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { type DailyLog } from '../../../types';

// The backend's AddLogTaskMutationPayload deserializes logTaskId as a
// nullable Guid. Local domain code, however, freely uses non-UUID strings
// like 'act_global_daily', `irr_${Date.now()}`, or scoped composites like
// 'act_global_daily::<plotUuid>' for in-memory state keying. If those land
// on the wire as-is, /sync/push returns 500 and the cycle never produces
// REJECTED → the conflict-badge / retry UI starves. So at the sync
// boundary we replace any non-UUID logTaskId with a freshly generated v4
// UUID. The payload is then memoised inside the mutation queue, so retries
// reuse the same UUID and stay idempotent.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureUuid(localId: string | undefined): string {
    if (localId && UUID_REGEX.test(localId)) {
        return localId;
    }
    return idGenerator.generate();
}

/**
 * LABOUR_PHASE2 B1a — what the farmer asserted about WHERE the work happened,
 * resolved against the plots this device actually knows.
 *
 * A DISCRIMINATED UNION, not one struct with four optional fields, and that is
 * load-bearing rather than stylistic: `ck_daily_logs_scope` and
 * `CreateDailyLogHandler` both reject a `MultiPlot` log that carries a
 * `plotId` or a `cropCycleId`, and reject a `Plot` log that omits either. The
 * union makes the rejected combinations unrepresentable here, so the payload
 * below cannot be built wrong — the same reason P2.1 gave each scope its own
 * domain factory instead of one `Create(scope, …)`.
 *
 * LABOUR_PHASE2 B1c — `Farm` JOINS THE UNION. It was absent because this module
 * could only read a farm off a plot and a farm-scoped log has none; it now has a
 * non-plot source (`log.meta.farmId`, stamped at save time) so the assertion is
 * finally expressible. Its plot set is the EMPTY TUPLE, not `string[]`: an empty
 * set is the whole content of the assertion (founder decision O-1), and
 * `ck_daily_logs_scope`, `CreateDailyLogValidator` and `CreateDailyLogHandler`
 * all reject a `Farm` row carrying any plot, so a non-empty one must be
 * unrepresentable here rather than merely unlikely.
 */
type ResolvedLogSyncTarget =
    | { farmId: string; scope: 'Plot'; plotIds: string[]; plotId: string; cropCycleId: string }
    | { farmId: string; scope: 'MultiPlot'; plotIds: string[] }
    | { farmId: string; scope: 'Farm'; plotIds: [] };

interface LogTaskMutationPayload {
    logTaskId: string;
    activityType: string;
    notes?: string;
    occurredAtUtc?: string;
}

function normalizeName(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function buildTaskNotes(parts: Array<string | undefined>): string | undefined {
    const filtered = parts
        .map(part => part?.trim())
        .filter((part): part is string => Boolean(part && part.length > 0));

    if (filtered.length === 0) {
        return undefined;
    }

    return filtered.join(' • ');
}

function buildTaskPayloads(log: DailyLog): LogTaskMutationPayload[] {
    const occurredAtUtc = log.meta?.createdAtISO;
    const payloads: LogTaskMutationPayload[] = [];

    log.cropActivities.forEach(activity => {
        payloads.push({
            logTaskId: ensureUuid(activity.id),
            activityType: activity.workTypes?.[0] || activity.title,
            notes: activity.notes,
            occurredAtUtc,
        });
    });

    log.irrigation.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: 'Irrigation',
            notes: buildTaskNotes([
                event.method ? `Method: ${event.method}` : undefined,
                event.source ? `Source: ${event.source}` : undefined,
                event.durationHours ? `Duration: ${event.durationHours} hrs` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    // Labour V1 Task 8.1 — labour deliberately does NOT produce a log_task here.
    // It used to be flattened into a free-text note ("Workers: 6 • Cost: ₹3000")
    // which discarded every structured field. It now travels as structured
    // `labour[]` on the create_daily_log payload (see buildLabourPayloads), which
    // the server stages as canonical Phase-1 rows atomically with the log.

    log.inputs.forEach(event => {
        const productName = event.productName || event.mix?.[0]?.productName || 'Input';
        const activityType = event.type === 'fertilizer' || event.reason === 'Growth' || event.reason === 'Deficiency'
            ? `Fertilizer ${productName}`
            : `Spray ${productName}`;

        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType,
            notes: buildTaskNotes([
                event.quantity ? `Qty: ${event.quantity} ${event.unit || ''}` : undefined,
                event.cost ? `Cost: ₹${event.cost}` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.machinery.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: `Machinery ${event.type}`,
            notes: buildTaskNotes([
                event.hoursUsed ? `Hours: ${event.hoursUsed}` : undefined,
                event.rentalCost ? `Rent: ₹${event.rentalCost}` : undefined,
                event.fuelCost ? `Fuel: ₹${event.fuelCost}` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.observations?.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: event.noteType === 'reminder' ? 'Reminder' : 'Observation',
            notes: event.textCleaned || event.textRaw,
            occurredAtUtc,
        });
    });

    return payloads;
}

/**
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — carry the farmer's
 * typed day to the server on a MANUAL save.
 *
 * The defect this closes: a manual log's payload was identity-only, so the server had
 * nothing to persist. No typed children were ever written for it, the day scored 0/10,
 * and a farmer who had typed out everything he did was told he had recorded nothing.
 *
 * THE GATE IS POSITIVE, AND IT FAILS SAFE. A draft ships only when the log ASSERTS it is
 * manual (`provenance.source === 'manual'`). Anything else — `'ai'`, `'pre_spine'`, or no
 * provenance at all — ships nothing.
 *
 * Why not "no sourceAiJobId": that was wrong and would have written a lie. The client's
 * real discriminator is `LogProvenance.source` (`domain/ai/LogProvenance.ts:18`);
 * `sourceAiJobId` is OPTIONAL even on AI logs (`:36`), and two live producers stamp
 * `source: 'ai'` with no job id — the streaming parse path
 * (`features/voice/useVoiceRecorder.ts:253-258`) and `BackendAiClient.ts:149`
 * (`apiResult.sourceAiJobId ?? undefined`). Such a log's buckets hold AI-EXTRACTED
 * figures. Shipping them as a manual draft would have the server persist them with
 * `Provenance.Manual` — model "n/a", no extractor SHA — making an inferred number
 * permanently indistinguishable from one the farmer typed. Doctrine P8 forbids exactly
 * that, and it is irreversible: it converts a gap in the record into a false record.
 *
 * Why ABSENT provenance ships nothing either: absence is genuinely ambiguous here. A
 * voice route reaches this function with no provenance at all —
 * `useLogCommands.ts:242-250` calls `createFromVoice(..., undefined, ...)` ("Provenance
 * might be lost here", its own comment) and then enqueues. Since shipping is the
 * irreversible direction, an unmarked log is treated as unknown-origin and withheld.
 * Genuinely-manual producers therefore DECLARE themselves — `ManualEntry` and the wizard
 * (`logSubmissionService`) stamp `source: 'manual'` — rather than being inferred from a
 * silence that a voice log can also produce.
 *
 * Also returns undefined for a log with no content at all. An absent draft is the
 * pre-task-0b wire exactly, which is what keeps old servers and voice saves untouched.
 */
export function buildManualDraft(log: DailyLog): ManualDraftPayload | undefined {
    if (log.meta?.provenance?.source !== 'manual') {
        return undefined;
    }

    // Only non-empty buckets go on the wire — an empty array says nothing the server
    // does not already assume, and the draft is size-capped at the sync boundary.
    const draft: ManualDraftPayload = {};
    if (log.labour?.length) draft.labour = log.labour;
    if (log.inputs?.length) draft.inputs = log.inputs;
    if (log.irrigation?.length) draft.irrigation = log.irrigation;
    if (log.observations?.length) draft.observations = log.observations;
    if (log.plannedTasks?.length) draft.plannedTasks = log.plannedTasks;
    if (log.cropActivities?.length) draft.cropActivities = log.cropActivities;
    if (log.machinery?.length) draft.machinery = log.machinery;
    if (log.activityExpenses?.length) draft.activityExpenses = log.activityExpenses;

    // FOUNDER DECISION 8 (2026-08-16) — the farmer's own statement about the DAY, and the
    // optional chip explaining it. Both are COPIED, never inferred.
    //
    // 'WORK_RECORDED' is deliberately NOT sent: it is the LogFactory's default for any
    // ordinary day, so putting it on the wire would turn a value the farmer never uttered
    // into a stored declaration (P4). Only a genuine departure from "he worked" travels.
    //
    // These two lines sit BEFORE the length check on purpose. A declared no-work day
    // carries no buckets at all, so without them `buildManualDraft` would return undefined
    // and the declaration would never leave the device — the exact defect decision 8
    // closes.
    if (log.dayOutcome && log.dayOutcome !== 'WORK_RECORDED') draft.dayOutcome = log.dayOutcome;
    if (log.disturbance?.reason) {
        // P9 — the chip is optional. A declaration with no reason writes no `disturbance`
        // key at all, and the record still commits; `DisturbanceEvent.Create` requires a
        // non-empty reason, which is precisely why the DECLARATION does not live here.
        draft.disturbance = {
            scope: log.disturbance.scope,
            cause: log.disturbance.cause,
            reason: log.disturbance.reason,
        };
    }

    return Object.keys(draft).length > 0 ? draft : undefined;
}

/**
 * A number the wire schema will actually accept, or `undefined` so the key is
 * dropped. `Number.isFinite` rejects NaN and ±Infinity, which is not a
 * theoretical concern: `DetailSheet` writes `totalCost` and `contractQuantity`
 * with a bare `parseFloat(e.target.value)` and no fallback, and `parseFloat('')`
 * is NaN, so simply CLEARING a money field produces one.
 */
export function finiteOrOmitted(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Same, for the three headcount fields, which the schema pins as
 * `z.number().int()`. The inputs are `type="number"`, so "2.5" in Male Split is
 * reachable in one keystroke.
 *
 * A fractional count is DROPPED, never rounded. Rounding would assert a
 * headcount the farmer never stated, and the server deliberately preserves
 * silence as NULL ("we were not told") rather than as a number — inventing 3
 * from 2.5 would put a fabricated count into the canonical record, which is the
 * failure this whole plan exists to remove. The log still saves either way.
 * `Number.isInteger` is already false for NaN and ±Infinity.
 */
export function wholeOrOmitted(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Labour V1 Task 8.1 — THE STRUCTURED LABOUR PAYLOAD.
 *
 * WHY THIS IS LOAD-BEARING, not a payload tweak: the server routes labour to
 * Phase 1 (atomic with the DailyLog) only when the confirm carries structured
 * `labour[]`. With no client producer, every confirmed labour row was written in
 * Phase 2 — the best-effort side-car, whose failure branches catch, log a
 * warning and return success. The log would commit, the labour rows would
 * vanish, and the idempotency early-return would hand back the existing log on
 * every retry. There is no backfill job in this system. Populating this array is
 * what closes that hole.
 *
 * DURATION: `durationHours` is OMITTED entirely when the farmer did not state
 * it. Absence is the client saying "not stated", and the server then records
 * LabourTime.ServerAssumed. Sending 0 — or any number nobody said — would
 * fabricate a measurement, which is the exact thing this plan removes.
 */
function buildLabourPayloads(log: DailyLog): LabourItemPayload[] {
    return (log.labour || []).map(event => {
        // SANITISED BEFORE THE OBJECT IS BUILT — this is a correctness boundary,
        // not defensive padding. `MutationQueue.enqueue` validates every payload
        // against sync-contract/schemas/payloads/create_daily_log.zod.ts and
        // THROWS on failure, and `enqueueLogsForSync` has no try/catch, so one
        // malformed number would propagate out of the save handler: the farmer
        // sees "Failed to save logs", the log sits in Dexie, and NO mutation row
        // was ever written — so there is nothing queued to retry and, on a
        // multi-plot broadcast, every later log in the batch is abandoned too.
        // The labour would then reach NEITHER Phase 1 nor Phase 2, which is
        // strictly worse than the side-car this array replaced.
        //
        // It would also invert the doctrine the server deliberately honours:
        // CreateDailyLogHandler is fail-OPEN on these fields (P9 / Constraint 7
        // — no optional field may ever reject a record). The client must not be
        // fail-closed on the very fields the server refuses to reject. The fix
        // belongs HERE, at the boundary that introduced the validation: never
        // loosen the schema, and never swallow the enqueue in a try/catch.
        const maleCount = wholeOrOmitted(event.maleCount);
        const femaleCount = wholeOrOmitted(event.femaleCount);
        const workerCount = wholeOrOmitted(event.count);
        // NO-MULTIPLY (ADR 0023): the rate is carried as stated and is never
        // multiplied out into a total. `rate` is the newer B2.4 field the parser
        // can emit; the voice path preferred it server-side, and that derivation
        // is now suppressed for any log carrying this array.
        const wagePerPerson = finiteOrOmitted(event.wagePerPerson ?? event.rate);
        const contractQuantity = finiteOrOmitted(event.contractQuantity);
        // Only an explicitly stated total — never derived from rate × count.
        const totalCost = finiteOrOmitted(event.totalCost);
        // Absent means "the farmer did not state hours"; the server then records
        // Assumed. Zero and negatives are unstated too — not an error (P9).
        const durationHours = finiteOrOmitted(event.durationHours);

        // Conditional spreads, so a value we cannot send is simply NOT SENT: the
        // key is absent rather than present-and-undefined. One uniform rule for
        // every optional number on this payload.
        return {
            // Task 7 mints this at confirm-time on the same array we read here.
            // `ensureUuid` is the last line of defence: Task 6.1 rejects a
            // missing/empty id as a malformed payload, which would 400 the WHOLE
            // log — permanently, since the farmer has no way to repair it. An
            // event with no local id has no identity to diverge from, so minting
            // one at the boundary loses nothing and saves the log. Ids that
            // already exist pass through untouched. It also satisfies the
            // schema's ZGuid, which is the same regex as UUID_REGEX above.
            labourAssignmentId: ensureUuid(event.labourAssignmentId),
            // The server maps this string tolerantly and passes `null` for the
            // legacy arg, so the legacy HIRED/CONTRACT/SELF must be folded in
            // HERE or a contract engagement would silently record as Hired.
            // The final fallback is not a guess: `engagementType` is the one
            // REQUIRED string on this payload, so a legacy Dexie record with
            // neither field would throw at the queue — and the server's total
            // map turns an unrecognised value into Hired anyway, so this
            // produces byte-identical server state to the absent case.
            engagementType: event.engagementType || event.type || 'hired_daily',
            ...(maleCount !== undefined && { maleCount }),
            ...(femaleCount !== undefined && { femaleCount }),
            ...(workerCount !== undefined && { workerCount }),
            ...(wagePerPerson !== undefined && { wagePerPerson }),
            ...(contractQuantity !== undefined && { contractQuantity }),
            ...(totalCost !== undefined && { totalCost }),
            ...(durationHours !== undefined && durationHours > 0 && { durationHours }),
            contractUnit: event.contractUnit,
            shift: event.shiftId,
            task: event.activity,
            notes: event.notes,
        };
    });
}

/**
 * LABOUR_PHASE2 B1a — the WHOLE plot set the farmer selected, in the order the
 * selection was made, duplicates removed.
 *
 * WHAT THIS REPLACES. `resolveLogPlot` read `selection[0].selectedPlotIds[0]`:
 * the first plot of the first crop. That was correct only because every log
 * `LogFactory` could persist had exactly one plot in exactly one entry — the
 * per-plot fan-out had already thrown the rest of the selection away before the
 * log reached Dexie (plan §C0). Phase 2b stops that split, so from B1b onward a
 * single log legitimately carries `{A,B,C}`, and `[0]` would silently discard
 * B and C — the same "pick the first plot" fabrication founder decision O-1
 * closed, moved one layer down.
 *
 * EVERY selection entry is read, not just `[0]`. A multi-CROP selection is one
 * entry per crop (`LogContext.tsx`, `logsReconciler.buildSelection`), so
 * stopping at `[0]` would drop the second crop's plots entirely.
 *
 * Duplicates are collapsed rather than rejected: the assertion is a SET, the
 * same plot named twice is still one plot, and `CreateDailyLogHandler` refuses
 * a `MultiPlot` set containing a repeat.
 */
function selectedPlotIds(log: DailyLog): string[] {
    const seen = new Set<string>();
    for (const entry of log.context.selection ?? []) {
        for (const plotId of entry?.selectedPlotIds ?? []) {
            if (plotId) {
                seen.add(plotId);
            }
        }
    }

    return [...seen];
}

/**
 * The plots, resolved out of Dexie, plus the one farm they all belong to.
 *
 * `null` when the log names no plot, when any named plot has not synced down to
 * this device yet, or when the plots do not agree on a farm. The last case is
 * not defensive padding: `farmId` is a REQUIRED, single-valued field on
 * `create_daily_log`, cross-farm mutation is forbidden, and picking one farm
 * out of two would attribute a farmer's work to a farm they did not name. There
 * is no honest single answer, so the log is not queued and the honesty surfaces
 * report it as unsendable instead of sending it somewhere plausible.
 */
async function resolveLogPlots(
    log: DailyLog,
): Promise<{ farmId: string; plotIds: string[] } | null> {
    const plotIds = selectedPlotIds(log);
    if (plotIds.length === 0) {
        return null;
    }

    const db = getDatabase();
    let farmId: string | null = null;

    for (const plotId of plotIds) {
        const plotRecord = await db.plots.get(plotId);
        if (!plotRecord) {
            return null;
        }

        const plotFarmId = (plotRecord.payload as PlotDto).farmId;
        if (!plotFarmId || (farmId !== null && plotFarmId !== farmId)) {
            return null;
        }

        farmId = plotFarmId;
    }

    return farmId ? { farmId, plotIds } : null;
}

/**
 * LABOUR_PHASE2 B1c — the farm of a log that names NO plot, and only such a log.
 *
 * THE ANSWER IS THE RECORD'S OWN, NOT THIS MOMENT'S. It reads `meta.farmId`,
 * stamped by `LogCommandServiceImpl.confirmAndSave` from the farm context the
 * app was displaying when the farmer saved (see `LogMeta.farmId`). It
 * deliberately does NOT read `SessionStore` here: the push runs whenever
 * `BackgroundSyncWorker` next fires, which may be after the farmer has switched
 * farms, and answering a question about the past with the present is exactly how
 * one farm's labour lands in another's ledger.
 *
 * THEN IT IS CROSS-CHECKED AGAINST DATA THIS DEVICE RECEIVED FROM THE SERVER.
 * `db.farms` is written only by the pull (`farmsPlotsCyclesReconciler`) into the
 * per-user database, so requiring the farm to be present there means the id on
 * the wire is one the server has already told THIS user about — an independent
 * witness to a value that otherwise rests entirely on local state. That matters
 * because `SessionStore` is a single localStorage key shared across logins,
 * while the Dexie database changes address on a user switch: without this check,
 * a log created in the window between logging in as B and B's farm context
 * loading could carry A's farm id, which is a cross-tenant write. The server
 * enforces tenancy too; that is a second line, not the argument (`E4`).
 *
 * THE COST IS STATED, NOT HIDDEN: a device that has a farm context but has not
 * completed a `/sync/pull` yet will refuse to send a farm-scoped log. That is
 * the SAME rule `resolveLogPlots` already applies one function above — a plot
 * the pull has not delivered makes a plot-scoped log unsendable too — so this
 * adds no new class of failure, and it fails the safe way: the record stays on
 * the phone and the honesty surfaces report it, rather than being posted to a
 * farm nobody has confirmed.
 *
 * `null` whenever the record does not say. Never "the only farm in Dexie",
 * never `farms[0]`, never a sentinel (founder decision O-1, `P4`).
 */
async function resolveRecordedFarmId(log: DailyLog): Promise<string | null> {
    const farmId = log.meta?.farmId;
    if (!farmId) {
        return null;
    }

    const farmRecord = await getDatabase().farms.get(farmId);
    return farmRecord ? farmId : null;
}

/**
 * "Did this record name no plot at all?" — the ONE condition under which the
 * recorded farm may be used.
 *
 * `resolveLogPlots` returns `null` for three different reasons, and only this
 * one is farm scope. The other two — a named plot this device has not pulled,
 * and named plots that disagree about their farm — are cases where plot evidence
 * exists but is unusable, and falling back to the stamp there would route a
 * PLOT-scoped log by a value that was never checked against its plots. Both must
 * keep refusing.
 */
function namesNoPlot(log: DailyLog): boolean {
    return selectedPlotIds(log).length === 0;
}

/**
 * Labour V1 Task 12b.7 — the farm a log belongs to, for the farm-scoped
 * correction route (`POST /farms/{farmId}/labour/assignments/{id}/corrections`).
 *
 * Deliberately narrower than `resolveSyncTarget`: a correction needs only the
 * farm, and requiring a resolvable CROP CYCLE as well would refuse to correct a
 * headcount on a log whose cycle has since ended.
 *
 * B1a: this shares `resolveLogPlots` with the push path, which is the point.
 * The `[0]` pick governed BOTH, so correcting a multi-plot log would have been
 * routed by the first plot alone — and would have started failing outright the
 * moment `LogFactory` stopped emitting one log per plot. One choke point, both
 * paths.
 *
 * B1c: the same choke point is why farm-wide CORRECTION becomes reachable in the
 * same edit that makes the farm-wide PUSH work. Until now a संपूर्ण शेत log
 * resolved to `null` here, so `UpdateLog` refused every correction on one —
 * which was the honest answer while there was no farm to route to, and is no
 * longer the only answer available.
 *
 * PLOT EVIDENCE STILL WINS where it exists. A plot's farm comes from
 * server-issued reference data (`db.plots[].payload.farmId`) and is the value
 * the server itself will check the write against; the stamp is a client capture
 * of screen state. The stamp is consulted only when there is no plot to ask.
 */
export async function resolveLogFarmId(log: DailyLog): Promise<string | null> {
    const resolved = await resolveLogPlots(log);
    if (resolved) {
        return resolved.farmId;
    }

    return namesNoPlot(log) ? await resolveRecordedFarmId(log) : null;
}

/**
 * §P0.7 box 2e / review B001 — WHICH MOMENT THE CROP CYCLE IS RESOLVED AS OF.
 *
 * `'at-capture'` is the original behaviour and is correct for the save path: the
 * enqueue happens seconds after the farmer speaks, so "the plot's current cycle"
 * and "the cycle the work happened in" are the same cycle.
 *
 * `'from-log-date'` exists because THE RECONCILER IS THE ONLY THING IN THE
 * SYSTEM THAT RESOLVES "THEN" USING "NOW". A log stranded during last season's
 * grape cycle — precisely the record box 2e exists to recover — would be routed
 * by the open-first sort below to THIS season's cycle. `logDate` would survive
 * and the attribution would be invented: a `cropCycleId` the farmer never gave,
 * manufactured by the recovery itself.
 *
 * So recovery does not consult "now" at all for the CHOICE. It asks which
 * cycle's own dates CONTAIN the log's own date — the record's evidence against
 * server-issued boundaries — and if that question does not have exactly one
 * answer it refuses and the caller reports the log as unroutable. The selection
 * never sorts, never prefers the open cycle, and never picks the likelier one.
 *
 * ONE PREFERENCE SURVIVES, AND IT IS UPSTREAM OF THE SELECTION (review N1).
 * "No fallback" is true of the selection and NOT of the candidate set. The
 * candidate list is built by filtering the plot's cycles on `cropName`, and when
 * that filter matches none it FALLS BACK to every cycle on the plot (`:562-565`
 * below). So a log whose recorded crop name has drifted — a rename, a spelling
 * change, an AI-derived name that no longer matches the reference data — can get
 * a unique, confident attribution to a DIFFERENT crop's cycle.
 *
 * That fallback predates this change and applies to both modes; date containment
 * makes it strictly less likely to fire wrongly, since the other crop's cycle
 * must also contain the date. It is named here rather than removed because
 * removing it would refuse to route logs that route correctly today, which is a
 * separate decision with its own cost. Do not read "no fallback" as covering it.
 *
 * ---------------------------------------------------------------------------
 * DEPENDENCY: THIS IS ONLY CORRECT WHILE CROP CYCLES ARE IMMUTABLE (review N2).
 * ---------------------------------------------------------------------------
 * Date containment answers "which cycle was open then" using the cycle's dates
 * AS THEY ARE NOW. That is sound only because a cycle's `startDate` / `endDate`
 * cannot change after the fact. Today they cannot:
 *
 *   - `CropCycle.cs` exposes private setters, a `Create` factory and no mutator;
 *   - there is no update handler for a crop cycle;
 *   - the sync catalog carries `create_crop_cycle` and nothing else that could
 *     write one from a client.
 *
 * Also load-bearing, and independently true: `CreateCropCycleHandler.cs:77-89`
 * REJECTS overlapping cycles on a plot, so server-issued cycles partition a
 * plot's timeline and containment can match at most one. The "two or more
 * matches" refusal below is therefore a guard against locally inconsistent data,
 * not a state the server can produce.
 *
 * THE DAY SOMEONE ADDS A CLOSE-OR-EDIT PATH, THIS SILENTLY CHANGES MEANING:
 * editing a cycle's dates would retroactively re-attribute every historical log
 * that recovery later touches, and no test here would fail. If you are adding
 * that path, decide first whether recovery should freeze the attribution at
 * capture time instead — `SelectedCropContext` carries no cycle today, so that
 * would mean recording one.
 *
 * `__tests__/cropCycleImmutability.guard.test.ts` fails if a cycle-mutating
 * mutation type appears in the catalog, so this note gets read rather than
 * discovered.
 */
export type CycleResolution = 'at-capture' | 'from-log-date';

/**
 * The one cycle whose dates contain this log's date, or `null`.
 *
 * `null` for zero matches AND for two or more. Ambiguity is not a tie to be
 * broken — a second candidate means the evidence does not identify the cycle,
 * and absent beats wrong (`P4`).
 *
 * An OPEN cycle (no `endDate`) contains every date at or after its start, which
 * is what makes this discriminate correctly in the case that motivated it: last
 * season's log predates this season's `startDate`, so the open cycle does not
 * contain it and only the closed one does.
 */
function selectCycleContainingDate(
    candidates: readonly CropCycleDto[],
    logDate: string,
): CropCycleDto | null {
    const at = Date.parse(logDate);
    if (Number.isNaN(at)) {
        return null;
    }

    const containing = candidates.filter(cycle => {
        const start = Date.parse(cycle.startDate);
        if (Number.isNaN(start) || at < start) {
            return false;
        }
        if (!cycle.endDate) {
            return true;
        }
        const end = Date.parse(cycle.endDate);
        return Number.isNaN(end) ? false : at <= end;
    });

    return containing.length === 1 ? containing[0] : null;
}

async function resolveSyncTarget(
    log: DailyLog,
    cycleResolution: CycleResolution = 'at-capture',
): Promise<ResolvedLogSyncTarget | null> {
    const selection = log.context.selection?.[0];
    const resolved = await resolveLogPlots(log);
    if (!resolved) {
        // LABOUR_PHASE2 B1c — the farm-scoped log (`selectedPlotIds: []`) is no
        // longer stranded here. It carries its own farm, recorded when the
        // farmer saved it, and that farm is verified against the farms this
        // device has actually pulled — see `resolveRecordedFarmId`.
        //
        // Every OTHER reason `resolveLogPlots` refused still refuses: a plot
        // this device has not pulled, and plots that disagree about their farm.
        // Those are plot-scoped logs whose plot evidence is missing or
        // contradictory, and the recorded farm is not a substitute for it.
        if (namesNoPlot(log)) {
            const recordedFarmId = await resolveRecordedFarmId(log);
            // `plotIds: []` is the assertion itself, not a gap: संपूर्ण शेत
            // means no plot was named. `plotId` and `cropCycleId` are absent
            // rather than null — the CHECK, the validator and the handler all
            // reject a `Farm` row that carries either.
            return recordedFarmId ? { farmId: recordedFarmId, scope: 'Farm', plotIds: [] } : null;
        }

        return null;
    }

    const { farmId, plotIds } = resolved;

    if (plotIds.length > 1) {
        // MultiPlot. No `plotId` and no `cropCycleId`, by contract: the domain
        // CHECK requires both to be NULL, `CreateDailyLogHandler` rejects the
        // command if either is present, and `crop_cycle_id` is as single-valued
        // as `plot_id` was — recording one plot's cycle for a three-plot log
        // would assert a cycle the farmer never named. Cross-cycle attribution
        // is explicitly deferred (plan §N), and absent beats wrong.
        return { farmId, scope: 'MultiPlot', plotIds };
    }

    const plotId = plotIds[0];
    const db = getDatabase();
    const cropName = normalizeName(selection?.cropName);

    const cycleRecords = await db.cropCycles.where('plotId').equals(plotId).toArray();
    const candidates = cycleRecords
        .map(record => record.payload as CropCycleDto)
        .filter(candidate => normalizeName(candidate.cropName) === cropName);

    // ONE candidate list, both modes. The cropName filter with its
    // fall-back-to-all is unchanged; only what happens NEXT differs, so the two
    // modes cannot drift apart over which cycles were even in the running.
    //
    // Review N1 — THIS FALLBACK IS A PREFERENCE, and it is the one thing
    // `from-log-date` does not eliminate. When the recorded crop name matches no
    // cycle on the plot (a rename, a spelling drift, an AI-derived name), every
    // cycle becomes a candidate and the log can be attributed to a DIFFERENT
    // crop's cycle. Pre-existing and unchanged; named where it happens so the
    // mode's "no fallback" claim is not read as covering it.
    const inTheRunning = candidates.length > 0
        ? candidates
        : cycleRecords.map(record => record.payload as CropCycleDto);

    const selectedCycle = cycleResolution === 'from-log-date'
        // Review B001 — recovery resolves "then" with "then". No sort, no
        // fallback: either the log's own date lands inside exactly one cycle or
        // this log has no resolvable attribution and the caller must say so.
        ? selectCycleContainingDate(inTheRunning, log.date)
        : inTheRunning
            .sort((left, right) => {
                const leftEnd = left.endDate ? Date.parse(left.endDate) : Number.MAX_SAFE_INTEGER;
                const rightEnd = right.endDate ? Date.parse(right.endDate) : Number.MAX_SAFE_INTEGER;
                if (leftEnd !== rightEnd) {
                    return rightEnd - leftEnd;
                }

                return Date.parse(right.modifiedAtUtc) - Date.parse(left.modifiedAtUtc);
            })[0];

    if (!selectedCycle) {
        return null;
    }

    return {
        farmId,
        scope: 'Plot',
        plotIds,
        plotId,
        cropCycleId: selectedCycle.id,
    };
}

export interface EnqueueLogsOptions {
    /**
     * Review B001 — as of WHICH MOMENT the crop cycle is resolved. Defaults to
     * `'at-capture'`, which is every existing caller's behaviour, unchanged.
     * Only the crash reconciler passes `'from-log-date'`.
     */
    cycleResolution?: CycleResolution;
    /**
     * Review B004 — whether to drive a sync cycle when this call finishes.
     *
     * Defaults to `true`, which is every existing caller's behaviour. The crash
     * reconciler passes `false` and triggers ONCE at the end: it calls this
     * function per log (that isolation is deliberate — this function has none of
     * its own, so a batch call would let one bad record cost every record behind
     * it), and `triggerNow()` is awaited and chains onto `currentCycle`, so K
     * stranded logs would otherwise mean K sequential push+pull+AI cycles at
     * every app start — on rural mobile data, for the population that by
     * definition has a backlog.
     */
    triggerSync?: boolean;
}

export async function enqueueLogsForSync(
    logs: DailyLog[],
    options: EnqueueLogsOptions = {},
): Promise<{ queuedLogIds: string[]; skippedLogIds: string[] }> {
    const { cycleResolution = 'at-capture', triggerSync = true } = options;
    const queuedLogIds: string[] = [];
    const skippedLogIds: string[] = [];

    for (const log of logs) {
        const target = await resolveSyncTarget(log, cycleResolution);
        if (!target) {
            skippedLogIds.push(log.id);
            continue;
        }

        const labourPayloads = buildLabourPayloads(log);
    const manualDraft = buildManualDraft(log);

        await CreateDailyLogCommand.enqueue({
            dailyLogId: log.id,
            farmId: target.farmId,
            // LABOUR_PHASE2 B1a — the ONE place the two shapes diverge, and the
            // reason B1a is behaviour-neutral.
            //
            // `Plot` emits exactly the two keys V1 emitted, in the position V1
            // emitted them, and states NO scope: `create_daily_log.zod.ts:90`
            // and `PushSyncBatchHandler` both read an absent scope as `Plot`,
            // which is precisely what every client shipped before P2.2 meant.
            // Every log this app can persist today is single-plot, so the
            // payload on the wire is byte-identical — asserted in
            // `logSyncMutationService.scopeTarget.test.ts`, which was run
            // against the unmodified module first.
            //
            // `MultiPlot` states the scope and the whole set instead. Emitting
            // `scope: 'Plot'` for the single-plot case as well would be
            // harmless server-side and is deliberately NOT done: it would
            // rewrite the wire format of every log a farmer writes for no
            // change in what is stored, on the same commit that changes how
            // logs are built.
            //
            // B1c — `Farm` takes the SAME branch as `MultiPlot` and needs no
            // code of its own: `scope: 'Farm'` with `plotIds: []`, and neither
            // `plotId` nor `cropCycleId` present. That is exactly what
            // `CreateDailyLogValidator` requires of a `Farm` command
            // (`PlotId is null && CropCycleId is null && PlotIds is null or
            // {Count: 0}`) and what `ck_daily_logs_scope` welds into the row.
            ...(target.scope === 'Plot'
                ? { plotId: target.plotId, cropCycleId: target.cropCycleId }
                : { scope: target.scope, plotIds: target.plotIds }),
            logDate: log.date,
            // AI Intelligence Plan WP-2a — thread the parse job linkage recorded on
            // the log's provenance (BackendAiClient stamps AiJob.Id there) so the
            // server can derive the typed ledger rows. Undefined for manual logs.
            sourceAiJobId: log.meta?.provenance?.sourceAiJobId,
            // task-0b — the farmer's typed day, so a manual save persists typed
            // children and can be scored. Absent for voice confirms.
            //
            // CONDITIONAL SPREAD, by the same rule every other optional field on
            // this payload follows (see `plotId` below, and `buildLabourPayloads`):
            // a value we do not have is not SENT, rather than sent as `undefined`.
            // A bare `manualDraft: buildManualDraft(log)` put the key on every
            // payload, including the voice ones — which is what B1a/B1c mean by
            // "byte-identical to what it sent before", and they read Object.keys.
            ...(manualDraft !== undefined && { manualDraft }),
            // B2.8 — carry the weather already captured at confirm-time to the server
            // (persisted into ssf.weather_stamps). Omit the client-only `id` (server generates).
            //
            // B1d — `plotId` is CONDITIONAL, by the same rule every other
            // optional field on this payload follows: a value we do not have is
            // not sent, rather than sent as `undefined`. A record naming a set
            // of plots (or संपूर्ण शेत) has one observed condition and no single
            // plot to record it against, and `weather_stamps.plot_id` is
            // `uuid NULL`, so absence is the shape the server already models.
            //
            // It is sent AS RECORDED and never repaired here. The producer
            // (`LogCommandServiceImpl.stampWeather`) is the one place that
            // decides, and it sets the field explicitly on every path — because
            // the weather clients fill it with `'farm'` / `'device'` /
            // `'unknown'`, and any of those reaching `ZGuid` would throw out of
            // `MutationQueue.enqueue` and cost the farmer the entire record.
            weatherStamp: log.weatherStamp
                ? {
                      ...(log.weatherStamp.plotId ? { plotId: log.weatherStamp.plotId } : {}),
                      timestampLocal: log.weatherStamp.timestampLocal,
                      timestampProvider: log.weatherStamp.timestampProvider,
                      provider: log.weatherStamp.provider,
                      tempC: log.weatherStamp.tempC,
                      humidity: log.weatherStamp.humidity,
                      windKph: log.weatherStamp.windKph,
                      precipMm: log.weatherStamp.precipMm,
                      cloudCoverPct: log.weatherStamp.cloudCoverPct,
                      conditionText: log.weatherStamp.conditionText,
                      iconCode: log.weatherStamp.iconCode,
                      rainProbNext6h: log.weatherStamp.rainProbNext6h,
                      windGustKph: log.weatherStamp.windGustKph,
                      soilMoistureVolumetric0To10: log.weatherStamp.soilMoistureVolumetric0To10,
                      uvIndex: log.weatherStamp.uvIndex,
                      alerts: log.weatherStamp.alerts,
                  }
                : undefined,
            // Labour V1 Task 8.1 — structured labour rides on the SAME payload as
            // the log so the server can stage it in Phase 1. Omitted (not `[]`)
            // when there is no labour, so the server's `Count: > 0` guard reads a
            // plainly absent array rather than an empty one.
            labour: labourPayloads.length > 0 ? labourPayloads : undefined,
        });

        const taskPayloads = buildTaskPayloads(log);
        for (const task of taskPayloads) {
            await AddLogTaskCommand.enqueue({
                dailyLogId: log.id,
                logTaskId: task.logTaskId,
                activityType: task.activityType,
                notes: task.notes,
                occurredAtUtc: task.occurredAtUtc,
            });
        }

        queuedLogIds.push(log.id);
    }

    if (triggerSync && queuedLogIds.length > 0) {
        await backgroundSyncWorker.triggerNow();
    }

    return {
        queuedLogIds,
        skippedLogIds,
    };
}
