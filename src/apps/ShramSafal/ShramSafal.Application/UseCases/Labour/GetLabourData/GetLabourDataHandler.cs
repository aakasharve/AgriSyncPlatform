using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Finance;
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
/// rounding step.
/// </para>
/// <para>
/// <b>TASK 9 (spec: 2026-08-28-labour-v2-release-1) — THE TIME WINDOW.</b>
/// Until now exactly ONE of the five dashboard tiles was period-scoped
/// (<c>ManDays</c>, hard-coded to the current week); <c>Wages</c>, <c>Logs</c>,
/// <c>Pending</c> and the recorded/owed pair were lifetime figures rendered
/// under a "या आठवड्यात" ("this week") heading. Four of the five numbers were
/// therefore false against their own label. <see cref="GetLabourDataQuery.Window"/>
/// now selects one of <see cref="LabourTimeWindow"/>'s four ranges. As of R15
/// (Task 13) EXACTLY THREE figures move with it — <c>ManDays</c>,
/// <c>Wages</c> and <c>Logs</c> — and nothing else does. Omitting the window
/// means आजपर्यंत (all time), the founder-chosen default, which is what lets a
/// client that predates the parameter keep working. Note the one deliberate
/// consequence: <c>ManDays</c> under the DEFAULT window is now all-time rather
/// than this-week — it stopped being the odd one out.
/// </para>
/// <para>
/// <b>R15 (ruling, Task 13, spec: 2026-08-28-labour-v2-release-1) — THE MONEY
/// CARD IS A POSITION CARD, ALL-TIME THROUGHOUT.</b> R13 below was right that
/// <c>Owed</c> is a balance, but it was applied at the wrong GRANULARITY:
/// <c>Owed</c> alone left the window while <c>Recorded</c> and <c>Paid</c> —
/// the other two terms of the SAME card — stayed windowed. That card draws ONE
/// stacked bar whose entire grammar is the identity <c>काम झालं = दिलं + उचल +
/// बाकी</c>, so the mix drew incommensurable quantities as parts of one whole:
/// on the release fixture under आज the header read ₹1,000 above a bar of ₹100
/// + ₹13,500. Every member of <see cref="LabourMoneyDto"/> is therefore now
/// computed from the ALL-TIME §2b/§3b dictionaries and the identity holds by
/// construction. The same reasoning applies ONE LEVEL DOWN: per-person
/// <c>RecordedWages</c>/<c>Paid</c> are the two terms a worker's बाकी/देय is
/// struck from, so they are a settlement position too and are also all-time.
/// The <c>Wages</c> tile (दिलं for the period) is what remains windowed, and
/// it is still the figure that must reconcile with the finance page for the
/// same window.
/// </para>
/// <para>
/// <b><c>Pending</c> is NEVER window-scoped</b> (founder ruling, Task 9). It is
/// an approval INBOX — work still waiting on the owner — not a statistic. A
/// time filter that hid a log awaiting his approval would not be a narrower
/// view, it would be a lost obligation. It is computed from the UNFILTERED
/// log set whatever window is in force, and so is the <c>Review</c> list it
/// summarises. Do not "fix" this to match the other tiles.
/// </para>
/// <para>
/// <b><c>Owed</c>/<c>Money.Owed</c> is ALSO NEVER window-scoped</b> (R13
/// ruling, Task 10, spec: 2026-08-28-labour-v2-release-1 — corrects Task 9,
/// which windowed it). बाकी देणं ("still to give") reads to a farmer as an
/// OUTSTANDING POSITION — what he currently owes — not "of this window's
/// work, how much is unpaid". Windowing it made those two different
/// questions share identical words: a farmer who owes ₹5,000 overall but has
/// paid off everything billed today would have seen बाकी देणं ₹0 under आज,
/// which is the app lying to him about money he owes. <c>Owed</c> is
/// therefore always <c>RecordedWages − Paid − Advance</c> computed from
/// ALL-TIME inputs (<c>recordedWagesByWorkerAllTime</c> /
/// <c>paidByWorkerAllTime</c> in §2b/§3b below). R15 (Task 13) — this
/// paragraph used to end "never the windowed figures that drive the
/// <c>Recorded</c>/<c>Wages</c> tiles, those two ARE flows". Half of that was
/// the defect: <c>Recorded</c> is not a flow, it is the HEADER this balance is
/// struck against, and the two had to share a basis. <c>Wages</c> is the flow,
/// and it is now the only windowed money figure on the screen.
/// </para>
/// <para>
/// <b>The window is IST-anchored</b> via <see cref="FarmLocalDay"/>. The old
/// week boundary came off <c>clock.UtcNow.Date</c>, which is a day behind the
/// farmer's between 00:00 and 05:30 IST — and early morning is when farm work
/// happens, so this was not a rare edge. The analytics side hit the identical
/// defect and fixed it the same way (<c>20260817150453_WvfdWeekBoundaryToIst</c>).
/// One rule, one owner: the single <c>FarmLocalDay.From(clock.UtcNow)</c> call
/// below is the only timezone arithmetic in this read-model — every column the
/// window is compared against is already a farm-local <c>DateOnly</c>.
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
/// mislabeling it as an "उचल" advance (see labourMock.ts netBalance). R13
/// (Task 10) + R15 (Task 13) — the <c>RecordedWages</c>/<c>Paid</c> this
/// subtraction uses are the ALL-TIME dictionaries (§2b/§3b), and so are the
/// values a person's row and the money card display, so the subtraction and
/// the figures shown beside it are now on one basis. The only windowed money
/// figure left on the screen is the <c>Wages</c> tile.
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

    /// <summary>
    /// Task 20 - joins the several plots (or several tasks) one log can carry.
    /// A middle dot, not a comma: it is the separator the labour screens
    /// already read as "and also", and it carries no language.
    /// </summary>
    private const string SeparatorMiddot = " · ";

    public async Task<Result<LabourDataDto>> HandleAsync(GetLabourDataQuery query, CancellationToken ct = default)
    {
        if (query.FarmId.IsEmpty || query.CallerUserId.IsEmpty)
        {
            return Result.Failure<LabourDataDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 0. The requested time window (Task 9), resolved in the FARMER'S
        //       timezone. This is the only place an instant becomes a date in
        //       this handler; everything downstream compares farm-local
        //       DateOnly columns (DailyLog.LogDate, CostEntry.EntryDate,
        //       JobCard.PlannedDate) against it. An unrecognised value is
        //       REJECTED rather than quietly widened to all-time — answering a
        //       question the caller did not ask, under a heading that says
        //       otherwise, is the defect this task exists to remove (same
        //       stance as GetFinanceSummaryHandler.NormalizeGroupBy).
        var farmLocalToday = FarmLocalDay.From(clock.UtcNow);
        var window = LabourTimeWindow.Resolve(query.Window, farmLocalToday);
        if (window is null)
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
            repository, query.FarmId.Value, query.CallerUserId.Value, clock.UtcNow, ct);

        // ── 1. Memberships → labour People (Worker / Mukadam only — owners
        //       and other roles are not "labour"). ──────────────────────────
        var memberships = await repository.GetFarmMembershipsAsync(query.FarmId, ct);
        var labourMemberships = memberships
            .Where(m => m.Status == MembershipStatus.Active
                && (m.Role == AppRole.Mukadam || m.Role == AppRole.Worker))
            .ToList();

        // ── 2. JobCards for the farm → per-worker RecordedWages (काम झालं). ──
        // Read farm-scoped and UNFILTERED. Task 9 additionally grouped these
        // by `window.Contains(jc.PlannedDate)` to drive a windowed काम झालं;
        // R15 (Task 13) deleted that grouping outright rather than leaving it
        // computed-and-unread. काम झालं is one term of a settlement position —
        // both farm-wide (`Money.Recorded`) and per person — and every term of
        // a position is all-time, so §2b below is now the ONLY grouping this
        // handler makes of job cards. Nothing on the screen asks "how much
        // work was recorded in this window" any more; the windowed money
        // question that remains is `Wages` (दिलं for the period), which comes
        // off CostEntry rows in §3, not off job cards.
        //
        // Filtered/grouped HERE rather than in SQL — unlike the two reads
        // below — because GetJobCardsForFarmAsync is shared with
        // GetJobCardsForFarmHandler; this feature does not get to re-shape
        // another use case's port.
        var jobCards = await repository.GetJobCardsForFarmAsync(query.FarmId, statusFilter: null, ct);

        // ── 2b. Per-worker काम झालं, ALL TIME — R13 (ruling, Task 10) for the
        //       balance, widened to the whole card by R15 (ruling, Task 13).
        //       `Owed` is a BALANCE ("what do I currently owe") and
        //       `Recorded`/per-person `RecordedWages` are the header that
        //       balance is struck against, so none of them may be derived from
        //       a windowed slice — see the class doc above.
        //
        //       PlannedDate (the day the work was FOR) is still the only
        //       farm-local calendar date the aggregate carries; it no longer
        //       has anything to be compared against here, but keep it in mind
        //       before ever re-introducing a windowed job-card figure:
        //       CompletedAtUtc/CreatedAtUtc are UTC instants recording when a
        //       STATUS changed, and keying a farmer-facing period off them
        //       would both re-introduce IST skew and credit last week's work
        //       to whenever someone got round to marking it done.
        var recordedWagesByWorkerAllTime = jobCards
            .Where(jc => jc.AssignedWorkerUserId is not null
                && jc.Status is JobCardStatus.Completed or JobCardStatus.VerifiedForPayout or JobCardStatus.PaidOut)
            .GroupBy(jc => jc.AssignedWorkerUserId!.Value.Value)
            .ToDictionary(
                g => g.Key,
                g => decimal.Round(g.Sum(jc => jc.EstimatedTotal.Amount), 2, MidpointRounding.AwayFromZero));

        // Task 1 (spec: 2026-08-28-labour-v2-release-1, P4) / R6 polarity —
        // whether ANY job-card evidence exists on this farm at all. Production
        // holds ZERO job cards, so this dictionary is always empty there; that
        // is an ABSENCE of evidence, not evidence of zero, and must not be
        // conflated with "nobody earned anything". Gates the per-person and
        // farm-wide काम झालं/बाकी figures below: null, never a fabricated ₹0,
        // whenever it is false. R15 (Task 13) — asked of the WHOLE farm
        // history, which is now the only basis any of those figures uses.
        //
        // Note the shape this differs from — ManDays below, where a logged day
        // with no labour on it IS a real zero — because a JobCard has no "the
        // day was recorded and it held no job card" counterpart: nothing else
        // in the model asserts a day had no work worth recording.
        var hasJobCardEvidenceAllTime = recordedWagesByWorkerAllTime.Count > 0;

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
        // rounds its group sum + grand total, never per-entry.
        //
        // Task 9 — दिलं is now scoped to the window by CostEntry.EntryDate,
        // which is the SAME date column GetFinanceSummaryHandler's own
        // fromDate/toDate filter uses. That is what keeps the money-consistency
        // invariant true per PERIOD and not merely per lifetime: labour "दिलं"
        // for a window equals the finance page's "Labour" bucket for the same
        // window. It is also why an empty window reports ₹0 rather than "—":
        // finance sums an empty range to 0, and two screens showing the same
        // rows must not contradict each other about whether the answer is
        // knowable. Unlike a daily log, a payment made through the app cannot
        // exist without leaving a row here — within the ledger the app owns, no
        // row IS no payment.
        var payoutRows = await repository.GetLabourPayoutCostEntriesWithJobCardAsync(
            query.FarmId, window.FromDate, window.ToDateInclusive, ct);
        var latestCorrections = BuildLatestCorrections(
            await repository.GetCorrectionsForEntriesAsync(payoutRows.Select(r => r.CostEntry.Id), ct));

        // Farm-wide money paid that CANNOT be attributed to a specific person
        // (labour_misc has no JobCard link, so AssignedWorkerUserId is always
        // null for it — a job-card-settled payout whose worker has since LEFT
        // the farm is a DIFFERENT case, handled below by the `people`-only
        // rollup, not here). Real money paid out either way — decision 3a
        // requires it in the farm-wide दिलं total even with no person to
        // attach it to; per-person Paid stays untouched (residual: per-person
        // attribution stays partial until job cards are in real use).
        var (paidByWorker, unattributedPaid) = AggregatePayouts(payoutRows, latestCorrections);

        // ── 3b. The SAME payout aggregation, unwindowed — R13 (ruling, Task
        //       10), widened by R15 (ruling, Task 13). `Owed`'s other input
        //       (`Paid`) must be all-time for the identical reason §2b's
        //       `RecordedWages` is: a balance answers "what do I currently
        //       owe", and mixing a windowed numerator with an all-time
        //       denominator (or the reverse) manufactures a figure no evidence
        //       supports. Under R15 this pass also feeds the money card's own
        //       दिलं (`Money.Paid`) and every per-person `Paid`, because those
        //       sit beside a बाकी struck from them and must share its basis.
        //       `payoutRows`/`paidByWorker` above stay windowed and drive the
        //       ONE money figure that is still a flow: the `Wages` tile.
        //
        //       When the requested window IS आजपर्यंत already, `window.FromDate`/
        //       `ToDateInclusive` are both null and re-querying would return
        //       the IDENTICAL rows fetched above — reuse them rather than
        //       hitting Postgres twice for one request.
        List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)> payoutRowsAllTime;
        Dictionary<Guid, FinanceCorrection> latestCorrectionsAllTime;
        if (window.FromDate is null && window.ToDateInclusive is null)
        {
            payoutRowsAllTime = payoutRows;
            latestCorrectionsAllTime = latestCorrections;
        }
        else
        {
            payoutRowsAllTime = await repository.GetLabourPayoutCostEntriesWithJobCardAsync(query.FarmId, null, null, ct);
            latestCorrectionsAllTime = BuildLatestCorrections(
                await repository.GetCorrectionsForEntriesAsync(payoutRowsAllTime.Select(r => r.CostEntry.Id), ct));
        }
        var (paidByWorkerAllTime, unattributedPaidAllTime) = AggregatePayouts(payoutRowsAllTime, latestCorrectionsAllTime);

        // ── 4. Display names (cross-context, safe — mirrors sync-pull operators). ──
        // Task 9 — this read stays UNFILTERED on purpose. It feeds three
        // different things with two different scoping rules, and collapsing
        // them into one windowed query would silently window the wrong ones:
        //   * `farmLogs`   — the review inbox (§8) and its Pending count, which
        //                    the founder ruled must NEVER be time-filtered, plus
        //                    the operator display names those rows need.
        //   * `windowLogs` — the `Logs` tile, and the "did we hear anything
        //                    about these days at all" test the man-days rule
        //                    turns on (§7).
        var farmLogs = await repository.GetDailyLogsByFarmAsync(query.FarmId, ct);
        var windowLogs = farmLogs.Where(l => window.Contains(l.LogDate)).ToList();

        var reviewOperatorIds = new List<Guid>();
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
            //
            // R15 (Task 13) — read from the ALL-TIME dictionaries. These two
            // numbers are not this window's flows; they are the two terms the
            // client subtracts to state this worker's बाकी/देय next to his name
            // (`labour.types.ts` netBalance), and a balance is true as of now.
            // Windowed, they made the same defect the money card had, one level
            // down: a man still owed ₹8,000 read as owed nothing under आज. It
            // was unreachable only because leaving आढावा resets the window
            // (Task 12) — persisting the window would have armed it, so it is
            // fixed at the source rather than left as a landmine.
            var recordedWages = recordedWagesByWorkerAllTime.TryGetValue(workerId, out var recordedWagesValue)
                ? recordedWagesValue
                : (decimal?)null;
            var paid = paidByWorkerAllTime.GetValueOrDefault(workerId);
            const decimal advance = 0m; // Stage 4 (LabourAdvance) — not yet built.

            var displayName = displayNameByUserId.GetValueOrDefault(workerId, $"Worker {personId[..8]}");
            var role = membership.Role == AppRole.Mukadam ? "mukadam" : "worker";
            // Task 9 — both ends read in the FARMER's timezone. Mixing a UTC
            // day-boundary into a figure a farmer reads as "days on my farm" is
            // the same defect as the UTC week; one rule (FarmLocalDay), applied
            // to both sides of the subtraction.
            var daysActive = Math.Max(
                0, farmLocalToday.DayNumber - FarmLocalDay.From(membership.GrantedAtUtc).DayNumber);

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
        // Every rollup here is summed over the ACTIVE ROSTER — `people` (the
        // list assembled in step 5) or the `activeWorkerIds` that produced it —
        // never over a raw by-worker dictionary. Those dictionaries can hold a
        // worker who was paid and then suspended/exited; summing one directly
        // would let a paid total include money for someone the recorded total
        // no longer counts, driving Owed negative even though every row shown
        // on screen reconciles. A paid-then-departed worker's historical pay is
        // out of Stage-1 scope (a former-workers view is a later stage).
        //
        // The paid totals are DIFFERENT in one respect: each adds its own
        // `unattributed…` slice — labour_misc entries (and any orphaned
        // labour_payout with no JobCard link) that were never attributable to
        // an active person still ARE real money the farmer paid out, and
        // Decision 3a requires दिलं to equal ALL labour money paid, matching
        // the finance page. Per-person Paid stays attribution-only; only these
        // farm-wide totals absorb the unattributed slice.
        //
        // R15 (Task 13) — `totalPaid` here is the WINDOWED figure and it now
        // has exactly ONE consumer left: the `Wages` (मजुरी) tile. It is
        // summed straight from the windowed §3 dictionary rather than from
        // `people.Sum(p => p.Paid)`, because a person's `Paid` is all-time as
        // of R15 and summing it would silently turn the one remaining windowed
        // money figure all-time too. `activeWorkerIds` is the same population
        // `people` was built from, so the roster rule above still holds.
        var activeWorkerIds = labourMemberships.Select(m => m.UserId.Value).Distinct().ToList();
        var totalPaid = decimal.Round(
            activeWorkerIds.Sum(id => paidByWorker.GetValueOrDefault(id)) + unattributedPaid,
            2, MidpointRounding.AwayFromZero);
        // (`p.Advance` is nullable ONLY for the D-H8 view projection applied at
        // the single Result.Success site; HERE, pre-projection, it is the
        // builder's own 0m constant from §4 above — this is not a
        // coalesce-a-withheld-figure-to-zero, which stays forbidden.)
        var totalAdvance = decimal.Round(people.Sum(p => p.Advance ?? 0m), 2, MidpointRounding.AwayFromZero);

        // THE MONEY CARD, in full — R13 (ruling, Task 10) for `Owed`, widened
        // to all four of its figures by R15 (ruling, Task 13). Every one of
        // them is a POSITION as of now, so all three inputs come from the
        // ALL-TIME §2b/§3b dictionaries, restricted to the SAME active roster
        // the windowed `totalPaid` above uses — a paid-then-departed worker's
        // historical pay must not drag the balance negative, on any basis.
        //
        // Deriving all four here, from one basis, is what makes the card's own
        // identity — काम झालं = दिलं + उचल + बाकी — true BY CONSTRUCTION rather
        // than by coincidence. Task 9 computed `Recorded`/`Paid` from the
        // window and `Owed` from all time, and the bar drawn from that mix put
        // ₹100 + ₹13,500 inside a ₹1,000 header. If a future task ever needs a
        // windowed काम झालं again, it must be a SEPARATE field with its own
        // label — not these.
        //
        // `totalAdvance` needs no all-time counterpart: Advance is hard-coded
        // 0m for everyone regardless of window (Stage 4 — LabourAdvance — is
        // not built yet), so it already IS the all-time figure.
        //
        // `totalRecordedAllTime`/`totalOwed` are `null` exactly when
        // `hasJobCardEvidenceAllTime` is false — never a fabricated ₹0, and
        // never a balance derived from an unknown. Do NOT gate this on "every
        // person's RecordedWages happens to be null": an active roster with
        // zero members would then vacuously read as "unknown" even when real
        // evidence exists elsewhere (e.g. for a departed worker), which is a
        // different and legitimate `0m` case.
        var totalRecordedAllTime = hasJobCardEvidenceAllTime
            ? decimal.Round(
                activeWorkerIds.Sum(id => recordedWagesByWorkerAllTime.GetValueOrDefault(id)),
                2, MidpointRounding.AwayFromZero)
            : (decimal?)null;
        var totalPaidAllTime = decimal.Round(
            activeWorkerIds.Sum(id => paidByWorkerAllTime.GetValueOrDefault(id)) + unattributedPaidAllTime,
            2, MidpointRounding.AwayFromZero);
        var totalOwed = totalRecordedAllTime is null
            ? (decimal?)null
            : decimal.Round(totalRecordedAllTime.Value - totalPaidAllTime - totalAdvance, 2, MidpointRounding.AwayFromZero);

        // ── 7. Man-days for the WINDOW (interim, from LabourAssignment.WorkerCount
        //       — NO-MULTIPLY descriptive only). ─────────────────────────────
        // Task 9 — the week is no longer computed here at all: the window
        // (§0) owns both bounds, IST-anchored, and this read simply asks for
        // the assignments whose parent log falls inside it. The upper bound is
        // new — the old query was `LogDate >= weekStart` with nothing on the
        // other side, so a day dated ahead of today counted inside "this week".
        var windowAssignments = await repository.GetLabourAssignmentsForFarmInWindowAsync(
            query.FarmId, window.FromDate, window.ToDateInclusive, ct);

        // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — LabourHeadcount.Resolve
        // now returns null for an assignment whose headcount was never stated
        // at all ("we were not told", not "nobody came"). LINQ's own
        // Sum(IEnumerable<int?>) would silently treat that identically to a
        // real 0 — it returns 0 for an all-null (or empty) sequence, never
        // null — which is exactly the fabrication this task removes, just
        // moved from JS `null + n` into LINQ instead of out of it. So it is
        // deliberately not used here.
        //
        // Fix round 1/5 — THREE cases, not two, mirroring Task 1's `hasJobCardEvidence`
        // ruling (R6) correctly instead of inverting it. Task 9 narrows "this
        // week" to "the window" throughout; the rule itself is untouched:
        //   1. NO daily log at all inside the window (`windowLogs`, from the
        //      unfiltered §4 read) — we have no record of those days whatsoever.
        //      Silence is not a statement: UNKNOWN, same polarity as R6.
        //   2. Logs exist inside the window, but NONE of them carries a
        //      LabourAssignment — the farmer told us about those days and none
        //      involved hired labour. That IS a real fact: a genuine 0.
        //   3. Logs carry labour, but no assignment in it ever stated a headcount —
        //      UNKNOWN (unchanged from the first pass at this task).
        // "Assignment contributes nothing to the sum" (not a fabricated 0) still
        // holds inside case 3's mixed sub-case: a known figure among unknowns is
        // never poisoned to null, and an unknown one never drags a known sum down.
        var hasLogsInWindow = windowLogs.Count > 0;
        var resolvedHeadcounts = windowAssignments
            .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
            .ToList();
        var manDays = !hasLogsInWindow
            ? (decimal?)null                                          // case 1: no record of the window at all.
            : resolvedHeadcounts.Count == 0
                ? 0m                                                  // case 2: logged days, none involved labour.
                : resolvedHeadcounts.All(h => h is null)
                    ? (decimal?)null                                  // case 3: labour logged, headcount never stated.
                    : (decimal?)resolvedHeadcounts.Sum(h => h ?? 0);   // real evidence — sum the known ones.

        // ── 8. Review — Draft/Confirmed logs still awaiting the owner. ─────
        // Task 9, FOUNDER RULING — this reads `farmLogs`, the UNFILTERED set,
        // and must keep doing so under every window. The review inbox is an
        // obligation, not a statistic: a day still waiting on the owner's
        // approval does not stop waiting because he switched the dashboard to
        // "आज". Narrowing it would not show him less, it would hide work he
        // owes an answer on, with no signal that anything was hidden. The
        // `Pending` count below is the same list's size for the same reason —
        // if one were windowed and the other not, the tile and the list under
        // it would disagree on one screen.
        //
        // Task 20 (spec: 2026-08-28-labour-v2-release-1) - ordered newest-first
        // by LogDate, the date the card itself SHOWS. It was ModifiedAtUtc,
        // which is when a row was last touched: a three-week-old day re-synced
        // this morning sorted above yesterday's, so the visible date column ran
        // in no order the farmer could see. ModifiedAtUtc stays as the
        // tiebreak, so two logs for the same day still order deterministically.
        var reviewLogs = farmLogs
            .Where(l => l.CurrentVerificationStatus is VerificationStatus.Draft or VerificationStatus.Confirmed
                && VerificationStateMachine.GetAvailableTransitions(
                    l.CurrentVerificationStatus, resolvedCallerRole, hasLabourManagementGrant).Length > 0)
            .OrderByDescending(l => l.LogDate)
            .ThenByDescending(l => l.ModifiedAtUtc)
            .ToList();

        // -- 8a. Task 20 - THE FACTS THE APPROVAL CARD IS JUDGED ON. ---------
        // Every review row used to ship a hard-coded
        // `new LabourPointsDto(null, null, null, null, [])`. The client renders
        // points faithfully, so a mukadam's eight-worker cane-cutting day with
        // a stated total reached the owner as a coloured circle, a name and a
        // relative date - nothing to judge. An owner with a backlog then taps
        // the bulk-approve button and approves work he never saw, after which
        // the record says he checked it. That is worse than having no approval
        // step at all, so the facts are resolved here.
        //
        // The review list reads the UNFILTERED `farmLogs` under every window
        // (founder ruling, above), so its engagements must be read unfiltered
        // too: asking the windowed set would blank the points of every card
        // outside the current window while still showing the card, which is the
        // same defect wearing a different mask. When the window IS alltime the
        // §7 read already returned exactly this set - reuse it rather than
        // hitting Postgres twice for one request (same reasoning as §3b).
        var allAssignments = window.FromDate is null && window.ToDateInclusive is null
            ? windowAssignments
            : await repository.GetLabourAssignmentsForFarmInWindowAsync(query.FarmId, null, null, ct);
        var assignmentsByLogId = allAssignments
            .GroupBy(a => a.DailyLogId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Plot NAMES, and only when some row in the queue actually names a plot
        // - a farm whose logs are all farm-wide has nothing to resolve and
        // should not pay for a query to learn that.
        var plotNameById = reviewLogs.Any(l => l.PlotIds.Count > 0)
            ? (await repository.GetPlotsByFarmIdAsync(query.FarmId.Value, ct))
                .ToDictionary(p => p.Id, p => p.Name)
            : [];

        var review = reviewLogs
            .Select(l =>
            {
                var who = displayNameByUserId.GetValueOrDefault(l.OperatorUserId.Value, "Worker");
                var engagements = assignmentsByLogId.GetValueOrDefault(l.Id) ?? [];

                // Headcount - the SAME rule §7 applies to man-days, one log
                // wide: a known figure among unknowns is never poisoned to null,
                // and an unknown one never counts as a 0. A log carrying no
                // engagement at all (a spraying log, say) is UNKNOWN, not zero -
                // "nobody worked" is a claim nothing in the record makes.
                var headcounts = engagements
                    .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
                    .ToList();
                var count = headcounts.All(h => h is null)
                    ? (int?)null
                    : headcounts.Sum(h => h ?? 0);

                // Shift is reported ONLY when the whole log agrees on one. Two
                // gangs on different shifts have no single shift, and naming the
                // first would state one gang's shift as the day's.
                var shifts = engagements
                    .Where(a => a.Shift is not null)
                    .Select(a => a.Shift!.Value)
                    .Distinct()
                    .ToList();
                var shift = shifts.Count == 1
                    ? shifts[0].ToString().ToLowerInvariant() // the wire union the client's SHIFT_LABEL is keyed by
                    : null;

                var tasks = engagements
                    .Select(a => a.Task)
                    .Where(t => !string.IsNullOrWhiteSpace(t))
                    .Select(t => t!.Trim())
                    .Distinct()
                    .ToList();

                // MONEY - stated totals only. NO-MULTIPLY: WagePerPerson times a
                // headcount is a number the farmer never said, and this is the
                // screen where he commits money. Null when nothing stated a
                // cost - never a fabricated 0, which reads as "this costs you
                // nothing".
                var statedCosts = engagements
                    .Where(a => a.TotalCost is not null)
                    .Select(a => a.TotalCost!.Value)
                    .ToList();

                var names = engagements
                    .SelectMany(a => a.ToDto([]).WorkerNames)
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Distinct()
                    .ToList();

                // WHERE. Only plots this farm still lists are named; an
                // unresolvable id contributes nothing rather than a placeholder.
                // `PlotScope` is what keeps "the farmer said the whole farm" (a
                // stated fact) distinguishable from "we cannot name the plot"
                // (an absence) - the client renders the two differently.
                var plotNames = l.PlotIds
                    .Select(id => plotNameById.GetValueOrDefault(id))
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .ToList();

                return new LabourReviewItemDto(
                    Id: l.Id.ToString(),
                    Who: who,
                    Initial: who.Length > 0 ? who[..1] : "?",
                    Tone: AvatarTones[0],
                    Detail: l.LogDate.ToString("yyyy-MM-dd"),
                    Status: l.CurrentVerificationStatus.ToString(),
                    Points: new LabourPointsDto(
                        Count: count,
                        Shift: shift,
                        Task: tasks.Count > 0 ? string.Join(SeparatorMiddot, tasks) : null,
                        Amount: statedCosts.Count > 0 ? statedCosts.Sum() : null,
                        Names: names),
                    Plot: plotNames.Count > 0 ? string.Join(SeparatorMiddot, plotNames) : null,
                    PlotScope: l.Scope.ToString());
            })
            .ToList();

        // Task 9 — the window's START date, or empty when the window is
        // unbounded (आजपर्यंत has no first day). The field is still named
        // `WeekLabel` on the wire and that name is now too narrow — renaming it
        // is a client-visible contract change and out of this server-side
        // task's scope. It is safe either way: the client suppresses any label
        // that is not a readable range (`features/labour/weekLabel.ts`,
        // `isReadableWeekRange`), and a bare ISO date and an empty string are
        // both suppressed. This never invents a label.
        var weekLabel = window.FromDate is { } windowStart ? $"{windowStart:yyyy-MM-dd}" : string.Empty;

        // Both boundaries of the window that produced every figure below.
        // Empty means unbounded at that end, which the client renders as no
        // range at all rather than inventing one.
        var windowFrom = weekLabel;
        var windowTo = window.ToDateInclusive is { } windowEnd ? $"{windowEnd:yyyy-MM-dd}" : string.Empty;

        var dashboard = new LabourDashboardDto(
            WeekLabel: weekLabel,
            WindowFrom: windowFrom,
            WindowTo: windowTo,
            Insight: string.Empty,
            ManDays: manDays,
            ManDaysTrend: 0,
            Wages: totalPaid,
            Advances: totalAdvance,
            Owed: totalOwed,
            // Task 9 — `Logs` counts records INSIDE the window and is a genuine
            // 0 when there are none. It is not a quantity estimated from
            // evidence (the way मजूर-दिवस is); it IS the evidence count, and
            // the absence of a row is exactly observable. "How many days did I
            // log this week" has an honest answer of zero.
            Logs: windowLogs.Count,
            // ...and `Pending` deliberately does NOT move with the window. See §8.
            Pending: reviewLogs.Count,
            Plots: [],
            // R15 (Task 13) — all four all-time, from §2b/§3b. `Recorded` and
            // `Paid` used to be the windowed `totalRecorded`/`totalPaid` here
            // while `Owed` was already all-time; that mix is the defect. The
            // windowed `totalPaid` is still reported, once, as `Wages` above.
            Money: new LabourMoneyDto(totalRecordedAllTime, totalPaidAllTime, totalAdvance, totalOwed));

        // STAGE 5, superseded (Phase 4) — the हजेरी वही reads attendance MARKS.
        // Engagements contribute exactly two stated facts (उक्ते dot, crew
        // counts) via the work-row join; names on engagements are no longer
        // presence. All three reads are windowed; the work-row read is NOT
        // farm-scoped by itself (PERMISSIVE user policy — see the port's own
        // remarks), so the E4 both-sides filter is applied here.
        var attendanceMarks = await repository.GetAttendanceMarksForFarmInWindowAsync(
            query.FarmId, window.FromDate, window.ToDateInclusive, ct);
        var farmOperators = await repository.GetFieldOperatorsForFarmAsync(query.FarmId, ct);
        var windowLogDateById = windowLogs.ToDictionary(l => l.Id, l => l.LogDate);
        var windowWorkRows = (await repository.GetFieldOperatorWorkRowsForAssignmentsAsync(
                windowAssignments.Select(a => a.Id).ToList(), ct))
            .Where(r => r.FarmId == query.FarmId)
            .ToList();
        var ledger = BuildHajeriLedger(
            weekLabel, window, farmLocalToday, attendanceMarks, farmOperators,
            windowWorkRows, windowAssignments, windowLogDateById);

        // Who has actually been ATTACHED to one of today’s engagements. An
        // attach is a deliberate human act (POST .../field-operators/{id}/attach
        // -> FieldOperatorWorkRow), which is exactly what an attendance row is
        // meant to record. Read per assignment because that is the read the
        // port exposes, and TODAY only, so the loop is over a handful of rows
        // rather than the farm’s history.
        var todaysLogIdSet = farmLogs
            .Where(l => l.LogDate == farmLocalToday)
            .Select(l => l.Id)
            .ToHashSet();
        var todaysWorkRows = new List<FieldOperatorWorkRow>();
        foreach (var assignment in allAssignments.Where(a => todaysLogIdSet.Contains(a.DailyLogId)))
        {
            todaysWorkRows.AddRange(
                await repository.GetFieldOperatorWorkRowsForAssignmentAsync(assignment.Id, ct));
        }

        var attendance = BuildAttendanceDraft(
            farmLogs, allAssignments, plotNameById, farmLocalToday, todaysWorkRows);

        var topLevelIds = people.Select(p => p.Id).ToList();

        var built = new LabourDataDto(
            topLevelIds, people, dashboard, ledger, review, attendance, View: "owner");
        return Result.Success(ApplyRegisterView(built, ResolveRegisterView(resolvedCallerRole)));
    }

    /// <summary>Latest <see cref="FinanceCorrection"/> per <c>CostEntryId</c>, by <c>CorrectedAtUtc</c>.</summary>
    private static Dictionary<Guid, FinanceCorrection> BuildLatestCorrections(IEnumerable<FinanceCorrection> corrections)
        => corrections
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.CorrectedAtUtc).First());

    /// <summary>
    /// §3's payout-aggregation loop, factored out so the WINDOWED pass (feeds
    /// <c>Wages</c>/<c>Money.Paid</c>/per-person <c>Paid</c> — genuine flows)
    /// and the ALL-TIME pass added by R13/Task 10 (feeds <c>Owed</c>'s balance
    /// — see §3b) share one implementation instead of two that could silently
    /// drift apart. Same rounding shape either way: per-entry rounding is a
    /// defensive no-op (amounts are already 2dp at domain construction — see
    /// the MONEY-CONSISTENCY INVARIANT above), and each running sum is rounded
    /// once at the end, not per-addition.
    /// </summary>
    private static (Dictionary<Guid, decimal> ByWorker, decimal Unattributed) AggregatePayouts(
        IEnumerable<(CostEntry CostEntry, Guid? AssignedWorkerUserId)> rows,
        IReadOnlyDictionary<Guid, FinanceCorrection> latestCorrections)
    {
        var byWorker = new Dictionary<Guid, decimal>();
        decimal unattributed = 0m;
        foreach (var (entry, assignedWorkerUserId) in rows)
        {
            var hasCorrection = latestCorrections.TryGetValue(entry.Id, out var latestCorrection);
            var effectiveAmount = decimal.Round(
                hasCorrection ? latestCorrection!.CorrectedAmount : entry.Amount,
                2, MidpointRounding.AwayFromZero);

            if (assignedWorkerUserId is not { } workerId)
            {
                unattributed += effectiveAmount; // orphaned payout (no linked JobCard/worker) — not attributable to a person.
                continue;
            }

            byWorker[workerId] = byWorker.GetValueOrDefault(workerId) + effectiveAmount;
        }

        unattributed = decimal.Round(unattributed, 2, MidpointRounding.AwayFromZero);
        foreach (var workerId in byWorker.Keys.ToList())
        {
            byWorker[workerId] = decimal.Round(byWorker[workerId], 2, MidpointRounding.AwayFromZero);
        }

        return (byWorker, unattributed);
    }

    /// <summary>
    /// STAGE 5, superseded — the हजेरी वही now reads ATTENDANCE MARKS (Phase 4,
    /// Labour V2 R1), not names on engagements. A cell is a RULING somebody
    /// made about a person on a farm-day; a person merely NAMED on a work
    /// engagement has said nothing about attendance and gets no cell (being
    /// named is not being marked — the same line BuildAttendanceDraft draws).
    ///
    /// <para><b>The page is always drawn</b> (correction 5): a bounded window
    /// enumerates every one of its days; an unbounded (आजपर्यंत) window shows
    /// every date that carries any fact, and when nothing does, the current
    /// farm-local week — day columns with every cell blank. The build takes no
    /// anchor, no headcount and no permission-to-capture as input, and that is
    /// pinned on its signature by BuildHajeriLedgerTests.</para>
    ///
    /// <para><b>What engagements still contribute</b> — exactly two stated
    /// facts, joined via work rows, never presence: the उक्ते dot (a person-day
    /// work row points at an engagement whose ContractUnit is stated) and the
    /// crew aggregate rows (engagements engaged-through a Labour Mukadam,
    /// per-day stated counts). Nothing here sums a mark, multiplies anything,
    /// or reads AttendanceMark.Value (which is [Obsolete]).</para>
    /// </summary>
    internal static LabourLedgerDto BuildHajeriLedger(
        string weekLabel,
        LabourTimeWindow window,
        DateOnly farmLocalToday,
        IReadOnlyList<AttendanceMark> marks,
        IReadOnlyList<FieldOperator> operators,
        IReadOnlyList<FieldOperatorWorkRow> workRows,
        IReadOnlyList<LabourAssignment> windowAssignments,
        IReadOnlyDictionary<Guid, DateOnly> logDateByLogId)
    {
        // ── 1. Day columns. Bounded window → every day of it, drawn whether or
        //       not anything happened. Unbounded → every date carrying a fact;
        //       none at all → the current farm-local week, blank. ─────────────
        List<DateOnly> days;
        if (window.FromDate is { } from && window.ToDateInclusive is { } to)
        {
            days = [];
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                days.Add(d);
            }
        }
        else
        {
            days = marks.Select(m => m.WorkDate)
                .Concat(logDateByLogId.Values)
                .Distinct()
                .OrderBy(d => d)
                .ToList();
            if (days.Count == 0)
            {
                // Monday-anchored, same arithmetic as LabourTimeWindow.StartOfWeek.
                var monday = farmLocalToday.AddDays(-(((int)farmLocalToday.DayOfWeek + 6) % 7));
                days = Enumerable.Range(0, 7).Select(offset => monday.AddDays(offset)).ToList();
            }
        }

        var dayIndex = days
            .Select((date, index) => (date, index))
            .ToDictionary(pair => pair.date, pair => pair.index);

        var nameByOperatorId = operators.ToDictionary(o => o.Id, o => o.DisplayName);
        var assignmentById = windowAssignments.ToDictionary(a => a.Id);
        var workRowsByPersonDay = workRows
            .Where(r => dayIndex.ContainsKey(r.WorkDate))
            .GroupBy(r => (r.FieldOperatorId, r.WorkDate))
            .ToDictionary(g => g.Key, g => g.ToList());

        // ── 2. One row per marked person; one cell per mark. ────────────────
        var cellsByOperator = new Dictionary<Guid, LabourLedgerCellDto?[]>();
        foreach (var mark in marks)
        {
            if (!dayIndex.TryGetValue(mark.WorkDate, out var index))
            {
                continue; // a mark outside the drawn days (unbounded edge) has no column
            }

            if (!cellsByOperator.TryGetValue(mark.FieldOperatorId, out var cells))
            {
                cells = new LabourLedgerCellDto?[days.Count];
                cellsByOperator[mark.FieldOperatorId] = cells;
            }

            var contextRows = workRowsByPersonDay.TryGetValue(
                (mark.FieldOperatorId, mark.WorkDate), out var personDayRows)
                ? personDayRows
                : new List<FieldOperatorWorkRow>();
            var contextAssignments = contextRows
                .Select(r => assignmentById.GetValueOrDefault(r.LabourAssignmentId))
                .Where(a => a is not null)
                .Select(a => a!)
                .ToList();
            var tasks = contextAssignments
                .Select(a => a.Task)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!.Trim())
                .Distinct()
                .ToList();

            cells[index] = new LabourLedgerCellDto(
                Day: mark.Day switch
                {
                    DayMark.Full => "full",
                    DayMark.Half => "half",
                    DayMark.Absent => "absent",
                    _ => null, // Unmarked: the day half was never ruled on
                },
                Night: mark.Night switch
                {
                    NightMark.Worked => "worked",
                    NightMark.NotWorked => "notworked",
                    _ => null,
                },
                Hours: mark.HoursWorked,        // as stated — never converted to day fractions
                ExtraHours: mark.ExtraHours,    // as stated
                Ukte: contextAssignments.Any(a => a.ContractUnit is not null),
                Work: tasks.Count == 0 ? null : string.Join(SeparatorMiddot, tasks));
        }

        var rows = cellsByOperator
            .Select(pair =>
            {
                // The operator row should always resolve (marks are written against
                // this farm's operators); the attach-time snapshot is the honest
                // fallback for a rename/erasure race — never an invented name.
                var name = nameByOperatorId.TryGetValue(pair.Key, out var displayName)
                    ? displayName
                    : workRows.FirstOrDefault(r => r.FieldOperatorId == pair.Key)?.DisplayNameAtAttach ?? string.Empty;
                return new LabourLedgerRowDto(
                    PersonId: $"op:{pair.Key:N}",
                    FieldOperatorId: pair.Key,
                    Name: name,
                    Initial: FirstLetterOf(name),
                    Tone: ToneFor(name),
                    Cells: pair.Value);
            })
            .OrderBy(row => row.Name, StringComparer.Ordinal)
            .ToList();

        // ── 3. Crew aggregate rows — engagements engaged THROUGH a Labour
        //       Mukadam (final direction §3). Stated counts only: known figures
        //       sum, an unstated engagement poisons nothing, all-unknown is
        //       null → the client draws a blank violet cell, never a 0. ───────
        var crewRows = windowAssignments
            .Where(a => a.EngagedThroughFieldOperatorId is not null
                && logDateByLogId.TryGetValue(a.DailyLogId, out var d)
                && dayIndex.ContainsKey(d))
            .GroupBy(a => a.EngagedThroughFieldOperatorId!.Value)
            .Select(group =>
            {
                var counts = new int?[days.Count];
                foreach (var byDay in group.GroupBy(a => logDateByLogId[a.DailyLogId]))
                {
                    var stated = byDay
                        .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
                        .Where(h => h is not null)
                        .Select(h => h!.Value)
                        .ToList();
                    counts[dayIndex[byDay.Key]] = stated.Count == 0 ? null : stated.Sum();
                }

                var throughName = nameByOperatorId.GetValueOrDefault(group.Key, string.Empty);
                return new LabourLedgerCrewRowDto(group.Key, throughName, counts);
            })
            .OrderBy(crew => crew.ThroughName, StringComparer.Ordinal)
            .ToList();

        return new LabourLedgerDto(
            WeekLabel: weekLabel,
            Days: days.Select(date => date.ToString("yyyy-MM-dd")).ToList(),
            Rows: rows,
            CrewRows: crewRows);
    }

    /// <summary>
    /// First visible character of a spoken name, for the avatar. Uses a text
    /// element, not an index: Devanagari letters carry combining matras, and
    /// slicing one UTF-16 unit off "कांतीलाल" yields a broken glyph.
    /// </summary>
    /// <summary>
    /// D-H8: which of the three register views this caller gets. Resolved on
    /// the SAME role the handler already authorises with (:174-178) — the
    /// boundary Phase 0 documented. Owner tier = the whole book; Mukadam =
    /// attendance without a money roster (D-H9's per-confirmation disclosure
    /// is a later confirmation feature — until it exists he sees no money at
    /// all); everything else = own-row (empty until an account↔FieldOperator
    /// link exists — FieldOperator carries no user member, verified).
    /// </summary>
    internal static LabourRegisterView ResolveRegisterView(AppRole role) => role switch
    {
        AppRole.PrimaryOwner or AppRole.SecondaryOwner => LabourRegisterView.OwnerBook,
        AppRole.Mukadam => LabourRegisterView.CrewAttendance,
        _ => LabourRegisterView.OwnRow,
    };

    /// <summary>
    /// Projects one built response into the caller's view. Money members go
    /// ABSENT (null) for non-owner views — blank is not zero, and a withheld
    /// figure must be indistinguishable from "nothing stated" to its reader
    /// rather than fabricated as ₹0. Attendance stays: "An attendance register
    /// is safe to show anyone on the farm. A wage book is not." (D-H8.)
    /// </summary>
    internal static LabourDataDto ApplyRegisterView(LabourDataDto dto, LabourRegisterView view)
    {
        if (view == LabourRegisterView.OwnerBook)
        {
            return dto with { View = "owner" };
        }

        var people = dto.People
            .Select(p => p with { RecordedWages = null, Paid = null, Advance = null })
            .ToList();
        var dashboard = dto.Dashboard with { Wages = null, Advances = null, Owed = null, Money = null };
        var review = dto.Review
            .Select(r => r with { Points = r.Points with { Amount = null } })
            .ToList();
        var ledger = view == LabourRegisterView.OwnRow
            ? dto.Ledger with { Rows = [], CrewRows = [] }
            : dto.Ledger;

        return dto with
        {
            View = view == LabourRegisterView.CrewAttendance ? "crew" : "own",
            People = people,
            Dashboard = dashboard,
            Review = review,
            Ledger = ledger,
        };
    }

    private static string FirstLetterOf(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
        {
            return string.Empty;
        }

        var enumerator = System.Globalization.StringInfo.GetTextElementEnumerator(trimmed);
        return enumerator.MoveNext() ? (string)enumerator.Current : trimmed[..1];
    }

    /// <summary>
    /// Avatar tint, chosen deterministically from the name so the same person
    /// keeps the same colour across days and requests. Cosmetic only — it encodes
    /// no fact about the worker.
    /// </summary>
    private static string ToneFor(string name)
    {
        string[] tones = ["em", "or", "bl", "am", "vi"];
        var hash = 0;
        foreach (var ch in name)
        {
            hash = unchecked((hash * 31) + ch);
        }

        return tones[Math.Abs(hash % tones.Length)];
    }

    /// <summary>
    /// STAGE 5 — today's attendance draft, no longer hardcoded to an empty plot
    /// and a zero headcount.
    ///
    /// <para><b>Headcount follows the same four cases as मजूर-दिवस</b>, using the
    /// SAME resolver (<c>LabourHeadcount.Resolve</c>) so the two can never
    /// disagree about what a crew size was: no log today at all is <c>null</c>;
    /// a logged day with no labour on it is a genuine <c>0</c>; labour with
    /// nobody saying how many is <c>null</c>, never 0; otherwise the sum of the
    /// counts actually stated.</para>
    ///
    /// <para><b>Rows stays empty, and that is the correct answer rather than an
    /// unfinished one.</b> A row exists only where the farmer deliberately
    /// tapped present/half/absent, and no save path carries those taps yet.
    /// Deriving rows from spoken NAMES would be the tempting shortcut and the
    /// wrong one: being named as present is not the same act as being marked,
    /// and filling the register with marks he never made is how a screen starts
    /// asserting things on his behalf. The names are already visible in the
    /// हजेरी वही, which is a record of what was said, not of what was ruled.</para>
    /// </summary>
    // internal for the same reason BuildHajeriLedger is: the four headcount
    // cases (and the rule that Rows stays empty) are the value here, and they
    // are pinned directly rather than through a handler round-trip.
    internal static LabourAttendanceDraftDto BuildAttendanceDraft(
        IReadOnlyList<DailyLog> farmLogs,
        IReadOnlyList<LabourAssignment> allAssignments,
        IReadOnlyDictionary<Guid, string> plotNameById,
        DateOnly farmLocalToday,
        IReadOnlyList<FieldOperatorWorkRow> todaysWorkRows)
    {
        var todaysLogs = farmLogs.Where(l => l.LogDate == farmLocalToday).ToList();
        if (todaysLogs.Count == 0)
        {
            // Nothing logged today. NOT a zero headcount — nobody has said
            // anything about today yet, and 0 would claim they had.
            return new LabourAttendanceDraftDto(string.Empty, null, [], string.Empty);
        }

        var todaysLogIds = todaysLogs.Select(l => l.Id).ToHashSet();
        var todaysAssignments = allAssignments
            .Where(a => todaysLogIds.Contains(a.DailyLogId))
            .ToList();

        var resolved = todaysAssignments
            .Select(a => LabourHeadcount.Resolve(a.WorkerCount, a.MaleCount, a.FemaleCount))
            .ToList();

        var headcount = resolved.Count == 0
            ? 0                                        // logged today, no labour on it — a real zero.
            : resolved.All(h => h is null)
                ? (int?)null                           // labour today, headcount never stated.
                : resolved.Sum(h => h ?? 0);           // sum only what was actually stated.

        // The plot only when today speaks with ONE voice. Two plots worked today
        // is not one plot to name, and picking the first would put a plot on the
        // screen the farmer never singled out.
        var todaysPlotIds = todaysLogs.SelectMany(l => l.PlotIds).Distinct().ToList();
        var plot = todaysPlotIds.Count == 1
            ? plotNameById.GetValueOrDefault(todaysPlotIds[0], string.Empty)
            : string.Empty;

        // One row per operator ATTACHED to today’s work, deduplicated: the same
        // person on two engagements today is one person present, not two.
        //
        // Status is "present" and only "present". A work row records that someone
        // DID the work; it carries no half-day and no absence, and there is no
        // other source for either. Emitting "absent" for anyone unattached would
        // be the fabrication this whole screen guards against — an unattached
        // worker has no row at all, which is how "not yet said" is expressed
        // here (see LabourAttendanceRowDto). Half-days remain unrepresentable
        // until something can record one; that gap is real and stated, not
        // papered over with a default.
        var rows = todaysWorkRows
            .Select(r => r.FieldOperatorId)
            .Distinct()
            .OrderBy(id => id)
            .Select(id => new LabourAttendanceRowDto(id.ToString(), "present"))
            .ToList();

        // Exactly one engagement today, or none named. See the DTO member.
        var soleAssignmentId = todaysAssignments.Count == 1
            ? todaysAssignments[0].Id.ToString()
            : string.Empty;

        return new LabourAttendanceDraftDto(plot, headcount, rows, soleAssignmentId);
    }
}

/// <summary>D-H8's three views. Internal — the wire carries the string form on <see cref="LabourDataDto.View"/>.</summary>
internal enum LabourRegisterView
{
    OwnerBook = 0,
    CrewAttendance = 1,
    OwnRow = 2,
}
