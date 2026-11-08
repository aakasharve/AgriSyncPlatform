using ShramSafal.Domain.AI;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;
using ShramSafal.Domain.Work;
using ShramSafal.Application.Contracts.Dtos;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;


namespace ShramSafal.Application.Ports;

/// <summary>
/// User-scoped my-farms projection row — one per farm the caller owns or holds a
/// seat on that has not ended, with the caller's role on that farm. Returned by
/// <see cref="IShramSafalRepository.GetMyFarmsAsync"/> for the
/// <c>/shramsafal/farms/mine</c> read path.
/// <para>spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — <paramref name="Status"/> says
/// whether that seat is Active (access) or only a relationship (a PendingApproval request,
/// a Suspended seat). The registrant is always <see cref="MembershipStatus.Active"/>.
/// Optional and last, so existing constructions keep compiling.</para>
/// </summary>
public sealed record MyFarmProjection(
    Guid FarmId,
    string Name,
    string? FarmCode,
    Guid OwnerAccountId,
    AppRole? Role,
    MembershipStatus Status = MembershipStatus.Active,
    string? StatusReason = null);

/// <summary>
/// Labour V2 R1 Task 3.5b — one engagement's day-fact about a person, as read
/// by <c>RecordAttendanceMarkHandler</c>'s pre-persistence contradiction
/// check. <c>Shift</c> is <c>null</c> when the engagement made no day claim
/// ("no claim → no question", GetLabourDataHandler.cs agreement idiom).
/// </summary>
/// <param name="DailyLogId">spec: plr-d10 lane PRV fix pass 2 (N1) — the record the engagement belongs to, so a check
/// asks only the engagements on records the sender may see. Empty only from a test double that does not say.</param>
public sealed record AttendanceEngagementFact(Guid LabourAssignmentId, string? Task, LabourShift? Shift, Guid DailyLogId = default);

