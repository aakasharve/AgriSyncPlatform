using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// AI Intelligence Plan WP-2c (Track B) — parses an <see cref="AiJob"/>'s
/// <c>NormalizedResultJson</c> into typed <c>ssf</c> ledger rows and stages them
/// on <see cref="IShramSafalRepository"/> (no SaveChanges — the caller
/// <see cref="CreateDailyLogHandler"/> owns the commit). See
/// <see cref="ILedgerDerivationService"/> for the contract; this class holds the
/// wire-shape → Domain-factory mapping and the DerivedEventKey / supersession
/// logic.
///
/// <para>The wire shape is the canonical <c>AgriLogResponse</c>
/// (see <c>AgriLogResponseSchema.ts</c>): top-level <c>inputs</c>,
/// <c>irrigation</c>, <c>labour</c>, <c>machinery</c>, <c>observations</c>
/// arrays plus a single <c>disturbance</c> object. Every scalar read is
/// tolerant (missing / null → skipped or safe default); a malformed blob throws
/// nothing the caller doesn't already guard.</para>
/// </summary>
public sealed class LedgerDerivationService(IShramSafalRepository repository) : ILedgerDerivationService
{
    private static readonly JsonSerializerOptions ReadOptions = new(JsonSerializerDefaults.Web);

    public async Task<DerivationOutcome> DeriveAsync(
        DailyLog log, AiJob sourceJob, IIdGenerator ids, IClock clock,
        bool deriveLabour = true, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(sourceJob);

        // Reuse the SOURCE job's provenance (Source.Voice + real model/prompt
        // versions), never a fabricated parallel lineage (Global Constraint).
        var provenance = new Provenance(
            source: Source.Voice,
            modelVersion: sourceJob.Provenance.ModelVersion,
            promptVersion: sourceJob.Provenance.PromptVersion,
            promptContentHash: sourceJob.Provenance.PromptContentHash,
            appVersion: sourceJob.Provenance.AppVersion,
            extractorCodeSha: sourceJob.Provenance.ExtractorCodeSha);

        // Identity is scoped to the parse job: two logs confirmed from the SAME
        // voice parse share a lineage and must supersede one another per plot.
        //
        // Labour V1 Task 6.3 — deriveLabour is the CALLER's single-producer decision
        // and is carried through untouched to the shared body, where it gates the
        // labour branch and nothing else. This wrapper neither makes that decision
        // nor softens it.
        return await DeriveCoreAsync(
            log, sourceJob.NormalizedResultJson, provenance, sourceJob.Id, ids, clock,
            deriveLabour, ct);
    }

    public Task<DerivationOutcome> DeriveFromManualDraftAsync(
        DailyLog log, string manualWireJson, string? appVersion,
        IIdGenerator ids, IClock clock, bool deriveLabour, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(log);

        // spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b). No AI
        // touched these rows, so their lineage says so and keeps saying so: source
        // "manual", model/prompt the canonical "n/a" placeholders, no prompt hash,
        // no extractor SHA. Doctrine P8 — a hand-typed figure must stay
        // distinguishable from an inferred one, forever. Deliberately NOT a
        // fabricated AiJob row: an ai_jobs record for something no AI produced
        // would itself be the lie.
        var provenance = Provenance.Manual(appVersion ?? "unknown");

        // The DETERMINISTIC source id. For voice the identity anchor is the parse
        // job; for a typed day the anchor is the LOG itself — it is where the facts
        // came from, and it is stable across re-saves, so a second derivation of
        // the same log recomputes the same DerivedEventKey and SUPERSEDES rather
        // than duplicating the farmer's single application.
        // Labour V2 R1 Task 2 — the single-producer decision is the CALLER's here too,
        // and is carried through untouched. It used to be hardcoded `true` on the
        // reasoning that the draft's own labour[] was this call's only source of labour
        // rows, so there was nothing here to be a second producer OF. That was true of
        // this call and false of the request: the manual client builds BOTH arrays from
        // one list (`buildManualDraft` sets `draft.labour = log.labour`;
        // `buildLabourPayloads` maps the same `log.labour`), so the handler had already
        // staged those rows as canonical Phase-1 data before reaching here, and this
        // call added a second row for the same engagement — carrying the eight-hour
        // server assumption over a duration the farmer had stated outright.
        return DeriveCoreAsync(
            log, manualWireJson, provenance, log.Id, ids, clock,
            deriveLabour, ct);
    }

