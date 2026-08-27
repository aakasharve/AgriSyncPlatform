using System.Text.Json;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// task-7 (2026-08-13) — projects ONE <see cref="DailyLog"/>'s <b>already-persisted
/// typed rows</b> into the same wire shape <see cref="DfesLensExtractor"/> reads, so
/// the day's score is computed from what the farmer actually recorded and not only
/// from an AI job's <c>NormalizedResultJson</c>.
///
/// <para><b>The blindness this closes.</b> The scorer's only input used to be the
/// source AiJob JSON, plus (for a log with no usable AI root) a fallback that
/// synthesised <c>cropActivities:[{title}]</c> from <c>LogTask</c> rows and NOTHING
/// else. A labour engagement, an irrigation, a machine or a disturbance the farmer
/// recorded was therefore worth zero to COST / CARRIER / WEATHER unless an AI job
/// happened to restate it. A manual-entry day could not be scored as well as a voice
/// day even when it carried identical facts.</para>
///
/// <para><b>No fabrication (doctrine P4).</b> Every property emitted here is copied
/// from a NON-NULL persisted column. A column the farmer never filled is OMITTED —
/// never defaulted to 0, "unknown", or an empty string — so a dimension can only be
/// credited from detail he genuinely supplied. An empty root (a log with no typed
/// children at all) yields <c>null</c> and contributes nothing at all.</para>
/// </summary>
internal static class PersistedDayRootBuilder
{
    // Statuses that mean the farmer actually DID the task that day. Skipped /
    // Delayed explicitly mean the work did NOT happen (LogTask requires a
    // DeviationReasonCode for those) — counting them as "work" would fabricate a
    // signal the farmer never recorded, so they are deliberately excluded.
    private static readonly HashSet<ExecutionStatus> WorkDoneStatuses =
    [
        ExecutionStatus.Completed, ExecutionStatus.Partial, ExecutionStatus.Modified
    ];

    /// <summary>
    /// Serializes <paramref name="log"/>'s persisted children into a wire-shaped JSON
    /// root, or returns <c>null</c> when the log has no such row (nothing to say).
    /// </summary>
    public static string? Build(
        DailyLog log,
        IReadOnlyList<LabourAssignment> labour,
        IReadOnlyList<IrrigationEntry> irrigation,
        IReadOnlyList<MachineryUsage> machinery,
        IReadOnlyList<DisturbanceEvent> disturbances)
    {
        var root = new Dictionary<string, object?>();

        // ── cropActivities ← LogTask rows that genuinely represent done work ────
        var activities = log.Tasks
            .Where(t => WorkDoneStatuses.Contains(t.ExecutionStatus) && !string.IsNullOrWhiteSpace(t.ActivityType))
            .Select(t => new Dictionary<string, object?> { ["title"] = t.ActivityType.Trim() })
            .ToList();
        if (activities.Count > 0)
        {
            root["cropActivities"] = activities;
        }

        // ── dayOutcome ← the farmer's own declaration. THE BRIDGE (wave-3.10) ───
        // Founder decision 8. Without this line the manual path never reaches
        // DfesLensExtractor.DeclaredNoWork: ManualDraftNormalizer's output goes to
        // LedgerDerivationService — the LEDGER writer — and never to the scorer, whose
        // roots come from the AI job plus this builder. A perfectly wired contract, a
        // stored column and a working extractor would still have left a typed "no work
        // today" invisible. This is the only join between them.
        //
        // Copied only when present, like every other value here: a NULL column is
        // omitted, never emitted as "WORK_RECORDED" (P4).
        if (!string.IsNullOrWhiteSpace(log.DayOutcome))
        {
            root["dayOutcome"] = log.DayOutcome;
        }

        // ── labour ← LabourAssignment rows ──────────────────────────────────────
        // "rate" and "totalCost" are the two money facts COST reads. Both are
        // NULLABLE columns held to the NO-MULTIPLY rule (a total is never derived
        // from rate x count), so both are emitted only when actually stated.
        var labourRows = labour.Select(l =>
        {
            var row = new Dictionary<string, object?>();
            Put(row, "count", l.WorkerCount);
            Put(row, "maleCount", l.MaleCount);
            Put(row, "femaleCount", l.FemaleCount);
            Put(row, "rate", l.WagePerPerson);
            Put(row, "totalCost", l.TotalCost);
            return row;
        }).ToList();
        if (labourRows.Count > 0)
        {
            root["labour"] = labourRows;
        }

        // ── irrigation ← IrrigationEntry rows ───────────────────────────────────
        var irrigationRows = irrigation.Select(i =>
        {
            var row = new Dictionary<string, object?>();
            Put(row, "method", NullIfBlank(i.Method));
            Put(row, "source", NullIfBlank(i.Source));
            Put(row, "durationHours", i.DurationHours);
            Put(row, "waterVolumeLitres", i.WaterVolumeLitres);
            return row;
        }).ToList();
        if (irrigationRows.Count > 0)
        {
            root["irrigation"] = irrigationRows;
        }

        // ── machinery ← MachineryUsage rows ─────────────────────────────────────
        var machineryRows = machinery.Select(m =>
        {
            var row = new Dictionary<string, object?>();
            Put(row, "rentalCost", m.RentalCost);
            Put(row, "hoursUsed", m.HoursUsed);
            return row;
        }).ToList();
        if (machineryRows.Count > 0)
        {
            root["machinery"] = machineryRows;
        }

        // ── disturbance ← the FIRST DisturbanceEvent (wire shape is one object) ──
        // Reason is a required, non-empty column on the entity, so a row that exists
        // always carries the farmer's own words for what disrupted the day.
        if (disturbances.Count > 0)
        {
            var d = disturbances[0];
            var row = new Dictionary<string, object?>
            {
                ["reason"] = d.Reason,
                ["scope"] = WireScope(d.Scope),
            };
            Put(row, "cause", WireCause(d.Cause));
            root["disturbance"] = row;
        }

        // wave-3.10 — note what this guard now means for a declared no-work day: it has no
        // typed children at all, but it DOES carry a dayOutcome, so the root is non-empty
        // and the day becomes scorable. Before decision 8 such a day projected nothing and
        // was read as "the farmer said nothing".
        return root.Count == 0 ? null : JsonSerializer.Serialize(root);
    }

    private static void Put(Dictionary<string, object?> row, string key, object? value)
    {
        if (value is not null)
        {
            row[key] = value;
        }
    }

    private static string? NullIfBlank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    // Inverse of LedgerDerivationService.MapDisturbanceScope — the wire vocabulary
    // DfesLensExtractor.DeclaredNoWork tests for.
    private static string WireScope(DisturbanceScope scope) => scope switch
    {
        DisturbanceScope.Partial => "PARTIAL",
        DisturbanceScope.Delayed => "DELAYED",
        _ => "FULL_DAY",
    };

    // Inverse of LedgerDerivationService.MapDisturbanceCause. Null stays null — an
    // unspecified cause is never invented.
    private static string? WireCause(DisturbanceCause? cause) => cause switch
    {
        DisturbanceCause.Machinery => "machinery",
        DisturbanceCause.Electricity => "electricity",
        DisturbanceCause.Weather => "weather",
        DisturbanceCause.WaterSource => "water_source",
        DisturbanceCause.Pest => "pest",
        DisturbanceCause.Disease => "disease",
        DisturbanceCause.LabourShortage => "labour_shortage",
        DisturbanceCause.MaterialShortage => "material_shortage",
        DisturbanceCause.Other => "other",
        _ => null,
    };
}
