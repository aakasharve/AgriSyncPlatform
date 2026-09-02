using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 3) — the
/// SINGLE construction site for <see cref="LabourAssignment"/>, the canonical
/// record of a labour engagement.
///
/// <para>Before this factory existed the voice/AI derivation path
/// (<c>LedgerDerivationService</c>) was the only producer. Task 6 adds a second
/// producer for manually-entered labour. If the two paths built the row
/// differently, the same real-world engagement would be recorded two different
/// ways depending only on how the farmer entered it. Both paths therefore go
/// through <see cref="FromParsed"/>, and
/// <c>LabourAnchorRules.LabourAssignment_is_constructed_in_exactly_one_production_file</c>
/// pins that so divergence is impossible rather than merely discouraged.</para>
///
/// <para><b>The enum maps below are TOTAL by design.</b> They are tolerant
/// wire-string → enum maps that NEVER throw (<c>MapLabourEngagement</c> falls
/// back to <see cref="LabourEngagementType.Hired"/>; the other two fall through
/// to <c>null</c>). Making any of them throw would convert the voice path from
/// tolerant to fail-closed and break the plan's Constraint 7 — "आज ८ मजूर होते"
/// must always complete a log, whatever the model emits alongside it.</para>
/// </summary>
public static class LabourAssignmentFactory
{
    /// <summary>
    /// Builds a <see cref="LabourAssignment"/> from already-mapped values,
    /// resolving the canonical headcount through
    /// <see cref="LabourHeadcount.Resolve"/> on the WRITE path.
    ///
    /// <para><paramref name="maleCount"/> / <paramref name="femaleCount"/> are
    /// stored untouched — the split stays exactly as stated. Only
    /// <paramref name="workerCount"/> is resolved, so a row whose headcount was
    /// only ever in the gender split ("५ बायका" → femaleCount=5) persists a real
    /// count instead of a null that every consumer then reads as zero.</para>
    ///
    /// <para><b>Silence is preserved as NULL.</b> When the farmer stated no
    /// headcount at all — a live shape on the shipping voice path, e.g.
    /// "Contract ne 2 acre chhatani keli" (contract + quantity, no count) —
    /// <c>WorkerCount</c> stays NULL. Resolving that to 0 would assert "zero
    /// people worked" about real work, and from Task 4 onward it would surface
    /// to the farmer as 0 hours. There is no backfill job in this system, so a
    /// wrong write is permanent. An explicitly stated 0 still stores 0 and
    /// stays distinguishable from silence.</para>
    ///
    /// <para>NO-MULTIPLY (ADR 0023 §1 / §3.2d) is unchanged and still owned by
    /// <see cref="LabourAssignment.Create"/>: <paramref name="totalCost"/> is
    /// stored exactly as supplied and is NEVER computed from rate × count.</para>
    /// </summary>
    /// <param name="notes">
    /// LABOUR_PHASE2 O-3 — the farmer's own note, carried through verbatim.
    /// Added LAST with a default so every existing call site compiles and keeps
    /// meaning exactly what it meant. <see cref="LabourAssignment.Create"/> owns
    /// the blank → <c>null</c> normalisation; nothing is normalised twice.
    /// </param>
    /// <param name="costCertainty">
    /// wave-3.12 spec Ruling 5 — how sure the farmer was of <paramref name="totalCost"/>.
    /// Trailing with a default, exactly like <paramref name="notes"/>, so every existing
    /// call site compiles and keeps writing NULL — which reads as "not asked, not
    /// stated", never as <c>Reported</c> (P4). It qualifies the total and NEVER relaxes
    /// NO-MULTIPLY: an approximate cost is still only ever the one the farmer stated.
    /// </param>
    /// <param name="costSpokenText">His own words for that cost, carried verbatim.</param>
    public static LabourAssignment FromParsed(
        Guid id, Guid dailyLogId, LabourEngagementType engagementType,
        int? maleCount, int? femaleCount, int? workerCount, decimal? wagePerPerson,
        ContractUnit? contractUnit, decimal? contractQuantity, decimal? totalCost,
        Guid? linkedActivityId, DateTime createdAtUtc, LabourTime time,
        LabourShift? shift = null, string? task = null, IReadOnlyList<string>? workerNames = null,
        string? notes = null,
        NumericCertainty? costCertainty = null, string? costSpokenText = null,
        // Task 3.6 (spec: 2026-08-28-labour-v2-release-1) — Final direction §3, the
        // crew link: THROUGH WHOM this engagement's crew came (a FieldOperatorId).
        // Trailing and OPTIONAL like notes/costCertainty above, so every existing
        // call site compiles and keeps writing NULL = "nobody said through whom".
        // Pure pass-through: the farm guard lives in CreateDailyLogHandler, and no
        // worker row is ever minted from this link (the remainder stays arithmetic).
        Guid? engagedThroughFieldOperatorId = null)
        => LabourAssignment.Create(
            id: id,
            dailyLogId: dailyLogId,
            engagementType: engagementType,
            maleCount: maleCount,
            femaleCount: femaleCount,
            // P4/P8: nothing stated => NULL means "we were not told", never "zero people
            // worked". An explicitly stated 0 still stores 0 and stays distinguishable.
            // Task 6 (spec: 2026-08-28-labour-v2-release-1) — LabourHeadcount.Resolve
            // itself now returns null for the all-silent case, so this call needs no
            // outer null-check anymore; see LabourAssignment.CorrectHeadcount for the
            // same simplification and why (the check was equivalent, just duplicated).
            workerCount: LabourHeadcount.Resolve(workerCount, maleCount, femaleCount),
            wagePerPerson: wagePerPerson,
            contractUnit: contractUnit,
            contractQuantity: contractQuantity,
            totalCost: totalCost,
            linkedActivityId: linkedActivityId,
            createdAtUtc: createdAtUtc,
            time: time,
            shift: shift,
            task: task,
            workerNames: workerNames,
            notes: notes,
            costCertainty: costCertainty,
            costSpokenText: costSpokenText,
            engagedThroughFieldOperatorId: engagedThroughFieldOperatorId);