    /// <summary>
    /// The one persistence body, shared by the voice and manual paths. Takes the wire
    /// JSON to read, the provenance to stamp, and the deterministic source id that
    /// anchors every <see cref="DerivedEventKey"/> — nothing else differs between the
    /// two callers, which is precisely why there is no second writer.
    /// </summary>
    /// <param name="deriveLabour">
    /// Labour V1 Task 6.3 — the SINGLE-PRODUCER guard, gating the labour branch and
    /// ONLY the labour branch. Required (no default) so neither caller can acquire
    /// this behaviour by omission.
    /// </param>
    private async Task<DerivationOutcome> DeriveCoreAsync(
        DailyLog log, string? wireJson, Provenance provenance, Guid sourceId,
        IIdGenerator ids, IClock clock, bool deriveLabour, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(ids);
        ArgumentNullException.ThrowIfNull(clock);

        if (string.IsNullOrWhiteSpace(wireJson))
        {
            return default;
        }

        using var doc = JsonDocument.Parse(wireJson);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        // An observation with no explicit source belongs to whatever produced this
        // derivation. Defaulting a hand-typed note to "voice" would misattribute it.
        var observationFallback = provenance.Source == Source.Manual
            ? ObservationSource.Manual
            : ObservationSource.Voice;

        var now = clock.UtcNow;
        var operations = 0;
        var children = 0;

        // LABOUR_PHASE2 P2.3 (landmine L8) — read the SCOPE once, here, instead
        // of letting every downstream call inherit whatever `log.PlotId`
        // happens to be. `log.PlotId` is null for BOTH MultiPlot and Farm, and
        // the two sinks below read a null plot in opposite ways. See
        // DerivedPlotScope / RoutineIsRepresentableForScope.
        var derivedPlotScope = DerivedPlotScope(log);

        // ── inputs → FarmOperation(application) + ApplicationInputItem children ──
        if (root.TryGetProperty("inputs", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
        {
            var ordinal = 0;
            foreach (var input in inputs.EnumerateArray())
            {
                var span = SpanInput(input, "input", ordinal);
                // Multi-plot fix: fold the plot scope into the derived identity so
                // two DailyLogs for two DIFFERENT plots that share one SourceAiJobId
                // (the mobile one-log-per-plot flow) don't collide on
                // (farm_id, derived_event_key) and silently supersede each other.
                // The scope is the log's plot (stable across re-confirms of the SAME
                // plot), so a same-plot offline re-confirm still recomputes the same
                // key and supersedes as intended. LABOUR_PHASE2 P2.3: for a
                // plot-less log the scope is null and folds in as the empty
                // string — see DerivedPlotScope for why that is a deliberate
                // reading and what it costs.
                var key = DerivedEventKey.Compute(sourceId, derivedPlotScope, span, "input");

                var opId = ids.New();
                var op = FarmOperation.Create(
                    id: opId,
                    farmId: log.FarmId,
                    plotId: derivedPlotScope,
                    operationType: "application",
                    operationDate: log.LogDate,
                    sourceDailyLogId: log.Id,
                    derivedEventKey: key,
                    createdByUserId: log.OperatorUserId,
                    provenance: provenance,
                    createdAtUtc: now);

                // Supersession (D2): supersede-or-no-op, never a second current row.
                //
                // Fix F1 — WRITE ORDERING against the non-deferrable partial unique
                // index ix_farm_operations_current_key (WHERE is_current_version).
                // On an offline RE-CONFIRM the same DerivedEventKey recomputes, so we
                // MarkSuperseded (UPDATE old is_current_version=false) then Add the new
                // current row (INSERT is_current_version=true). Both touch the same
                // partial-unique index. If EF batched them and emitted the INSERT
                // BEFORE the UPDATE, Postgres would transiently see two current rows
                // for the key → 23505 → the whole tx aborts and the farmer's log is
                // lost. Flushing the UPDATE with its own SaveChanges BEFORE staging
                // the INSERT guarantees the DB never holds two current rows for the
                // key at any instant, so the supersession path can NEVER raise 23505.
                var existing = await repository.GetFarmOperationByKeyAsync(key.Value, ct);
                if (existing is not null && existing.IsCurrentVersion)
                {
                    existing.MarkSuperseded(opId, now);
                    await repository.SaveChangesAsync(ct); // flush UPDATE before the INSERT
                }

                await repository.AddFarmOperationAsync(op, ct);
                operations++;

                var productType = ReadString(input, "type"); // legacy fertilizer/pesticide/…
                var mixOrdinal = 0;
                var hasMix = input.TryGetProperty("mix", out var mix) && mix.ValueKind == JsonValueKind.Array;
                if (hasMix)
                {
                    foreach (var item in mix.EnumerateArray())
                    {
                        var productName = ReadString(item, "productName");
                        if (string.IsNullOrWhiteSpace(productName))
                        {
                            continue; // ApplicationInputItem requires a non-blank product name.
                        }

                        // wave-3.12 — how sure he was of THIS dose. The mix item's own
                        // "numbers" wins; otherwise the parent input's map covers its mix.
                        var doseFact = ReadNumericFactWithParent(item, input, "dose");

                        var child = ApplicationInputItem.Create(
                            id: ids.New(),
                            operationId: opId,
                            productName: productName!,
                            productType: productType,
                            npkGrade: ReadString(item, "npkGrade"),
                            // P4 — "आठवत नाही" carries no number, so none is read and none is
                            // invented. The certainty column is where the unknown lives.
                            doseAmount: ReadDecimal(item, "dose"),
                            doseUnit: ReadString(item, "unit"),
                            doseBasisQty: ReadDecimal(item, "basisQty"),
                            doseBasisUnit: ReadString(item, "basisUnit"),
                            ordinal: mixOrdinal,
                            createdAtUtc: now,
                            doseCertainty: ReadCertainty(doseFact),
                            doseSpokenText: ReadSpokenText(doseFact));
                        await repository.AddApplicationInputItemAsync(child, ct);
                        children++;
                        mixOrdinal++;
                    }
                }

                // Legacy TOP-LEVEL shape (still supported): productName/quantity/unit
                // stated directly on the input, no `mix` array (or an empty one). The
                // parent FarmOperation was created above; without this branch the
                // product/dose would be dropped (no ApplicationInputItem child). Emit
                // one child from the legacy fields. Guarded on !hasMix-produced-a-child
                // so we never DOUBLE-create when a `mix` is present.
                if (mixOrdinal == 0)
                {
                    var legacyProductName = ReadString(input, "productName");
                    if (!string.IsNullOrWhiteSpace(legacyProductName))
                    {
                        var legacyChild = ApplicationInputItem.Create(
                            id: ids.New(),
                            operationId: opId,
                            productName: legacyProductName!,
                            productType: productType,
                            npkGrade: ReadString(input, "npkGrade"),
                            // legacy top-level dose: `quantity` is the canonical field,
                            // `dose` is the tolerant fallback (mirrors the mix item).
                            doseAmount: ReadDecimal(input, "quantity") ?? ReadDecimal(input, "dose"),
                            doseUnit: ReadString(input, "unit"),
                            doseBasisQty: ReadDecimal(input, "basisQty"),
                            doseBasisUnit: ReadString(input, "basisUnit"),
                            ordinal: 0,
                            createdAtUtc: now,
                            // wave-3.12 — the legacy shape states its dose on the input row,
                            // so its certainty is read from that same row.
                            doseCertainty: ReadCertainty(ReadNumericFact(input, "dose")),
                            doseSpokenText: ReadSpokenText(ReadNumericFact(input, "dose")));
                        await repository.AddApplicationInputItemAsync(legacyChild, ct);
                        children++;
                    }
                }

                ordinal++;
            }
        }

        // ── irrigation → IrrigationEntry (daily_logs child) ────────────────────
        // First derived irrigation entry per (farm, plot, "irrigation") also seeds
        // the RoutineMemory upsert below (WP-2d / D5).
        var irrigationRoutine = default(RoutineSeed?);
        if (root.TryGetProperty("irrigation", out var irrigation) && irrigation.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in irrigation.EnumerateArray())
            {
                var method = ReadString(item, "method");
                var srcSpoken = ReadString(item, "source");
                var duration = ReadDecimal(item, "durationHours");

                var entry = IrrigationEntry.Create(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    role: MapIrrigationRole(ReadString(item, "role")),
                    weatherAdjusted: ReadBool(item, "weatherAdjusted") ?? false,
                    method: method,
                    source: srcSpoken,
                    durationHours: duration,
                    waterVolumeLitres: ReadDecimal(item, "waterVolumeLitres"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now,
                    // wave-3.12 — how sure he was of the WATER.
                    waterCertainty: ReadCertainty(ReadNumericFact(item, "waterVolumeLitres")),
                    waterSpokenText: ReadSpokenText(ReadNumericFact(item, "waterVolumeLitres")));
                await repository.AddIrrigationEntryAsync(entry, ct);
                children++;

                // Seed the routine from the FIRST irrigation entry in this log
                // (one log rarely restates the same op-type; running-consistency
                // is achieved across logs by Reinforce, not within one).
                irrigationRoutine ??= new RoutineSeed(duration, method, srcSpoken);
            }
        }

        // ── labour → LabourAssignment (daily_logs child) ───────────────────────
        // Labour V1 Task 6.3 — SINGLE PRODUCER. `deriveLabour` is false exactly
        // when the confirm carried structured labour[], which the handler has
        // already staged as CANONICAL Phase-1 rows. Deriving again here would
        // record one real engagement twice. Note the guard is on THIS branch only:
        // every other family below (and the inputs/irrigation above) still derives,
        // so a voice confirm that also carries manual labour keeps its full ledger.
        if (deriveLabour
            && root.TryGetProperty("labour", out var labour) && labour.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in labour.EnumerateArray())
            {
                // ONE shared construction site (Labour V1 Task 3) — the manual
                // path added in Task 6 goes through the same factory so the same
                // engagement can never be recorded two ways.
                var assignment = LabourAssignmentFactory.FromParsed(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    engagementType: LabourAssignmentFactory.MapLabourEngagement(ReadString(item, "engagementType"), ReadString(item, "type")),
                    maleCount: ReadInt(item, "maleCount"),
                    femaleCount: ReadInt(item, "femaleCount"),
                    workerCount: ReadInt(item, "count"),
                    // rate spoken lands on WagePerPerson; new `rate` wins, legacy
                    // `wagePerPerson` is the fallback.
                    wagePerPerson: ReadDecimal(item, "rate") ?? ReadDecimal(item, "wagePerPerson"),
                    contractUnit: LabourAssignmentFactory.MapContractUnit(ReadString(item, "contractUnit")),
                    contractQuantity: ReadDecimal(item, "contractQuantity"),
                    // NO-MULTIPLY (D3): only an EXPLICIT stated total — never rate × count.
                    totalCost: ReadDecimal(item, "totalCost"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now,
                    // Task 4: the model emits no duration key (A5/outputContract.md) — every
                    // voice-derived row is honestly Assumed, never a fabricated Explicit.
                    time: LabourTime.ServerAssumed(),
                    // Descriptive only (Task 2.3) — never touch money above.
                    shift: LabourAssignmentFactory.MapLabourShift(ReadString(item, "shift")),
                    task: ReadTrimmedString(item, "activity"),
                    // FOUNDER RULING 2026-08-31 — "names marked here means
                    // attendance + identity recorded". This reader existed and
                    // had never once received anything: it read "whoWorked",
                    // which the CLIENT contract defines as an ENUM
                    // (OWNER|OPERATOR|HIRED_LABOUR|UNKNOWN), and the prompt
                    // never emitted it in any shape. ReadStringArray on a
                    // string returns null, so WorkerNamesJson defaulted to "[]"
                    // for every labour row ever written. The prompt now emits
                    // an unambiguous `workerNames` array; `whoWorked` stays as a
                    // fallback only so an older stored AiJob still resolves the
                    // same way it did (namely: to null).
                    workerNames: ReadStringArray(item, "workerNames") ?? ReadStringArray(item, "whoWorked"),
                    // wave-3.12 — how sure he was of the COST. Keyed on "totalCost", the
                    // sibling number it qualifies, so a farmer vague about the wage and
                    // exact about the dose is recorded as exactly that.
                    // RESTORED: the main merge took main's LabourAssignment and dropped
                    // this pair, so "मजुरीचा खर्च अंदाजे ५०००" rode the wire, passed the
                    // normalizer, and had nowhere to land — discarded with no error (P10).
                    // CostEntry.Create throws on amount <= 0, so an unknown cost has
                    // nowhere else honest to live.
                    costCertainty: ReadCertainty(ReadNumericFact(item, "totalCost")),
                    costSpokenText: ReadSpokenText(ReadNumericFact(item, "totalCost")));
                await repository.AddLabourAssignmentAsync(assignment, ct);
                children++;
            }
        }

        // ── machinery → MachineryUsage (daily_logs child) ──────────────────────
        if (root.TryGetProperty("machinery", out var machinery) && machinery.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in machinery.EnumerateArray())
            {
                var usage = MachineryUsage.Create(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    machineType: MapMachineType(ReadString(item, "type")),
                    ownership: MapOwnership(ReadString(item, "ownership")),
                    hoursUsed: ReadDecimal(item, "hoursUsed"),
                    rentalCost: ReadDecimal(item, "rentalCost"),
                    fuelCost: ReadDecimal(item, "fuelCost"),
                    implement: ReadString(item, "implement"),
                    nozzlesActive: ReadInt(item, "nozzlesActive"),
                    fanState: MapFanState(ReadString(item, "fanState")), // null when absent (no "Unknown" fabrication)
                    fuelType: ReadString(item, "fuelType"),
                    fuelQuantity: ReadDecimal(item, "fuelQuantity"),
                    operationPerformed: ReadString(item, "operationPerformed"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now);
                await repository.AddMachineryUsageAsync(usage, ct);
                children++;
            }
        }

        // ── observations → ObservationEvent (daily_logs child) ─────────────────
        if (root.TryGetProperty("observations", out var observations) && observations.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in observations.EnumerateArray())
            {
                var textRaw = ReadString(item, "textRaw");
                if (string.IsNullOrWhiteSpace(textRaw))
                {
                    continue; // ObservationEvent requires the load-bearing free-text.
                }

                var observation = ObservationEvent.Create(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    plotId: ReadGuid(item, "plotId"),
                    noteType: MapNoteType(ReadString(item, "noteType")),
                    severity: MapObservationSeverity(ReadString(item, "severity")),
                    source: MapObservationSource(ReadString(item, "source"), observationFallback),
                    textRaw: textRaw!,
                    textCleaned: ReadString(item, "textCleaned"),
                    tagsJson: ReadRawArray(item, "tags"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now);
                await repository.AddObservationEventAsync(observation, ct);
                children++;
            }
        }

        // ── disturbance → DisturbanceEvent (single object, daily_logs child) ────
        if (root.TryGetProperty("disturbance", out var disturbance) && disturbance.ValueKind == JsonValueKind.Object)
        {
            var reason = ReadString(disturbance, "reason");
            if (!string.IsNullOrWhiteSpace(reason))
            {
                // Labour V2 R1 Task 8.5 — the same dedup discipline the inputs
                // branch has above (DerivedEventKey lookup-before-write), adapted
                // to this child's shape.
                //
                // FarmOperation stores a hashed key because its identity span (the
                // raw transcript text) is not a column. A disturbance's derived
                // identity is (farm, log-day, reason) — and every component is
                // already persisted: farm and day on the parent daily_logs row,
                // the reason on the event itself. So the lookup-before-write idiom
                // carries over with no key column and no migration: the query IS
                // the key.
                //
                // The identity is the DAY, not the parse or the log, deliberately.
                // The labour door (attendance-only draft — Task 6 preserves its
                // disturbance) and the regular door produce TWO logs, hence two
                // source ids, for one farm-day; "पाऊस आला" recorded through both
                // doors is one fact, not two. A DIFFERENT reason is a different
                // identity and stays a second live event: dedup collapses
                // identical derivations, never distinct facts.
                //
                // On a hit we SKIP where FarmOperation SUPERSEDES — not an
                // oversight. This EXISTS-join child has no version chain (no
                // is_current_version / superseded_by), so "mark old superseded,
                // insert new" is unrepresentable, and mutating or deleting the
                // OTHER door's child would falsify its lineage (daily_log_id
                // naming log A with content from log B). The half of the
                // FarmOperation semantics that guards day truth — never a second
                // live row for one identity — is exactly what skip preserves, and
                // the identity contains the entire load-bearing free-text, so a
                // skipped second arrival loses no farmer words.
                //
                // The failure mode stays LOUD: no catch here. A thrown lookup or
                // write error propagates to PersistSideCarAsync's savepoint
                // isolation exactly as every other derivation write's does.
                var trimmedReason = reason!.Trim(); // the entity-stored form (DisturbanceEvent.Create trims)
                var existingDisturbance = await repository.GetDisturbanceEventForFarmDayAsync(
                    log.FarmId.Value, log.LogDate, trimmedReason, ct);
                if (existingDisturbance is null)
                {
                    var evt = DisturbanceEvent.Create(
                        id: ids.New(),
                        dailyLogId: log.Id,
                        scope: MapDisturbanceScope(ReadString(disturbance, "scope")),
                        reason: reason!,
                        severity: MapDisturbanceSeverity(ReadString(disturbance, "severity")),
                        blockedSegmentsJson: ReadRawArray(disturbance, "blockedSegments"),
                        weatherEventId: ReadGuid(disturbance, "weatherEventId"),
                        createdAtUtc: now,
                        cause: MapDisturbanceCause(ReadString(disturbance, "cause")),
                        affectedScope: MapAffectedScope(ReadString(disturbance, "affectedScope")),
                        impact: ReadString(disturbance, "impact"),
                        resolvedStatus: MapResolvedStatus(ReadString(disturbance, "resolvedStatus")));
                    await repository.AddDisturbanceEventAsync(evt, ct);
                    children++;
                }
            }
        }

        // ── RoutineMemory upsert (WP-2d / D5) ──────────────────────────────────
        // Rides THIS derivation transaction: a confirmed irrigation creates-or-
        // reinforces routine_patterns(farmId, plotId, "irrigation"). Keyed on
        // farm+plot+op-type → idempotent under replay (sync replay is idempotency-
        // keyed upstream, so a replayed mutation never re-enters this path and
        // won't double-count). POPULATE only — the "नेहमी प्रमाणे" read is deferred.
        //
        // LABOUR_PHASE2 P2.3 (L8) — NOT every scope can be written here. A
        // MultiPlot log is skipped, deliberately and visibly; see
        // RoutineIsRepresentableForScope.
        if (irrigationRoutine is RoutineSeed seed && RoutineIsRepresentableForScope(log.Scope))
        {
            await UpsertRoutineAsync(
                log.FarmId, derivedPlotScope, "irrigation", seed, ids, now, ct);
        }

        return new DerivationOutcome(operations, children);
    }

    /// <summary>
    /// LABOUR_PHASE2 P2.3 — the plot that this log's DERIVED rows are allowed to
    /// name, decided from <see cref="DailyLog.Scope"/> rather than inherited from
    /// a nullable <see cref="DailyLog.PlotId"/>.
    ///
    /// <list type="bullet">
    /// <item><b>Plot</b> — the single plot the farmer named. Byte-identical to
    /// the pre-Phase-2 behaviour, which matters: <c>farm_operations</c> rows
    /// already in the database carry <see cref="DerivedEventKey"/>s computed
    /// from this value, and changing it would stop an offline re-confirm
    /// superseding its own earlier row.</item>
    /// <item><b>MultiPlot</b> — null, because <c>farm_operations</c> has one
    /// nullable <c>plot_id</c> and no plot-set column. Null here is LOSSY (the
    /// named subset is not carried) but it is not FALSE: it says "no single
    /// plot", not "the whole farm". The true scope stays recoverable from
    /// <c>farm_operations.source_daily_log_id → daily_logs.plot_ids</c>.
    /// Picking the first plot, or writing one operation per plot, are the two
    /// fabrications founder decision O-1 closed.</item>
    /// <item><b>Farm</b> — null, and here null is the whole truth: the farmer
    /// named no plot.</item>
    /// </list>
    /// </summary>
    private static Guid? DerivedPlotScope(DailyLog log) => log.Scope switch
    {
        DailyLogScope.Plot => log.PlotId,
        DailyLogScope.MultiPlot => null,
        DailyLogScope.Farm => null,
        _ => null,
    };

    /// <summary>
    /// LABOUR_PHASE2 P2.3 — whether a <c>routine_patterns</c> row may be written
    /// for a log of this scope. This is the sink where a null plot means
    /// something DIFFERENT from what it means everywhere else, so it gets its
    /// own explicit rule instead of inheriting <see cref="DerivedPlotScope"/>.
    ///
    /// <para><c>routine_patterns.plot_id IS NULL</c> is not "unknown plot" — it
    /// is a positive claim, spelled out at <c>RoutinePattern.cs:49</c>: <i>"null
    /// = farm-wide pattern"</i>, and enforced as such by the partial unique
    /// index <c>ux_routine_patterns_farm_op_no_plot</c>. So:</para>
    ///
    /// <list type="bullet">
    /// <item><b>Plot</b> — write it against that plot. Unchanged.</item>
    /// <item><b>Farm</b> — write it with a null plot. The farmer's assertion
    /// was farm-wide and the column's null means farm-wide; the two agree.</item>
    /// <item><b>MultiPlot</b> — SKIP. Passing null would upgrade "these two
    /// plots" into "the whole farm" — a claim about plots the farmer never
    /// named, on a row whose whole purpose is to be replayed back to him as
    /// "नेहमी प्रमाणे". Fanning out to one row per plot is the other direction of
    /// the same fault: it would take ONE stated duration and assert it
    /// individually of each plot, and would count one log as N samples in
    /// <see cref="RoutinePattern.SampleCount"/>. Representing a
    /// named-subset routine needs a schema that can hold a plot SET, which is a
    /// separate decision on a separate table.</item>
    /// </list>
    ///
    /// <para>Nothing is lost that a farmer can see: <c>routine_patterns</c> is
    /// populate-only today (the "नेहमी प्रमाणे" read is deferred), and the
    /// underlying irrigation entries are still written for every scope by the
    /// block above — only the derived <i>pattern</i> is withheld.</para>
    /// </summary>
    private static bool RoutineIsRepresentableForScope(DailyLogScope scope)
        => scope is DailyLogScope.Plot or DailyLogScope.Farm;

    // Create-or-reinforce the routine_patterns row for one (farm, plot, op-type).
    private async Task UpsertRoutineAsync(
        Guid farmId, Guid? plotId, string operationType, RoutineSeed seed,
        IIdGenerator ids, DateTime now, CancellationToken ct)
    {
        var existing = await repository.GetRoutinePatternAsync(farmId, plotId, operationType, ct);
        if (existing is not null)
        {
            existing.Reinforce(seed.DurationHours, seed.Method, seed.Source, now);
            return;
        }

        var pattern = RoutinePattern.Create(
            id: ids.New(),
            farmId: farmId,
            plotId: plotId,
            operationType: operationType,
            typicalDurationHours: seed.DurationHours,
            typicalMethod: seed.Method,
            typicalSource: seed.Source,
            sampleCount: 1,
            createdAtUtc: now,
            updatedAtUtc: now);
        await repository.AddRoutinePatternAsync(pattern, ct);
    }

    // Typical fields lifted from the first derived entry of an op-type in a log.
    private readonly record struct RoutineSeed(decimal? DurationHours, string? Method, string? Source);

    // ── DerivedEventKey span (D2) ──────────────────────────────────────────────
    // sourceText when present-and-non-blank, else "<eventType>#<ordinal>".
    private static string SpanInput(JsonElement item, string eventType, int ordinal)
    {
        var sourceText = ReadString(item, "sourceText");
        return string.IsNullOrWhiteSpace(sourceText) ? $"{eventType}#{ordinal}" : sourceText!;
    }

    // ── tolerant scalar readers ────────────────────────────────────────────────
    // ── wave-3.12, spec Ruling 5 — the per-number certainty map ──────────────
    //
    // Wire shape, beside the number it qualifies:
    //   "numbers": { "dose": { "certainty": "approximate", "spokenText": "अंदाजे ५०० मिली" } }
    //
    // The KEY names the sibling numeric field ("dose", "totalCost",
    // "waterVolumeLitres"), so certainty belongs to each NUMBER and not to the log: a
    // farmer can be exact about the wage and vague about the dose in one sentence.
    //
    // Doctrine P8 — certainty is a DIFFERENT AXIS from provenance and is never folded
    // into it. Doctrine P4 — an unreadable or absent map yields NULL, never Reported: a
    // number nobody asked about must not come back claiming he was sure of it.

    /// <summary>The <c>numbers.&lt;key&gt;</c> object, or <c>default</c> when absent.</summary>
    private static JsonElement ReadNumericFact(JsonElement el, string key)
        => el.ValueKind == JsonValueKind.Object
           && el.TryGetProperty("numbers", out var numbers)
           && numbers.ValueKind == JsonValueKind.Object
           && numbers.TryGetProperty(key, out var fact)
           && fact.ValueKind == JsonValueKind.Object
            ? fact
            : default;

    private static NumericCertainty? ReadCertainty(JsonElement fact)
        => fact.ValueKind != JsonValueKind.Object ? null : Norm(ReadString(fact, "certainty")) switch
        {
            "reported" => NumericCertainty.Reported,
            "approximate" => NumericCertainty.Approximate,
            "unknown" => NumericCertainty.Unknown,
            // An unrecognised word is NOT quietly read as Reported — that would invent
            // confidence the farmer never expressed.
            _ => null,
        };

    /// <summary>His own words for the number. Trimmed, never synthesised.</summary>
    private static string? ReadSpokenText(JsonElement fact)
    {
        if (fact.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var text = ReadString(fact, "spokenText");
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    /// <summary>
    /// The fact for <paramref name="key"/> on <paramref name="row"/>, falling back to
    /// <paramref name="parent"/>. The mix item's own certainty wins; a map stated once on
    /// the parent input covers its mix, which is the shape the manual-entry screen builds
    /// (the dose lives on the mix item, the qualifier on the row the farmer edited).
    /// </summary>
    private static JsonElement ReadNumericFactWithParent(JsonElement row, JsonElement parent, string key)
    {
        var own = ReadNumericFact(row, key);
        return own.ValueKind == JsonValueKind.Object ? own : ReadNumericFact(parent, key);
    }

    private static string? ReadString(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static decimal? ReadDecimal(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)
            ? d
            : null;

    private static int? ReadInt(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)
            ? i
            : null;

    private static bool? ReadBool(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean()
            : null;

    private static Guid? ReadGuid(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            && Guid.TryParse(v.GetString(), out var g)
            ? g
            : null;

    // Preserve a JSON array (tags / blockedSegments) as its raw serialized form
    // for the *Json columns; null when absent or empty.
    private static string? ReadRawArray(JsonElement el, string prop)
        => el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Array && v.GetArrayLength() > 0
            ? v.GetRawText()
            : null;

    // Like ReadString, but trims and normalizes blank-after-trim to null
    // (e.g. labour "activity" — the spoken task). Case/script preserved
    // (Devanagari), unlike Norm() which lowercases for enum matching.
    private static string? ReadTrimmedString(JsonElement el, string prop)
    {
        var s = ReadString(el, prop);
        return string.IsNullOrWhiteSpace(s) ? null : s!.Trim();
    }

    // Reads a JSON array of strings (labour "whoWorked" — names as stated) into
    // a plain list; blank entries dropped, null when absent/empty so
    // LabourAssignment.Create's own "[]" default applies.
    private static IReadOnlyList<string>? ReadStringArray(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var names = new List<string>();
        foreach (var entry in v.EnumerateArray())
        {
            if (entry.ValueKind == JsonValueKind.String)
            {
                var name = entry.GetString();
                if (!string.IsNullOrWhiteSpace(name))
                {
                    names.Add(name!);
                }
            }
        }

        return names.Count == 0 ? null : names;
    }

    // ── tolerant string → enum maps (safe default; never throw) ────────────────
    private static IrrigationRole MapIrrigationRole(string? s) => Norm(s) switch
    {
        "spray-carrier" or "spraycarrier" or "spray_carrier" => IrrigationRole.SprayCarrier,
        "fertigation" => IrrigationRole.Fertigation,
        _ => IrrigationRole.Irrigation,
    };

    // The three labour maps (MapLabourEngagement / MapLabourShift / MapContractUnit)
    // moved to LabourAssignmentFactory in Labour V1 Task 3 — the manual entry path
    // needs the same wire-string → enum mapping. They are still called from the
    // labour block above, now as LabourAssignmentFactory.Map…; behaviour unchanged.

    private static MachineType MapMachineType(string? s) => Norm(s) switch
    {
        "tractor" => MachineType.Tractor,
        "tiller" => MachineType.Tiller,
        "harvester" => MachineType.Harvester,
        "drone" => MachineType.Drone,
        "sprayer" => MachineType.Sprayer,
        _ => MachineType.Unknown,
    };

    private static Ownership MapOwnership(string? s) => Norm(s) switch
    {
        "owned" => Ownership.Owned,
        "rented" => Ownership.Rented,
        _ => Ownership.Unknown,
    };

    // Null when absent / "unknown" — no "Unknown" fabrication (D3).
    private static FanState? MapFanState(string? s) => Norm(s) switch
    {
        "on" => FanState.On,
        "off" => FanState.Off,
        _ => null,
    };

    private static ObservationNoteType MapNoteType(string? s) => Norm(s) switch
    {
        "observation" => ObservationNoteType.Observation,
        "issue" => ObservationNoteType.Issue,
        "tip" => ObservationNoteType.Tip,
        "reminder" => ObservationNoteType.Reminder,
        _ => ObservationNoteType.Unknown,
    };

    private static ObservationSeverity MapObservationSeverity(string? s) => Norm(s) switch
    {
        "important" => ObservationSeverity.Important,
        "urgent" => ObservationSeverity.Urgent,
        _ => ObservationSeverity.Normal,
    };

    // An EXPLICIT source in the blob always wins. When the row states none, the
    // fallback is whichever pipeline is running this derivation — voice for an AiJob,
    // manual for a typed draft. Hardcoding Voice here used to be safe (only voice jobs
    // derived) and became a misattribution the moment manual drafts did too.
    private static ObservationSource MapObservationSource(string? s, ObservationSource fallback) => Norm(s) switch
    {
        "manual" => ObservationSource.Manual,
        "voice" => ObservationSource.Voice,
        _ => fallback,
    };

    private static DisturbanceScope MapDisturbanceScope(string? s) => Norm(s) switch
    {
        "partial" => DisturbanceScope.Partial,
        "delayed" => DisturbanceScope.Delayed,
        _ => DisturbanceScope.FullDay, // FULL_DAY + default
    };

    private static DisturbanceSeverity? MapDisturbanceSeverity(string? s) => Norm(s) switch
    {
        "low" => DisturbanceSeverity.Low,
        "medium" => DisturbanceSeverity.Medium,
        "high" => DisturbanceSeverity.High,
        _ => null,
    };

    private static DisturbanceCause? MapDisturbanceCause(string? s) => Norm(s) switch
    {
        "machinery" => DisturbanceCause.Machinery,
        "electricity" => DisturbanceCause.Electricity,
        "weather" => DisturbanceCause.Weather,
        "water_source" or "watersource" => DisturbanceCause.WaterSource,
        "pest" => DisturbanceCause.Pest,
        "disease" => DisturbanceCause.Disease,
        "labor_shortage" or "labour_shortage" => DisturbanceCause.LabourShortage,
        "material_shortage" => DisturbanceCause.MaterialShortage,
        "other" => DisturbanceCause.Other,
        _ => null,
    };

    private static AffectedScope? MapAffectedScope(string? s) => Norm(s) switch
    {
        "event" => Domain.Farms.AffectedScope.Event,
        "bucket" => Domain.Farms.AffectedScope.Bucket,
        "whole_day" or "wholeday" => Domain.Farms.AffectedScope.WholeDay,
        _ => null,
    };

    private static ResolvedStatus? MapResolvedStatus(string? s) => Norm(s) switch
    {
        "ongoing" => ResolvedStatus.Ongoing,
        "resolved_same_day" or "resolvedsameday" => ResolvedStatus.ResolvedSameDay,
        "carried_over" or "carriedover" => ResolvedStatus.CarriedOver,
        _ => null,
    };

    private static string? Norm(string? s)
        => string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToLowerInvariant();
}
