using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.Sync.PullSyncChanges;

public sealed class PullSyncChangesHandler(
    IShramSafalRepository repository,
    IClock clock,
    GetScheduleTemplatesHandler getScheduleTemplatesHandler,
    GetAttentionBoardHandler getAttentionBoardHandler,
    ITestInstanceRepository testInstanceRepository,
    ITestProtocolRepository testProtocolRepository,
    ITestRecommendationRepository testRecommendationRepository,
    IComplianceSignalRepository complianceSignalRepository,
    EvaluateComplianceHandler evaluateComplianceHandler,
    TenantContext tenantContext,
    ILogger<PullSyncChangesHandler> logger)
{
    // Sub-plan 03 Task 10 — stable component identifiers used in
    // DegradedComponent.ComponentName. Frontend keys on these.
    private const string ComponentAttentionBoard = "AttentionBoard";
    private const string ComponentJobCards = "JobCards";
    private const string ComponentComplianceFreshness = "ComplianceFreshness";
    private const string ComponentComplianceSignals = "ComplianceSignals";

    /// <summary>MU-3 fix 1 (F9) — at most this many farms a phone may ask about in one pull.</summary>
    public const int MaxHeldFarms = 100;
    public async Task<Result<SyncPullResponseDto>> HandleAsync(PullSyncChangesQuery query, CancellationToken ct = default)
    {
        var serverNowUtc = clock.UtcNow;
        var sinceUtc = NormalizeCursor(query.SinceUtc, serverNowUtc);

        // ── lane MU-3 (plan step 4a; founder D-22 / D-26) — each farm's READ SCOPE ──────────────
        // The farms this person may pull (owned, or an Active seat), each with what he may read there,
        // decided by FarmAccessPolicy over his stored authorities (FarmReadScope) — never by the label
        // alone, never by a second rule. A farm whose standing reads nothing (paused, waiting, removed
        // between the two reads) contributes nothing at all. Every kind below is read only for the
        // farms whose scope admits it, and a farm whose reading widened after this phone's cursor is
        // re-sent from the beginning (PullReadWindow — the per-farm cursor reset).
        // MU-3 fix 1 (F12): every seat in ONE batched read, never one read per farm. (F9): the farms the
        // phone says it holds are asked about too, so a farm it may no longer read is TOLD to it explicitly
        // (Paused / Waiting / Removed) — the phone never wipes a farm because it is merely absent.
        var readable = await repository.GetFarmIdsForUserAsync(query.UserId, ct);
        var held = (query.HeldFarmIds ?? []).Where(id => id != Guid.Empty).Distinct().Take(MaxHeldFarms).ToList();
        var accesses = await repository.GetFarmAccessesForUserAsync(query.UserId, readable.Union(held).ToList(), ct);
        var scopes = new Dictionary<Guid, FarmReadScope>();
        foreach (var candidateFarmId in readable)
        {
            if (FarmReadScope.Of(candidateFarmId, accesses.GetValueOrDefault(candidateFarmId), serverNowUtc) is { } scope)
            {
                scopes[candidateFarmId] = scope;
            }
        }

        // A farm read as readable a moment ago by the other query (a seat activated in between) is not
        // told "gone": only a standing that truly reads nothing is.
        var notReadable = held
            .Where(id => !scopes.ContainsKey(id) && !FarmAccessPolicy.MayRead(accesses.GetValueOrDefault(id)))
            .Select(id => FarmAccessScopeDto.NotReadable(id, accesses.GetValueOrDefault(id)))
            .ToList();

        var window = new PullReadWindow(scopes, sinceUtc, serverNowUtc);
        var farmIds = window.FarmIds.ToList();
        static bool Any(FarmReadScope _) => true;

        var farms = await window.ReadAsync(Any, (ids, since) => repository.GetFarmsChangedSinceAsync(ids, since, ct), f => (Guid)f.Id);
        var plots = await window.ReadAsync(Any, (ids, since) => repository.GetPlotsChangedSinceAsync(ids, since, ct), p => (Guid)p.FarmId);
        var cropCycles = await window.ReadAsync(Any, (ids, since) => repository.GetCropCyclesChangedSinceAsync(ids, since, ct), c => (Guid)c.FarmId);
        // A कामगार label reads his OWN records only; every other working seat reads the farm's (D-26).
        var dailyLogs = (await window.ReadAsync(Any, (ids, since) => repository.GetDailyLogsChangedSinceAsync(ids, since, ct), l => (Guid)l.FarmId))
            .Where(l => window.ScopeOf((Guid)l.FarmId)!.MayReadRecordOf(query.UserId, l.OperatorUserId.Value))
            .ToList();
        // ── LABOUR_PHASE2 Phase 3 — labour read-back ─────────────────────────
        // Labour was written and never read back: a farmer recorded 8 workers on
        // Phone A, and Phone B on a clean install saw the log with no labour at
        // all. These two reads are that fix, and they are NOT wrapped in a
        // degrade-and-continue block like JobCards / ComplianceSignals below.
        //
        // That is deliberate (doctrine P1). Labour is Phase-1 canonical data —
        // what the farmer confirmed — and the same rule that keeps it out of
        // CreateDailyLogHandler's best-effort side-car keeps it out of a
        // best-effort branch here. A degraded read would have to answer with
        // either `[]` ("this log has no labour" — a false statement about the
        // farmer's own record) or `null` on some logs and not others. Failing the
        // pull, exactly as the daily-log read above already does, is the honest
        // outcome: the device retries and nothing is misreported meanwhile.
        //
        // The labour rows are children of `dailyLogs`, which is ALREADY farm-scoped
        // twice over (SQL predicate + farmIdSet filter), so scoping is inherited
        // rather than re-derived. `labourByLogId` re-asserts it anyway: only
        // engagements whose parent is in this response can reach the wire.
        var dailyLogFarmById = dailyLogs.ToDictionary(l => l.Id, l => (Guid)l.FarmId);
        var labourAssignments =
            (await repository.GetLabourAssignmentsForDailyLogsAsync(dailyLogFarmById.Keys.ToList(), ct))
            .Where(a => dailyLogFarmById.ContainsKey(a.DailyLogId))
            .ToList();

        // E4 — "the database is not the whole defence". `field_operator_work_rows`
        // carries its own `farm_id`, Postgres FK checks bypass RLS, and
        // `p_user_select_field_operator_work_rows` is PERMISSIVE and OR-ed with the
        // tenant policy. So an attribution row pointing at this engagement is only
        // trusted when its farm IS the parent log's farm. A mismatch is dropped, and
        // dropping it cannot change any reported quantity: WorkerCount lives on the
        // engagement and is copied, never counted from these rows (P7).
        var assignmentFarmById = labourAssignments.ToDictionary(
            a => a.Id, a => dailyLogFarmById[a.DailyLogId]);
        var attributionsByAssignment =
            (await repository.GetFieldOperatorWorkRowsForAssignmentsAsync(assignmentFarmById.Keys.ToList(), ct))
            .Where(r => assignmentFarmById.TryGetValue(r.LabourAssignmentId, out var parentFarmId)
                        && (Guid)r.FarmId == parentFarmId)
            .GroupBy(r => r.LabourAssignmentId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<Domain.Labour.FieldOperatorWorkRow>)g.ToList());

        // lane MU-3 — wages on OTHER people's labour only to a seat that sees wages (or the primary
        // account holder). The engagement itself travels (worker counts, hours, names: the record of the
        // work, P7), its money does not: WagePerPerson / TotalCost are null — "not sent", which the phone
        // shows as withheld for this farm (accessScopes.seeWages = false), never as ₹0 (P4). A person's
        // OWN record comes back whole: it is his own statement.
        // MU-3 fix 1 (F4): the per-person wage is a WAGE (see wages), the crew's total is MONEY (see money);
        // both, the content amounts and the task lines' "₹" parts are applied by ReadScopeProjection.Record
        // below — the same projection every command answer uses (F5).
        var dailyLogById = dailyLogs.ToDictionary(l => l.Id);
        var labourByLogId = labourAssignments
            .GroupBy(a => a.DailyLogId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<LabourEngagementDto>)g
                    .Select(a => a.ToDto(
                        attributionsByAssignment.TryGetValue(a.Id, out var rows) ? rows : []))
                    .ToList());

        // ── spec: plr-d10 (lane F1) — what Sathi understood, read back ────────
        // The current content row of every log in this response. Phase-1 data like labour, so
        // NOT degrade-and-continue: a failed read fails the pull and the device retries, rather
        // than being told a log has no details.
        //
        // E4 — a row is only trusted when its farm IS the parent log's farm (`farm_id` is its own
        // column, FK checks bypass RLS, and a member of two farms passes the read policy for
        // both). That check is made INSIDE the query, BEFORE the newest version is picked
        // (review S4 / N5): a mismatched row at a higher version can never hide the newest
        // legitimate one and empty the log.
        var contentByLogId =
            (await repository.GetCurrentDailyLogContentsAsync(dailyLogFarmById.Keys.ToList(), ct))
            .ToDictionary(c => c.DailyLogId);

        // Review S1 (founder D-31 / D-26) — his words only to a reader allowed to hear them: the
        // speaker, the farm's primary owner, or a member holding the owner's grant
        // (RecordWordsGate, the rule the original-voice route uses). Everyone else gets the same
        // document with the words removed and every value kept. Role and grant are read once
        // per farm, and only for farms this response carries content for.
        // lane MU-3 — and its stated money only to a reader who sees the farm's money (or who made it).
        var contentDtoByLogId = ProjectContentForReader(
            query.UserId, dailyLogs, contentByLogId, accesses, serverNowUtc);

        // NOTE — the cursor is NOT advanced from labour, on purpose.
        // ssf.labour_assignments has no modified_at_utc; the parent log's
        // ModifiedAtUtc is the only real clock, and inventing one here would be a
        // fabricated timestamp (P4). See ComputeNextCursor.

        // lane MU-3 — an attachment follows its parent: a record's photo goes where the record goes, a
        // money receipt only where money goes, a farm's photo to every working seat. A kind of parent this
        // rule does not know goes to the primary account holder only (fail closed).
        var attachments = await VisibleAttachmentsAsync(
            query.UserId,
            await window.ReadAsync(Any, (ids, since) => repository.GetAttachmentsChangedSinceAsync(ids, since, ct), a => (Guid)a.FarmId),
            window,
            dailyLogById,
            ct);
        // lane MU-3 — money (cost entries, their corrections, the day ledger) only where the seat sees money.
        static bool Money(FarmReadScope scope) => scope.SeeMoney;
        var costEntries = await window.ReadAsync(Money, (ids, since) => repository.GetCostEntriesChangedSinceAsync(ids, since, ct), c => (Guid)c.FarmId);
        var costEntryIds = costEntries.Select(c => c.Id).ToHashSet();
        var financeCorrections = new List<Domain.Finance.FinanceCorrection>();
        foreach (var (ids, since) in window.Groups(Money))
        {
            financeCorrections.AddRange((await repository.GetFinanceCorrectionsChangedSinceAsync(ids, since, ct))
                .Where(c => costEntryIds.Contains(c.CostEntryId)));
        }

        financeCorrections = financeCorrections.DistinctBy(c => c.Id).ToList();
        var dayLedgers = await window.ReadAsync(Money, (ids, since) => repository.GetDayLedgersChangedSinceAsync(ids, since, ct), l => (Guid)l.FarmId);
        // Labour V2 R1 Task 3.5c — attendance rulings changed since the cursor.
        // P10's server half: once pulled here, a mark is reconstructable
        // without the device that made it.
        // lane MU-3 — attendance only to a seat that takes हजेरी (or the primary account holder).
        var attendanceMarks = await window.ReadAsync(
            s => s.SeeAttendance,
            (ids, since) => repository.GetAttendanceMarksChangedSinceAsync(ids, since, ct),
            m => (Guid)m.FarmId);
        var priceConfigs = (await repository.GetPriceConfigsChangedSinceAsync(sinceUtc, ct))
            .Where(p => (Guid)p.CreatedByUserId == query.UserId)
            .ToList();
        // lane MU-3 — the farm's planned work only to a seat that reads the farm's overview.
        var overviewCycleIds = cropCycles
            .Where(c => window.ScopeOf((Guid)c.FarmId) is { SeeFarmOverview: true })
            .Select(c => c.Id)
            .ToHashSet();
        var plannedActivities = new List<Domain.Planning.PlannedActivity>();
        foreach (var (ids, since) in window.Groups(s => s.SeeFarmOverview))
        {
            plannedActivities.AddRange((await repository.GetPlannedActivitiesChangedSinceAsync(ids, since, ct))
                .Where(a => overviewCycleIds.Contains(a.CropCycleId)));
        }

        plannedActivities = plannedActivities.DistinctBy(a => a.Id).ToList();
        // §P0.2 — the sync pull no longer carries the audit ledger at all.
        //
        // Not a trim: every audit row this path could ever have returned was a
        // NULL-farm cross-tenant row. TenantConnectionInterceptor returns in
        // user-scoped mode BEFORE setting agrisync.farm_id, so the tenant
        // policy's equality disjunct was always NULL and only the
        // `farm_id IS NULL` branch could match. There is no
        // p_user_select_audit_events. So farmers have never received their own
        // farm's audit rows here, and the farmIdSet.Contains(...) branch that
        // used to sit on this line was dead code guarding rows that never
        // arrived. What DID arrive was the cross-tenant set: S3 object keys for
        // other farmers' raw voice recordings, erasure subjects' GUIDs,
        // PII-review staff notes, admin elevation reasons.
        //
        // The empty list still flows into ComputeNextCursor and
        // CollectOperatorIds below — deliberately, so the two effects are
        // visible rather than deleted: the cursor stops advancing off audit
        // timestamps (it can only move EARLIER, never later, so no row can be
        // skipped) and the operator directory stops hydrating strangers'
        // display names out of leaked ActorUserIds.
        //
        // The `auditEvents` field STAYS on the wire as an empty array. APKs in
        // farmers' hands have it non-optional in their bundled schema; removing
        // it risks a parse failure that breaks sync entirely. Deleting the field
        // is a later change gated on client rollout.
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents = [];
        var templatesResult = await getScheduleTemplatesHandler.HandleAsync(ct);
        if (!templatesResult.IsSuccess)
        {
            return Result.Failure<SyncPullResponseDto>(templatesResult.Error);
        }

        var scheduleTemplates = templatesResult.Value ?? [];
        var cropTypes = GetScheduleTemplatesHandler.BuildCropTypes(scheduleTemplates);
        var referenceDataVersionHash = scheduleTemplates.Count > 0
            ? scheduleTemplates[0].VersionHash
            : ReferenceDataCatalog.VersionHash;
        var operatorIds = CollectOperatorIds(
            query.UserId,
            window,
            farms,
            dailyLogs,
            attachments,
            costEntries,
            financeCorrections,
            dayLedgers,
            auditEvents);
        var operators = await repository.GetOperatorsByIdsAsync(operatorIds, ct);

        var nextCursorUtc = ComputeNextCursor(
            sinceUtc,
            farms,
            plots,
            cropCycles,
            dailyLogs,
            attachments,
            costEntries,
            financeCorrections,
            dayLedgers,
            attendanceMarks,
            priceConfigs,
            plannedActivities,
            auditEvents);

        // Sub-plan 03 Task 10 — collect partial-failure components.
        // When this list is non-empty, the response carries
        // DegradedComponents + the X-Degraded HTTP header so clients
        // can show a partial-data badge, AND the cursor-freeze block
        // below resets NextCursorUtc to SinceUtc so the next pull
        // retries the same window (no silent data loss).
        var degraded = new List<DegradedComponent>();

        // AttentionBoard is computed as a snapshot on every pull.
        // If the inner handler returns Result.Failure (e.g. "no attention
        // items"), pass null verbatim — that's a normal "nothing to show"
        // outcome, not a degraded one. We only DEGRADE on a thrown
        // exception (infrastructure failure: query timeout, transient DB
        // error, NRE in computation); a Result.Failure is a typed
        // outcome and stays silent.
        AttentionBoardDto? attentionBoard = null;
        try
        {
            var attentionResult = await getAttentionBoardHandler.HandleAsync(
                new GetAttentionBoardQuery(query.UserId, serverNowUtc), ct);
            attentionBoard = attentionResult.IsSuccess ? attentionResult.Value : null;
            // lane MU-3 — the board only for farms whose overview this seat reads.
            if (attentionBoard is not null)
            {
                attentionBoard = attentionBoard with
                {
                    Cards = attentionBoard.Cards
                        .Where(c => window.ScopeOf(c.FarmId) is { SeeFarmOverview: true })
                        .ToList(),
                    ScheduledWork = attentionBoard.ScheduledWork?
                        .Where(w => window.ScopeOf(w.FarmId) is { SeeFarmOverview: true })
                        .ToList(),
                };
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "PullSync: AttentionBoard threw {ExceptionType}; degrading.",
                ex.GetType().Name);
            degraded.Add(new DegradedComponent(
                ComponentAttentionBoard,
                "AttentionBoard.Unavailable",
                ex.Message));
        }

        // CEI Phase 2 §4.5 — test instances modified since the cursor, scoped
        // to the caller's farms. Recommendations follow the parent instances.
        // lane MU-3 — tests only to a seat that reads them (not an own-records-only seat without lab records).
        IReadOnlyList<Domain.Tests.TestInstance> testInstances = await window.ReadAsync(
            s => s.SeeTests,
            async (ids, since) => (await testInstanceRepository
                .GetModifiedSinceAsync(ids.Select(id => new FarmId(id)).ToList(), since, ct)).ToList(),
            i => i.FarmId.Value);
        var testInstanceIds = testInstances.Select(i => i.Id).ToList();
        var testRecommendations = testInstanceIds.Count == 0
            ? Array.Empty<Domain.Tests.TestRecommendation>()
            : (IReadOnlyList<Domain.Tests.TestRecommendation>)await testRecommendationRepository
                .GetByTestInstanceIdsAsync(testInstanceIds, ct);
        // Resolve protocol names for each distinct protocol ID in one pass —
        // the in-memory stub and the future EF repo both support a single
        // by-id lookup cheaply.
        var protocolIds = testInstances.Select(i => i.TestProtocolId).Distinct().ToList();
        var protocolNames = new Dictionary<Guid, string?>();
        foreach (var protocolId in protocolIds)
        {
            var protocol = await testProtocolRepository.GetByIdAsync(protocolId, ct);
            protocolNames[protocolId] = protocol?.Name;
        }

        var testInstanceDtos = testInstances
            .Select(i => TestInstanceDto.FromDomain(
                i,
                protocolNames.TryGetValue(i.TestProtocolId, out var name) ? name : null))
            .ToList();
        var testRecommendationDtos = testRecommendations
            .Select(TestRecommendationDto.FromDomain)
            .ToList();

        // Advance the cursor past the test-instance / recommendation stream as
        // well so the next pull starts after the newest row emitted here.
        if (testInstances.Count > 0)
        {
            var maxTestInstance = testInstances.Max(i => i.ModifiedAtUtc);
            if (maxTestInstance > nextCursorUtc)
            {
                nextCursorUtc = maxTestInstance;
            }
        }
        if (testRecommendations.Count > 0)
        {
            var maxRec = testRecommendations.Max(r => r.CreatedAtUtc);
            if (maxRec > nextCursorUtc)
            {
                nextCursorUtc = maxRec;
            }
        }

        // CEI Phase 4 §4.8 — job cards modified since cursor, scoped to
        // caller's farms. On failure: keep the empty list and record a
        // DegradedComponent. The cursor-freeze block below picks this
        // up and rewinds NextCursorUtc so the missed JobCards rows
        // reach the client on the next pull.
        List<JobCardDto> jobCardDtos = [];
        try
        {
            // lane MU-3 fix 1 (F7) — a job card is the farm's WORK (plot, day, worker, tasks): every seat that reads the
            // farm's work gets it, and an own-records-only seat (a कामगार) gets the cards assigned to HIM. Its rates and
            // payout are a worker's pay: withheld without see wages (ReadScopeProjection.JobCard), never the card.
            var changedJobCards = (await window.ReadAsync(
                    Any,
                    (ids, since) => repository.GetJobCardsChangedSinceAsync(ids, since, ct),
                    j => j.FarmId.Value))
                .Where(j => window.ScopeOf(j.FarmId.Value) is { OwnRecordsOnly: false }
                    || j.AssignedWorkerUserId?.Value == query.UserId)
                .ToList();
            jobCardDtos = changedJobCards
                .Select(j => ReadScopeProjection.JobCard(j.ToJobCardDto(), window.ScopeOf(j.FarmId.Value), query.UserId))
                .ToList();
            if (jobCardDtos.Count > 0)
            {
                var maxJobCard = changedJobCards.Max(j => j.ModifiedAtUtc);
                if (maxJobCard > nextCursorUtc) nextCursorUtc = maxJobCard;
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "PullSync: JobCards fetch threw {ExceptionType}; degrading.",
                ex.GetType().Name);
            degraded.Add(new DegradedComponent(
                ComponentJobCards,
                "JobCards.Unavailable",
                ex.Message));
        }

        // CEI Phase 3 §4.6 — compliance signals since cursor (per farm), with
        // on-pull freshness trigger: if latest evaluation is >6h old, fire async eval.
        var complianceSignalDtos = new List<ComplianceSignalDto>();
        // lane MU-3 — compliance warnings only to a seat that reads them, each farm from its own cursor.
        foreach (var fid in farmIds.Where(id => window.ScopeOf(id) is { SeeCompliance: true }))
        {
            var typedFarmId = new FarmId(fid);

            // Freshness check — fire-and-forget if stale (>6 hours).
            // Sub-plan 03 Task 10: capture exceptions instead of swallowing.
            // The freshness READ (line A) and the BACKGROUND eval (line B)
            // are separate concerns and degrade independently.
            try
            {
                var latestEval = await complianceSignalRepository.GetLatestEvaluationTimeAsync(typedFarmId, ct);
                if (latestEval is null || (serverNowUtc - latestEval.Value).TotalHours > 6)
                {
                    // ADR 0019 / STOP-1 — the inline compliance EVALUATION is a
                    // WRITE to ssf.compliance_signals (WITH CHECK keyed on
                    // agrisync.farm_id). Under user-scoped /sync/pull no farm_id
                    // GUC is set, so the write fails RLS and POISONS the shared
                    // pull transaction (the surrounding catch cannot rescue an
                    // aborted tx). Skip the write in user-scoped mode; freshness
                    // is owned by the nightly ComplianceEvaluatorSweeper. The
                    // freshness READ above and the signals READ below still run.
                    if (!tenantContext.IsUserScoped)
                    {
                        await evaluateComplianceHandler.HandleAsync(
                            new EvaluateComplianceCommand(typedFarmId),
                            ct);
                    }
                }
            }
            catch (Exception ex)
            {
                // Freshness read failed — surface as degraded so the
                // frontend knows the freshness lamp may be stale.
                logger.LogWarning(ex,
                    "PullSync: ComplianceFreshness read for farm {FarmId} threw {ExceptionType}; degrading.",
                    typedFarmId, ex.GetType().Name);
                degraded.Add(new DegradedComponent(
                    ComponentComplianceFreshness,
                    "ComplianceFreshness.Unavailable",
                    ex.Message));
            }

            // Pull signals since cursor
            try
            {
                var signals = await complianceSignalRepository.GetSinceCursorAsync(typedFarmId, window.SinceFor(fid), ct);
                complianceSignalDtos.AddRange(
                    signals
                        .Where(signal => signal.FarmId.Value == fid)
                        .Select(GetComplianceSignalsForFarmHandler.MapToDto));
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "PullSync: ComplianceSignals fetch for farm {FarmId} threw {ExceptionType}; degrading.",
                    typedFarmId, ex.GetType().Name);
                degraded.Add(new DegradedComponent(
                    ComponentComplianceSignals,
                    "ComplianceSignals.Unavailable",
                    ex.Message));
            }
        }

        // Advance cursor past compliance signals
        if (complianceSignalDtos.Count > 0)
        {
            var maxSignal = complianceSignalDtos.Max(s => s.LastSeenAtUtc);
            if (maxSignal > nextCursorUtc) nextCursorUtc = maxSignal;
        }

        // lane MU-3 — a farm re-sent from the beginning (its reading widened after this phone's cursor) is
        // re-sent ONCE: the cursor moves at least past that access change. Every farm was read with no
        // upper bound, so nothing up to it is skipped.
        if (window.ResetThroughUtc is { } resetThrough && resetThrough > nextCursorUtc)
        {
            nextCursorUtc = resetThrough;
        }

        // MU-3 fix 1 (F1) — and never past a change too young to send yet: the next pull sends it.
        if (window.PendingCapUtc is { } cap && nextCursorUtc > cap)
        {
            nextCursorUtc = cap;
        }

        // Sub-plan 03 Task 10 (T-IGH-03-PULL-CURSOR-FREEZE) — cursor
        // freeze on partial failure. If ANY component degraded,
        // NextCursorUtc is set BACK to SinceUtc so the next pull
        // retries the same window. Without this, a partial failure
        // could silently advance the cursor past data the client
        // never received (cost: small redundant work on the next pull;
        // benefit: no silent data loss).
        if (degraded.Count > 0)
        {
            logger.LogWarning(
                "PullSync: {Count} component(s) degraded ({Components}); freezing NextCursorUtc at {SinceUtc} for retry.",
                degraded.Count, string.Join(",", degraded.Select(d => d.ComponentName)), sinceUtc);
            nextCursorUtc = sinceUtc;
        }

        // DATA_PRINCIPLE_SPINE sub-phase 02.5 — project the canonical
        // cost-category lookup from `ssf.cost_categories` (server-owned
        // single source of truth). If the DB returns nothing (e.g. the
        // seeded migration has not yet replayed in a test harness), fall
        // back to the in-memory ReferenceDataCatalog constant so the
        // pull pipeline never returns an empty list.
        var dbCostCategories = await repository.GetCostCategoriesAsync(ct);
        IReadOnlyList<CostCategoryRefDto> costCategoryDtos = dbCostCategories.Count > 0
            ? dbCostCategories
                .Select(c => new CostCategoryRefDto(c.Id, c.DisplayEn, c.DisplayMr, c.DisplayHi))
                .ToList()
            : ReferenceDataCatalog.CostCategories;

        var response = new SyncPullResponseDto(
            serverNowUtc,
            nextCursorUtc,
            farms.Select(f => f.ToDto()).ToList(),
            plots.Select(p => p.ToDto()).ToList(),
            cropCycles.Select(c => c.ToDto()).ToList(),
            // Every log in this response gets a labour STATEMENT — `[]` when it has
            // none. `null` (the DTO's "this caller made no statement") belongs only
            // to callers that never looked; the pull looked.
            // lane MU-3 — a record's task lines carry its stated money in their notes ("Cost: ₹…"): for a
            // reader who may not see the farm's money (and did not make the record) those parts are dropped.
            dailyLogs
                .Select(l => ReadScopeProjection.Record(
                    l.ToDto(
                        labourByLogId.TryGetValue(l.Id, out var labour) ? labour : [],
                        contentDtoByLogId.GetValueOrDefault(l.Id)),
                    window.ScopeOf((Guid)l.FarmId),
                    query.UserId))
                .ToList(),
            attachments.Select(a => a.ToDto()).ToList(),
            costEntries.Select(c => c.ToDto()).ToList(),
            financeCorrections.Select(c => c.ToDto()).ToList(),
            dayLedgers.Select(l => l.ToDto()).ToList(),
            priceConfigs.Select(c => c.ToDto()).ToList(),
            plannedActivities.Select(a => a.ToDto()).ToList(),
            auditEvents.Select(a => a.ToDto()).ToList(),
            operators.ToList(),
            scheduleTemplates,
            cropTypes,
            ReferenceDataCatalog.ActivityCategories,
            costCategoryDtos,
            referenceDataVersionHash,
            attentionBoard,
            testInstanceDtos,
            testRecommendationDtos,
            complianceSignalDtos,
            jobCardDtos,
            attendanceMarks.Select(m => m.ToDto()).ToList(),
            // Sub-plan 03 Task 10: empty list when healthy; non-empty
            // signals partial data AND triggers the NextCursorUtc
            // rewind handled in the if-block above.
            degraded,
            // lane MU-3 — what this person may read on each farm this pull covers.
            window.FarmIds.Select(id => FarmAccessScopeDto.From(window.Scopes[id])).Concat(notReadable).ToList());

        return Result.Success(response);
    }

    /// <summary>
    /// spec: plr-d10 (lane F1, review S1) — each log's content as THIS reader may see it.
    /// </summary>
    private static Dictionary<Guid, LogContentDto> ProjectContentForReader(
        Guid readerUserId,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyDictionary<Guid, Domain.Logs.DailyLogContent> contentByLogId,
        IReadOnlyDictionary<Guid, FarmAccess?> accesses,
        DateTime nowUtc)
    {
        var projected = new Dictionary<Guid, LogContentDto>();
        foreach (var log in dailyLogs)
        {
            if (!contentByLogId.TryGetValue(log.Id, out var content))
            {
                continue;
            }

            // Review S1 (founder D-31 / D-26) — his words to the speaker, the primary owner, or a holder of the
            // confirm-records authority (RecordWordsGate's rule), read from the batched seat (MU-3 fix 1, F12).
            // Its MONEY is applied afterwards by ReadScopeProjection.Record, like every other part of the record.
            var access = accesses.GetValueOrDefault((Guid)log.FarmId);
            var role = access is null ? (AppRole?)null : access.IsRegistrant ? AppRole.PrimaryOwner : access.Role;
            var mayHear = readerUserId != Guid.Empty
                && role is not null
                && (readerUserId == log.OperatorUserId.Value
                    || role == AppRole.PrimaryOwner
                    || FarmAccessPolicy.Holds(access, Domain.Farms.FarmAuthority.ConfirmRecords, nowUtc));
            projected[log.Id] = content.ToDto(withWords: mayHear);
        }

        return projected;
    }

    /// <summary>
    /// lane MU-3 — an attachment follows its PARENT (<see cref="AttachmentParentRule"/>). For an
    /// own-records-only seat a record's photo needs its record's maker: the ones not in this response are read
    /// in ONE batch (MU-3 fix 1, F12), never one read per photo.
    /// </summary>
    private async Task<List<Domain.Attachments.Attachment>> VisibleAttachmentsAsync(
        Guid readerUserId,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        PullReadWindow window,
        IReadOnlyDictionary<Guid, Domain.Logs.DailyLog> sentLogs,
        CancellationToken ct)
    {
        var missing = attachments
            .Where(a => AttachmentParentRule.IsRecordParent(a.LinkedEntityType)
                && window.ScopeOf((Guid)a.FarmId) is { OwnRecordsOnly: true }
                && !sentLogs.ContainsKey(a.LinkedEntityId))
            .Select(a => a.LinkedEntityId)
            .Distinct()
            .ToList();
        var makers = new Dictionary<Guid, RecordMaker>(
            missing.Count == 0 ? [] : await repository.GetRecordMakersAsync(missing, ct));
        foreach (var log in sentLogs.Values)
        {
            makers[log.Id] = new RecordMaker(log.Id, (Guid)log.FarmId, log.OperatorUserId.Value);
        }

        return attachments
            .Where(a => AttachmentParentRule.MayRead(
                window.ScopeOf((Guid)a.FarmId), readerUserId, a, makers.GetValueOrDefault(a.LinkedEntityId)))
            .ToList();
    }

    private static DateTime NormalizeCursor(DateTime rawCursor, DateTime serverNowUtc)
    {
        var cursor = rawCursor.Kind switch
        {
            DateTimeKind.Utc => rawCursor,
            DateTimeKind.Local => rawCursor.ToUniversalTime(),
            _ => DateTime.SpecifyKind(rawCursor, DateTimeKind.Utc)
        };

        if (cursor < DateTime.UnixEpoch)
        {
            return DateTime.UnixEpoch;
        }

        if (cursor > serverNowUtc)
        {
            return serverNowUtc;
        }

        return cursor;
    }

    private static DateTime ComputeNextCursor(
        DateTime sinceUtc,
        IReadOnlyList<Domain.Farms.Farm> farms,
        IReadOnlyList<Domain.Farms.Plot> plots,
        IReadOnlyList<Domain.Crops.CropCycle> cropCycles,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Labour.AttendanceMark> attendanceMarks,
        IReadOnlyList<Domain.Finance.PriceConfig> priceConfigs,
        IReadOnlyList<Domain.Planning.PlannedActivity> plannedActivities,
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents)
    {
        var maxTimestamp = sinceUtc;

        if (farms.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, farms.Max(f => f.ModifiedAtUtc));
        }

        if (plots.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plots.Max(p => p.ModifiedAtUtc));
        }

        if (cropCycles.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, cropCycles.Max(c => c.ModifiedAtUtc));
        }

        if (dailyLogs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dailyLogs.Max(log => log.ModifiedAtUtc));
        }

        if (attachments.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, attachments.Max(a => a.ModifiedAtUtc));
        }

        if (costEntries.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, costEntries.Max(c => c.ModifiedAtUtc));
        }

        if (financeCorrections.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, financeCorrections.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.ModifiedAtUtc));
        }

        if (attendanceMarks.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, attendanceMarks.Max(m => m.ModifiedAtUtc));
        }

        if (priceConfigs.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, priceConfigs.Max(c => c.ModifiedAtUtc));
        }

        if (dayLedgers.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, dayLedgers.Max(c => c.CreatedAtUtc));
        }

        if (plannedActivities.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, plannedActivities.Max(a => a.ModifiedAtUtc));
        }

        if (auditEvents.Count > 0)
        {
            maxTimestamp = Max(maxTimestamp, auditEvents.Max(a => a.OccurredAtUtc));
        }

        return maxTimestamp;
    }

    private static DateTime Max(DateTime left, DateTime right) => left >= right ? left : right;

    private static HashSet<Guid> CollectOperatorIds(
        Guid requestingUserId,
        PullReadWindow window,
        IReadOnlyList<Domain.Farms.Farm> farms,
        IReadOnlyList<Domain.Logs.DailyLog> dailyLogs,
        IReadOnlyList<Domain.Attachments.Attachment> attachments,
        IReadOnlyList<Domain.Finance.CostEntry> costEntries,
        IReadOnlyList<Domain.Finance.FinanceCorrection> financeCorrections,
        IReadOnlyList<Domain.Finance.DayLedger> dayLedgers,
        IReadOnlyList<Domain.Audit.AuditEvent> auditEvents)
    {
        var ids = new HashSet<Guid>();
        AddIfValid(requestingUserId, ids);

        // lane MU-3 — names follow the rows this seat receives, and an own-records-only seat (a कामगार)
        // is sent no other person's name at all: not the registrant's, not whoever added a farm photo or
        // confirmed his record. Everyone else gets the people behind the rows he was sent.
        void AddFor(Guid farmId, Guid userId)
        {
            if (userId == requestingUserId || window.ScopeOf(farmId) is { OwnRecordsOnly: false })
            {
                AddIfValid(userId, ids);
            }
        }

        foreach (var farm in farms)
        {
            AddFor((Guid)farm.Id, (Guid)farm.OwnerUserId);
        }

        foreach (var log in dailyLogs)
        {
            AddFor((Guid)log.FarmId, (Guid)log.OperatorUserId);
            foreach (var verification in log.VerificationEvents)
            {
                AddFor((Guid)log.FarmId, (Guid)verification.VerifiedByUserId);
            }
        }

        foreach (var attachment in attachments)
        {
            AddFor((Guid)attachment.FarmId, (Guid)attachment.CreatedByUserId);
        }

        foreach (var entry in costEntries)
        {
            AddFor((Guid)entry.FarmId, (Guid)entry.CreatedByUserId);
        }

        // A correction belongs to a cost entry this pull sent: it is named under that entry's farm.
        var entryFarm = costEntries.ToDictionary(e => e.Id, e => (Guid)e.FarmId);
        foreach (var correction in financeCorrections)
        {
            if (entryFarm.TryGetValue(correction.CostEntryId, out var correctionFarm))
            {
                AddFor(correctionFarm, (Guid)correction.CorrectedByUserId);
            }
        }

        foreach (var ledger in dayLedgers)
        {
            AddFor((Guid)ledger.FarmId, (Guid)ledger.CreatedByUserId);
        }

        foreach (var auditEvent in auditEvents)
        {
            AddIfValid((Guid)auditEvent.ActorUserId, ids);
        }

        return ids;
    }

    private static void AddIfValid(Guid value, HashSet<Guid> ids)
    {
        if (value != Guid.Empty)
        {
            ids.Add(value);
        }
    }
}