    // ── tolerant string → enum maps (safe default; never throw) ────────────────
    // Moved verbatim from LedgerDerivationService so the manual path can map wire
    // STRINGS to the same enums the voice path uses. Task 6 depends on these
    // being public. Behaviour is unchanged — see the TOTAL-by-design note above.

    /// <summary>
    /// Prefers the richer B2.4 <c>engagementType</c>; falls back to the legacy
    /// HIRED/CONTRACT/SELF <c>type</c>. Never throws — anything unrecognised is
    /// <see cref="LabourEngagementType.Hired"/>.
    /// </summary>
    public static LabourEngagementType MapLabourEngagement(string? raw, string? legacyType)
    {
        // Prefer the richer B2.4 engagementType; fall back to the legacy HIRED/CONTRACT/SELF.
        var e = Norm(raw);
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

    // Descriptive only (Task 2.3) — unknown/garbage shift values (e.g. a model
    // hallucination) fall through to null rather than throwing; never guess.
    public static LabourShift? MapLabourShift(string? raw) => Norm(raw) switch
    {
        "full" => LabourShift.Full,
        "half" => LabourShift.Half,
        "night" => LabourShift.Night,
        _ => null,
    };

    public static ContractUnit? MapContractUnit(string? raw) => Norm(raw) switch
    {
        "tree" => ContractUnit.Tree,
        "acre" => ContractUnit.Acre,
        "row" => ContractUnit.Row,
        "lump sum" or "lump_sum" or "lumpsum" => ContractUnit.LumpSum,
        _ => null,
    };

    // DELIBERATE two-line duplicate of LedgerDerivationService.Norm, NOT a shared
    // helper. Twelve other maps in that file (irrigation role, machine type,
    // ownership, fan state, note type, severity, …) call its copy and have
    // nothing to do with labour. Extracting one shared Norm would couple this
    // labour factory to all twelve; that coupling is the worse outcome, so the
    // Rule of Three is not applied here. Keep the two copies behaviourally
    // identical — trim + lower-invariant, blank/whitespace → null.
    private static string? Norm(string? s)
        => string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToLowerInvariant();
}
