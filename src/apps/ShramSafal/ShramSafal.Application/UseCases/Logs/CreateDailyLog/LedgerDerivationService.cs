using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
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
        DailyLog log, AiJob sourceJob, IIdGenerator ids, IClock clock, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(log);
        ArgumentNullException.ThrowIfNull(sourceJob);
        ArgumentNullException.ThrowIfNull(ids);
        ArgumentNullException.ThrowIfNull(clock);

        if (string.IsNullOrWhiteSpace(sourceJob.NormalizedResultJson))
        {
            return default;
        }

        using var doc = JsonDocument.Parse(sourceJob.NormalizedResultJson);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return default;
        }

        // Reuse the SOURCE job's provenance (Source.Voice + real model/prompt
        // versions), never a fabricated parallel lineage (Global Constraint).
        var provenance = new Provenance(
            source: Source.Voice,
            modelVersion: sourceJob.Provenance.ModelVersion,
            promptVersion: sourceJob.Provenance.PromptVersion,
            promptContentHash: sourceJob.Provenance.PromptContentHash,
            appVersion: sourceJob.Provenance.AppVersion,
            extractorCodeSha: sourceJob.Provenance.ExtractorCodeSha);

        var now = clock.UtcNow;
        var operations = 0;
        var children = 0;

        // ── inputs → FarmOperation(application) + ApplicationInputItem children ──
        if (root.TryGetProperty("inputs", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
        {
            var ordinal = 0;
            foreach (var input in inputs.EnumerateArray())
            {
                var span = SpanInput(input, "input", ordinal);
                var key = DerivedEventKey.Compute(sourceJob.Id, span, "input");

                var opId = ids.New();
                var op = FarmOperation.Create(
                    id: opId,
                    farmId: log.FarmId,
                    plotId: log.PlotId,
                    operationType: "application",
                    operationDate: log.LogDate,
                    sourceDailyLogId: log.Id,
                    derivedEventKey: key,
                    createdByUserId: log.OperatorUserId,
                    provenance: provenance,
                    createdAtUtc: now);

                // Supersession (D2): supersede-or-no-op, never a second current row.
                var existing = await repository.GetFarmOperationByKeyAsync(key.Value, ct);
                if (existing is not null && existing.IsCurrentVersion)
                {
                    existing.MarkSuperseded(opId, now);
                }

                await repository.AddFarmOperationAsync(op, ct);
                operations++;

                var productType = ReadString(input, "type"); // legacy fertilizer/pesticide/…
                var mixOrdinal = 0;
                if (input.TryGetProperty("mix", out var mix) && mix.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in mix.EnumerateArray())
                    {
                        var productName = ReadString(item, "productName");
                        if (string.IsNullOrWhiteSpace(productName))
                        {
                            continue; // ApplicationInputItem requires a non-blank product name.
                        }

                        var child = ApplicationInputItem.Create(
                            id: ids.New(),
                            operationId: opId,
                            productName: productName!,
                            productType: productType,
                            npkGrade: ReadString(item, "npkGrade"),
                            doseAmount: ReadDecimal(item, "dose"),
                            doseUnit: ReadString(item, "unit"),
                            doseBasisQty: ReadDecimal(item, "basisQty"),
                            doseBasisUnit: ReadString(item, "basisUnit"),
                            ordinal: mixOrdinal,
                            createdAtUtc: now);
                        await repository.AddApplicationInputItemAsync(child, ct);
                        children++;
                        mixOrdinal++;
                    }
                }

                ordinal++;
            }
        }

        // ── irrigation → IrrigationEntry (daily_logs child) ────────────────────
        if (root.TryGetProperty("irrigation", out var irrigation) && irrigation.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in irrigation.EnumerateArray())
            {
                var entry = IrrigationEntry.Create(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    role: MapIrrigationRole(ReadString(item, "role")),
                    weatherAdjusted: ReadBool(item, "weatherAdjusted") ?? false,
                    method: ReadString(item, "method"),
                    source: ReadString(item, "source"),
                    durationHours: ReadDecimal(item, "durationHours"),
                    waterVolumeLitres: ReadDecimal(item, "waterVolumeLitres"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now);
                await repository.AddIrrigationEntryAsync(entry, ct);
                children++;
            }
        }

        // ── labour → LabourAssignment (daily_logs child) ───────────────────────
        if (root.TryGetProperty("labour", out var labour) && labour.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in labour.EnumerateArray())
            {
                var assignment = LabourAssignment.Create(
                    id: ids.New(),
                    dailyLogId: log.Id,
                    engagementType: MapLabourEngagement(ReadString(item, "engagementType"), ReadString(item, "type")),
                    maleCount: ReadInt(item, "maleCount"),
                    femaleCount: ReadInt(item, "femaleCount"),
                    workerCount: ReadInt(item, "count"),
                    // rate spoken lands on WagePerPerson; new `rate` wins, legacy
                    // `wagePerPerson` is the fallback.
                    wagePerPerson: ReadDecimal(item, "rate") ?? ReadDecimal(item, "wagePerPerson"),
                    contractUnit: MapContractUnit(ReadString(item, "contractUnit")),
                    contractQuantity: ReadDecimal(item, "contractQuantity"),
                    // NO-MULTIPLY (D3): only an EXPLICIT stated total — never rate × count.
                    totalCost: ReadDecimal(item, "totalCost"),
                    linkedActivityId: ReadGuid(item, "linkedActivityId"),
                    createdAtUtc: now);
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
                    source: MapObservationSource(ReadString(item, "source")),
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

        return new DerivationOutcome(operations, children);
    }

    // ── DerivedEventKey span (D2) ──────────────────────────────────────────────
    // sourceText when present-and-non-blank, else "<eventType>#<ordinal>".
    private static string SpanInput(JsonElement item, string eventType, int ordinal)
    {
        var sourceText = ReadString(item, "sourceText");
        return string.IsNullOrWhiteSpace(sourceText) ? $"{eventType}#{ordinal}" : sourceText!;
    }

    // ── tolerant scalar readers ────────────────────────────────────────────────
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

    // ── tolerant string → enum maps (safe default; never throw) ────────────────
    private static IrrigationRole MapIrrigationRole(string? s) => Norm(s) switch
    {
        "spray-carrier" or "spraycarrier" or "spray_carrier" => IrrigationRole.SprayCarrier,
        "fertigation" => IrrigationRole.Fertigation,
        _ => IrrigationRole.Irrigation,
    };

    private static LabourEngagementType MapLabourEngagement(string? engagementType, string? legacyType)
    {
        // Prefer the richer B2.4 engagementType; fall back to the legacy HIRED/CONTRACT/SELF.
        var e = Norm(engagementType);
        if (e is not null)
        {
            return e switch
            {
                "contract_piece" or "contract" => LabourEngagementType.Contract,
                "self" or "exchange" => LabourEngagementType.Self,
                _ => LabourEngagementType.Hired, // hired_daily + default
            };
        }

        return Norm(legacyType) switch
        {
            "contract" => LabourEngagementType.Contract,
            "self" => LabourEngagementType.Self,
            _ => LabourEngagementType.Hired,
        };
    }

    private static ContractUnit? MapContractUnit(string? s) => Norm(s) switch
    {
        "tree" => ContractUnit.Tree,
        "acre" => ContractUnit.Acre,
        "row" => ContractUnit.Row,
        "lump sum" or "lump_sum" or "lumpsum" => ContractUnit.LumpSum,
        _ => null,
    };

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

    private static ObservationSource MapObservationSource(string? s) => Norm(s) switch
    {
        "manual" => ObservationSource.Manual,
        _ => ObservationSource.Voice, // derivation runs on a voice job
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
