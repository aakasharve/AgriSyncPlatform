using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Application.Contracts.Sync.Payloads;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>
/// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — translates the
/// farmer's MANUAL draft (<see cref="ManualDraftItem"/>, the buckets the manual-entry
/// screen builds) into the canonical <c>AgriLogResponse</c> wire shape that
/// <see cref="LedgerDerivationService"/> already parses for voice.
///
/// <para><b>The defect this closes.</b> A manual day persisted NO typed children.
/// <c>LedgerDerivationService</c> is the sole writer of <c>labour_assignments</c>,
/// <c>irrigation_entries</c> and <c>machinery_usages</c>, and it read exclusively from
/// an <c>AiJob.NormalizedResultJson</c>. A hand-typed day has no AI job, so nothing was
/// written, <c>PersistedDayRootBuilder</c> found nothing to project, and the farmer was
/// told ०/१० for a day he had fully described. Normalising the draft into the same
/// wire shape means ONE persistence path serves voice and manual alike — no second
/// writer, no second set of rules to keep in step.</para>
///
/// <para><b>This class copies; it never interprets.</b> Every emitted value is a value
/// the farmer actually entered, moved verbatim. Doctrine P4 forbids the tempting
/// arithmetic: a labour row stating a rate and a head-count but no total emits NO
/// total — <c>rate x count</c> is a number he never said. Absent stays absent; a field
/// is omitted rather than defaulted to 0, "unknown" or null-as-a-value, exactly as
/// <see cref="PersistedDayRootBuilder"/> does on the way back out. Keys outside the
/// per-bucket allowlists below are dropped rather than guessed at, so a client that
/// starts sending a new field cannot silently acquire a server meaning.</para>
///
/// <para><b>Buckets accepted on the wire but not emitted here.</b> The sync contract
/// admits all eight bucket names (the same vocabulary as
/// <c>CreateDailyLogHandler.EvidenceArrayKeys</c>). Only the five below have a typed
/// ledger target that <c>DeriveAsync</c> knows how to write. <c>cropActivities</c>,
/// <c>plannedTasks</c> and <c>activityExpenses</c> therefore pass validation and are
/// carried no further — deliberately, because inventing a persistence target for them
/// here would be a second writer. (<c>cropActivities</c> already reaches the scorer by
/// its own route: the client pushes those as <c>add_log_task</c> mutations, and
/// <c>PersistedDayRootBuilder</c> projects the resulting <c>LogTask</c> rows.)</para>
/// </summary>
internal static class ManualDraftNormalizer
{
    // ── per-bucket field allowlists ──────────────────────────────────────────
    // Each name below is one LedgerDerivationService.DeriveAsync actually reads.
    // Keeping these in lockstep with that reader is the whole contract: a name here
    // with no reader there is dead weight; a reader there with no name here is a
    // fact of the farmer's that would be silently dropped.


    // wave-3.12, spec Ruling 5 (2026-08-15) — "numbers", the per-number certainty map:
    // { dose: { certainty, quantity?, unit?, basis?, spokenText? } }.
    //
    // 🛑 THIS FILE SILENTLY EATS ANYTHING NOT ALLOW-LISTED (see CopyAllowed). Without the
    // name on each list below, the wire test passes, the client ships the map, and the
    // farmer's "अंदाजे ५०० मिली" vanishes between the sync boundary and the ledger with no
    // error anywhere. Adding it here is mandatory, not decorative.
    //
    // It is copied VERBATIM like every other field — the object is handed through
    // untouched and LedgerDerivationService is the only thing that reads inside it.
    private const string NumbersField = "numbers";

    private static readonly string[] InputFields =
    [
        // NOTE: "sourceText" is deliberately ABSENT. It is a span of something SPOKEN,
        // and a hand-typed row has none. Forwarding a stray one would attribute spoken
        // words to a typed figure (P8); the derivation's ordinal fallback
        // ("input#<n>") gives these rows a stable identity without inventing a
        // transcript.
        "type", "productName", "npkGrade", "quantity", "dose", "unit",
        "basisQty", "basisUnit",
        NumbersField,
    ];

    private static readonly string[] MixFields =
    [
        "productName", "npkGrade", "dose", "unit", "basisQty", "basisUnit",
        NumbersField,
    ];

    private static readonly string[] IrrigationFields =
    [
        "role", "weatherAdjusted", "method", "source", "durationHours",
        "waterVolumeLitres", "linkedActivityId",
        NumbersField,
    ];

