using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
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
/// uses: <c>sum(CostEntry.Amount WHERE CategoryId=="labour_payout")</c>, with
/// the latest <see cref="ShramSafal.Domain.Finance.FinanceCorrection.CorrectedAmount"/>
/// applied when present. This guarantees the labour page's "दिलं" figure
/// equals the finance page for the same work — never re-derived.
/// <c>CostEntry.Amount</c> / <c>FinanceCorrection.CorrectedAmount</c> are
/// already 2dp at domain construction, so the <c>decimal.Round</c> calls in
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
/// <c>RecordedWages − Paid − Advance</c> — never stored.
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

        // ── 3. labour_payout CostEntries (finance-consistent Paid — दिलं). ──
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
        foreach (var (entry, assignedWorkerUserId) in payoutRows)
        {
            if (assignedWorkerUserId is not { } workerId)
            {
                continue; // orphaned payout (no linked JobCard/worker) — not attributable to a person.
            }

            var hasCorrection = latestCorrections.TryGetValue(entry.Id, out var latestCorrection);
            var effectiveAmount = decimal.Round(
                hasCorrection ? latestCorrection!.CorrectedAmount : entry.Amount,
                2, MidpointRounding.AwayFromZero);

            paidByWorker[workerId] = paidByWorker.GetValueOrDefault(workerId) + effectiveAmount;
        }

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

            var recordedWages = recordedWagesByWorker.GetValueOrDefault(workerId);
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

        // ── 6. Dashboard rollups — SAME population as the People rows below. ──
        // All three totals are summed over `people` (the Active-roster list
        // assembled in step 5), NOT over the raw `recordedWagesByWorker` /
        // `paidByWorker` dictionaries. Those dictionaries can hold a worker
        // who was paid and then suspended/exited — summing them directly
        // would let totalPaid include money for someone totalRecorded no
        // longer counts, driving Owed negative even though every row shown
        // on screen reconciles. This dashboard reflects the ACTIVE roster;
        // a paid-then-departed worker's historical pay is out of Stage-1
        // scope (a former-workers view is a later stage). Each per-person
        // Paid/RecordedWages value is still sourced exactly as in step 5 —
        // only the aggregation population changes here.
        var totalRecorded = decimal.Round(people.Sum(p => p.RecordedWages), 2, MidpointRounding.AwayFromZero);
        var totalPaid = decimal.Round(people.Sum(p => p.Paid), 2, MidpointRounding.AwayFromZero);
        var totalAdvance = decimal.Round(people.Sum(p => p.Advance), 2, MidpointRounding.AwayFromZero);
        var totalOwed = decimal.Round(totalRecorded - totalPaid - totalAdvance, 2, MidpointRounding.AwayFromZero);

        // ── 7. This-week man-days (interim, from LabourAssignment.WorkerCount — NO-MULTIPLY descriptive only). ──
        var today = DateOnly.FromDateTime(clock.UtcNow.Date);
        var daysSinceMonday = ((int)today.DayOfWeek + 6) % 7; // Sunday=0..Saturday=6 -> Monday-anchored offset.
        var weekStart = today.AddDays(-daysSinceMonday);
        var weekAssignments = await repository.GetLabourAssignmentsForFarmSinceAsync(query.FarmId, weekStart, ct);
        var manDays = weekAssignments.Sum(a => a.WorkerCount ?? 0);

        // ── 8. Review — Draft/Confirmed logs still awaiting the owner. ─────
        var reviewLogs = farmLogs
            .Where(l => l.CurrentVerificationStatus is VerificationStatus.Draft or VerificationStatus.Confirmed
                && VerificationStateMachine.GetAvailableTransitions(l.CurrentVerificationStatus, resolvedCallerRole).Length > 0)
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
