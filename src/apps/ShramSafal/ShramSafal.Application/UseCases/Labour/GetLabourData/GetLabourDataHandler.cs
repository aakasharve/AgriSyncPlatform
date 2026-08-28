using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Labour.GetLabourData;

/// <summary>
/// Task 1.2 (spec: 2026-07-13-labour-attendance-approval-design) — assembles
/// the Option-3 wage-book <see cref="LabourDataDto"/> read-model from
/// EXISTING engines. No new tables; no writes.
///
/// <para>
/// <b>MONEY-CONSISTENCY INVARIANT (binding — founder's #1 concern).</b>
/// <c>Paid</c> (per worker and in <c>Dashboard.Money</c>) is sourced from the
/// EXACT SAME rows and correction resolution <c>GetFinanceSummaryHandler</c>
/// uses: <c>sum(CostEntry.Amount WHERE CategoryId IN ("labour_payout",
/// "labour_misc"))</c> — Decision 3a (2026-07-19): दिलं = ALL labour money
/// paid out, not only job-card settlements — with the latest
/// <see cref="ShramSafal.Domain.Finance.FinanceCorrection.CorrectedAmount"/>
/// applied when present. This guarantees the labour page's "दिलं" figure
/// equals the finance page's "Labour" total for the same farm — never
/// re-derived. Per-PERSON <c>Paid</c> stays attribution-only (labour_misc has
/// no JobCard link, so it can never be attributed to a specific worker); the
/// unattributable slice is added to <c>Dashboard.Money.Paid</c> only — see
/// step 6 below. <c>CostEntry.Amount</c> / <c>FinanceCorrection.CorrectedAmount</c>
/// are already 2dp at domain construction, so the <c>decimal.Round</c> calls in
/// this handler (including the per-entry one) are a defensive no-op, not a
/// source of truth — <c>GetFinanceSummaryHandler</c> itself only rounds the
/// per-category group sum and the grand total, never per-entry, so "mirrors
/// finance" here refers to the ROWS and correction resolution, not the
/// rounding step. This labour <c>Paid</c> is also all-time: unlike
/// <c>GetFinanceSummaryHandler</c>, which accepts an optional date-range
/// filter, there is no period scoping here (Stage-1 scope).
/// </para>
/// <para>
/// <c>RecordedWages</c> ("काम झालं") is a DISTINCT number: the sum of
/// <see cref="JobCard.EstimatedTotal"/> for the worker's cards in
/// {Completed, VerifiedForPayout, PaidOut}. <c>Advance</c> ("उचल") is 0 until
/// Stage 4 (<c>LabourAdvance</c>). <c>Owed</c> ("बाकी") is always DERIVED as
/// <c>RecordedWages − Paid − Advance</c> — never stored. Now that <c>Paid</c>
/// can include farm-wide labour_misc spend with no matching JobCard,
/// <c>Owed</c> CAN legitimately go negative (paid more than what job cards
/// have recorded) — that is a correct, honest number, not a bug; the client
/// is responsible for presenting a negative Owed honestly rather than
/// mislabeling it as an "उचल" advance (see labourMock.ts netBalance).
/// </para>
/// <para>
/// <see cref="LabourAssignment.TotalCost"/> / <see cref="LabourAssignment.WagePerPerson"/>
/// are NEVER used for any wage-book figure (NO-MULTIPLY voice-stated estimate,
/// null→0 — a different number by design). LabourAssignment here is
/// DESCRIPTIVE only (count/shift/task/names) and an interim man-days source
/// for the Dashboard until the Stage 5 attendance ledger lands.
/// </para>
/// </summary>
public sealed class GetLabourDataHandler(IShramSafalRepository repository, IClock clock)
    : IHandler<GetLabourDataQuery, LabourDataDto>
{
    private static readonly string[] AvatarTones = ["or", "em", "bl", "vi", "rs", "am"];

    public async Task<Result<LabourDataDto>> HandleAsync(GetLabourDataQuery query, CancellationToken ct = default)
    {
        if (query.FarmId.IsEmpty || query.CallerUserId.IsEmpty)
        {
            return Result.Failure<LabourDataDto>(ShramSafalErrors.InvalidCommand);
        }

        var callerRole = await repository.GetUserRoleForFarmAsync(query.FarmId.Value, query.CallerUserId.Value, ct);
        if (callerRole is null)
        {
            return Result.Failure<LabourDataDto>(ShramSafalErrors.Forbidden);
        }
        var resolvedCallerRole = callerRole.Value;

        // spec: 2026-08-25-prod-cutover-waves — founder ruling 2026-08-27. The review
        // inbox (§8) lists logs by asking the FSM what this caller may do next. Asked
        // on role alone it would hide a Confirmed log from the very member the owner
        // GRANTED approval authority to — the button would not merely be disabled, the
        // row would not exist. Same flag the decision path reads, one place.
        var hasLabourManagementGrant = await LabourManagementGate.HasExplicitGrantAsync(
            repository, query.FarmId.Value, query.CallerUserId.Value, ct);

        // ── 1. Memberships → labour People (Worker / Mukadam only — owners
        //       and other roles are not "labour"). ──────────────────────────
        var memberships = await repository.GetFarmMembershipsAsync(query.FarmId, ct);
        var labourMemberships = memberships
            .Where(m => m.Status == MembershipStatus.Active
                && (m.Role == AppRole.Mukadam || m.Role == AppRole.Worker))
            .ToList();

        // ── 2. JobCards for the farm → per-worker RecordedWages (काम झालं). ──
        var jobCards = await repository.GetJobCardsForFarmAsync(query.FarmId, statusFilter: null, ct);
        var recordedWagesByWorker = jobCards
            .Where(jc => jc.AssignedWorkerUserId is not null
                && jc.Status is JobCardStatus.Completed or JobCardStatus.VerifiedForPayout or JobCardStatus.PaidOut)
            .GroupBy(jc => jc.AssignedWorkerUserId!.Value.Value)
            .ToDictionary(
                g => g.Key,
                g => decimal.Round(g.Sum(jc => jc.EstimatedTotal.Amount), 2, MidpointRounding.AwayFromZero));

        // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) — whether ANY
        // job-card evidence exists on this farm at all. Production holds ZERO
        // job cards, so `recordedWagesByWorker` is always empty there — that is
        // an ABSENCE of evidence, not evidence of zero, and must not be
        // conflated with "nobody earned anything". Gates both the per-person
        // and the farm-wide RecordedWages/Owed figures below: null, never `0m`,
        // whenever this is false.
        var hasJobCardEvidence = recordedWagesByWorker.Count > 0;

        // ── 3. Labour CostEntries — labour_payout + labour_misc (finance-consistent Paid — दिलं). ──
        // Decision 3a (2026-07-19): दिलं = ALL labour money paid out, not just
        // job-card settlements — labour_misc (generic voice/manual labour
        // spend, no JobCard link) is included alongside labour_payout so this
        // reconciles with the finance page's "Labour" bucket (same two
        // categories the frontend's mapCategory() collapses into one).
        // Mirrors GetFinanceSummaryHandler's ROWS and latest-correction
        // resolution — that's what keeps this page and the finance page
        // agreeing. It does NOT mirror that handler's rounding: values are
        // already 2dp at domain construction (CostEntry.Amount /
        // FinanceCorrection.CorrectedAmount), so the decimal.Round calls
        // below are a defensive no-op. GetFinanceSummaryHandler itself only
        // rounds its group sum + grand total, never per-entry. This labour
        // Paid is also all-time — no date-range filter, unlike the finance
        // summary's optional period scoping.
        var payoutRows = await repository.GetLabourPayoutCostEntriesWithJobCardAsync(query.FarmId, ct);
        var corrections = await repository.GetCorrectionsForEntriesAsync(payoutRows.Select(r => r.CostEntry.Id), ct);
        var latestCorrections = corrections
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.CorrectedAtUtc).First());

        var paidByWorker = new Dictionary<Guid, decimal>();
        // Farm-wide money paid that CANNOT be attributed to a specific person
        // (labour_misc has no JobCard link, so AssignedWorkerUserId is always
        // null for it — a job-card-settled payout whose worker has since LEFT
        // the farm is a DIFFERENT case, handled below by the `people`-only
        // rollup, not here). Real money paid out either way — decision 3a
        // requires it in the farm-wide दिलं total even with no person to
        // attach it to; per-person Paid stays untouched (residual: per-person
        // attribution stays partial until job cards are in real use).
        decimal unattributedPaid = 0m;
        foreach (var (entry, assignedWorkerUserId) in payoutRows)
        {
            var hasCorrection = latestCorrections.TryGetValue(entry.Id, out var latestCorrection);
            var effectiveAmount = decimal.Round(
                hasCorrection ? latestCorrection!.CorrectedAmount : entry.Amount,
                2, MidpointRounding.AwayFromZero);

            if (assignedWorkerUserId is not { } workerId)
            {
                unattributedPaid += effectiveAmount; // orphaned payout (no linked JobCard/worker) — not attributable to a person.
                continue;
            }

            paidByWorker[workerId] = paidByWorker.GetValueOrDefault(workerId) + effectiveAmount;
        }

        unattributedPaid = decimal.Round(unattributedPaid, 2, MidpointRounding.AwayFromZero);
        foreach (var workerId in paidByWorker.Keys.ToList())
        {
            paidByWorker[workerId] = decimal.Round(paidByWorker[workerId], 2, MidpointRounding.AwayFromZero);
        }

        // ── 4. Display names (cross-context, safe — mirrors sync-pull operators). ──
        var reviewOperatorIds = new List<Guid>();
        var farmLogs = await repository.GetDailyLogsByFarmAsync(query.FarmId, ct);
        reviewOperatorIds.AddRange(farmLogs.Select(l => l.OperatorUserId.Value));

        var operatorIds = labourMemberships.Select(m => m.UserId.Value)
            .Concat(reviewOperatorIds)
            .Distinct()
            .ToList();
        var operators = await repository.GetOperatorsByIdsAsync(operatorIds, ct);
        var displayNameByUserId = operators.ToDictionary(o => o.UserId, o => o.DisplayName);

        // ── 5. Assemble People (Option-3 wage-book fields per person). ──────
        var people = new List<LabourPersonDto>();
        var seenPersonIds = new HashSet<string>();
        var toneIndex = 0;

        foreach (var membership in labourMemberships)
        {
            var workerId = membership.UserId.Value;
            var personId = workerId.ToString();
            if (!seenPersonIds.Add(personId))
            {
                continue; // defends the "People ids are unique" wire-contract invariant.
            }

            // Task 1 (P4) — null when THIS worker carries no job-card evidence
            // (no Completed/VerifiedForPayout/PaidOut card), never a fabricated
            // ₹0. `TryGetValue` in place of `GetValueOrDefault`: the latter
            // silently substitutes decimal's default (0m) for "not found",
            // which is exactly the conflation this task removes.
            var recordedWages = recordedWagesByWorker.TryGetValue(workerId, out var recordedWagesValue)
                ? recordedWagesValue
                : (decimal?)null;
            var paid = paidByWorker.GetValueOrDefault(workerId);
            const decimal advance = 0m; // Stage 4 (LabourAdvance) — not yet built.

            var displayName = displayNameByUserId.GetValueOrDefault(workerId, $"Worker {personId[..8]}");
            var role = membership.Role == AppRole.Mukadam ? "mukadam" : "worker";
            var daysActive = (int)Math.Max(0, (clock.UtcNow.Date - membership.GrantedAtUtc.Date).TotalDays);

            people.Add(new LabourPersonDto(
                Id: personId,
                Name: displayName,
                Initial: displayName.Length > 0 ? displayName[..1] : "?",
                Tone: AvatarTones[toneIndex++ % AvatarTones.Length],
                Role: role,
                Verified: true, // sourced from an app FarmMembership — an app-registered worker.
                Temporary: false,
                TaskScope: null,
                AppointedById: null,
                RecordedWages: recordedWages,
                Paid: paid,
                Advance: advance,
                TodayStatus: null, // Stage 5 attendance ledger.
                DaysThisWeek: null, // Stage 5 attendance ledger.
                MemberIds: null,
                Trust: null, // Reliability scoring is a separate read-model (WorkerProfile), not this task.
                Access: "review", // trust-graduation not yet built — every worker defaults to owner-review.
                DaysActive: daysActive,
                CleanRecord: null));
        }

        // ── 6. Dashboard rollups — SAME population as the People rows below,
        //       PLUS farm-wide unattributed labour spend (Decision 3a). ──────
        // RecordedWages/Advance are summed over `people` (the Active-roster
        // list assembled in step 5), NOT over the raw `recordedWagesByWorker`
        // dictionary. That dictionary can hold a worker who was paid and then
        // suspended/exited — summing it directly would let totalPaid include
        // money for someone totalRecorded no longer counts, driving Owed
        // negative even though every row shown on screen reconciles. This
        // dashboard reflects the ACTIVE roster for THAT reason; a
        // paid-then-departed worker's historical pay is out of Stage-1 scope
        // (a former-workers view is a later stage).
        //
        // Dashboard Paid (दिलं) is DIFFERENT: `people.Sum(p => p.Paid)` PLUS
        // `unattributedPaid` — labour_misc entries (and any orphaned
        // labour_payout with no JobCard link) that were never attributable to
        // an active person still ARE real money the farmer paid out, and
        // Decision 3a requires दिलं to equal ALL labour money paid, matching
        // the finance page. Per-person Paid is untouched (still attribution-
        // only); only this farm-wide total absorbs the unattributed slice.
        // Task 1 (P4) — `totalRecorded` is null when the farm carries zero
        // job-card evidence (`hasJobCardEvidence` false), exactly mirroring the
        // per-person rule above. Do NOT gate this on "every person's
        // RecordedWages happens to be null" — an active roster with zero
        // members would then vacuously read as "unknown" even when real
        // evidence exists elsewhere (e.g. for a departed worker), which is a
        // different and legitimate `0m` case handled below. `totalOwed` is
        // NEVER derived from a null `totalRecorded` — the balance is absent
        // too, not zero, not negative.
        var totalRecorded = hasJobCardEvidence
            ? decimal.Round(people.Sum(p => p.RecordedWages ?? 0m), 2, MidpointRounding.AwayFromZero)
            : (decimal?)null;
        var totalPaid = decimal.Round(people.Sum(p => p.Paid) + unattributedPaid, 2, MidpointRounding.AwayFromZero);
        var totalAdvance = decimal.Round(people.Sum(p => p.Advance), 2, MidpointRounding.AwayFromZero);
        var totalOwed = totalRecorded is null
            ? (decimal?)null
            : decimal.Round(totalRecorded.Value - totalPaid - totalAdvance, 2, MidpointRounding.AwayFromZero);

        // ── 7. This-week man-days (interim, from LabourAssignment.WorkerCount — NO-MULTIPLY descriptive only). ──
        var today = DateOnly.FromDateTime(clock.UtcNow.Date);
        var daysSinceMonday = ((int)today.DayOfWeek + 6) % 7; // Sunday=0..Saturday=6 -> Monday-anchored offset.
        var weekStart = today.AddDays(-daysSinceMonday);
        var weekAssignments = await repository.GetLabourAssignmentsForFarmSinceAsync(query.FarmId, weekStart, ct);
        var manDays = weekAssignments.Sum(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount));

        // ── 8. Review — Draft/Confirmed logs still awaiting the owner. ─────
        var reviewLogs = farmLogs
            .Where(l => l.CurrentVerificationStatus is VerificationStatus.Draft or VerificationStatus.Confirmed
                && VerificationStateMachine.GetAvailableTransitions(
                    l.CurrentVerificationStatus, resolvedCallerRole, hasLabourManagementGrant).Length > 0)
            .OrderByDescending(l => l.ModifiedAtUtc)
            .ToList();

        var review = reviewLogs
            .Select(l =>
            {
                var who = displayNameByUserId.GetValueOrDefault(l.OperatorUserId.Value, "Worker");
                return new LabourReviewItemDto(
                    Id: l.Id.ToString(),
                    Who: who,
                    Initial: who.Length > 0 ? who[..1] : "?",
                    Tone: AvatarTones[0],
                    Detail: l.LogDate.ToString("yyyy-MM-dd"),
                    Status: l.CurrentVerificationStatus.ToString(),
                    Points: new LabourPointsDto(null, null, null, null, []));
            })
            .ToList();

        var weekLabel = $"{weekStart:yyyy-MM-dd}";

        var dashboard = new LabourDashboardDto(
            WeekLabel: weekLabel,
            Insight: string.Empty,
            ManDays: manDays,
            ManDaysTrend: 0,
            Wages: totalPaid,
            Advances: totalAdvance,
            Owed: totalOwed,
            Logs: farmLogs.Count,
            Pending: reviewLogs.Count,
            Plots: [],
            Money: new LabourMoneyDto(totalRecorded, totalPaid, totalAdvance, totalOwed));

        var ledger = new LabourLedgerDto(
            WeekLabel: weekLabel,
            Days: [],
            Rows: [], // Stage 5 per-worker attendance ledger — empty by design until then.
            DailyTotals: [],
            WeekTotal: manDays);

        var attendance = new LabourAttendanceDraftDto(
            Plot: string.Empty,
            Headcount: 0,
            Rows: []);

        var topLevelIds = people.Select(p => p.Id).ToList();

        return Result.Success(new LabourDataDto(topLevelIds, people, dashboard, ledger, review, attendance));
    }
}