    private static readonly string[] LabourFields =
    [
        "engagementType", "type", "maleCount", "femaleCount", "count",
        "rate", "wagePerPerson", "contractUnit", "contractQuantity",
        // NO-MULTIPLY (P4): copied ONLY when the farmer stated it outright. There is
        // no branch anywhere in this file that derives it from rate x count.
        "totalCost",
        "linkedActivityId",
        NumbersField,
    ];

    private static readonly string[] MachineryFields =
    [
        "type", "ownership", "hoursUsed", "rentalCost", "fuelCost", "implement",
        "nozzlesActive", "fanState", "fuelType", "fuelQuantity",
        "operationPerformed", "linkedActivityId",
        NumbersField,
    ];

    private static readonly string[] ObservationFields =
    [
        "textRaw", "textCleaned", "plotId", "noteType", "severity", "source",
        "tags", "linkedActivityId",
    ];

    /// <summary>
    /// Returns the wire JSON for <paramref name="draft"/>, or <c>null</c> when there is
    /// no draft at all — the absent-draft path must behave exactly as it did before
    /// task-0b (old clients and voice confirms alike). A draft that is present but
    /// empty yields empty arrays, never an invented row.
    /// </summary>
    public static string? Normalize(ManualDraftItem? draft)
    {
        if (draft is null)
        {
            return null;
        }

        var root = new JsonObject
        {
            ["inputs"] = MapRows(draft.Inputs, InputFields, withMix: true),
            ["irrigation"] = MapRows(draft.Irrigation, IrrigationFields),
            ["labour"] = MapRows(draft.Labour, LabourFields),
            ["machinery"] = MapRows(draft.Machinery, MachineryFields),
            ["observations"] = MapRows(draft.Observations, ObservationFields),
        };

        // wave-3.10, founder decision 8 (2026-08-16) — the farmer's own statement about
        // the DAY, and the chip he may or may not have added. Both COPIED, never inferred;
        // an absent dayOutcome stays absent, which is exactly the pre-decision-8 behaviour
        // for every ordinary work day (P4).
        if (!string.IsNullOrWhiteSpace(draft.DayOutcome))
        {
            root["dayOutcome"] = draft.DayOutcome;
        }

        if (draft.Disturbance is { } d && !string.IsNullOrWhiteSpace(d.Reason))
        {
            // LedgerDerivationService already writes a DisturbanceEvent from this exact
            // shape, so a chip needs no new table. The reason is REQUIRED there
            // (DisturbanceEvent.Create rejects a blank one), which is precisely why the
            // DECLARATION itself does not live here — doctrine P9: an optional chip may
            // not reject the record. A chip-less declaration writes no disturbance at all
            // and the day still commits.
            //
            // Scope defaults to FULL_DAY only when the client omitted it: a chip attached
            // to "there was no work today" is a whole-day statement by construction, and
            // the wire vocabulary has no "unspecified" member to copy instead.
            root["disturbance"] = new JsonObject
            {
                ["reason"] = d.Reason,
                ["scope"] = string.IsNullOrWhiteSpace(d.Scope) ? "FULL_DAY" : d.Scope,
                ["cause"] = d.Cause,
            };
        }

        return root.ToJsonString();
    }

    private static JsonArray MapRows(
        IReadOnlyList<object>? rows, string[] allowedFields, bool withMix = false)
    {
        var array = new JsonArray();
        if (rows is null)
        {
            return array;
        }

        foreach (var raw in rows)
        {
            // The generated payload types the buckets as IReadOnlyList<object>; on the
            // real sync path System.Text.Json materialises each element as a
            // JsonElement. Anything else — or a non-object row from a malformed client
            // — is skipped rather than throwing: a single bad row must never cost the
            // farmer the rest of his day.
            if (raw is not JsonElement element || element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var row = CopyAllowed(element, allowedFields);

            if (withMix
                && element.TryGetProperty("mix", out var mix)
                && mix.ValueKind == JsonValueKind.Array)
            {
                var mixArray = new JsonArray();
                foreach (var item in mix.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object)
                    {
                        mixArray.Add(CopyAllowed(item, MixFields));
                    }
                }

                row["mix"] = mixArray;
            }

            array.Add(row);
        }

        return array;
    }

    /// <summary>
    /// Copies the allowlisted properties of <paramref name="source"/> VERBATIM. A
    /// property that is absent, JSON <c>null</c>, or not allowlisted is simply not
    /// written — "he did not say" and "he said zero" stay distinguishable downstream.
    /// </summary>
    private static JsonObject CopyAllowed(JsonElement source, string[] allowedFields)
    {
        var row = new JsonObject();
        foreach (var field in allowedFields)
        {
            if (source.TryGetProperty(field, out var value)
                && value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            {
                row[field] = JsonNode.Parse(value.GetRawText());
            }
        }

        return row;
    }
}