public interface IShramSafalRepository
{
    Task AddFarmAsync(Farm farm, CancellationToken ct = default);

    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION): required member.
    // Was previously a default-impl that threw NotImplementedException —
    // a runtime landmine if a future implementor forgot to override.
    // Production ShramSafalRepository overrides; every test stub now
    // overrides as well (most as Task.CompletedTask no-ops).
    Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default);
    Task<FarmBoundary?> GetActiveFarmBoundaryAsync(Guid farmId, CancellationToken ct = default)
        => Task.FromResult<FarmBoundary?>(null);
    Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default);
    Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default);

    /// <summary>
    /// The caller's seat on the farm that has not ended (any status but Revoked / Exited),
    /// with its <see cref="FarmMembership.Status"/> — a RELATIONSHIP read, not an access
    /// check (spec plr-d7-m1-multiuser-2026-10-26 step 1). Join idempotency reads it; a
    /// caller that means "may act on this farm" must check <c>IsActive</c> or use one of the
    /// Active-only gates below.
    /// </summary>
    Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// The role the user may ACT as on the farm: <see cref="AppRole.PrimaryOwner"/> for the
    /// declared owner, otherwise the role of an <c>Active</c> seat, otherwise <c>null</c>.
    /// spec plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1): a PendingApproval request's
    /// placeholder role and a Suspended seat's role are NOT returned.
    /// </summary>
    Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);
    Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);

    Task AddPlotAsync(Plot plot, CancellationToken ct = default);
    Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default);
    Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default);

    Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default);
    Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default);
    Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default);

    Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default);

    // Track B B2.8 — stage a WeatherStamp on the DbSet (no SaveChanges; the
    // caller's existing SaveChangesAsync commits it in the same unit of work
    // as the DailyLog). Production ShramSafalRepository overrides with the EF
    // AddAsync. A default no-op impl is used (not a required member) so the
    // ~28 in-tree IShramSafalRepository test doubles keep compiling untouched —
    // the same convention the other recent additive ports here follow (e.g.
    // UpsertRawBlobIndexAsync). Weather-stamp persistence is best-effort /
    // NON-BLOCKING anyway, so a test double that no-ops it is harmless.
    Task AddWeatherStampAsync(WeatherStamp stamp, CancellationToken ct = default)
        => Task.CompletedTask;
    Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 (lane OF-S) — the log, read for a CHANGE that must not race another one (a move of its place or
    /// day): the row is held (<c>SELECT … FOR UPDATE</c>) for the rest of the caller's transaction and the record is
    /// re-read after the hold, so its version is the one a second writer cannot move underneath this change. The
    /// default (an in-memory or test repository, no row locks) is the ordinary read.
    /// </summary>
    Task<DailyLog?> GetDailyLogForChangeAsync(Guid dailyLogId, CancellationToken ct = default)
        => GetDailyLogByIdAsync(dailyLogId, ct);

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 1, B002) — every stored version of what Sathi understood for this log, oldest
    /// first (append-only rows). The move reads the line ids of ALL versions: money made from a line that a later edit
    /// removed is still that record's money. Default: none.
    /// </summary>
    Task<IReadOnlyList<DailyLogContent>> GetDailyLogContentVersionsAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLogContent>>([]);

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 1, B010) — the observations made from this log, TRACKED (the move changes their
    /// plot in the same unit of work). Default: none.
    /// </summary>
    Task<IReadOnlyList<ObservationEvent>> GetObservationEventsForChangeAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ObservationEvent>>([]);
    Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.5) — every log that has NEVER been touched
    /// by the verification FSM, oldest first, TRACKED so the caller can attest to them.
    ///
    /// <para><b>Why "no events at all" is the right predicate, and the whole guard.</b>
    /// <c>DailyLog.CurrentVerificationStatus</c> folds the events and defaults to
    /// <c>Draft</c>, so "reads Draft" is ambiguous: it covers a log nobody has ever
    /// assessed AND a log a human deliberately re-opened (<c>Edit</c> writes a real Draft
    /// event; <c>AddLogTaskHandler</c> walks an attested day back to Draft to re-cover new
    /// content). Backfilling on "reads Draft" would therefore stamp approval over a
    /// re-opening somebody performed on purpose. An EMPTY event list cannot mean that:
    /// nothing has ever been asserted about this day by anyone, which is precisely and
    /// only the population wave-1.3 left behind. It also makes the backfill self-limiting
    /// — a log it has attested to has two events and can never be a candidate again, so
    /// re-running is a no-op with no marker table to keep in sync.</para>
    ///
    /// <para><b>Why it takes a cursor and not just a limit (wave-1.5 review, I1).</b> Not
    /// every candidate can be repaired: a mukadam's day, or one whose creator has left the
    /// farm, is REFUSED and therefore stays a candidate forever — it has no verification
    /// events and never will until a human presses approve. Ordered oldest-first, a run of
    /// such rows holds the front of the result set on every re-read, so a caller that only
    /// ever asks for "the first N candidates" re-reads the same refusals and can never see
    /// what sorts behind them. With <paramref name="afterCreatedAtUtc"/> /
    /// <paramref name="afterId"/> the caller walks FORWARD through the whole candidate set
    /// instead, and an owner's stuck day behind 500 un-attestable ones is reached. Keyset,
    /// not OFFSET, because the set shrinks underneath the walk as rows are repaired — an
    /// offset would skip rows as it slid.</para>
    ///
    /// <para>Default no-op so the ~28 in-tree test doubles keep compiling, per the
    /// additive-port convention above.</para>
    /// </summary>
    /// <param name="limit">Maximum candidates to return in this page.</param>
    /// <param name="afterCreatedAtUtc">
    /// Exclusive lower bound on <c>CreatedAtUtc</c> from the previous page's last row.
    /// Null (with <paramref name="afterId"/>) starts from the oldest candidate.
    /// </param>
    /// <param name="afterId">
    /// Tie-break half of the cursor: rows sharing <paramref name="afterCreatedAtUtc"/> are
    /// included only if their id sorts after this one. Both halves are required —
    /// <c>CreatedAtUtc</c> alone is not unique, and a bulk import can give many logs the
    /// same timestamp.
    /// </param>
    /// <param name="ct">Cancellation.</param>
    Task<IReadOnlyList<DailyLog>> GetDailyLogsWithNoVerificationHistoryAsync(
        int limit, DateTime? afterCreatedAtUtc, Guid? afterId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLog>>(Array.Empty<DailyLog>());

    Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default);
    Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane BILL-1 (founder D-12) — the bill, read for a change that must not race another one (an approval of
    /// its version, a correction that makes a new version): the row is held (<c>SELECT … FOR UPDATE</c>) for the rest of the
    /// caller's transaction and re-read after the hold, so the version compared is one a second writer cannot move
    /// underneath it (the L6 S7 lesson). The default (an in-memory or test repository, no row locks) is the ordinary read.
    /// </summary>
    Task<CostEntry?> GetCostEntryForChangeAsync(Guid costEntryId, CancellationToken ct = default)
        => GetCostEntryByIdAsync(costEntryId, ct);

    /// <summary>
    /// lane BILL-1 fix round 1 (review M2) — the same hold for several bills at once (a record edit or a move changes all its
    /// money in one save): every row held in id order (so two such changes never deadlock), then re-read. Every path that
    /// raises a bill's version takes this hold first, so two simultaneous changes raise it twice. Default: the ordinary read.
    /// </summary>
    Task<List<CostEntry>> GetCostEntriesForChangeAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
        => GetCostEntriesByIdsAsync(costEntryIds, ct);

    /// <summary>
    /// lane BILL-1 — stage one मंजूर stamp (append-only; the caller's single SaveChanges commits it with its audit row). The
    /// default refuses: a repository that cannot keep a stamp must never answer as if it had (P5).
    /// </summary>
    Task AddCostEntryApprovalAsync(CostEntryApproval approval, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot keep a bill's approval stamp.");

    /// <summary>
    /// lane BILL-1 — every stamp of these bills, as the caller's tenant scope can see them (the pull is user-scoped: the
    /// Active-member read policy). Callers still match each stamp's farm to its bill's farm (E4). Default: none.
    /// </summary>
    Task<IReadOnlyList<CostEntryApproval>> GetCostEntryApprovalsAsync(IReadOnlyCollection<Guid> costEntryIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<CostEntryApproval>>([]);

    // ── spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) — his हो / नाही / फोटो answers about
    // the products of a saved record (ssf.input_identity_assertions). APPEND-ONLY by privilege: the app role holds SELECT and
    // INSERT only, so there is no update or delete counterpart here; the newest row for an item (asserted_at_utc) is current.

    /// <summary>
    /// Stages one answer (no SaveChanges: the caller's single save commits it with its audit row). The default refuses: a
    /// repository that cannot keep an answer must never answer as if it had (P5).
    /// </summary>
    Task AddInputIdentityAssertionAsync(InputIdentityAssertion assertion, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot keep a product-identity answer.");

    /// <summary>
    /// The answer this farm already kept for this sync request (a re-sent answer), or null. Matched on the farm AND the request
    /// id, the unique key the table keeps (<c>ux_input_identity_assertions_farm_mutation</c>).
    /// </summary>
    Task<InputIdentityAssertion?> GetInputIdentityAssertionByClientMutationIdAsync(
        Guid farmId, string clientMutationId, CancellationToken ct = default)
        => Task.FromResult<InputIdentityAssertion?>(null);

    /// <summary>
    /// The CURRENT answer of each item of these records: per (record, input event, mix slot, speaker-or-check) the newest by
    /// <c>asserted_at_utc</c>, only where the answer's farm is its record's farm (E4). The pull reads it for a record
    /// RE-ADMITTED to a reader, whose answers go with it whatever their age. The default REFUSES: a store that cannot answer
    /// must never look as though the record has no answers (it would silently hide them).
    /// </summary>
    Task<IReadOnlyList<InputIdentityAssertion>> GetLatestInputIdentityAssertionsForLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot read the newest product-identity answers of a record.");

    /// <summary>
    /// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, founder D-94) — EVERY answer ever kept for these records,
    /// oldest first (<c>asserted_at_utc</c>, then id), only where the answer's farm is its record's farm (E4). The day's
    /// points read it to find the FIRST answer that could count for a product, whichever day it was given. The default
    /// REFUSES: a store that cannot answer must never look as though the records have no answers (the day's points would be
    /// stamped lower).
    /// </summary>
    Task<IReadOnlyList<InputIdentityAssertion>> GetInputIdentityAssertionsForLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot read every product-identity answer of a record.");

    /// <summary>
    /// lane IT3 — the answers this farm took in the window <paramref name="fromUtc"/> (inclusive) to
    /// <paramref name="toUtcExclusive"/>, oldest first: the answers of one farm-local day. The default REFUSES (see above).
    /// </summary>
    Task<IReadOnlyList<InputIdentityAssertion>> GetInputIdentityAssertionsGivenBetweenAsync(
        Guid farmId, DateTime fromUtc, DateTime toUtcExclusive, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot read the product-identity answers of a day.");

    // ── spec: plr-d10 lane L8c-1 (founder D-24c) — planned work and reminders (ssf.planned_work, ssf.planned_work_plots). No
    // DELETE exists: a plot taken off a task is a Dropped row, and a cancelled task is a Cancelled one.

    /// <summary>Stages a new task with its plot rows (no SaveChanges). The default refuses (P5).</summary>
    Task AddPlannedWorkAsync(PlannedWork work, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot keep planned work.");

    /// <summary>
    /// The task with this id and its plot rows, TRACKED (the caller changes it and saves), as the caller's tenant scope can
    /// see it (under FORCE RLS only the farm in scope; another farm's row is not found). Default: none.
    /// </summary>
    Task<PlannedWork?> GetPlannedWorkByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult<PlannedWork?>(null);

    /// <summary>
    /// Saves a change to a task and its audit row. <c>false</c> when another change to the SAME task was saved first (the row
    /// version, <c>xmin</c>, moved): nothing of this change is kept and the tracked state is discarded, so the caller answers
    /// "this work was changed first" and never overwrites the winner. Any other failure throws. Provider specifics never leave
    /// Infrastructure. Default body = plain save.
    /// </summary>
    async Task<bool> TrySavePlannedWorkChangeAsync(CancellationToken ct = default)
    {
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// The pull and the REST list: tasks of these farms changed after <paramref name="sinceUtc"/>, with their plot rows,
    /// untracked, oldest change first. Which of them a reader may see is <c>PlannedWorkVisibility</c>'s, applied by the caller.
    /// </summary>
    Task<List<PlannedWork>> GetPlannedWorkChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<PlannedWork>());

    /// <summary>The pull: answers kept on these farms strictly after <paramref name="sinceUtc"/>, oldest first.</summary>
    Task<List<InputIdentityAssertion>> GetInputIdentityAssertionsChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<InputIdentityAssertion>());

    /// <summary>
    /// spec: pre-launch-repair L2b (R-1) — the stored cost entry with this id, read-only and untracked, as the
    /// caller's tenant scope can see it (under FORCE RLS only the farm in scope; a row of another farm reaches
    /// the write as a primary-key clash instead, which the sync push turns into the typed conflict), or
    /// <c>null</c>. Used by <c>AddCostEntryHandler</c> to answer a repeat of an id it already holds.
    /// Default body = "none stored", so the in-tree test doubles compile (A10); production overrides it.
    /// </summary>
    Task<CostEntry?> FindCostEntryForReplayAsync(Guid costEntryId, CancellationToken ct = default)
        => Task.FromResult<CostEntry?>(null);

    Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default);
    Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default);
    Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default);
    Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default);
    Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default);
    Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default);
    Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default);
    Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default);
    Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default);

    Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default);
    Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default);

    Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default);
    Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default);

    // ── spec: plr-d10 lane SCH-A (Task 1/4; founder D-74) - ShramSafal's check of a library schedule (ssf.schedule_checks).
    // APPEND-ONLY by privilege: the app role holds SELECT and INSERT only, so there is no update or delete counterpart. ──

    /// <summary>Stages one check (no SaveChanges: the caller's single save commits it with its audit row). The default
    /// refuses: a repository that cannot keep a check must never answer as if it had (P5).</summary>
    Task AddScheduleCheckAsync(ScheduleCheck check, CancellationToken ct = default)
        => throw new NotSupportedException("This repository cannot keep a schedule check.");

    /// <summary>Every check of these library rows (any order). The default is "no checks": a repository that keeps none
    /// reads every row NotChecked, which is also what a built-in sample is.</summary>
    Task<IReadOnlyList<ScheduleCheck>> GetScheduleChecksAsync(
        IReadOnlyCollection<Guid> scheduleTemplateIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ScheduleCheck>>([]);
    Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default);
    Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);
    Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);

    Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default);

    Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);

    // ADR 0019 / sync-pull-user-scoped-rls-read-path-2026-06-07 R3:
    // farm-filtered changed-since overloads. Production overrides push the
    // farm scope into SQL before RLS evaluates per-row user-scoped policies;
    // default implementations keep existing test doubles source-compatible.
    Task<List<Farm>> GetFarmsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetFarmsChangedSinceAsync(sinceUtc, ct);
    Task<List<Plot>> GetPlotsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetPlotsChangedSinceAsync(sinceUtc, ct);
    Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetCropCyclesChangedSinceAsync(sinceUtc, ct);
    Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetDailyLogsChangedSinceAsync(sinceUtc, ct);
    Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetCostEntriesChangedSinceAsync(sinceUtc, ct);
    Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetFinanceCorrectionsChangedSinceAsync(sinceUtc, ct);
    Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetDayLedgersChangedSinceAsync(sinceUtc, ct);
    Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetPlannedActivitiesChangedSinceAsync(sinceUtc, ct);
    Task<List<Attachment>> GetAttachmentsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => GetAttachmentsChangedSinceAsync(sinceUtc, ct);
    /// <summary>
    /// §P0.2 — this default used to FAIL OPEN. It forwarded to the unscoped
    /// overload, so any implementation that did not override it answered a
    /// farm-scoped audit request with the WHOLE ledger, silently, while the
    /// call site read as if it were scoped. Roughly 25 test doubles implement
    /// only the unscoped overload, so deleting the default is a suite-wide
    /// compile break and keeping the forward preserves the hazard.
    ///
    /// Throwing is the third option: a double that never calls this is
    /// unaffected, and one that does gets a loud stop instead of the ledger.
    /// The production override in ShramSafalRepository is the only real
    /// implementation.
    /// </summary>
    Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAuditEventsChangedSinceAsync(farmIds, ...) has no fail-open default. "
            + "Forwarding to the unscoped overload returned the entire audit ledger "
            + "for a farm-scoped request (§P0.2). Override it on this implementation.");

    Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default);

    /// <summary>
    /// lane 2b fix 1 (MEDIUM-1) — how many audit rows of (<paramref name="entityType"/>,
    /// <paramref name="action"/>) <paramref name="actorUserId"/> has on <paramref name="farmId"/> in
    /// [<paramref name="fromUtc"/>, <paramref name="toUtcExclusive"/>). No fail-open default: a double
    /// that is asked gets a loud stop (the caller logs and counts it), never a made-up zero.
    /// </summary>
    Task<int> CountAuditEventsByActorAsync(
        Guid farmId, Guid actorUserId, string entityType, string action,
        DateTime fromUtc, DateTime toUtcExclusive, CancellationToken ct = default)
        => throw new NotSupportedException(
            "CountAuditEventsByActorAsync has no fail-open default. Override it on this implementation.");
    Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane PRV fix pass 3 (M-B) — the farm's audit rows of these actions (the server's own notes it derives
    /// a screen state from; never sent to a phone). Default: none, so in-tree doubles keep compiling.
    /// </summary>
    Task<IReadOnlyList<AuditEvent>> GetAuditEventsForFarmByActionsAsync(
        Guid farmId, IReadOnlyCollection<string> actions, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<AuditEvent>>([]);

    /// <summary>
    /// spec: plr-d10 lane MU-1 (PRV REVIEW-4 N-4) — the same read, BOUNDED: only rows from <paramref name="sinceUtc"/> on,
    /// newest first, at most <paramref name="limit"/>. A screen's state is never derived from an unbounded read of an
    /// append-only table. Default body: the unbounded read narrowed in memory (a test double); production overrides in SQL.
    /// </summary>
    async Task<IReadOnlyList<AuditEvent>> GetAuditEventsForFarmByActionsAsync(
        Guid farmId, IReadOnlyCollection<string> actions, DateTime sinceUtc, int limit, CancellationToken ct = default)
        => (await GetAuditEventsForFarmByActionsAsync(farmId, actions, ct))
            .Where(a => a.OccurredAtUtc >= sinceUtc)
            .OrderByDescending(a => a.OccurredAtUtc)
            .Take(limit)
            .ToList();

    /// <summary>
    /// The farms whose data this user may read (the sync pull's farm list): owned, or an
    /// <c>Active</c> seat. spec plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1): a
    /// PendingApproval request or a Suspended seat contributes no farm.
    /// </summary>
    Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// User-scoped my-farms projection (owner farms + every seat that has not ended,
    /// with the caller's role and seat status per farm — spec plr-d7-m1-multiuser-2026-10-26
    /// step 1: a pending request is listed so the person can see THAT it is pending; it
    /// grants nothing). Opens its OWN transaction and emits
    /// <c>SET LOCAL agrisync.user_id</c> so the <c>p_user_select_farms</c> /
    /// <c>p_user_select_memberships</c> RLS policies surface the caller's farms
    /// on the admin-elevated <c>/shramsafal/farms/mine</c> route (where the
    /// interceptor injects no GUC and the middleware opens no transaction).
    /// Default impl returns empty so the many in-tree test doubles compile;
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<MyFarmProjection>> GetMyFarmsAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<MyFarmProjection>());

    Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);

    /// <summary>
    /// The declared owner, or an <c>Active</c> seat. spec plr-d7-m1-multiuser-2026-10-26
    /// (step 1, BN-1): a PendingApproval request or a Suspended seat is not a member.
    /// </summary>
    Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — returns a non-terminal
    /// farm-membership decision plus the farm's <c>owner_account_id</c>
    /// (denormalised onto <c>ssf.farm_memberships</c> by migration
    /// <c>20260516120000_AddOwnerAccountIdToFarmMemberships</c>) so the
    /// <c>ShramSafalAuthorizationEnforcer</c> can populate
    /// <c>TenantContext</c> with both halves of the RLS key in a single
    /// round-trip.
    /// <para>
    /// Returns <c>(false, Guid.Empty)</c> when the user has no active
    /// membership on the farm. Returns <c>(true, ownerAccountId)</c> for an
    /// <c>Active</c> seat ONLY — spec plr-d7-m1-multiuser-2026-10-26 (step 1,
    /// BN-1): a PendingApproval request (a typed farm code), a PendingOtpClaim
    /// seat and a Suspended seat are refused here, so none of them can push to
    /// the farm or open its REST farm scope. (Before that spec this admitted
    /// every non-terminal status.) For "does this person still have a seat that
    /// has not ended" use <see cref="GetFarmMembershipRelationshipForTenantAsync"/>.
    /// Owner-of-farm shortcut: when <paramref name="userId"/> is the
    /// declared <c>Farm.OwnerUserId</c>, the method returns
    /// <c>(true, farm.OwnerAccountId)</c> even if the membership row is
    /// absent (mirrors <see cref="IsUserMemberOfFarmAsync"/> semantics).
    /// </para>
    /// <para>
    /// Naming deviation from sub-phase 03.2 spec: the spec named the new
    /// method <c>GetFarmMembershipAsync</c> with a tuple return type, but
    /// that name already exists at L32 above returning <c>FarmMembership?</c>.
    /// C# cannot overload by return type, so this method takes the
    /// <c>ForTenant</c> suffix; the consumer (
    /// <c>ShramSafalAuthorizationEnforcer</c>) and the semantics are
    /// unchanged from the spec. Documented in the hand-off envelope.
    /// </para>
    /// </summary>
    Task<(bool IsMember, Guid OwnerAccountId)> GetFarmMembershipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
        // Default impl returns "not a member" so the dozens of in-tree
        // test doubles for IShramSafalRepository do not break. Production
        // ShramSafalRepository overrides; FakeAuthorizationRepository
        // (baseline-814ec70 suite) overrides with a deterministic owner.
        => Task.FromResult((false, Guid.Empty));

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the RELATIONSHIP twin of
    /// <see cref="GetFarmMembershipForTenantAsync"/>: <c>(true, ownerAccountId)</c> for the
    /// declared owner or ANY seat that has not ended (Active, PendingApproval, PendingOtpClaim,
    /// Suspended). It grants nothing by itself. Its one caller is the self-exit scope
    /// (<c>ICallerFarmTenantScope.EstablishRelationshipForCallerAsync</c>): a person must
    /// always be able to withdraw a pending request or leave a paused seat, and that write
    /// needs the farm scope the access gate now refuses them.
    /// Default body = the access gate's answer, so a test double that overrides only that
    /// one keeps its old behaviour (and the default stays fail-closed).
    /// </summary>
    Task<(bool IsMember, Guid OwnerAccountId)> GetFarmMembershipRelationshipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
        => GetFarmMembershipForTenantAsync(farmId, userId, ct);

    /// <summary>
    /// spec: 2026-08-25-prod-cutover-waves (D1, tenant-DEK authorization) — only the
    /// farm's declared owner or an <c>Active</c> membership counts (written when
    /// <see cref="GetFarmMembershipForTenantAsync"/> still admitted every non-terminal
    /// status; since spec plr-d7-m1-multiuser-2026-10-26 step 1 the two agree on status,
    /// and this one still differs by reading the owner account from the FARM row and by
    /// refusing a farm with no owner account). The owner account is read from the FARM row
    /// (never from the caller), so the key is always bound to the account that really
    /// owns the farm. Returns <c>(false, Guid.Empty)</c> otherwise (no such farm, not a
    /// member, pending, suspended, revoked, exited) — the caller cannot tell which.
    /// Default impl returns "not a member" so in-tree test doubles compile.
    /// </summary>
    Task<(bool IsActiveMember, Guid OwnerAccountId)> GetActiveFarmMembershipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
        => Task.FromResult((false, Guid.Empty));

    /// <summary>
    /// Count of <c>Active</c> <c>PrimaryOwner</c> memberships on a farm.
    /// Used by the exit-membership handler to defend invariant I3 (the
    /// last PrimaryOwner cannot leave).
    /// </summary>
    Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default);

    // --- Schedule domain (Phase 3) ---------------------------------------------------------
    Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default);
    Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default);
    Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default);

    Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default);
    Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default);

    /// <summary>
    /// Returns the single <see cref="ScheduleSubscriptionState.Active"/> subscription for
    /// (<paramref name="plotId"/>, <paramref name="cropKey"/>, <paramref name="cropCycleId"/>)
    /// or <c>null</c> when none exists. Invariant I-14 guarantees at most one.
    /// </summary>
    Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default);

    Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane L8b-1F fix 1 (F004) - ONLY the Active subscriptions of these farms (state read in SQL), for the pull's
    /// "schedules a plot follows" extras. Default for test doubles: none.
    /// </summary>
    Task<List<ScheduleSubscription>> GetActiveScheduleSubscriptionsOfFarmsAsync(
        IEnumerable<Guid> farmIds, CancellationToken ct = default)
        => Task.FromResult(new List<ScheduleSubscription>());

    /// <summary>
    /// spec: plr-d10 lane L8b-2 - the pull: subscriptions of these farms adopted, or whose state changed, after
    /// <paramref name="sinceUtc"/> (every state). Default for test doubles: none.
    /// </summary>
    Task<List<ScheduleSubscription>> GetScheduleSubscriptionsChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<ScheduleSubscription>());

    /// <summary>
    /// spec: plr-d10 lane L8b-2 (F96) - these crop seasons of these farms, WHETHER OR NOT they changed since any cursor: the
    /// pull needs the farm's visible seasons to keep a planned step of an unchanged older season. Default for test doubles:
    /// every season of the farms (read from the beginning), narrowed to the ids.
    /// </summary>
    async Task<List<CropCycle>> GetCropCyclesOfFarmsByIdsAsync(
        IEnumerable<Guid> farmIds, IReadOnlyCollection<Guid> cropCycleIds, CancellationToken ct = default)
    {
        var all = await GetCropCyclesChangedSinceAsync(farmIds, DateTime.UnixEpoch, ct);
        return all.Where(c => cropCycleIds.Contains(c.Id)).ToList();
    }

    Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default);

    /// <summary>
    /// Returns <c>true</c> if the user has at least one <c>Active</c>
    /// <see cref="FarmMembership"/> with <c>Role >= SecondaryOwner</c>.
    /// Used to gate Team / Licensed / Public template mutations.
    /// </summary>
    Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Returns the root template and all templates derived from it (flat list).
    /// </summary>
    Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);

    /// <summary>
    /// Commits the staged new <see cref="FarmMembership"/> (and its audit row). Returns
    /// <c>true</c> when committed. Returns <c>false</c> ONLY when this exact save lost a race to
    /// a concurrent insert of the same (farm, user) non-terminal membership
    /// (<c>ix_farm_memberships_farm_user_nonterminal</c>, SQLSTATE 23505): the staged entities
    /// are discarded and the caller re-reads the winner's row. Any other failure still throws.
    /// Provider specifics never leave Infrastructure. Default body = plain save.
    /// </summary>
    async Task<bool> TrySaveNewMembershipAsync(CancellationToken ct = default)
    {
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the farm whose code is
    /// <paramref name="normalizedFarmCode"/> (already passed through
    /// <c>FarmCode.Normalize</c>), or <c>null</c>. On the typed-join path the caller is not
    /// yet a member of any farm it could find here, so this read only sees a row because
    /// <see cref="IJoinCodeTenantScope.BeginCodeLookupAsync"/> published that exact code.
    /// Default body = "no such farm" (fail closed), so the in-tree test doubles compile (F7).
    /// </summary>
    Task<Farm?> GetFarmByJoinCodeAsync(string normalizedFarmCode, CancellationToken ct = default)
        => Task.FromResult<Farm?>(null);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — returns the farm's code, giving it one
    /// first (and committing it) when it has none. <paramref name="farm"/> must have been read
    /// through this repository. The production body draws again on the rare collision with
    /// another farm's code (<c>ux_farms_farm_code</c>); provider specifics never leave
    /// Infrastructure. Default body = assign once + plain save.
    /// </summary>
    async Task<string> EnsureFarmCodeAsync(Farm farm, DateTime utcNow, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(farm.FarmCode))
        {
            farm.AssignFarmCode(FarmCode.New(), utcNow);
            await SaveChangesAsync(ct);
        }

        return farm.FarmCode!;
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, M3) — saves the unit of work that CREATES
    /// <paramref name="farm"/> (added through <see cref="AddFarmAsync"/>, together with whatever
    /// else was added with it — the owner's seat, the audit row), giving the farm its code as it
    /// is saved: every new farm is born with a code. The production body draws again on the rare
    /// collision with another farm's code (<c>ux_farms_farm_code</c>), bounded, so a collision no
    /// longer fails the creation; provider specifics never leave Infrastructure.
    /// Default body = one draw + plain save (the in-tree test doubles have no unique index).
    /// </summary>
    Task SaveNewFarmAsync(Farm farm, DateTime utcNow, CancellationToken ct = default)
    {
        farm.AssignFarmCode(FarmCode.New(), utcNow);
        return SaveChangesAsync(ct);
    }

    // --- CEI Phase 1 §4.4 ----------------------------------------------------------------
    /// <summary>
    /// Returns the count of <see cref="ShramSafal.Domain.Logs.DailyLog"/> records for the
    /// given plot whose <c>CurrentVerificationStatus</c> is
    /// <see cref="ShramSafal.Domain.Logs.VerificationStatus.Disputed"/>.
    /// </summary>
    Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default);

    // --- CEI Phase 3 §4.6 ----------------------------------------------------------------
    /// <summary>
    /// Returns all <see cref="DailyLog"/> records for the given farm.
    /// Used by the compliance evaluator to assess log coverage.
    /// </summary>
    Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<DailyLog>());

    /// <summary>
    /// spec: plr-d10 (I22) — only the farm's logs with these ids. The attention board runs on every sync pull
    /// and needs the work day of the current season's tasks, not the farm's whole history. The default body
    /// filters <see cref="GetDailyLogsByFarmAsync"/> so the in-tree test doubles keep working; production
    /// overrides it with one bounded, untracked query.
    /// </summary>
    async Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmByIdsAsync(FarmId farmId, IReadOnlyCollection<Guid> ids, CancellationToken ct = default)
        => (await GetDailyLogsByFarmAsync(farmId, ct)).Where(l => ids.Contains(l.Id)).ToList();

    /// <summary>
    /// spec: plr-d10 lane PRV fix pass 2 (D-69) — the farm's records made from one voice parse (<c>source_ai_job_id</c>):
    /// its words and amounts are theirs. The default body filters <see cref="GetDailyLogsByFarmAsync"/> so the in-tree
    /// test doubles keep working; production overrides it with one bounded, untracked query.
    /// </summary>
    async Task<IReadOnlyList<DailyLog>> GetDailyLogsBySourceAiJobAsync(FarmId farmId, Guid aiJobId, CancellationToken ct = default)
        => (await GetDailyLogsByFarmAsync(farmId, ct)).Where(l => l.SourceAiJobId == aiJobId).ToList();

    /// <summary>
    /// Returns <see cref="PlannedActivity"/> records for all crop cycles on the given farm
    /// with <c>PlannedDate >= sinceDate</c>.
    /// </summary>
    Task<List<PlannedActivity>> GetPlannedActivitiesForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
        => Task.FromResult(new List<PlannedActivity>());

    /// <summary>
    /// Returns <see cref="LogTask"/> records for all daily logs on the given farm
    /// with log date >= <paramref name="sinceDate"/>.
    /// </summary>
    Task<List<LogTask>> GetLogTasksForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
        => Task.FromResult(new List<LogTask>());

    /// <summary>
    /// Returns all active farm IDs in the system (farms with at least one active membership).
    /// Used by the compliance sweeper to evaluate all farms.
    /// </summary>
    Task<List<Guid>> GetAllActiveFarmIdsAsync(CancellationToken ct = default)
        => Task.FromResult(new List<Guid>());

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------

    // Sub-plan 03 Task 5: required member (see AddFarmBoundaryAsync above).
    Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default);

    Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
        => Task.FromResult<JobCard?>(null);

    /// <summary>
    /// Returns the JobCard whose <c>LinkedDailyLogId</c> equals <paramref name="dailyLogId"/>, or null.
    /// At most one card may be linked to a given log (domain invariant).
    /// </summary>
    Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<JobCard?>(null);

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 1, B003) — EVERY job card linked to this log. Nothing makes the link unique
    /// (a cancelled card keeps its link, a second card may be completed with the same log), so a check that must see a
    /// paid card reads them all. The default wraps the single lookup.
    /// </summary>
    async Task<List<JobCard>> GetJobCardsByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
        => await GetJobCardByLinkedDailyLogIdAsync(dailyLogId, ct) is { } one ? [one] : [];

    /// <summary>
    /// Returns all job cards for the given farm, optionally filtered by status.
    /// </summary>
    Task<List<JobCard>> GetJobCardsForFarmAsync(FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns all job cards assigned to the given worker.
    /// </summary>
    Task<List<JobCard>> GetJobCardsForWorkerAsync(UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns all job cards modified since the given cursor for the provided farms.
    /// Used by sync pull.
    /// </summary>
    Task<List<JobCard>> GetJobCardsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<JobCard>());

    /// <summary>
    /// Returns worker metrics for ReliabilityScore computation.
    /// </summary>
    /// <remarks>
    /// <para><paramref name="scopedFarmIds"/> is the tier-1 boundary in parameter form.
    /// It used to be a single nullable farm id, where null meant "every farm he has ever
    /// worked" — a portable reputation expressible by forgetting to pass an argument. It is
    /// now an explicit, non-empty list, so the widest thing a caller can ask for is the
    /// widest thing he was permitted.</para>
    /// <para>Callers obtain it from <c>WorkerRecordAccess.PermittedFarmIds</c>; never pass
    /// a raw client-supplied farm id, and never pass an empty list expecting "no filter" —
    /// an empty list means no farms and must return nothing. See
    /// <see cref="WorkerRecordPortability"/>.</para>
    /// </remarks>
    Task<WorkerMetricsDto> GetWorkerMetricsAsync(UserId workerUserId, IReadOnlyCollection<Guid> scopedFarmIds, DateTime since30d, CancellationToken ct = default)
        => Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));

    /// <summary>
    /// The farms this user OWNS — not the farms he belongs to.
    ///
    /// <para>Founder ruling, 2026-08-17: an owner with two farms of his own may see his own
    /// worker's record across both, because that is one owner's own record and not
    /// portability at all. <see cref="WorkerRecordPortability.DecideAggregateScope"/> needs
    /// ownership separately from membership to tell that case apart from a mukadam folding
    /// two different owners' records together.</para>
    ///
    /// <para>The default is empty, which is fail-closed: an implementation that says
    /// nothing claims no ownership, and the widening never fires.</para>
    /// </summary>
    Task<List<Guid>> GetOwnedFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<Guid>());

    /// <summary>
    /// TIER 2 — the statements farms have written about this worker
    /// (<see cref="WorkerStatement"/>): "anything the ARVE farm owner wants to say".
    ///
    /// <para><b>Returns empty today, and empty means silence.</b> No table stores these and
    /// no endpoint writes one, so there is nothing to return and nothing is invented. The
    /// caller must render an empty result as the farm having said nothing — never as a zero
    /// score, an unrated badge, or any phrasing implying a review was owed and withheld.
    /// Writing one is optional, and an owner is allowed to stay silent forever.</para>
    ///
    /// <para>Whoever adds the table implements this against it. The read path, the tier
    /// boundary and the attribution are already built and tested around this seam.</para>
    /// </summary>
    Task<IReadOnlyList<WorkerStatement>> GetWorkerStatementsAsync(UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<WorkerStatement>>([]);

    // --- spec: dfes-companion-2026-07-11 (wave-4.4) — founder ruling A, 2026-08-17 ----
    /// <summary>
    /// True when <paramref name="workerUserId"/> has himself granted
    /// <see cref="WorkerRecordPortability.PortabilityConsentPurposeCode"/> — consent for
    /// his identifiable record to leave the farm that recorded it.
    ///
    /// <para><b>The default is false, and false is the whole point.</b> Ruling A puts the
    /// worker-consent question at portability, not at naming: his name inside his own
    /// farm's records needs no consent, but a reputation that follows him to the next
    /// employer needs HIS. Nothing in this codebase can grant that purpose yet, so every
    /// implementation answers false and every cross-farm read is refused.</para>
    ///
    /// <para>This default impl is the fail-closed seam. When someone builds a portable
    /// worker record they must come here and implement it against a real consent row —
    /// they cannot ship the feature by forgetting this method, because forgetting it
    /// denies. An owner's consent is NEVER an answer to this question, and
    /// <c>ConsentPurpose.CrossFarmAggregation</c> is not either: that licenses
    /// DE-IDENTIFIED data, and this boundary is only about data that still names him.</para>
    ///
    /// <para><b>Even a true here opens only tiers 2 and 3</b> — the farm's own operational
    /// detail is not his to license, so no answer to this question moves it. See
    /// <see cref="WorkerRecordTier"/>.</para>
    /// </summary>
    Task<bool> HasWorkerRecordPortabilityConsentAsync(UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult(false);

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.5 (cost-category lookup) -------
    /// <summary>
    /// Returns all active rows from <c>ssf.cost_categories</c> — the
    /// canonical 13-code cost-category lookup owned by the server. The
    /// pull-sync handler projects these into <see cref="CostCategoryRefDto"/>
    /// so the mobile client can render Marathi / Hindi / English without
    /// a second round-trip. Default impl returns an empty list so legacy
    /// test doubles compile; production overrides hit the DB.
    /// </summary>
    Task<List<CostCategory>> GetCostCategoriesAsync(CancellationToken ct = default)
        => Task.FromResult(new List<CostCategory>());

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.3 (warm-tier transcripts) ------
    /// <summary>
    /// Persists a warm-tier <see cref="Transcript"/> projection for the
    /// winning AI job attempt. One row per attempt; the <c>ssf.transcripts</c>
    /// unique index on <c>ai_job_attempt_id</c> enforces the invariant.
    /// Required member (no default impl) — every test double must explicitly
    /// override to avoid a runtime landmine if a future codepath routes
    /// through this method, per the sub-plan 03 Task 5 convention surfaced
    /// on <see cref="AddFarmBoundaryAsync"/>.
    /// </summary>
    Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default);

    // --- DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) --------------
    /// <summary>
    /// Upserts the ref-count entry in <c>ssf.raw_blob_index</c> for a content-
    /// addressed raw blob the orchestrator just parked in the cold tier (see
    /// <see cref="ShramSafal.Application.Storage.IRawBlobStore.PutAsync"/>).
    /// Insert-and-set-RefCount=1 on first sighting; increment on a repeat
    /// upload of the same SHA-256. The unique key is
    /// <see cref="RawBlobRef.Sha256"/>.
    /// <para>
    /// <b>The increment is best-effort under RLS, and that is not a bug here.</b>
    /// <c>p_tenant_raw_blob_index</c> scopes visibility by an EXISTS-join to
    /// <c>ssf.ai_jobs</c> on <c>agrisync.farm_id</c>. When the row exists but
    /// belongs to a different farm the caller cannot see it, so the increment
    /// matches nothing and <c>ref_count</c> undercounts. The subject linkage
    /// below is still written — which is the part that must not be lost.
    /// </para>
    /// <para>
    /// <b>§P0.9 — <paramref name="subjectUserId"/> is the data-subject
    /// linkage.</b> The implementation also records
    /// <c>(sha256, subjectUserId)</c> in <c>ssf.raw_blob_subjects</c>,
    /// idempotently. This is the ONLY user→audio pointer that survives a DPDP
    /// erasure: the cascade deletes <c>ai_jobs WHERE user_id = X</c>, and
    /// <c>ai_jobs.raw_input_ref</c> was previously the only link, so the S3
    /// object was left permanently unattributable.
    /// </para>
    /// <para>
    /// <b>Pass <c>null</c> when the subject is genuinely unknown</b> — and only
    /// then. The linkage row is skipped, so an unknown owner is recorded as the
    /// ABSENCE of a row. Never pass <see cref="Guid.Empty"/> or a fresh GUID to
    /// fill the parameter; a fabricated owner reads as a real one and is worse
    /// than an honest gap.
    /// </para>
    /// <para>
    /// Default impl is a no-op so the dozens of in-tree
    /// <c>IShramSafalRepository</c> test doubles keep compiling. Production
    /// <c>ShramSafalRepository</c> overrides with raw parameterised SQL — NOT EF
    /// Core writes, which cannot express the conflict tolerance the RLS policy
    /// above forces; integration suites that care about ref-count semantics
    /// override as well.
    /// </para>
    /// </summary>
    Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, Guid? subjectUserId, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 (transcript idempotency) ---
    /// <summary>
    /// Lookup a prior transcript by the unique tuple
    /// <c>(audio_content_hash, transcript_provider, transcript_model_version,
    /// transcript_mode)</c>. Returns the prior <see cref="TranscriptHistory"/>
    /// row if present (Sarvam idempotency check — Task 2.10 Lever #8) or
    /// <c>null</c> when this is a first sighting. Used by
    /// <c>SarvamStreamingSttClient.TranscribeAsync</c> and
    /// <c>SarvamVerbatimSttClient.TranscribeVerbatimAsync</c> to short-circuit
    /// the Sarvam REST call when the same audio has already been transcribed
    /// against the same (provider, model, mode). Default impl returns
    /// <c>null</c> so legacy test doubles compile; production overrides hit
    /// <c>ssf.transcript_history</c>.
    /// </summary>
    Task<TranscriptHistory?> GetTranscriptHistoryAsync(
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        CancellationToken ct = default)
        => Task.FromResult<TranscriptHistory?>(null);

    /// <summary>
    /// Insert a new <see cref="TranscriptHistory"/> row with
    /// <c>ON CONFLICT DO NOTHING</c> semantics against the unique tuple
    /// <c>(audio_content_hash, transcript_provider, transcript_model_version,
    /// transcript_mode)</c>. A race between two concurrent transcribers of
    /// the same audio resolves to one persisted row; the loser silently
    /// no-ops. Used by <c>SarvamStreamingSttClient</c> /
    /// <c>SarvamVerbatimSttClient</c> after a successful Sarvam call.
    /// Default impl is a no-op so legacy test doubles compile.
    /// </summary>
    Task UpsertTranscriptHistoryAsync(
        TranscriptHistory history,
        CancellationToken ct = default)
        => Task.CompletedTask;

    // --- DATA_PRINCIPLE_SPINE sub-phase 06.1 / 06.2 (consent domain) ------
    /// <summary>
    /// Fetch the live <see cref="UserConsentState"/> row for
    /// <paramref name="userId"/>, or <c>null</c> when no row exists yet
    /// (first-ever consent interaction for that user). Default impl
    /// returns <c>null</c> so legacy test doubles compile; production
    /// <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult<UserConsentState?>(null);

    /// <summary>
    /// Persist a brand-new <see cref="UserConsentState"/> row (first toggle
    /// for this user). The handler decides between Add vs Update — the
    /// repository surface mirrors the existing
    /// <see cref="AddAuditEventAsync"/> shape (no UpdateXxx counterpart
    /// because EF tracks the entity once it is materialised through the
    /// DbContext).
    /// </summary>
    Task AddUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Replace the live <see cref="UserConsentState"/> for the user
    /// embedded in <paramref name="state"/>. The Infrastructure
    /// implementation reattaches the value via the DbSet's existing
    /// tracking entry; the in-memory test doubles overwrite their
    /// dictionary. <c>UserId</c> is the row's primary key.
    /// </summary>
    Task UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Append a <see cref="ConsentAuditEntry"/> row to the
    /// <c>ssf.consent_audit</c> ledger. The migration revokes UPDATE +
    /// DELETE on this table so an existing row can never be mutated —
    /// this method is INSERT-only by both port contract and DB
    /// privilege.
    /// </summary>
    Task AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Start of the CURRENT continuous grant of the voice full-history purpose,
    /// computed read-side from the append-only consent ledger (see
    /// <c>FullHistoryGrantWindow</c>). <c>null</c> when it is not granted or the
    /// ledger cannot show when it started. Never mutates the ledger.
    /// </summary>
    Task<DateTime?> GetFullHistoryCurrentGrantStartUtcAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult<DateTime?>(null);

    // --- DATA_PRINCIPLE_SPINE sub-phase 10.2 / 10.4 (PII review queue) ---
    /// <summary>
    /// Append a brand-new <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry"/>
    /// row to <c>ssf.pii_review_queue</c>. INSERT-only by privilege
    /// (migration revokes DELETE). Used by
    /// <c>ParseVoiceInputHandler</c> on every detection event that
    /// produces a redaction (auto-redacted, review-pending, or
    /// discard).
    /// </summary>
    Task AddPiiReviewQueueEntryAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry entry,
        CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Fetch the queue entry by id, or <c>null</c> when absent. Used
    /// by the approve/reject endpoints; no farm-scope check (reviewer
    /// allow-list spans all farms per OQ-6).
    /// </summary>
    Task<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?> GetPiiReviewQueueEntryAsync(
        Guid entryId,
        CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?>(null);

    /// <summary>
    /// List queue entries filtered by status. The admin UI calls
    /// this with <see cref="ShramSafal.Domain.Privacy.Pii.PiiReviewStatus.Pending"/>
    /// to drain the review queue.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>> ListPiiReviewQueueAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewStatus status,
        int limit,
        CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>>(Array.Empty<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>());

    // --- DATA_PRINCIPLE_SPINE sub-phase 08.1 (DPDP rights surface) -------
    /// <summary>
    /// Enqueue a fresh <see cref="ErasureRequest"/> row for the async
    /// ErasureWorker (08.2) to process. Default impl is a no-op so test
    /// stubs that don't exercise the erasure path stay compiling; the
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task AddErasureRequestAsync(ErasureRequest request, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// spec: plr-d10 lane OPS-1 (F99 leftover L-1) - store a new erasure request and its "Requested" audit row, unless the
    /// database's one-waiting-request-per-person index (ux_erasure_requests_one_waiting_per_person) refuses it because
    /// another request for the same person was stored first. Returns false in that case, with nothing stored and the
    /// surrounding request transaction still usable. The default (test fakes) stores both and returns true.
    /// </summary>
    async Task<bool> TryAddErasureRequestAsync(
        ErasureRequest request, AuditEvent requestedAudit, CancellationToken ct = default)
    {
        await AddErasureRequestAsync(request, ct);
        await AddAuditEventAsync(requestedAudit, ct);
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Enqueue a fresh <see cref="ExportRequest"/> row for the async
    /// ExportWorker (08.3) to process.
    /// </summary>
    Task AddExportRequestAsync(ExportRequest request, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Append a <see cref="BreachIncident"/> to the breach ledger
    /// (Phase 08.5 scaffolding — admin records a breach; Phase 12+
    /// wires the dispatcher).
    /// </summary>
    Task AddBreachIncidentAsync(BreachIncident incident, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Read the user's recent erasure requests for the mobile
    /// "Recent requests" UI. Default impl returns empty so test stubs
    /// stay compiling.
    /// </summary>
    Task<List<ErasureRequest>> GetErasureRequestsForUserAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<ErasureRequest>());

    /// <summary>
    /// lane F99 fix pass 2 (review N-1) — the request still WAITING for this person (the one whose data it is), oldest
    /// first, or null. One person has at most one: asking again answers this one.
    /// </summary>
    Task<ErasureRequest?> GetWaitingErasureRequestForAsync(Guid targetUserId, CancellationToken ct = default)
        => Task.FromResult<ErasureRequest?>(null);

    /// <summary>
    /// lane F99 fix pass 2 (review N-1) — cancel every OTHER request still waiting for this person, as one guarded UPDATE
    /// (a request made twice at the same instant by two phones). Returns how many.
    /// </summary>
    Task<int> CancelOtherWaitingErasureRequestsForAsync(Guid targetUserId, Guid exceptRequestId, DateTime nowUtc, CancellationToken ct = default)
        => Task.FromResult(0);

    /// <summary>lane F99 fix pass 1, item 11 (D-71) — one erasure request by id (no tracking), or null.</summary>
    Task<ErasureRequest?> GetErasureRequestByIdAsync(Guid requestId, CancellationToken ct = default)
        => Task.FromResult<ErasureRequest?>(null);

    /// <summary>
    /// lane F99 fix pass 1, item 11 (D-71) — cancel a request that is STILL WAITING, as one guarded UPDATE
    /// (status Requested → Cancelled, ended now). False when it is no longer waiting (the worker took it first).
    /// </summary>
    Task<bool> TryCancelErasureRequestAsync(Guid requestId, DateTime nowUtc, CancellationToken ct = default)
        => Task.FromResult(false);

    Task<List<ExportRequest>> GetExportRequestsForUserAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(new List<ExportRequest>());

    // --- AI Intelligence Plan WP-2b (Track B typed ledger writers) --------
    // Confirm-time server-side derivation (LedgerDerivationService) stages
    // these typed ssf rows on the DbSet inside CreateDailyLogHandler's
    // existing unit of work (no SaveChanges here — the handler commits). The
    // 11 tables + routine_patterns already exist, RLS-enabled, runtime-proven
    // (ADR 0023). Each writer mirrors the AddWeatherStampAsync default-no-op
    // convention (L69) so the ~28 in-tree IShramSafalRepository test doubles
    // keep compiling untouched — derivation is best-effort / NON-BLOCKING, so
    // a test double that no-ops it is harmless. Production ShramSafalRepository
    // overrides with the EF AddAsync.

    /// <summary>
    /// Stage a derived <see cref="FarmOperation"/> ledger-spine parent
    /// (inputs → operationType "application"). No SaveChanges — the handler
    /// owns the commit.
    /// </summary>
    Task AddFarmOperationAsync(FarmOperation op, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Stage a derived <see cref="ApplicationInputItem"/> child of a
    /// <see cref="FarmOperation"/> (ordinal-keyed within the input array).
    /// </summary>
    Task AddApplicationInputItemAsync(ApplicationInputItem item, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="IrrigationEntry"/> (daily_logs child).</summary>
    Task AddIrrigationEntryAsync(IrrigationEntry e, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="LabourAssignment"/> (daily_logs child).</summary>
    Task AddLabourAssignmentAsync(LabourAssignment a, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// For each supplied labour-assignment id that ALREADY EXISTS, the
    /// <c>daily_log_id</c> it is attached to. Ids with no row are simply absent
    /// from the result.
    ///
    /// <para>The id is that row's PRIMARY KEY and it is CLIENT-MINTED
    /// (LabourAssignmentConfiguration, ValueGeneratedNever), so a client that
    /// carries one across two daily logs produces a 23505 the server can only
    /// translate after the fact. This read is what lets
    /// <c>CreateDailyLogHandler</c> refuse the contradiction BEFORE anything is
    /// staged, and name it.</para>
    ///
    /// <para><b>Projection only, AsNoTracking - this matters.</b> The existing
    /// <c>GetLabourAssignmentByIdAsync</c> is implemented as
    /// <c>db.LabourAssignments.FindAsync</c>, which TRACKS what it returns.
    /// Tracking a row whose PK the caller is about to <c>Add</c> turns the
    /// same-log case into an InvalidOperationException from the change tracker -
    /// which is NOT a DbUpdateException, escapes the sync handler's catch, and
    /// 500s the whole batch. Do not "simplify" this method into that one.</para>
    ///
    /// <para>Default impl returns empty so in-memory doubles compile, matching
    /// the convention of the staging methods above.</para>
    /// </summary>
    Task<IReadOnlyDictionary<Guid, Guid>> GetLabourAssignmentOwnerLogIdsAsync(
        IReadOnlyCollection<Guid> labourAssignmentIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyDictionary<Guid, Guid>>(new Dictionary<Guid, Guid>());

    /// <summary>Stage a derived <see cref="MachineryUsage"/> (daily_logs child).</summary>
    Task AddMachineryUsageAsync(MachineryUsage m, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="ObservationEvent"/> (daily_logs child).</summary>
    Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>Stage a derived <see cref="DisturbanceEvent"/> (daily_logs child).</summary>
    Task AddDisturbanceEventAsync(DisturbanceEvent d, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Supersession lookup — the CURRENT-version <see cref="FarmOperation"/>
    /// whose <see cref="DerivedEventKey"/> matches, or <c>null</c>. Re-derivation
    /// marks the old row superseded and inserts a new current row with the same
    /// key (append-only, never duplicates). Default impl returns <c>null</c> so
    /// test doubles compile; production filters on <c>IsCurrentVersion</c>.
    /// </summary>
    Task<FarmOperation?> GetFarmOperationByKeyAsync(string derivedEventKey, CancellationToken ct = default)
        => Task.FromResult<FarmOperation?>(null);

    /// <summary>
    /// Labour V2 R1 Task 8.5 — the disturbance analogue of
    /// <see cref="GetFarmOperationByKeyAsync"/>: the live
    /// <see cref="DisturbanceEvent"/> for one derived identity, or <c>null</c>.
    /// A disturbance's derived identity is (farm, log-day, reason) — the DAY,
    /// not the parse, because the labour door and the regular door produce two
    /// logs (two source ids) for one farm-day and "पाऊस आला" through both doors
    /// is one fact. Every component is already a persisted column (farm and day
    /// on the parent <c>daily_logs</c> row, reason on the event), so unlike
    /// FarmOperation no key column is stored — production resolves the identity
    /// with a join through <c>daily_log_id</c>. <paramref name="reason"/> is
    /// compared against the entity-stored form (<see cref="DisturbanceEvent"/>
    /// trims on Create), so callers pass it trimmed. Default impl returns
    /// <c>null</c> so test doubles compile.
    /// <para>B001 — this read is the dedup's whole enforcement (no DB unique),
    /// so cross-device overlapping pushes can race it; the production impl is
    /// also the residual's NAMED OBSERVER — it warns when the identity already
    /// holds more than one live row. See the derivation-site comment in
    /// <c>LedgerDerivationService</c> for the enforced boundary.</para>
    /// </summary>
    Task<DisturbanceEvent?> GetDisturbanceEventForFarmDayAsync(
        Guid farmId, DateOnly logDate, string reason, CancellationToken ct = default)
        => Task.FromResult<DisturbanceEvent?>(null);

    /// <summary>
    /// RoutineMemory upsert lookup — the existing <see cref="RoutinePattern"/>
    /// for (<paramref name="farmId"/>, <paramref name="plotId"/>,
    /// <paramref name="operationType"/>) or <c>null</c> on first sighting.
    /// Default impl returns <c>null</c> so test doubles compile.
    /// </summary>
    Task<RoutinePattern?> GetRoutinePatternAsync(Guid farmId, Guid? plotId, string operationType, CancellationToken ct = default)
        => Task.FromResult<RoutinePattern?>(null);

    /// <summary>Stage a brand-new <see cref="RoutinePattern"/> (first confirmed sighting).</summary>
    Task AddRoutinePatternAsync(RoutinePattern p, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- Labour Management read-model (Task 1.2, spec: 2026-07-13-labour-attendance-approval-design) ---

    /// <summary>
    /// All <see cref="FarmMembership"/> rows for a farm (any status) — the
    /// source for <c>GetLabourDataHandler</c>'s People assembly. Unlike
    /// <see cref="GetFarmMembershipAsync"/> (single user) this returns the
    /// whole roster. Default impl returns empty so the many in-tree
    /// <see cref="IShramSafalRepository"/> test doubles keep compiling;
    /// production <c>ShramSafalRepository</c> overrides.
    /// </summary>
    Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<FarmMembership>());

    /// <summary>
    /// The farm's labour <see cref="CostEntry"/> rows — <c>CategoryId</c>
    /// <c>labour_payout</c> OR <c>labour_misc</c> (Decision 3a, 2026-07-19,
    /// spec: 2026-07-13-labour-attendance-approval-design: दिलं = ALL labour
    /// money paid out, not just job-card settlements) — each paired with the
    /// linked <see cref="JobCard.AssignedWorkerUserId"/> when one exists
    /// (read at the repo layer via <c>CostEntry.JobCardId → JobCard</c>,
    /// since <c>CostEntryDto</c> does not expose <c>JobCardId</c>).
    /// <c>labour_misc</c> rows are never linked to a JobCard, so their
    /// <c>AssignedWorkerUserId</c> is always <c>null</c> — the caller counts
    /// them at the farm-wide level only, never attributes them to a person.
    /// <para>
    /// MONEY-CONSISTENCY INVARIANT — these are the EXACT SAME rows
    /// <c>GetFinanceSummaryHandler</c> sums for the "Labour" bucket
    /// (<c>labour_payout</c> + <c>labour_misc</c>). The caller (handler)
    /// applies the latest <see cref="FinanceCorrection"/> and rounding
    /// identically to that handler so the labour "Paid" figure equals the
    /// finance page.
    /// </para>
    /// Default impl returns empty so in-tree test doubles keep compiling;
    /// production <c>ShramSafalRepository</c> overrides.
    /// <para>
    /// Task 9 (spec: 2026-08-28-labour-v2-release-1) — bounded by
    /// <c>CostEntry.EntryDate</c>, the farm-local calendar date the money is
    /// booked against. Both bounds are INCLUSIVE and either may be
    /// <c>null</c> for unbounded, so the all-time window (the default) reads
    /// exactly what this method read before the window existed.
    /// </para>
    /// </summary>
    Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
        FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
        => Task.FromResult(new List<(CostEntry, Guid?)>());

    /// <summary>
    /// <see cref="LabourAssignment"/> rows (voice-derived, NO-MULTIPLY
    /// descriptive attendance — count/shift/task/names only) for daily logs
    /// on this farm whose <c>LogDate</c> falls inside the given window.
    /// Interim source for <c>Dashboard.ManDays</c> (sum of
    /// <see cref="LabourAssignment.WorkerCount"/>) until the Stage 5
    /// per-worker attendance ledger lands — <c>Ledger.Rows</c> stays empty
    /// until then. Default impl returns empty so in-tree test doubles keep
    /// compiling; production <c>ShramSafalRepository</c> overrides.
    /// <para>
    /// Task 9 (spec: 2026-08-28-labour-v2-release-1) — replaces
    /// <c>GetLabourAssignmentsForFarmSinceAsync</c>, which had a lower bound
    /// only. Both bounds are INCLUSIVE and either may be <c>null</c> for
    /// unbounded. The upper bound is the substantive addition: without it a
    /// day dated ahead of today counted inside "this week".
    /// </para>
    /// </summary>
    Task<List<LabourAssignment>> GetLabourAssignmentsForFarmInWindowAsync(
        FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
        => Task.FromResult(new List<LabourAssignment>());

    // --- Field Operator identity (Task 11, spec: 2026-07-13-labour-attendance-approval-design) ---
    // A10: IShramSafalRepository has 28 implementors and uses default interface
    // implementations DELIBERATELY — an abstract member here produces ~135
    // compile errors across the test tree. Every member below ships a default
    // body so every existing test double keeps compiling untouched; production
    // ShramSafalRepository overrides all five.

    /// <summary>Stage a new <see cref="FieldOperator"/> identity (Task 9). No SaveChanges — the caller commits.</summary>
    Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Idempotent-create insert for a CLIENT-CHOSEN <see cref="FieldOperator"/> id: commits
    /// now and reports <c>true</c> = inserted, <c>false</c> = that id already exists (a retry,
    /// or an id that belongs to a person this tenant cannot see). A duplicate never throws and
    /// never poisons the caller's transaction. The default body is the plain add + save used by
    /// in-memory repositories (no unique index to race).
    /// </summary>
    async Task<bool> TryAddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
    {
        await AddFieldOperatorAsync(o, ct);
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Single <see cref="FieldOperator"/> lookup by id. <b>NOT farm-scoped by
    /// itself</b> — <c>p_user_select_field_operators</c> is a PERMISSIVE RLS
    /// policy OR-ed with the tenant policy (A11), so under a multi-farm login
    /// this can return a row belonging to a DIFFERENT farm than the caller's
    /// current <c>agrisync.farm_id</c>. Every caller MUST assert
    /// <see cref="FieldOperator.OriginatingFarmId"/> against the authorised
    /// farm before using the result — see <c>AttachFieldOperatorHandler</c>'s
    /// file header for the full rationale.
    /// </summary>
    Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult<FieldOperator?>(null);

    /// <summary>
    /// Single <see cref="LabourAssignment"/> lookup by id. <b>NOT farm-scoped by
    /// itself</b> — <c>p_user_select_labour_assignments</c> is the same kind of
    /// PERMISSIVE, OR-ed RLS policy as <see cref="GetFieldOperatorByIdAsync"/>
    /// above; a multi-farm caller can load a row belonging to another farm.
    /// Callers must resolve the parent <c>DailyLog</c> and assert its
    /// <c>FarmId</c> before trusting this result.
    /// </summary>
    Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult<LabourAssignment?>(null);

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 2, N6) — the engagement read AGAIN for a change, after the caller has taken its
    /// record's row hold (<see cref="GetDailyLogForChangeAsync"/>): a copy read before the hold may be stale (another
    /// correction may have changed it and let go), so its columns are re-read from the database. Same scoping caveat as
    /// <see cref="GetLabourAssignmentByIdAsync"/>. The default (no row locks) is the ordinary read.
    /// </summary>
    Task<LabourAssignment?> GetLabourAssignmentForChangeAsync(Guid id, CancellationToken ct = default)
        => GetLabourAssignmentByIdAsync(id, ct);

    /// <summary>All active-or-not <see cref="FieldOperator"/> identities originated on a farm, for the field-operator list read.</summary>
    Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperator>>([]);

    /// <summary>
    /// "ON CONFLICT DO NOTHING" insert for the (FieldOperator, LabourAssignment)
    /// attribution row — <c>true</c> = inserted, <c>false</c> = this pair
    /// already existed (a retried attach; NOT an error — Task 11.5). Mirrors
    /// <see cref="ISyncMutationStore.TryStoreSuccessAsync"/>, the one existing
    /// outcome-returning precedent in this codebase (A10). Production
    /// <c>ShramSafalRepository</c> commits immediately (its own SaveChanges) so
    /// the caller learns the real outcome; PostgreSQL specifics (SQLSTATE
    /// 23505) never leave Infrastructure — this port never throws a
    /// provider-specific exception.
    /// </summary>
    Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.FromResult(true);

    // --- Labour review & correction (Task 12b, spec: 2026-07-13-labour-attendance-approval-design) ---
    // Same A10 rule as the Task 11 block above: every member ships a DEFAULT
    // body. IShramSafalRepository has 28 implementors and an abstract member
    // here produces ~135 compile errors across the test tree. Production
    // ShramSafalRepository overrides all three.

    /// <summary>
    /// Stage an APPEND-ONLY <see cref="LabourCorrection"/> row. No SaveChanges —
    /// the caller commits it in the SAME unit of work as the in-place mutation
    /// of the <see cref="LabourAssignment"/> it explains. There is deliberately
    /// no update or delete counterpart: correction history that can itself be
    /// rewritten proves nothing.
    /// </summary>
    Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// The LIVE attribution set for one engagement — every
    /// <see cref="FieldOperatorWorkRow"/> currently pointing at it.
    /// <b>NOT farm-scoped by itself</b>, for the same reason as
    /// <see cref="GetLabourAssignmentByIdAsync"/>: <c>p_user_select_field_operator_work_rows</c>
    /// is a PERMISSIVE RLS policy OR-ed with the tenant policy, so a multi-farm
    /// caller can see rows outside the farm established for this request.
    /// Callers must assert the parent engagement's farm first.
    /// </summary>
    Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
        Guid labourAssignmentId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

    /// <summary>
    /// The हजेरी marks for a farm across a window (D-H3). Both bounds are
    /// inclusive; <c>null</c> means unbounded at that end.
    /// </summary>
    /// <remarks>
    /// THE DEFAULT THROWS, deliberately, and does not return an empty list like
    /// its neighbours above. An empty register is a POSITIVE claim — "nobody was
    /// marked" — and an implementation that simply has not implemented this
    /// would be making that claim silently. Failing loudly is the only honest
    /// default for a read whose empty answer is itself a statement.
    /// </remarks>
    Task<IReadOnlyList<AttendanceMark>> GetAttendanceMarksForFarmInWindowAsync(
        FarmId farmId, DateOnly? from, DateOnly? toInclusive, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAttendanceMarksForFarmInWindowAsync is not implemented by this repository. "
            + "Returning an empty register would assert that nobody was marked.");

    /// <summary>
    /// The existing ruling for one person on one farm-day, or <c>null</c> when
    /// nobody has ruled yet. <c>null</c> is NOT absence — see
    /// <see cref="AttendanceMark"/>, where unmarked is a fourth state.
    /// </summary>
    Task<AttendanceMark?> GetAttendanceMarkAsync(
        FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAttendanceMarkAsync is not implemented by this repository.");

    /// <summary>Adds a new ruling. Amending an existing one goes through the entity.</summary>
    Task AddAttendanceMarkAsync(AttendanceMark mark, CancellationToken ct = default)
        => throw new NotSupportedException(
            "AddAttendanceMarkAsync is not implemented by this repository.");

    /// <summary>
    /// The engagement day-facts for one person on one farm-day — the input to
    /// <c>RecordAttendanceMarkHandler</c>'s pre-persistence contradiction
    /// check (Labour V2 R1 Task 3.5b).
    /// </summary>
    /// <remarks>
    /// THE DEFAULT THROWS, like <see cref="GetAttendanceMarksForFarmInWindowAsync"/>
    /// and unlike the staging members around it: "no contradiction found" is a
    /// POSITIVE claim, and an implementation that simply has not implemented
    /// this would be making it silently.
    /// </remarks>
    Task<IReadOnlyList<AttendanceEngagementFact>> GetAttendanceEngagementFactsAsync(
        FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAttendanceEngagementFactsAsync is not implemented by this repository. "
            + "Returning an empty list would assert that no contradiction exists.");

    /// <summary>
    /// Stage an APPEND-ONLY <see cref="AttendanceMarkCorrection"/> row. No
    /// SaveChanges — the caller commits it in the SAME unit of work as the
    /// in-place amendment of the <see cref="AttendanceMark"/> it explains, so
    /// the change can never land without its record. Same contract as
    /// <see cref="AddLabourCorrectionAsync"/> — deliberately no update or
    /// delete counterpart.
    /// </summary>
    Task AddAttendanceMarkCorrectionAsync(AttendanceMarkCorrection correction, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Pull carriage (Labour V2 R1 Task 3.5c): every mark on the caller's
    /// farms whose <c>ModifiedAtUtc</c> is after <paramref name="sinceUtc"/>.
    /// Empty default mirrors <see cref="GetFinanceCorrectionsChangedSinceAsync(IEnumerable{Guid}, DateTime, CancellationToken)"/>:
    /// a pull that misses rows retries on the frozen cursor, so an empty
    /// answer here is recoverable in a way the facts read above is not.
    /// </summary>
    Task<List<AttendanceMark>> GetAttendanceMarksChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<AttendanceMark>());

    /// <summary>
    /// Stage the removal of one attribution row. No SaveChanges — the caller
    /// commits it together with the <see cref="LabourCorrection"/> that records
    /// WHICH operator was removed, so the deletion can never commit without its
    /// explanation (Task 12b.4).
    /// </summary>
    Task RemoveFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// STAGE-ONLY sibling of <see cref="TryAddFieldOperatorWorkRowAsync"/>. That
    /// one commits immediately (Task 11's attach route needs the real outcome
    /// before it answers the farmer); a correction cannot use it, because the
    /// added attribution and the <see cref="LabourCorrection"/> explaining it
    /// must reach the database in ONE unit of work. The unique index
    /// <c>ux_field_operator_work_rows_operator_assignment</c> remains the
    /// backstop; the correction handler pre-filters operators that are already
    /// attributed, so the ordinary re-add is a no-op rather than a violation.
    /// </summary>
    Task AddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        => Task.CompletedTask;

    // --- Labour read-back on /sync/pull (LABOUR_PHASE2 Phase 3) ---------------
    // Same A10/F7 rule as the two blocks above: BOTH members ship a DEFAULT body,
    // because an abstract member on this interface produces ~135 compile errors
    // across the 28 in-tree implementors. Production ShramSafalRepository
    // overrides both.
    //
    // Read-only, no farm parameter, and that is deliberate: the caller passes the
    // ids of daily logs it has ALREADY farm-scoped, so these can only widen to
    // children of rows the caller was entitled to. They are not a farm-scoped
    // entry point and must not be used as one.

    /// <summary>
    /// Every <see cref="LabourAssignment"/> whose parent <c>DailyLog</c> is in
    /// <paramref name="dailyLogIds"/> — the labour half of a <c>/sync/pull</c>
    /// delta, fetched in ONE round trip rather than per log.
    /// </summary>
    /// <remarks>
    /// <para><b>There is no "changed since" here, and that is not an oversight.</b>
    /// <c>ssf.labour_assignments</c> has NO <c>modified_at_utc</c> and corrections
    /// mutate the row IN PLACE, so a delta keyed on this table could not see a
    /// correction at all. The delta is the PARENT log's <c>ModifiedAtUtc</c>, which
    /// <c>CorrectLabourHandler</c> bumps; this method then returns current truth for
    /// whatever logs that delta selected. Adding a timestamp filter here would
    /// silently hide every correction.</para>
    /// <para>Ordered by <c>created_at_utc</c> so a device sees engagements in the
    /// order they were recorded.</para>
    /// </remarks>
    Task<IReadOnlyList<LabourAssignment>> GetLabourAssignmentsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<LabourAssignment>>([]);

    // ── spec: plr-d10 (lane F1) — what Sathi understood, one unchangeable row per record
    // version (ssf.daily_log_contents). Default bodies on purpose (doctrine F7): the in-tree test
    // doubles keep compiling; production ShramSafalRepository overrides all three.

    /// <summary>
    /// Stages a content row (no SaveChanges — the caller's own save commits it with its log).
    /// There is deliberately no update or delete counterpart: a change is a NEW version.
    /// </summary>
    Task AddDailyLogContentAsync(DailyLogContent content, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review M1) — saves a staged schedule COPY (a clone and its audit row). Returns
    /// <c>false</c>, having discarded everything this unit of work staged, when a copy of the same source and version is
    /// already kept (unique index <c>ix_schedule_templates_derived_version</c>, error 23505: one copy per source and
    /// version, which lane SCH-OWN re-keys); the clone door answers 409 with words instead of a 500. Any other failure is
    /// thrown as before. The default (test doubles) saves and answers <c>true</c>.
    /// </summary>
    async Task<bool> TrySaveScheduleCopyAsync(CancellationToken ct = default)
    {
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// spec: plr-d10 (lane F1, review N1) — saves a staged content revision. Returns <c>false</c>,
    /// having discarded everything this unit of work staged, when another writer took the same
    /// record version first (unique key <c>ux_daily_log_contents_log_version</c>, error 23505): the
    /// caller re-applies the edit on top of the newer version instead of failing the phone's
    /// mutation and spending its retry budget. Any other failure is thrown as before.
    /// </summary>
    async Task<bool> TrySaveContentRevisionAsync(CancellationToken ct = default)
    {
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-M) — saves ONE money entry an edit made for a newly priced line of a record, with its
    /// <c>Created</c> audit row. Returns <c>false</c>, having written nothing of it, when the entry's id is already held
    /// by a row this farm cannot see (another farm's: the primary key, error 23505) — so another farm's row can never
    /// make a farmer's edit fail, and is never written over (E4). Any other failure is thrown, and the caller's whole
    /// edit is retried with it (P1: the money is the farmer's own statement, never a best-effort side-car).
    /// </summary>
    async Task<bool> TryAddRecordMoneyAsync(CostEntry entry, AuditEvent created, CancellationToken ct = default)
    {
        await AddCostEntryAsync(entry, ct);
        await AddAuditEventAsync(created, ct);
        await SaveChangesAsync(ct);
        return true;
    }

    /// <summary>The CURRENT content of one log (its highest version), or null when it has none.</summary>
    Task<DailyLogContent?> GetCurrentDailyLogContentAsync(Guid dailyLogId, CancellationToken ct = default)
        => Task.FromResult<DailyLogContent?>(null);

    /// <summary>
    /// The CURRENT content of each log in the set (one row per log that has any) — the pull's
    /// read. Like <see cref="GetLabourAssignmentsForDailyLogsAsync"/> there is no "changed since"
    /// here: the parent log's <c>ModifiedAtUtc</c> is the delta, and a revision moves it.
    /// <para><b>Farm-checked before the newest is picked</b> (doctrine E4, review S4 / N5): only a
    /// row whose <c>farm_id</c> is its log's own farm counts, so a mismatched row at a higher
    /// version falls away and the newest legitimate row is returned. One row per log is chosen
    /// by the database, never by loading every version (review S8).</para>
    /// </summary>
    Task<IReadOnlyList<DailyLogContent>> GetCurrentDailyLogContentsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLogContent>>([]);

    /// <summary>
    /// The LIVE attribution rows for a set of engagements — the bulk sibling of
    /// <see cref="GetFieldOperatorWorkRowsForAssignmentAsync"/>.
    /// </summary>
    /// <remarks>
    /// <b>NOT farm-scoped by itself</b>, exactly like its single-assignment
    /// sibling: <c>p_user_select_field_operator_work_rows</c> is a PERMISSIVE
    /// policy OR-ed with the tenant policy, and Postgres FK checks bypass RLS
    /// entirely, so a row here can carry a <c>farm_id</c> other than its parent
    /// log's. The caller must assert that itself (doctrine E4 — both sides).
    /// </remarks>
    Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentsAsync(
        IReadOnlyCollection<Guid> labourAssignmentIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

    // --- Labour capability (LABOUR_PHASE2 Phase 5, migration ②) ---------------
    // Same A10/F7 rule as every block above, and it is LOAD-BEARING here:
    // IShramSafalRepository has 28 implementors and an ABSTRACT member on this
    // interface produces ~135 compile errors across the test tree. Both members
    // below therefore ship a DEFAULT body. Production ShramSafalRepository
    // overrides both.
    //
    // ⚠ KNOWN CONSEQUENCE, stated rather than discovered later: because the
    // default for GetLabourManagementGrantAsync is `false`, EVERY in-tree test
    // double silently reports "not granted". That is the correct fail-closed
    // direction, and it is what keeps the pre-existing Worker-denial baselines
    // (FarmMembershipAuthorizationBaselineTests) passing untouched — but it also
    // means a FUTURE test that asserts a denial can pass for the wrong reason:
    // it would pass identically against a repository that never consulted the
    // grant at all. Any test that means to prove the GRANT path must override
    // this member (see LabourCapabilityGateTests, which uses a double that
    // returns true, and the real-Postgres suite, which uses the real row).

    /// <summary>
    /// Does this user hold the EXPLICIT <c>can_manage_labour_records</c> grant
    /// on this farm? <c>Active</c> memberships only (spec plr-d7-m1-multiuser-2026-10-26
    /// step 1; non-terminal before it) — a grant cannot outlive, or act through a paused or
    /// pending, membership that carries it.
    ///
    /// <para><b>This is one INPUT to the decision, never the decision.</b>
    /// Owner-tier and Mukadam are allowed with this flag <c>false</c>; the
    /// effective rule is <see cref="ShramSafal.Domain.Farms.LabourManagementPermission.IsAllowed"/>,
    /// resolved once in <c>LabourManagementGate</c>. Do not call this member
    /// directly from a handler.</para>
    ///
    /// <para><c>nowUtc</c> bounds the grant: a row whose
    /// <c>labour_grant_expires_at_utc</c> is at or before it does not count.</para>
    /// </summary>
    Task<bool> GetLabourManagementGrantAsync(
        Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
        => Task.FromResult(false);

    /// <summary>
    /// The caller's non-terminal <see cref="FarmMembership"/> on a farm,
    /// <b>TRACKED</b> — for the grant/revoke write path only.
    ///
    /// <para><b>Why this exists next to <see cref="GetFarmMembershipAsync"/>
    /// rather than reusing it.</b> That method is <c>AsNoTracking()</c>, so a
    /// domain mutation applied to what it returns is never persisted by
    /// <c>SaveChangesAsync</c> — the change is made on a detached POCO and
    /// silently discarded. (<c>ExitMembershipHandler</c> does exactly that
    /// today; see the Phase 5 report. Reusing the no-tracking read here would
    /// have shipped a grant endpoint that answers 200 and writes nothing.)
    /// Widening <c>GetFarmMembershipAsync</c> to tracked would change behaviour
    /// for every existing caller, so the write path gets its own read that says
    /// what it is.</para>
    /// </summary>
    Task<FarmMembership?> GetTrackedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult<FarmMembership?>(null);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — <see cref="GetTrackedFarmMembershipAsync"/>,
    /// read only after the live seat's row is LOCKED for the rest of the request transaction
    /// (<c>FOR UPDATE</c>). For a status change decided on what the read returns (the owner's QR
    /// activating a typed-code request): a second request for the same seat (a double scan) waits
    /// at the lock, then reads the committed result and sees nothing left to do — so the change,
    /// its audit row and its analytics event happen once. Requires the caller's transaction (the
    /// request transaction); the lock is released when it ends.
    /// Default body = the unlocked read, so in-tree test doubles keep compiling (F7); they have
    /// no concurrency to serialise.
    /// </summary>
    Task<FarmMembership?> GetTrackedFarmMembershipForUpdateAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => GetTrackedFarmMembershipAsync(farmId, userId, ct);

    /// <summary>
    /// The caller's <see cref="FarmMembership"/> on a farm <b>whatever its
    /// status</b>, <b>TRACKED</b> — for the exit write path only.
    ///
    /// <para><b>Why the terminal rows have to come back.</b>
    /// <c>ExitMembershipHandler</c> answers "you have already left" as an
    /// idempotent success rather than an error, because a farmer on a rural
    /// connection re-sending the same request must converge instead of being
    /// told something went wrong. That branch reads
    /// <c>membership.IsTerminal</c> — and every other membership read in this
    /// port filters <c>Revoked</c>/<c>Exited</c> out, so with any of them the
    /// branch is unreachable and a repeat exit answers "you are not a member of
    /// this farm" about a farm the caller demonstrably was a member of.</para>
    ///
    /// <para><b>Deterministic when several rows exist.</b>
    /// <c>ix_farm_memberships_farm_user_nonterminal</c> permits at most ONE
    /// non-terminal row per (farm, user) but any number of terminal ones (a
    /// worker may rejoin by QR after leaving). The live row wins; otherwise the
    /// most recently modified terminal row, so the answer does not depend on
    /// scan order.</para>
    ///
    /// <para><b>Default is the narrower sibling, deliberately.</b> Falling back
    /// to <see cref="GetTrackedFarmMembershipAsync"/> leaves every in-tree test
    /// double on the behaviour it has today (non-terminal only) instead of on
    /// <c>null</c>, so a double that has not overridden this member degrades to
    /// "not a member" — the answer it already gave — rather than to a new,
    /// silently wrong one.</para>
    /// </summary>
    Task<FarmMembership?> GetTrackedFarmMembershipIncludingTerminalAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => GetTrackedFarmMembershipAsync(farmId, userId, ct);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, plan §2 #1) — the person's standing on the
    /// farm for <see cref="Services.FarmAccessPolicy"/>: the registrant (always every power), or
    /// their live seat (any status, so the policy itself refuses a waiting or paused one) with its
    /// role and stored permission choice; <c>null</c> when neither exists.
    /// Default body (F7): built from <see cref="GetUserRoleForFarmAsync"/> — the Active-only role —
    /// and <see cref="GetLabourManagementGrantAsync"/>, so a test double answers what its role and
    /// its labour grant answer. lane 2b: a double's labour grant reads as take हजेरी AND confirm
    /// records — exactly what the 2b migration wrote for every stored grant (the one switch meant
    /// both until 2b) — and nothing else is stored. Production overrides with the real row
    /// (per-authority ends included). The double has no clock of its own, so its grant is read at
    /// the wall clock; a double that needs another instant overrides this member.
    /// </summary>
    async Task<Services.FarmAccess?> GetFarmAccessForUserAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var role = await GetUserRoleForFarmAsync(farmId, userId, ct);
        if (role is null)
        {
            return null;
        }

        var grant = await GetLabourManagementGrantAsync(farmId, userId, DateTime.UtcNow, ct);
        return new Services.FarmAccess(
            role.Value,
            MembershipStatus.Active,
            IsRegistrant: false,
            StoredPermissions: grant ? FarmPermission.ConfirmRecords : null,
            LabourGrant: grant);
    }

    /// <summary>
    /// lane MU-3 fix 1 (F12) — <see cref="GetFarmAccessForUserAsync"/> for MANY farms at once (the sync pull
    /// asks it every 15 s per phone): one answer per id, <c>null</c> where the person has no standing.
    /// Default body (F7): one call per farm, so a test double answers exactly what it answers alone;
    /// production overrides with a fixed number of queries whatever the number of farms.
    /// </summary>
    async Task<IReadOnlyDictionary<Guid, Services.FarmAccess?>> GetFarmAccessesForUserAsync(
        Guid userId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        var result = new Dictionary<Guid, Services.FarmAccess?>();
        foreach (var farmId in farmIds.Distinct())
        {
            result[farmId] = await GetFarmAccessForUserAsync(farmId, userId, ct);
        }

        return result;
    }

    /// <summary>
    /// lane MU-3 fix 1 (F12) — who made each of these records, and on which farm (a record's photo follows
    /// its record: an own-records-only seat may read it only when the record is his). Unknown ids are
    /// absent. Default body: one read per id; production overrides with one query.
    /// </summary>
    async Task<IReadOnlyDictionary<Guid, Services.RecordMaker>> GetRecordMakersAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    {
        var result = new Dictionary<Guid, Services.RecordMaker>();
        foreach (var id in dailyLogIds.Distinct())
        {
            if (await GetDailyLogByIdAsync(id, ct) is { } log)
            {
                result[id] = new Services.RecordMaker(log.Id, (Guid)log.FarmId, log.OperatorUserId.Value);
            }
        }

        return result;
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the person's most recently ENDED seat on the
    /// farm (Revoked or Exited; newest by its last change), untracked, or <c>null</c>. The owner's
    /// decision route reads it to answer a decline / removal re-sent after it landed. NOT for SEC-2:
    /// the newest ended seat can be a request the person withdrew himself, which would hide the
    /// owner's stop — the QR claim reads <see cref="GetFarmMembershipHistoryAsync"/> instead.
    /// Default body: <c>null</c> (no history), so the in-tree test doubles keep their behaviour;
    /// production overrides.
    /// </summary>
    Task<FarmMembership?> GetLatestEndedFarmMembershipAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult<FarmMembership?>(null);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, SEC-2) — EVERY seat this person has had on the
    /// farm (any status, ended ones included), untracked, oldest first. The QR claim reads the
    /// whole history (<see cref="FarmMembership.HasUnansweredOwnerStop"/>) so a seat the person
    /// ended himself (a withdrawn request) can never hide the owner's earlier stop. Default body:
    /// empty (no history), so the in-tree test doubles keep their behaviour; production overrides.
    /// </summary>
    Task<IReadOnlyList<FarmMembership>> GetFarmMembershipHistoryAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FarmMembership>>(Array.Empty<FarmMembership>());

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, M-7 of the 27 Oct alignment) — the LAST FOUR
    /// digits of each account's phone number (<c>public.users.phone</c>), keyed by user id. Names
    /// are self-typed, so the owner's team screen shows who is really asking; only the tail, never
    /// the whole number. Read ONLY by the owner-tier roster and the owner's decision answer. A user
    /// with no row is absent (the phone then shows nothing, never an invented number). Default
    /// body: empty, so the in-tree test doubles keep their behaviour; production overrides.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, string>> GetPhoneLast4ByIdsAsync(
        IEnumerable<Guid> userIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyDictionary<Guid, string>>(new Dictionary<Guid, string>());
    /// <summary>
    /// DFES (dfes-companion-2026-07-11) — all <see cref="ShramSafal.Domain.Dfes.DailyRichnessAggregate"/>
    /// rows for a farm (the Phase-3 engagement fold reads these). Default impl returns empty so the
    /// in-tree IShramSafalRepository test doubles keep compiling; production overrides.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.DailyRichnessAggregate>> GetDailyRichnessAggregatesForFarmAsync(
        Guid farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.DailyRichnessAggregate>>(
            Array.Empty<ShramSafal.Domain.Dfes.DailyRichnessAggregate>());

    // ── DFES (dfes-companion-2026-07-11) daily richness derivation ─────────────
    Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLog>>(Array.Empty<DailyLog>());

    Task<IReadOnlyList<ShramSafal.Domain.Farms.ObservationEvent>> GetObservationEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Farms.ObservationEvent>>(
            Array.Empty<ShramSafal.Domain.Farms.ObservationEvent>());

    /// <summary>
    /// wave-3.5, Ruling 3 (2026-08-15) — the day's system-captured
    /// <see cref="ShramSafal.Domain.Farms.WeatherStamp"/> rows, so the scorer can stop
    /// asking the farmer to repeat weather the app already holds.
    ///
    /// <para><c>ssf.weather_stamps</c> has been written on the same unit of work as the
    /// log since 20260630040851_AddWeatherStampsTable and carries its own SELECT RLS
    /// policy — but until this port existed <b>nothing had ever read it back</b>. That
    /// was the whole gap: the data was there and the farmer was still being asked.</para>
    ///
    /// <para>Same shape as <see cref="GetObservationEventsForDailyLogsAsync"/> above: an
    /// EXISTS-join child keyed by plain <c>DailyLogId</c>, read no-tracking because the
    /// scorer only inspects it. Default empty so the in-tree test doubles keep compiling;
    /// a double that does not override it simply sees no system weather, which is the
    /// pre-3.5 behaviour exactly.</para>
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Farms.WeatherStamp>> GetWeatherStampsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Farms.WeatherStamp>>(
            Array.Empty<ShramSafal.Domain.Farms.WeatherStamp>());

    // ── the rest of the day's PERSISTED spine (task-7, 2026-08-13) ─────────────
    // The richness scorer used to read the AI job's NormalizedResultJson and
    // nothing else, so every fact the farmer supplied that lives ONLY as a typed
    // row — a labour engagement, an irrigation, a machine, a disturbance — was
    // invisible to it on any log without a usable AI-JSON root. These reads give
    // the scorer the same rows the farmer actually created. Default impls return
    // empty so the in-tree test doubles keep compiling; production overrides.


    /// <summary>DFES — the <see cref="IrrigationEntry"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<IrrigationEntry>> GetIrrigationEntriesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<IrrigationEntry>>(Array.Empty<IrrigationEntry>());

    /// <summary>DFES — the <see cref="MachineryUsage"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<MachineryUsage>> GetMachineryUsagesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<MachineryUsage>>(Array.Empty<MachineryUsage>());

    /// <summary>DFES — the <see cref="DisturbanceEvent"/> rows of the day's logs.</summary>
    Task<IReadOnlyList<DisturbanceEvent>> GetDisturbanceEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DisturbanceEvent>>(Array.Empty<DisturbanceEvent>());

    /// <summary>
    /// READ-ONLY lookup of the day's aggregate. The production implementation is
    /// <b>NO-TRACKING</b> — the returned entity is DETACHED, so mutating it (e.g.
    /// <c>ApplyDerivation</c>) and then calling <see cref="SaveChangesAsync"/> emits
    /// <b>NO UPDATE AT ALL</b>: a silent, exception-free no-op.
    /// <para><b>Do NOT use this overload when the caller intends to mutate the entity.</b>
    /// Use <see cref="GetDailyRichnessAggregateForUpdateAsync"/> for any read-modify-write.</para>
    /// </summary>
    Task<ShramSafal.Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.DailyRichnessAggregate?>(null);

    /// <summary>
    /// FIX (dfes-companion-2026-07-11) — read the day's aggregate as a
    /// <b>CHANGE-TRACKED</b> entity, for the read-modify-write recompute path
    /// (<c>DailyRichnessDerivationService.RecomputeAsync</c>). Because the entity is
    /// attached to the DbContext, a subsequent <c>ApplyDerivation</c> +
    /// <see cref="SaveChangesAsync"/> actually emits the UPDATE.
    /// <para>This exists SPECIFICALLY because <see cref="GetDailyRichnessAggregateAsync"/>
    /// is no-tracking: mutating its detached result persisted NOTHING and froze the farmer's
    /// day score at whatever the first log of the day produced. Read-only callers
    /// (e.g. <c>GetDayUnderstandingHandler</c>) must keep using the no-tracking overload —
    /// do not collapse these two into one tracked method.</para>
    /// Default returns null so in-tree <c>IShramSafalRepository</c> test doubles keep
    /// compiling; production overrides.
    /// </summary>
    Task<ShramSafal.Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.DailyRichnessAggregate?>(null);

    Task AddDailyRichnessAggregateAsync(
        ShramSafal.Domain.Dfes.DailyRichnessAggregate aggregate, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 2, N5) — stage the removal of a day's aggregate: a day left with no record (its
    /// only record moved away) must look exactly like a day that never had one, which is NO row (the create path writes
    /// one only for a day with records). The aggregate is derived only — nothing else writes it — so nothing is lost.
    /// The default throws: a repository that cannot remove it must not pretend it did.
    /// </summary>
    void RemoveDailyRichnessAggregate(ShramSafal.Domain.Dfes.DailyRichnessAggregate aggregate)
        => throw new NotSupportedException("This repository cannot remove a day aggregate.");

    // ── DFES Phase 5 — question-engine telemetry (append-only ssf.question_events) ──
    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Dfes.QuestionEvent"/> row.
    /// No SaveChanges — the handler owns the commit. Default no-op keeps existing
    /// in-tree test doubles compiling (mirrors AddWeatherStampAsync, L69).
    /// </summary>
    Task AddQuestionEventAsync(ShramSafal.Domain.Dfes.QuestionEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    // ── wave-4.2 — the two append-only consent ledgers behind the gate's one tap ──
    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Consent.TermsAcceptanceEvent"/>.
    /// No SaveChanges — the handler owns the commit, and it commits BOTH ledgers together
    /// or neither. Default no-op keeps in-tree test doubles compiling.
    /// </summary>
    Task AddTermsAcceptanceEventAsync(
        ShramSafal.Domain.Consent.TermsAcceptanceEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    /// <summary>
    /// Stage an append-only <see cref="ShramSafal.Domain.Consent.ConsentGrantEvent"/>.
    /// Same contract as the terms ledger above.
    /// </summary>
    Task AddConsentGrantEventAsync(
        ShramSafal.Domain.Consent.ConsentGrantEvent e, CancellationToken ct = default)
        => Task.CompletedTask;

    // ── B1 (2026-08-27) — the idempotency reads behind LinkConsentGateToUserHandler ──
    /// <summary>
    /// The existing <c>TERMS_ACCEPTANCE_LINKED</c> row for this account and
    /// pre-registration session, if one has already been written.
    ///
    /// <para><b>Why this read is possible at all.</b> A linking row carries
    /// <c>user_id</c>, so the self policy's
    /// <c>USING (user_id IS NOT NULL AND user_id = &lt;GUC&gt;)</c> admits it — unlike the
    /// orphaned accepting row it links, which no role in this system can read. So the
    /// caller can be told "already linked" rather than being handed a second row.</para>
    ///
    /// <para><b>Why it matters.</b> A client that loses the response to a successful link
    /// must be free to call again — that retryability is what keeps a failed link from ever
    /// needing to block a farmer (doctrine P9). Without this read, every retry would append
    /// another pair of rows to a ledger that can never be cleaned up, because
    /// <c>UPDATE</c>/<c>DELETE</c>/<c>TRUNCATE</c> are revoked.</para>
    ///
    /// <para>Default body returns null so in-tree test doubles keep compiling — the same
    /// convention this file already uses for <see cref="FindQuestionEventAsync"/>.</para>
    /// </summary>
    Task<ShramSafal.Domain.Consent.TermsAcceptanceEvent?> FindTermsAcceptanceLinkAsync(
        Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Consent.TermsAcceptanceEvent?>(null);

    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13) — this
    /// person's granted acceptance of the notice that carries a user id (a linked acceptance,
    /// or one given while signed in): his newest acceptance of the CURRENT notice version when
    /// one exists, otherwise his newest of any version — so a later tick on an old APK never
    /// hides a current acceptance. Read-only; <c>GET /consent/me</c> exposes
    /// its notice version so a phone can tell whether the notice in force was already
    /// accepted (on any phone) before asking again.
    ///
    /// <para>Must run inside the caller's RLS identity scope: the ledger's self-only policy
    /// hides every user-bearing row from a session without <c>agrisync.user_id</c>.
    /// Default body returns null (= "not known"), which a phone treats as "ask" — never as
    /// "already accepted".</para>
    /// </summary>
    Task<ShramSafal.Domain.Consent.TermsAcceptanceEvent?> GetLatestNoticeAcceptanceAsync(
        Guid userId, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Consent.TermsAcceptanceEvent?>(null);

    /// <summary>
    /// The existing <c>CORE_DPDP_CONSENT_LINKED</c> row for this account and
    /// pre-registration session, if one has already been written. Same contract and same
    /// reason as the terms ledger above; queried separately because the two ledgers are
    /// deliberately separate legal records and "linked" has to be true of both.
    /// </summary>
    Task<ShramSafal.Domain.Consent.ConsentGrantEvent?> FindConsentGrantLinkAsync(
        Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Consent.ConsentGrantEvent?>(null);

    /// <summary>
    /// Read recent question_events for a farm (anti-repeat / cooldown feed). RLS
    /// already scopes rows to the tenant; the app layer additionally membership-checks.
    /// Default empty so test doubles compile.
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.QuestionEvent>> GetRecentQuestionEventsForFarmAsync(
        Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.QuestionEvent>>(Array.Empty<ShramSafal.Domain.Dfes.QuestionEvent>());

    /// <summary>
    /// wave-3.3, Ruling 1 (2026-08-15) — the existing append-only row for
    /// (<paramref name="dailyLogId"/>, <paramref name="questionKey"/>), if any.
    ///
    /// <para><c>ssf.question_events</c> carries <c>REVOKE UPDATE, DELETE</c>
    /// (20260713052440_AddDfesDataSpine), so an upsert is unavailable to the app role:
    /// the handler reads, then inserts. The partial unique index
    /// <c>ux_question_events_log_question</c> (20260816090000_UniqueQuestionPerLog) is the
    /// backstop for a genuine race; this read is what makes the ordinary offline retry
    /// silent rather than a 500.</para>
    ///
    /// <para>Default body returns null so the in-tree <c>IShramSafalRepository</c> test
    /// doubles keep compiling — the same convention this file already uses for
    /// <see cref="AddWeatherStampAsync"/> and <see cref="AddQuestionEventAsync"/>. A double
    /// that does not override this therefore behaves exactly as it did before wave-3.3.</para>
    /// </summary>
    Task<ShramSafal.Domain.Dfes.QuestionEvent?> FindQuestionEventAsync(
        Guid dailyLogId, string questionKey, CancellationToken ct = default)
        => Task.FromResult<ShramSafal.Domain.Dfes.QuestionEvent?>(null);

    /// <summary>
    /// task-3 (2026-08-14), founder ruling A — the gap dimensions the farmer actually
    /// ANSWERED on one local day, for the daily-richness recompute to credit.
    ///
    /// <para>Returns only what <see cref="ShramSafal.Domain.Dfes.AnsweredGap.TryFrom"/>
    /// accepts: a <c>gap.*</c> question whose response carries content. Non-gap questions
    /// and empty answers yield nothing, so silence can never score (doctrine P4). Rows the
    /// farmer explicitly SKIPPED are excluded before <c>TryFrom</c> ever sees them — it has
    /// no access to the flag, so this read is what makes "a skip yields nothing" TRUE
    /// rather than merely documented. Every instance MUST be built through <c>TryFrom</c>
    /// — it is what upper-cases the dimension, and the extractor compares dimension names
    /// with ordinal equality.</para>
    ///
    /// <para><c>question_events</c> has no local-date column, so the day is expressed as the
    /// UTC window <see cref="ShramSafal.Domain.Dfes.FarmLocalDay.UtcWindow"/> defines —
    /// the same rule the handler uses to decide which day was answered. RLS scopes rows to
    /// the caller's tenant; the app layer additionally membership-checks. Default empty so
    /// in-tree test doubles keep compiling; production overrides.</para>
    /// </summary>
    Task<IReadOnlyList<ShramSafal.Domain.Dfes.AnsweredGap>> GetAnsweredGapsAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Dfes.AnsweredGap>>(Array.Empty<ShramSafal.Domain.Dfes.AnsweredGap>());

    // ── spec: plr-d10 lane PRV (founder D-26) — who may see ONE record. Default bodies on purpose (doctrine F7). ──

    /// <summary>
    /// lane PRV — every record of these farms whose audience is NOT the normal team (rare by nature), with the people
    /// chosen for it. The ONE read every door asks before it hands out a record, a total or a photo
    /// (<see cref="Services.RecordVisibility"/>). Production overrides it with two bounded queries; a test double holds
    /// no narrowed record unless it overrides this (the in-tree doubles predate audiences and stub the reads a derived
    /// default would need). In a user-scoped read only the reader's own chosen rows are visible (the table's narrow
    /// policy) — which is all the rule needs; the primary account holder sees every row.
    /// </summary>
    Task<IReadOnlyList<Services.RestrictedRecord>> GetRestrictedRecordsAsync(
        IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Services.RestrictedRecord>>([]);

    /// <summary>
    /// spec: plr-d10 lane MU-4 — where EVERY work and money record of these farms sits and who made it
    /// (<see cref="Services.RecordPlace"/>), for the place rule (<see cref="Services.RecordPlaceRule"/>). Asked only for the
    /// farms whose reader's seat covers chosen plots or reads his own work (rare: never the owner's own farm). Production
    /// overrides it with two bounded, untracked projections (no children); a test double holds no place (nothing is
    /// narrowed by place unless it overrides this), doctrine F7.
    /// </summary>
    Task<IReadOnlyList<Services.RecordPlace>> GetRecordPlacesAsync(
        IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Services.RecordPlace>>([]);

    /// <summary>
    /// lane MU-4 — of <paramref name="farmIds"/>, the farms where this person's live seat MAY read by place (it covers
    /// chosen plots or its own work, or carries the कामगार label): a cheap pre-filter, a superset — the rule itself
    /// (<see cref="Services.RecordPlaceRule.Narrows"/>) is then asked of his real scope. Lets a door that finds nothing
    /// narrowed skip reading his standing at all (PRV's common case). Default body: none (a test double narrows nothing by
    /// place unless it overrides this), doctrine F7.
    /// </summary>
    Task<IReadOnlyList<Guid>> GetFarmsMaybeReadByPlaceAsync(
        Guid userId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Guid>>([]);

    /// <summary>
    /// lane MU-4 — the place of ONE work (<c>DailyLog</c>) or money (<c>CostEntry</c>) record, read without tracking; null
    /// when it is not found under the caller's scope. Default body: none (a test double narrows nothing by place).
    /// </summary>
    Task<Services.RecordPlace?> GetRecordPlaceAsync(string recordKind, Guid recordId, CancellationToken ct = default)
        => Task.FromResult<Services.RecordPlace?>(null);

    /// <summary>
    /// lane PRV — the little a door needs to decide whether a change may touch one record: its farm, its audience and
    /// its maker. Read WITHOUT tracking (it never stands in for the copy a handler changes). Null when the record is not
    /// found under the caller's current scope.
    /// </summary>
    async Task<Services.RecordAudienceHead?> GetRecordAudienceHeadAsync(string recordKind, Guid recordId, CancellationToken ct = default)
    {
        if (recordKind == Domain.RecordPrivacy.RecordKinds.DailyLog)
        {
            return await GetDailyLogByIdAsync(recordId, ct) is { } log
                ? new Services.RecordAudienceHead(Domain.RecordPrivacy.RecordKinds.DailyLog, log.Id, (Guid)log.FarmId, log.Audience, log.OperatorUserId.Value)
                : null;
        }

        return recordKind == Domain.RecordPrivacy.RecordKinds.CostEntry && await GetCostEntryByIdAsync(recordId, ct) is { } entry
            ? new Services.RecordAudienceHead(Domain.RecordPrivacy.RecordKinds.CostEntry, entry.Id, (Guid)entry.FarmId, entry.Audience, entry.CreatedByUserId.Value)
            : null;
    }

    /// <summary>lane PRV — the people chosen for one record (empty when none, or when the reader may not see them).</summary>
    Task<IReadOnlyList<Guid>> GetRecordAudienceUserIdsAsync(string recordKind, Guid recordId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Guid>>([]);

    /// <summary>
    /// lane PRV — stages the people chosen for one record, replacing whoever was chosen before (no SaveChanges: the
    /// caller's own save commits it with the record's audience and its audit row). Current state only; the history is
    /// the audit row. A store that cannot hold it REFUSES (never a silent no-op).
    /// </summary>
    Task ReplaceRecordAudienceMembersAsync(
        Guid farmId, string recordKind, Guid recordId, IReadOnlyCollection<Guid> userIds, DateTime atUtc, CancellationToken ct = default)
        => throw new NotSupportedException("This store cannot hold a record's chosen people.");

    /// <summary>lane PRV — the attachments linked to any of these parents (a re-admitted record's photos are sent again).</summary>
    async Task<IReadOnlyList<Attachment>> GetAttachmentsForEntitiesAsync(
        IReadOnlyCollection<Guid> entityIds, string entityType, CancellationToken ct = default)
    {
        var result = new List<Attachment>();
        foreach (var id in entityIds.Distinct())
        {
            result.AddRange(await GetAttachmentsForEntityAsync(id, entityType, ct));
        }

        return result;
    }

    /// <summary>lane PRV — attachments by id (a money record's bill photos are named on the entry itself).</summary>
    async Task<IReadOnlyList<Attachment>> GetAttachmentsByIdsAsync(
        IReadOnlyCollection<Guid> attachmentIds, CancellationToken ct = default)
    {
        var result = new List<Attachment>();
        foreach (var id in attachmentIds.Distinct())
        {
            if (await GetAttachmentByIdAsync(id, ct) is { } attachment)
            {
                result.Add(attachment);
            }
        }

        return result;
    }

    /// <summary>lane PRV — the day-ledger rows made from any of these money entries.</summary>
    async Task<IReadOnlyList<DayLedger>> GetDayLedgersBySourceCostEntryIdsAsync(
        IReadOnlyCollection<Guid> costEntryIds, CancellationToken ct = default)
    {
        var result = new List<DayLedger>();
        foreach (var id in costEntryIds.Distinct())
        {
            if (await GetDayLedgerBySourceCostEntryIdAsync(id, ct) is { } ledger)
            {
                result.Add(ledger);
            }
        }

        return result;
    }

    // ── spec: plr-d10 lane RATE-1 part A (founder D-72 "Own farm prices") — each farm's own price and rate list ──────
    // Default implementations (doctrine F7): the in-tree doubles keep compiling; ShramSafalRepository overrides each.

    /// <summary>
    /// lane RATE-1 — saves one version of a farm's rate with its audit row, or answers <c>false</c> when its id or its
    /// (line, version) is already taken — by a change that landed first, or by another farm's row the caller cannot see
    /// (a unique index sees across row security). Only this save is undone (a savepoint on the ambient transaction), so
    /// the caller can look again. A store that cannot hold it REFUSES (never a silent no-op).
    /// </summary>
    Task<bool> TryAddFarmRateAsync(FarmRate rate, AuditEvent created, CancellationToken ct = default)
        => throw new NotSupportedException("This store cannot hold a farm's rates.");

    /// <summary>
    /// lane RATE-1 — every version of one rate line the caller's row policies let through, oldest first. A line of
    /// another farm the caller is ALSO on can come back: the caller checks each row's farm (E4).
    /// </summary>
    Task<IReadOnlyList<FarmRate>> GetFarmRateLineAsync(Guid rateLineId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FarmRate>>([]);

    /// <summary>lane RATE-1 — one version by its id (a repeat of the same change), or null.</summary>
    Task<FarmRate?> GetFarmRateByIdAsync(Guid farmRateId, CancellationToken ct = default)
        => Task.FromResult<FarmRate?>(null);

    /// <summary>lane RATE-1 — every version of every rate of one farm (the REST read), by line then version.</summary>
    Task<IReadOnlyList<FarmRate>> GetFarmRatesForFarmAsync(Guid farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FarmRate>>([]);

    /// <summary>lane RATE-1 — the pull: versions made on these farms after <paramref name="sinceUtc"/>.</summary>
    Task<List<FarmRate>> GetFarmRatesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
        => Task.FromResult(new List<FarmRate>());

    /// <summary>lane RATE-1 — one row of ShramSafal's shared price list (a suggestion he confirms), or null.</summary>
    Task<PriceConfig?> GetPriceConfigByIdAsync(Guid priceConfigId, CancellationToken ct = default)
        => Task.FromResult<PriceConfig?>(null);

    /// <summary>lane RATE-1 — the whole shared price list (the suggestion door filters it to ShramSafal's own rows).</summary>
    Task<IReadOnlyList<PriceConfig>> GetPriceConfigsAsync(CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<PriceConfig>>([]);
}
