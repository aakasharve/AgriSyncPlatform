using Microsoft.EntityFrameworkCore;
using Npgsql;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Work;
using ShramSafal.Domain.Attachments;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class ShramSafalRepository(ShramSafalDbContext db) : IShramSafalRepository
{
    public async Task AddFarmAsync(Farm farm, CancellationToken ct = default)
    {
        await db.Farms.AddAsync(farm, ct);
    }

    public async Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default)
    {
        await db.FarmBoundaries.AddAsync(boundary, ct);
    }

    public async Task<FarmBoundary?> GetActiveFarmBoundaryAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.FarmBoundaries
            .FirstOrDefaultAsync(boundary => boundary.FarmId == typedFarmId && boundary.IsActive, ct);
    }

    public async Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.Farms.FirstOrDefaultAsync(f => f.Id == typedFarmId, ct);
    }

    public async Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default)
    {
        await db.FarmMemberships.AddAsync(membership, ct);
    }

    public async Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        return await db.FarmMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(
                membership => membership.FarmId == typedFarmId &&
                              membership.UserId == typedUserId &&
                              membership.Status != MembershipStatus.Revoked &&
                              membership.Status != MembershipStatus.Exited,
                ct);
    }

    public async Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var isDeclaredOwner = await db.Farms
            .AsNoTracking()
            .AnyAsync(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId, ct);
        if (isDeclaredOwner)
        {
            return AppRole.PrimaryOwner;
        }

        var membership = await db.FarmMemberships
            .AsNoTracking()
            .Where(x => x.FarmId == typedFarmId && x.UserId == typedUserId
                && x.Status != MembershipStatus.Revoked && x.Status != MembershipStatus.Exited)
            .Select(x => (AppRole?)x.Role)
            .FirstOrDefaultAsync(ct);

        return membership;
    }

    public async Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var role = await GetUserRoleForFarmAsync(farmId, userId, ct);
        return role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;
    }

    public async Task AddPlotAsync(Plot plot, CancellationToken ct = default)
    {
        await db.Plots.AddAsync(plot, ct);
    }

    public async Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
    {
        return await db.Plots.FirstOrDefaultAsync(p => p.Id == plotId, ct);
    }

    public async Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.Plots
            .Where(p => p.FarmId == typedFarmId)
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
    }

    public async Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default)
    {
        await db.CropCycles.AddAsync(cropCycle, ct);
    }

    public async Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await db.CropCycles.FirstOrDefaultAsync(c => c.Id == cropCycleId, ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default)
    {
        return await db.CropCycles
            .Where(c => c.PlotId == plotId)
            .OrderBy(c => c.StartDate)
            .ToListAsync(ct);
    }

    public async Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default)
    {
        await db.DailyLogs.AddAsync(log, ct);
    }

    public async Task AddWeatherStampAsync(WeatherStamp stamp, CancellationToken ct = default)
    {
        await db.WeatherStamps.AddAsync(stamp, ct);
    }

    public async Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .FirstOrDefaultAsync(l => l.Id == dailyLogId, ct);
    }

    public async Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .FirstOrDefaultAsync(l => l.IdempotencyKey == idempotencyKey, ct);
    }

    // spec: dfes-companion-2026-07-11 (wave-1.5) — see IShramSafalRepository for why the
    // predicate is "no verification events at all" and not "reads Draft".
    //
    // TRACKED on purpose (no AsNoTracking, unlike the read-only pull queries): the caller
    // mutates these aggregates and commits them in its own unit of work, exactly as
    // GetDailyLogByIdAsync feeds VerifyLogHandler. VerificationEvents is Included because
    // TrySelfVerifyAsCreator folds it to decide whether the log is still in Draft — an
    // un-Included collection would fold to empty and read Draft for every log, including
    // ones a human had already disputed.
    public async Task<IReadOnlyList<DailyLog>> GetDailyLogsWithNoVerificationHistoryAsync(
        int limit, DateTime? afterCreatedAtUtc, Guid? afterId, CancellationToken ct = default)
    {
        if (limit <= 0)
        {
            return Array.Empty<DailyLog>();
        }

        var query = db.DailyLogs
            .Include(l => l.VerificationEvents)
            .Where(l => !l.VerificationEvents.Any());

        // KEYSET, not OFFSET. The candidate set shrinks underneath the walk (a repaired
        // log gains events and stops being a candidate), so a sliding OFFSET would step
        // over rows that moved up behind it. A (CreatedAtUtc, Id) cursor is stable against
        // that: it names the last row seen rather than a position. Both halves are used
        // together because CreatedAtUtc is not unique — the composite matches the
        // OrderBy/ThenBy below exactly, which is what makes the page boundary total.
        if (afterCreatedAtUtc is { } cursorCreatedAtUtc && afterId is { } cursorId)
        {
            query = query.Where(l =>
                l.CreatedAtUtc > cursorCreatedAtUtc
                || (l.CreatedAtUtc == cursorCreatedAtUtc && l.Id > cursorId));
        }

        return await query
            // Oldest day first: if an operator ever has to read the backfill's audit
            // rows in order, they should tell the farm's story forwards.
            .OrderBy(l => l.CreatedAtUtc)
            .ThenBy(l => l.Id)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
    {
        await db.CostEntries.AddAsync(costEntry, ct);
    }

    public async Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default)
    {
        return await db.CostEntries.FirstOrDefaultAsync(c => c.Id == costEntryId, ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
    {
        var ids = costEntryIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await db.CostEntries
            .Where(entry => ids.Contains(entry.Id))
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(
        FarmId farmId,
        Guid? plotId,
        string category,
        DateTime since,
        CancellationToken ct = default)
    {
        return await db.CostEntries
            .Where(entry =>
                entry.FarmId == farmId &&
                entry.PlotId == plotId &&
                entry.CreatedAtUtc >= since)
            .OrderByDescending(entry => entry.CreatedAtUtc)
            .ToListAsync(ct);
    }

    /// <summary>
    /// DATA_PRINCIPLE_SPINE sub-phase 02.5 — returns active rows from
    /// <c>ssf.cost_categories</c> for the pull-sync reference projection.
    /// </summary>
    public async Task<List<CostCategory>> GetCostCategoriesAsync(CancellationToken ct = default)
    {
        return await db.CostCategories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .ToListAsync(ct);
    }

    public async Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default)
    {
        await db.FinanceCorrections.AddAsync(correction, ct);
    }

    public async Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default)
    {
        await db.DayLedgers.AddAsync(dayLedger, ct);
    }

    public async Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .Include(x => x.Allocations)
            .FirstOrDefaultAsync(x => x.Id == dayLedgerId, ct);
    }

    public async Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .Include(x => x.Allocations)
            .FirstOrDefaultAsync(x => x.SourceCostEntryId == costEntryId, ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersForFarm(
        Guid farmId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);

        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x =>
                x.FarmId == typedFarmId &&
                x.LedgerDate >= from &&
                x.LedgerDate <= to)
            .OrderBy(x => x.LedgerDate)
            .ThenBy(x => x.CreatedAtUtc)
            .ToListAsync(ct);
    }

    /// <summary>
    /// DFES (dfes-companion-2026-07-11) — the ONE locked aggregate read. Filters to the
    /// caller's farm (RLS + this Where) and orders by local_date for the Phase-3 fold.
    /// </summary>
    public async Task<IReadOnlyList<ShramSafal.Domain.Dfes.DailyRichnessAggregate>> GetDailyRichnessAggregatesForFarmAsync(
        Guid farmId, CancellationToken ct = default)
    {
        return await db.DailyRichnessAggregates
            .AsNoTracking()
            .Where(x => x.FarmId == farmId)
            .OrderBy(x => x.LocalDate)
            .ToListAsync(ct);
    }

    // ── DFES (dfes-companion-2026-07-11) daily richness derivation ─────────────
    // spec: dfes-companion-2026-07-11 — .Include(l => l.Tasks) so
    // DailyRichnessDerivationService's persisted-work fallback (a log with no
    // usable AI-job JSON root) can see the log's real LogTask rows instead of
    // an empty navigation. Mirrors the existing .Include(l => l.Tasks) pattern
    // already used by GetDailyLogByIdAsync / GetDailyLogsChangedSinceAsync above.
    public async Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Where(l => l.FarmId == typedFarmId && l.LogDate == localDate)
            .OrderBy(l => l.Id)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Domain.Farms.ObservationEvent>> GetObservationEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    {
        if (dailyLogIds.Count == 0)
        {
            return Array.Empty<Domain.Farms.ObservationEvent>();
        }

        return await db.ObservationEvents
            .AsNoTracking()
            .Where(o => dailyLogIds.Contains(o.DailyLogId))
            .ToListAsync(ct);
    }

    // wave-3.5, Ruling 3 — the day's system weather, mirroring the ObservationEvent
    // read above exactly: EXISTS-join child keyed by plain DailyLogId, no-tracking
    // because the scorer only inspects it, empty id set short-circuited so we never
    // emit `IN ()`. ssf.weather_stamps has been written since 20260630040851 and read
    // by nothing until now.
    public async Task<IReadOnlyList<Domain.Farms.WeatherStamp>> GetWeatherStampsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => dailyLogIds.Count == 0
            ? Array.Empty<Domain.Farms.WeatherStamp>()
            : await db.WeatherStamps.AsNoTracking()
                .Where(w => dailyLogIds.Contains(w.DailyLogId)).ToListAsync(ct);

    // ── the rest of the day's PERSISTED spine (task-7, 2026-08-13) ─────────────
    // Same shape as the ObservationEvent read above: EXISTS-join children keyed
    // by plain DailyLogId, read NO-TRACKING because the scorer only inspects
    // them. Empty id set short-circuits so we never emit `IN ()`.

    public async Task<IReadOnlyList<Domain.Farms.IrrigationEntry>> GetIrrigationEntriesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => dailyLogIds.Count == 0
            ? Array.Empty<Domain.Farms.IrrigationEntry>()
            : await db.IrrigationEntries.AsNoTracking()
                .Where(x => dailyLogIds.Contains(x.DailyLogId)).ToListAsync(ct);

    public async Task<IReadOnlyList<Domain.Farms.MachineryUsage>> GetMachineryUsagesForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => dailyLogIds.Count == 0
            ? Array.Empty<Domain.Farms.MachineryUsage>()
            : await db.MachineryUsages.AsNoTracking()
                .Where(x => dailyLogIds.Contains(x.DailyLogId)).ToListAsync(ct);

    public async Task<IReadOnlyList<Domain.Farms.DisturbanceEvent>> GetDisturbanceEventsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
        => dailyLogIds.Count == 0
            ? Array.Empty<Domain.Farms.DisturbanceEvent>()
            : await db.DisturbanceEvents.AsNoTracking()
                .Where(x => dailyLogIds.Contains(x.DailyLogId)).ToListAsync(ct);

    public async Task<Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => await db.DailyRichnessAggregates
            // READ-ONLY. The result is DETACHED — mutating it (ApplyDerivation) and
            // calling SaveChangesAsync emits NO UPDATE, silently and without error.
            // Any read-modify-write caller must use
            // GetDailyRichnessAggregateForUpdateAsync below instead.
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.FarmId == farmId && a.LocalDate == localDate, ct);

    // FIX (dfes-companion-2026-07-11) — TRACKED twin of the read above, for the
    // recompute read-modify-write path. Identical query, deliberately WITHOUT
    // .AsNoTracking() so ApplyDerivation + SaveChangesAsync actually persists.
    public async Task<Domain.Dfes.DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => await db.DailyRichnessAggregates
            .FirstOrDefaultAsync(a => a.FarmId == farmId && a.LocalDate == localDate, ct);

    public async Task AddDailyRichnessAggregateAsync(
        Domain.Dfes.DailyRichnessAggregate aggregate, CancellationToken ct = default)
    {
        await db.DailyRichnessAggregates.AddAsync(aggregate, ct);
    }

    public async Task AddQuestionEventAsync(ShramSafal.Domain.Dfes.QuestionEvent e, CancellationToken ct = default)
        => await db.QuestionEvents.AddAsync(e, ct);

    // wave-4.2 — the two append-only consent ledgers. Staged, never committed here: the
    // handler flushes both in one SaveChanges so a tap can never leave one record behind.
    public async Task AddTermsAcceptanceEventAsync(
        ShramSafal.Domain.Consent.TermsAcceptanceEvent e, CancellationToken ct = default)
        => await db.TermsAcceptanceEvents.AddAsync(e, ct);

    public async Task AddConsentGrantEventAsync(
        ShramSafal.Domain.Consent.ConsentGrantEvent e, CancellationToken ct = default)
        => await db.ConsentGrantEvents.AddAsync(e, ct);

    // B1 (2026-08-27) — the idempotency reads behind LinkConsentGateToUserHandler.
    //
    // NO-TRACKING: the caller needs the existing row's id to hand back, nothing more, and
    // both tables are append-only by privilege so nothing here is ever mutated.
    //
    // Keyed on (user_id, pre_registration_session_id, event_type). The event type is part
    // of the key on purpose: ssf.terms_acceptance_events also holds TERMS_ACCEPTED rows,
    // and a signed-in re-acceptance writes one carrying BOTH a user id and the same
    // session id. Omitting the type would make an in-app re-acceptance look like a
    // completed link and suppress the linking row entirely — the exact orphaning this
    // whole change exists to close, reintroduced through the back door.
    //
    // RLS already restricts these rows to the caller (the linking row has a user_id, so
    // the self policy admits it); the explicit user_id predicate is defence in depth, and
    // it is what makes the query correct if it is ever run under a wider scope.
    //
    // Oldest first: if a race ever produced two, the first one written is the link.
    public async Task<ShramSafal.Domain.Consent.TermsAcceptanceEvent?> FindTermsAcceptanceLinkAsync(
        Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
        => await db.TermsAcceptanceEvents
            .AsNoTracking()
            .Where(e => e.UserId == userId
                && e.PreRegistrationSessionId == preRegistrationSessionId
                && e.EventType == ShramSafal.Domain.Consent.TermsAcceptanceEvent.TermsAcceptanceLinkedEventType)
            .OrderBy(e => e.RecordedAtUtc)
            .FirstOrDefaultAsync(ct);

    public async Task<ShramSafal.Domain.Consent.ConsentGrantEvent?> FindConsentGrantLinkAsync(
        Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
        => await db.ConsentGrantEvents
            .AsNoTracking()
            .Where(e => e.UserId == userId
                && e.PreRegistrationSessionId == preRegistrationSessionId
                && e.EventType == ShramSafal.Domain.Consent.ConsentGrantEvent.CoreConsentLinkedEventType)
            .OrderBy(e => e.RecordedAtUtc)
            .FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<ShramSafal.Domain.Dfes.QuestionEvent>> GetRecentQuestionEventsForFarmAsync(
        Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
        => await db.QuestionEvents
            .AsNoTracking()
            .Where(q => q.FarmId == farmId && q.CreatedAtUtc >= sinceUtc)
            .OrderByDescending(q => q.CreatedAtUtc)
            .ToListAsync(ct);

    // wave-3.3, Ruling 1 — the idempotency read behind RecordQuestionEventHandler.
    // NO-TRACKING: the caller only needs the existing row's Id to hand back, and the
    // table is append-only by privilege, so nothing here is ever mutated. RLS already
    // scopes the row set to the tenant; the handler membership-checks in addition, so
    // this deliberately keys on (daily_log_id, question_key) only — exactly the columns
    // ux_question_events_log_question constrains, so the read and the index can never
    // disagree about what "already asked" means.
    public async Task<ShramSafal.Domain.Dfes.QuestionEvent?> FindQuestionEventAsync(
        Guid dailyLogId, string questionKey, CancellationToken ct = default)
        => await db.QuestionEvents
            .AsNoTracking()
            .FirstOrDefaultAsync(q => q.DailyLogId == dailyLogId && q.QuestionKey == questionKey, ct);

    // task-3 (2026-08-14), founder ruling A. question_events carries no local_date, so the
    // day is a half-open UTC window (FarmLocalDay — the SAME rule the handler and the
    // derivation service use; a second one here would credit the wrong day). ShownAtUtc is
    // nullable, and CreatedAtUtc is the fallback the handler also derives from, so the two
    // sides agree row-for-row.
    public async Task<IReadOnlyList<Domain.Dfes.AnsweredGap>> GetAnsweredGapsAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
    {
        var (startUtc, endUtcExclusive) = Domain.Dfes.FarmLocalDay.UtcWindow(localDate);

        var rows = await db.QuestionEvents
            .AsNoTracking()
            .Where(e => e.FarmId == farmId
                        // A skip yields nothing — the contract AnsweredGap's own docstring
                        // states. TryFrom cannot enforce it (it never sees the flag), so the
                        // exclusion lives HERE, at the read, rather than in the question
                        // handler's recompute guard: this way EVERY recompute path honours
                        // it, including the daily-log ones that never look at a command.
                        // A dismissal carrying text is contradictory data the shipped client
                        // cannot produce; if one ever lands, it must still score nothing.
                        && e.Skipped != true
                        && (e.ShownAtUtc ?? e.CreatedAtUtc) >= startUtc
                        && (e.ShownAtUtc ?? e.CreatedAtUtc) < endUtcExclusive)
            .Select(e => new { e.QuestionKey, e.Response })
            .ToListAsync(ct);

        var gaps = new List<Domain.Dfes.AnsweredGap>();
        foreach (var r in rows)
        {
            // TryFrom is the ONLY constructor used here: it enforces the gap-key and
            // non-empty-answer rules and upper-cases the dimension the extractor matches
            // on. Rehydrating an AnsweredGap straight from the column would silently
            // credit nothing (casing) or credit silence.
            if (Domain.Dfes.AnsweredGap.TryFrom(r.QuestionKey, r.Response, localDate, out var gap))
            {
                gaps.Add(gap);
            }
        }

        return gaps;
    }

    public async Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default)
    {
        await db.Attachments.AddAsync(attachment, ct);
    }

    public async Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default)
    {
        return await db.Attachments.FirstOrDefaultAsync(a => a.Id == attachmentId, ct);
    }

    public async Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default)
    {
        var normalizedType = entityType.Trim();
        return await db.Attachments
            .AsNoTracking()
            .Where(a => a.LinkedEntityId == entityId && a.LinkedEntityType == normalizedType)
            .OrderBy(a => a.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default)
    {
        await db.PriceConfigs.AddAsync(config, ct);
    }

    public async Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        await db.AuditEvents.AddAsync(auditEvent, ct);
    }

    public async Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default)
    {
        await db.ScheduleTemplates.AddAsync(template, ct);
    }

    public async Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
        await db.ScheduleTemplates
            .Include(t => t.Stages)
            .Include(t => t.Activities)
            .FirstOrDefaultAsync(t => t.Id == templateId, ct);

    public async Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default)
    {
        var typedUserId = new UserId(userId);
        return await db.FarmMemberships
            .AnyAsync(m => m.UserId == typedUserId
                && m.Status == MembershipStatus.Active
                && (int)m.Role >= (int)AppRole.SecondaryOwner, ct);
    }

    public async Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) =>
        await db.ScheduleTemplates
            .Where(t => t.Id == rootTemplateId || t.DerivedFromTemplateId == rootTemplateId)
            .ToListAsync(ct);

    public async Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default)
    {
        return await db.ScheduleTemplates
            .AsNoTracking()
            .Include(t => t.Activities)
            .OrderBy(t => t.Name)
            .ThenBy(t => t.Stage)
            .ToListAsync(ct);
    }

    public async Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default)
    {
        await db.PlannedActivities.AddRangeAsync(plannedActivities, ct);
    }

    public async Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) =>
        await db.PlannedActivities.FirstOrDefaultAsync(a => a.Id == id, ct);

    public async Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        return await db.PlannedActivities
            .Where(p => p.CropCycleId == cropCycleId)
            .OrderBy(p => p.PlannedDate)
            .ThenBy(p => p.ActivityName)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Every <see cref="LogTask"/> executed against one crop cycle.
    ///
    /// <para><b>LABOUR_PHASE2 P2.3 (landmine L6).</b> Until Phase 2 every daily
    /// log named a crop cycle, so <c>log.CropCycleId == cropCycleId</c> was the
    /// whole answer. A <c>MultiPlot</c> or <c>Farm</c> scoped log carries
    /// <c>crop_cycle_id IS NULL</c> BY DESIGN — the farmer named no single plot,
    /// so there is no one cycle to name — and the old filter therefore made its
    /// tasks vanish from every consumer of this method:
    /// <c>EvaluateComplianceHandler</c>, <c>ComputePlannedVsExecutedDeltaHandler</c>
    /// and <c>GetAttentionBoardHandler</c>. All three feed CompareEngine, so the
    /// farmer would be told he had failed to do work he had actually done — a
    /// fabricated breach, `P4`, on three surfaces.</para>
    ///
    /// <para><b>How a plot-less log is attributed, and why that is not
    /// over-counting.</b> A plot-less log joins a cycle when all three hold:
    /// it belongs to the same FARM; the cycle's plot is actually covered by it
    /// (<c>Farm</c> covers every plot; <c>MultiPlot</c> covers exactly the plots
    /// in <c>plot_ids</c> — never "all of them"); and its <c>log_date</c> falls
    /// inside the cycle's own window, which is what stops last season's work
    /// being counted as this season's. The cycle id is the time bound for a
    /// plot-scoped log; the cycle's dates are the only honest equivalent when
    /// there is no cycle id. No plot, cycle or sentinel is invented anywhere:
    /// the log is matched by what it already says.</para>
    ///
    /// <para>Quantities are unaffected: <c>CompareEngine</c> de-duplicates
    /// executed activity types before comparing, so including a farm-wide spray
    /// can make a planned spray MATCH, and can never make it count twice
    /// (`P7`).</para>
    /// </summary>
    public async Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        var cycle = await db.CropCycles
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == cropCycleId, ct);

        if (cycle is null)
        {
            // Unknown cycle: nothing to attribute a plot-less log to. Behaviour
            // identical to Labour V1.
            return await (
                from task in db.LogTasks
                join log in db.DailyLogs on task.DailyLogId equals log.Id
                where log.CropCycleId == cropCycleId
                select task)
                .ToListAsync(ct);
        }

        var cycleFarmId = cycle.FarmId;
        var cyclePlotId = cycle.PlotId;
        var cycleStart = cycle.StartDate;
        var cycleEnd = cycle.EndDate;

        return await (
            from task in db.LogTasks
            join log in db.DailyLogs on task.DailyLogId equals log.Id
            where
                // (a) the log names this cycle — the Labour V1 predicate, untouched
                log.CropCycleId == cropCycleId
                // (b) the log names no cycle because it names no single plot
                || (log.CropCycleId == null
                    && log.FarmId == cycleFarmId
                    && log.LogDate >= cycleStart
                    && (cycleEnd == null || log.LogDate <= cycleEnd)
                    && (log.Scope == DailyLogScope.Farm
                        || EF.Property<List<Guid>>(log, "_plotIds").Contains(cyclePlotId)))
            select task)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        var query = db.CostEntries.AsQueryable();

        if (fromDate is not null)
        {
            query = query.Where(c => c.EntryDate >= fromDate.Value);
        }

        if (toDate is not null)
        {
            query = query.Where(c => c.EntryDate <= toDate.Value);
        }

        return await query
            .OrderBy(c => c.EntryDate)
            .ThenBy(c => c.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
    {
        var ids = costEntryIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return await db.FinanceCorrections
            .Where(c => ids.Contains(c.CostEntryId))
            .OrderBy(c => c.CorrectedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Farms
            .AsNoTracking()
            .Where(f => f.ModifiedAtUtc > sinceUtc)
            .OrderBy(f => f.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Farm>> GetFarmsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Farms
            .AsNoTracking()
            .Where(f => ids.Contains((Guid)f.Id) && f.ModifiedAtUtc > sinceUtc)
            .OrderBy(f => f.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Plots
            .AsNoTracking()
            .Where(p => p.ModifiedAtUtc > sinceUtc)
            .OrderBy(p => p.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Plot>> GetPlotsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Plots
            .AsNoTracking()
            .Where(p => ids.Contains((Guid)p.FarmId) && p.ModifiedAtUtc > sinceUtc)
            .OrderBy(p => p.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CropCycles
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.CropCycles
            .AsNoTracking()
            .Where(c => ids.Contains((Guid)c.FarmId) && c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l => l.ModifiedAtUtc > sinceUtc)
            .OrderBy(l => l.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.DailyLogs
            .AsNoTracking()
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l => ids.Contains((Guid)l.FarmId) && l.ModifiedAtUtc > sinceUtc)
            .OrderBy(l => l.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.CostEntries
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.CostEntries
            .AsNoTracking()
            .Where(c => ids.Contains((Guid)c.FarmId) && c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.FinanceCorrections
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.FinanceCorrections
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .Where(c => db.CostEntries.Any(entry =>
                entry.Id == c.CostEntryId &&
                ids.Contains((Guid)entry.FarmId)))
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x => x.ModifiedAtUtc > sinceUtc)
            .OrderBy(x => x.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.DayLedgers
            .AsNoTracking()
            .Include(x => x.Allocations)
            .Where(x => ids.Contains((Guid)x.FarmId) && x.ModifiedAtUtc > sinceUtc)
            .OrderBy(x => x.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PriceConfigs
            .AsNoTracking()
            .Where(c => c.ModifiedAtUtc > sinceUtc)
            .OrderBy(c => c.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.PlannedActivities
            .AsNoTracking()
            .Where(a => a.ModifiedAtUtc > sinceUtc)
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.PlannedActivities
            .AsNoTracking()
            .Where(a => a.ModifiedAtUtc > sinceUtc)
            .Where(a => db.CropCycles.Any(cycle =>
                cycle.Id == a.CropCycleId &&
                ids.Contains((Guid)cycle.FarmId)))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.Attachments
            .AsNoTracking()
            .Where(a =>
                a.CreatedAtUtc > sinceUtc ||
                a.ModifiedAtUtc > sinceUtc ||
                (a.UploadedAtUtc.HasValue && a.UploadedAtUtc.Value > sinceUtc) ||
                (a.FinalizedAtUtc.HasValue && a.FinalizedAtUtc.Value > sinceUtc))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<Attachment>> GetAttachmentsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.Attachments
            .AsNoTracking()
            .Where(a =>
                ids.Contains((Guid)a.FarmId) &&
                (a.CreatedAtUtc > sinceUtc ||
                 a.ModifiedAtUtc > sinceUtc ||
                 (a.UploadedAtUtc.HasValue && a.UploadedAtUtc.Value > sinceUtc) ||
                 (a.FinalizedAtUtc.HasValue && a.FinalizedAtUtc.Value > sinceUtc)))
            .OrderBy(a => a.ModifiedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.OccurredAtUtc > sinceUtc)
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    // §P0.2 — farm-scoped changed-since audit read. The `!a.FarmId.HasValue ||`
    // disjunct that used to lead this predicate was one of the three places the
    // same hole was written (the other two: the pull handler's filter and the
    // p_tenant_audit_events USING clause). It admitted every NULL-farm row —
    // the cross-farm ones — to every caller, whatever farms they asked for.
    // Nothing in production calls this today: the pull no longer reads the
    // ledger. It is kept, and kept tight, so that a future caller that DOES
    // reach for a farm-scoped audit slice gets farm rows and nothing else.
    public async Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var ids = NormalizeFarmIds(farmIds);
        if (ids.Count == 0) return [];

        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.OccurredAtUtc > sinceUtc)
            .Where(a => a.FarmId.HasValue && ids.Contains(a.FarmId.Value))
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default)
    {
        var normalizedEntityType = entityType.Trim();
        return await db.AuditEvents
            .AsNoTracking()
            .Where(a => a.EntityId == entityId && a.EntityType == normalizedEntityType)
            .OrderBy(a => a.OccurredAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<AuditEvent>> GetAuditEventsForFarmAsync(
        Guid farmId,
        DateOnly from,
        DateOnly to,
        int limit,
        int offset,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var toExclusiveUtc = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        return await db.AuditEvents
            .AsNoTracking()
            .Where(a =>
                a.FarmId == farmId &&
                a.OccurredAtUtc >= fromUtc &&
                a.OccurredAtUtc < toExclusiveUtc)
            .OrderByDescending(a => a.OccurredAtUtc)
            .Skip(Math.Max(0, offset))
            .Take(Math.Clamp(limit, 1, 1000))
            .ToListAsync(ct);
    }

    public async Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var ownedFarmIds = await db.Farms
            .AsNoTracking()
            .Where(f => (Guid)f.OwnerUserId == userId)
            .Select(f => (Guid)f.Id)
            .ToListAsync(ct);

        var membershipFarmIds = await db.FarmMemberships
            .AsNoTracking()
            .Where(m => (Guid)m.UserId == userId
                && m.Status != MembershipStatus.Revoked && m.Status != MembershipStatus.Exited)
            .Select(m => (Guid)m.FarmId)
            .ToListAsync(ct);

        return ownedFarmIds
            .Concat(membershipFarmIds)
            .Distinct()
            .ToList();
    }

    public async Task<List<MyFarmProjection>> GetMyFarmsAsync(Guid userId, CancellationToken ct = default)
    {
        // /shramsafal/farms/mine is skip-listed in TenantTransactionMiddleware →
        // admin-elevated → the interceptor injects NO GUC AND the middleware opens
        // NO transaction. RlsIdentityScope (the ONE shared helper) opens the
        // transaction that `set_config(..., is_local: true)` needs — Postgres scopes
        // the setting to the current transaction — and sets `agrisync.user_id`
        // through a PARAMETERISED call. The interceptor is in admin no-op mode here,
        // so it does not rewrite these commands: the helper's GUC is authoritative.
        var (farms, memberships) = await RlsIdentityScope.RunAsUserAsync(
            db,
            userId,
            async token =>
            {
                // RLS (p_user_select_farms) filters to the caller's owned +
                // active-member farms — no WHERE needed.
                var scopedFarms = await db.Farms.AsNoTracking().ToListAsync(token);

                var scopedMemberships = await db.FarmMemberships
                    .AsNoTracking()
                    .Where(m => (Guid)m.UserId == userId
                        && m.Status != MembershipStatus.Revoked && m.Status != MembershipStatus.Exited)
                    .ToListAsync(token);

                return (scopedFarms, scopedMemberships);
            },
            ct);

        var roleByFarm = memberships
            .GroupBy(m => (Guid)m.FarmId)
            .ToDictionary(g => g.Key, g => g.First().Role);

        return farms.Select(f =>
        {
            var farmId = (Guid)f.Id;
            AppRole? role = roleByFarm.TryGetValue(farmId, out var membershipRole)
                ? membershipRole
                : ((Guid)f.OwnerUserId == userId ? AppRole.PrimaryOwner : (AppRole?)null);
            return new MyFarmProjection(farmId, f.Name, f.FarmCode, (Guid)f.OwnerAccountId, role);
        }).ToList();
    }

    public async Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
        IEnumerable<Guid> userIds,
        CancellationToken ct = default)
    {
        var ids = userIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

        if (ids.Count == 0)
        {
            return [];
        }

        if (!db.Database.IsRelational())
        {
            return ids
                .Select(id => new SyncOperatorDto(id, $"Operator {id:N}"[..17], "WORKER"))
                .OrderBy(op => op.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var operators = new List<SyncOperatorDto>(ids.Count);
        foreach (var id in ids)
        {
            var row = await db.Database
                .SqlQueryRaw<OperatorDirectoryRow>(
                    """
                    select
                        u."Id" as "UserId",
                        u.display_name as "DisplayName",
                        case lower(coalesce(m.role, 'worker'))
                            when 'primaryowner' then 'PRIMARY_OWNER'
                            when 'secondaryowner' then 'SECONDARY_OWNER'
                            when 'mukadam' then 'MUKADAM'
                            else 'WORKER'
                        end as "Role"
                    from public.users u
                    left join public.memberships m
                        on m.user_id = u."Id"
                        and m.app_id = 'shramsafal'
                        and m.is_revoked = false
                    where u."Id" = {0}
                    limit 1
                    """,
                    id)
                .FirstOrDefaultAsync(ct);

            if (row is null)
            {
                continue;
            }

            operators.Add(new SyncOperatorDto(row.UserId, row.DisplayName, row.Role));
        }

        return operators
            .OrderBy(op => op.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var isOwner = await db.Farms
            .AsNoTracking()
            .AnyAsync(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId, ct);
        if (isOwner)
        {
            return true;
        }

        return await db.FarmMemberships
            .AsNoTracking()
            .AnyAsync(
                membership => membership.FarmId == typedFarmId &&
                              membership.UserId == typedUserId &&
                              membership.Status != MembershipStatus.Revoked &&
                              membership.Status != MembershipStatus.Exited,
                ct);
    }

    public async Task<(bool IsMember, Guid OwnerAccountId)> GetFarmMembershipForTenantAsync(
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
    {
        // DATA_PRINCIPLE_SPINE 03.2 — Owner shortcut first so a farm's
        // declared OwnerUserId resolves to its OwnerAccountId in one
        // round-trip even when the membership row is absent (matches the
        // semantic of IsUserMemberOfFarmAsync above).
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        var ownerHit = await db.Farms
            .AsNoTracking()
            .Where(f => f.Id == typedFarmId && f.OwnerUserId == typedUserId)
            .Select(f => (Guid?)f.OwnerAccountId.Value)
            .FirstOrDefaultAsync(ct);
        if (ownerHit is Guid ownerAccount)
        {
            return (true, ownerAccount);
        }

        // owner_account_id was added to ssf.farm_memberships by migration
        // 20260516120000_AddOwnerAccountIdToFarmMemberships but is not on
        // the FarmMembership domain entity (kept stable for that migration
        // per its own rationale comment). Read it via raw SQL alongside
        // the non-terminal status filter the existing LINQ predicates use.
        // Status enum: 0=PendingOtpClaim, 1=PendingApproval, 2=Active,
        // 3=Suspended, 5=Revoked, 6=Exited (see MembershipStatus enum).
        var membershipOwner = await db.Database
            .SqlQueryRaw<Guid?>(
                """
                SELECT owner_account_id AS "Value"
                FROM ssf.farm_memberships
                WHERE farm_id = {0}
                  AND user_id = {1}
                  AND status NOT IN (5, 6)
                LIMIT 1
                """,
                farmId,
                userId)
            .FirstOrDefaultAsync(ct);

        return membershipOwner is Guid mappedOwner
            ? (true, mappedOwner)
            : (false, Guid.Empty);
    }

    public async Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);

        var membershipOwners = await db.FarmMemberships
            .AsNoTracking()
            .CountAsync(m => m.FarmId == typedFarmId
                && m.Status == MembershipStatus.Active
                && m.Role == AppRole.PrimaryOwner, ct);

        // Fallback for seeded farms: the declared Farm.OwnerUserId also
        // counts as a PrimaryOwner, even if no explicit membership row
        // exists. This mirrors the fallback in GetUserRoleForFarmAsync.
        if (membershipOwners == 0)
        {
            var hasDeclaredOwner = await db.Farms
                .AsNoTracking()
                .AnyAsync(f => f.Id == typedFarmId, ct);
            return hasDeclaredOwner ? 1 : 0;
        }

        return membershipOwners;
    }

    // --- Schedule domain (Phase 3) -----------------------------------------------------

    public async Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default)
    {
        await db.CropScheduleTemplates.AddAsync(template, ct);
    }

    public async Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
        ScheduleTemplateId templateId,
        CancellationToken ct = default)
    {
        return await db.CropScheduleTemplates
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == templateId.Value, ct);
    }

    public async Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(
        string cropKey,
        string? regionCode,
        CancellationToken ct = default)
    {
        var normalizedCrop = cropKey.Trim().ToLowerInvariant();
        var normalizedRegion = string.IsNullOrWhiteSpace(regionCode)
            ? null
            : regionCode.Trim().ToLowerInvariant();

        return await db.CropScheduleTemplates
            .AsNoTracking()
            .Where(t => t.CropKey == normalizedCrop
                        && (normalizedRegion == null || t.RegionCode == normalizedRegion)
                        && t.IsPublished)
            .OrderBy(t => t.TemplateKey)
            .ToListAsync(ct);
    }

    public async Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default)
    {
        await db.ScheduleSubscriptions.AddAsync(subscription, ct);
    }

    public async Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(
        ScheduleSubscriptionId subscriptionId,
        CancellationToken ct = default)
    {
        return await db.ScheduleSubscriptions
            .FirstOrDefaultAsync(s => s.Id == subscriptionId.Value, ct);
    }

    public async Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(
        Guid plotId,
        string cropKey,
        Guid cropCycleId,
        CancellationToken ct = default)
    {
        var normalizedCrop = cropKey.Trim().ToLowerInvariant();

        return await db.ScheduleSubscriptions
            .AsNoTracking()
            .FirstOrDefaultAsync(
                s => s.PlotId == plotId
                     && s.CropKey == normalizedCrop
                     && s.CropCycleId == cropCycleId
                     && s.State == ScheduleSubscriptionState.Active,
                ct);
    }

    public async Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default)
    {
        await db.ScheduleMigrationEvents.AddAsync(migrationEvent, ct);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }

    // --- CEI Phase 1 §4.4 -----------------------------------------------------------------

    public async Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default)
    {
        var logs = await db.DailyLogs
            .Where(l => l.PlotId == plotId)
            .Include(l => l.VerificationEvents)
            .ToListAsync(ct);

        return logs.Count(l => l.CurrentVerificationStatus == VerificationStatus.Disputed);
    }

    // --- CEI Phase 3 §4.6 -----------------------------------------------------------------

    public async Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
    {
        return await db.DailyLogs
            .Where(l => l.FarmId == farmId)
            .Include(l => l.VerificationEvents)
            .OrderBy(l => l.LogDate)
            .ToListAsync(ct);
    }

    public async Task<List<PlannedActivity>> GetPlannedActivitiesForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
    {
        // Get all crop cycle IDs for the farm first, then query planned activities
        var cropCycleIds = await db.CropCycles
            .Where(c => c.FarmId == farmId)
            .Select(c => c.Id)
            .ToListAsync(ct);

        if (cropCycleIds.Count == 0) return [];

        return await db.PlannedActivities
            .Where(a => cropCycleIds.Contains(a.CropCycleId) && a.PlannedDate >= sinceDate && a.RemovedAtUtc == null)
            .ToListAsync(ct);
    }

    public async Task<List<LogTask>> GetLogTasksForFarmSinceAsync(FarmId farmId, DateOnly sinceDate, CancellationToken ct = default)
    {
        return await (
            from task in db.LogTasks
            join log in db.DailyLogs on task.DailyLogId equals log.Id
            where log.FarmId == farmId && log.LogDate >= sinceDate
            select task
        ).ToListAsync(ct);
    }

    public async Task<List<Guid>> GetAllActiveFarmIdsAsync(CancellationToken ct = default)
    {
        return await db.FarmMemberships
            .Where(m => m.Status == MembershipStatus.Active)
            .Select(m => (Guid)m.FarmId)
            .Distinct()
            .ToListAsync(ct);
    }

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------

    public async Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default)
    {
        await db.JobCards.AddAsync(jobCard, ct);
    }

    public async Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
    {
        return await db.JobCards.FindAsync([jobCardId], ct);
    }

    public async Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
    {
        return await db.JobCards
            .FirstOrDefaultAsync(j => j.LinkedDailyLogId == dailyLogId, ct);
    }

    public async Task<List<JobCard>> GetJobCardsForFarmAsync(
        FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
    {
        var query = db.JobCards.Where(j => j.FarmId == farmId);
        if (statusFilter.HasValue)
            query = query.Where(j => j.Status == statusFilter.Value);
        return await query.OrderByDescending(j => j.CreatedAtUtc).ToListAsync(ct);
    }

    public async Task<List<JobCard>> GetJobCardsForWorkerAsync(
        UserId workerUserId, CancellationToken ct = default)
    {
        return await db.JobCards
            .Where(j => j.AssignedWorkerUserId == workerUserId)
            .OrderByDescending(j => j.PlannedDate)
            .ToListAsync(ct);
    }

    public async Task<List<JobCard>> GetJobCardsChangedSinceAsync(
        IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        var farmIdSet = farmIds.Select(id => new FarmId(id)).ToHashSet();
        return await db.JobCards
            .Where(j => farmIdSet.Contains(j.FarmId) && j.ModifiedAtUtc > sinceUtc)
            .ToListAsync(ct);
    }

    public Task<WorkerMetricsDto> GetWorkerMetricsAsync(
        UserId workerUserId, IReadOnlyCollection<Guid> scopedFarmIds, DateTime since30d, CancellationToken ct = default)
    {
        // For now return zeroed metrics — ReliabilityScore computation from DB queries
        // is deferred to a dedicated read-model in a future phase.
        //
        // spec: dfes-companion-2026-07-11 (wave-4.4) — WHEN YOU BUILD THAT READ-MODEL:
        // scopedFarmIds is not advisory, and it is no longer nullable precisely so that
        // "every farm this worker has ever worked" cannot be expressed by omission. It is
        // the set of farms the caller was PERMITTED (WorkerRecordAccess.PermittedFarmIds),
        // and a query here must filter on it. An empty set means no farms, never "all".
        //
        // Note also what these zeros mean for tier 3: nothing in this method is derived
        // from anything, so ReliabilityScore is not a real number today. Do not let it
        // become a portable reputation until it is.
        return Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));
    }

    // --- Labour Management read-model (Task 1.2, spec: 2026-07-13-labour-attendance-approval-design) ---

    public async Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
    {
        return await db.FarmMemberships
            .AsNoTracking()
            .Where(m => m.FarmId == farmId)
            .OrderBy(m => m.GrantedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
        FarmId farmId, CancellationToken ct = default)
    {
        // Decision 3a (2026-07-19, spec: 2026-07-13-labour-attendance-approval-design):
        // दिलं = ALL labour money paid out, not just job-card settlements.
        // "labour" on the wire is exactly the two CostCategoryId codes
        // labour_payout + labour_misc (CostCategory.ts / _shared.zod.ts) — the
        // same pair the frontend's mapCategory() buckets into "Labour" for the
        // finance page. Widening this filter (rather than adding a second
        // query) keeps ONE derivation for both categories.
        var entries = await db.CostEntries
            .Where(c => c.FarmId == farmId && (c.CategoryId == "labour_payout" || c.CategoryId == "labour_misc"))
            .OrderBy(c => c.EntryDate)
            .ToListAsync(ct);

        if (entries.Count == 0)
        {
            return [];
        }

        var jobCardIds = entries
            .Where(e => e.JobCardId.HasValue)
            .Select(e => e.JobCardId!.Value)
            .Distinct()
            .ToList();

        var workerByJobCardId = jobCardIds.Count == 0
            ? []
            : await db.JobCards
                .Where(j => jobCardIds.Contains(j.Id))
                .Select(j => new { j.Id, j.AssignedWorkerUserId })
                .ToDictionaryAsync(
                    x => x.Id,
                    x => x.AssignedWorkerUserId.HasValue ? (Guid?)x.AssignedWorkerUserId.Value.Value : null,
                    ct);

        return entries
            .Select(e => (
                e,
                e.JobCardId.HasValue && workerByJobCardId.TryGetValue(e.JobCardId.Value, out var w) ? w : null))
            .ToList();
    }

    public async Task<List<LabourAssignment>> GetLabourAssignmentsForFarmSinceAsync(
        FarmId farmId, DateOnly weekStart, CancellationToken ct = default)
    {
        return await (
            from la in db.LabourAssignments
            join log in db.DailyLogs on la.DailyLogId equals log.Id
            where log.FarmId == farmId && log.LogDate >= weekStart
            select la)
            .ToListAsync(ct);
    }

    // --- Field Operator identity (Task 11, spec: 2026-07-13-labour-attendance-approval-design) ---

    public async Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
    {
        await db.FieldOperators.AddAsync(o, ct);
    }

    public async Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await db.FieldOperators.FindAsync([id], ct);
    }

    public async Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
    {
        return await db.LabourAssignments.FindAsync([id], ct);
    }

    public async Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default)
    {
        return await db.FieldOperators
            .AsNoTracking()
            .Where(o => o.OriginatingFarmId == farmId)
            .OrderBy(o => o.CreatedAtUtc)
            .ToListAsync(ct);
    }

    /// <summary>
    /// "ON CONFLICT DO NOTHING" semantics for the (FieldOperator,
    /// LabourAssignment) attribution row — same shape as
    /// <see cref="UpsertTranscriptHistoryAsync"/> above: attempt the INSERT
    /// directly (the unique index <c>ux_field_operator_work_rows_operator_assignment</c>
    /// is the source of truth, so no pre-check query), commit immediately so
    /// the caller learns the real outcome before returning to the farmer, and
    /// on a unique-violation race detach the losing entity and report `false`.
    /// `false` is a SUCCESS outcome to the caller (Task 11.5 — attach is
    /// idempotent by intent), never re-thrown as an error.
    /// </summary>
    public async Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(r);

        try
        {
            await db.FieldOperatorWorkRows.AddAsync(r, ct);
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            db.Entry(r).State = EntityState.Detached;
            return false;
        }
    }

    // --- Labour review & correction (Task 12b, spec: 2026-07-13-labour-attendance-approval-design) ---

    public async Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(c);
        await db.LabourCorrections.AddAsync(c, ct);
    }

    public async Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
        Guid labourAssignmentId, CancellationToken ct = default)
    {
        // TRACKED (no AsNoTracking): the caller removes rows from this set in
        // the same unit of work, so EF must already be tracking them.
        return await db.FieldOperatorWorkRows
            .Where(r => r.LabourAssignmentId == labourAssignmentId)
            .OrderBy(r => r.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public Task RemoveFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(r);
        db.FieldOperatorWorkRows.Remove(r);
        return Task.CompletedTask;
    }

    public async Task AddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(r);
        await db.FieldOperatorWorkRows.AddAsync(r, ct);
    }

    // --- Labour read-back on /sync/pull (LABOUR_PHASE2 Phase 3) ---------------

    public async Task<IReadOnlyList<LabourAssignment>> GetLabourAssignmentsForDailyLogsAsync(
        IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
    {
        if (dailyLogIds is null || dailyLogIds.Count == 0)
        {
            return [];
        }

        // AsNoTracking: a pull is a pure read, and tracking hundreds of engagements
        // would put them in the same ChangeTracker the push path saves through.
        var ids = dailyLogIds as IList<Guid> ?? dailyLogIds.ToList();
        return await db.LabourAssignments
            .AsNoTracking()
            .Where(a => ids.Contains(a.DailyLogId))
            .OrderBy(a => a.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentsAsync(
        IReadOnlyCollection<Guid> labourAssignmentIds, CancellationToken ct = default)
    {
        if (labourAssignmentIds is null || labourAssignmentIds.Count == 0)
        {
            return [];
        }

        var ids = labourAssignmentIds as IList<Guid> ?? labourAssignmentIds.ToList();
        return await db.FieldOperatorWorkRows
            .AsNoTracking()
            .Where(r => ids.Contains(r.LabourAssignmentId))
            .OrderBy(r => r.CreatedAtUtc)
            .ToListAsync(ct);
    }

    // --- Labour capability (LABOUR_PHASE2 Phase 5, migration ②) ------------

    /// <summary>
    /// Projected to a bare <c>bool</c> on purpose: this runs on the hot path of
    /// five governed actions and never needs the entity. It is also reached
    /// ONLY for roles that do not already carry the capability
    /// (<c>LabourManagementGate</c> short-circuits owner-tier and Mukadam), so
    /// in practice it is one extra round trip on the rarest branch.
    /// <para>The non-terminal filter matches <see cref="GetUserRoleForFarmAsync"/>
    /// exactly, so the grant and the role can never disagree about whether the
    /// membership counts.</para>
    /// </summary>
    public async Task<bool> GetLabourManagementGrantAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        return await db.FarmMemberships
            .AsNoTracking()
            .AnyAsync(m => m.FarmId == typedFarmId
                && m.UserId == typedUserId
                && m.Status != MembershipStatus.Revoked
                && m.Status != MembershipStatus.Exited
                && m.CanManageLabourRecords, ct);
    }

    /// <summary>
    /// TRACKED, deliberately — the grant/revoke handler mutates what this
    /// returns and relies on <c>SaveChangesAsync</c> to persist it. The sibling
    /// <see cref="GetFarmMembershipAsync"/> is <c>AsNoTracking()</c> and would
    /// throw the mutation away in silence.
    /// </summary>
    public async Task<FarmMembership?> GetTrackedFarmMembershipAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        return await db.FarmMemberships
            .FirstOrDefaultAsync(m => m.FarmId == typedFarmId
                && m.UserId == typedUserId
                && m.Status != MembershipStatus.Revoked
                && m.Status != MembershipStatus.Exited, ct);
    }

    /// <summary>
    /// TRACKED and status-blind — the exit write path. See the port docs: every
    /// other membership read here filters the terminal statuses out, which makes
    /// <c>ExitMembershipHandler</c>'s already-exited branch unreachable and turns
    /// a retried exit into "you are not a member of this farm".
    /// <para>The ordering is load-bearing, not cosmetic: a (farm, user) pair may
    /// hold one live row plus any number of terminal ones (leave, rejoin by QR,
    /// leave again). Live first, then most-recently-modified, so the row this
    /// returns never depends on scan order.</para>
    /// </summary>
    public async Task<FarmMembership?> GetTrackedFarmMembershipIncludingTerminalAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
    {
        var typedFarmId = new FarmId(farmId);
        var typedUserId = new UserId(userId);

        return await db.FarmMemberships
            .Where(m => m.FarmId == typedFarmId && m.UserId == typedUserId)
            .OrderBy(m => m.Status == MembershipStatus.Revoked
                || m.Status == MembershipStatus.Exited ? 1 : 0)
            .ThenByDescending(m => m.ModifiedAtUtc)
            .FirstOrDefaultAsync(ct);
    }
    // --- spec: dfes-companion-2026-07-11 (wave-4.4) — founder model, 2026-08-17 -------
    // The farms this user OWNS, kept apart from the farms he merely belongs to.
    // GetFarmIdsForUserAsync unions the two; the founder's ruling that "an owner with two
    // farms of his own may see his own worker's record across both" needs the owned half
    // on its own, or a mukadam on two farms would inherit the same widening.
    public async Task<List<Guid>> GetOwnedFarmIdsForUserAsync(
        Guid userId, CancellationToken ct = default)
        => await db.Farms
            .AsNoTracking()
            .Where(f => (Guid)f.OwnerUserId == userId)
            .Select(f => (Guid)f.Id)
            .ToListAsync(ct);

    // TIER 2 — a farm's own word about a worker.
    //
    // There is no ssf table for these yet and no endpoint that writes one, so the honest
    // answer is nothing at all. Empty here means SILENCE: the farm has said nothing. It
    // must never be rendered as a zero, an empty star row, or "not yet rated" — writing a
    // statement is optional and an owner may never write one.
    //
    // When the table lands, query it here. The tier boundary, the attribution and the
    // consent gate around this read are already built and tested against this seam.
    public Task<IReadOnlyList<WorkerStatement>> GetWorkerStatementsAsync(
        UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<WorkerStatement>>([]);

    // --- spec: dfes-companion-2026-07-11 (wave-4.4) — founder ruling A, 2026-08-17 ----
    // Stated here rather than inherited silently from the port's default, because this
    // is the file someone edits when they build the cross-farm worker feature and this
    // is the answer that must stop them.
    //
    // There is NO grant surface for WORKER_RECORD_PORTABILITY: no screen asks a worker
    // for it, no endpoint records it, and ssf.consent_grant_events has never held a row
    // carrying that purpose code. So the honest answer is false, and returning false
    // keeps every identifiable cross-farm read refused.
    //
    // Do not satisfy this by reading the FARMER's consent row. The farm owner is not the
    // data principal for his worker's reputation; ruling A is explicit that the consent
    // required at portability is the worker's own.
    public Task<bool> HasWorkerRecordPortabilityConsentAsync(
        UserId workerUserId, CancellationToken ct = default)
        => Task.FromResult(false);

    // --- DATA_PRINCIPLE_SPINE sub-phase 02.3 (warm-tier transcripts) ------
    public Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default)
    {
        db.Transcripts.Add(transcript);
        return Task.CompletedTask;
    }

    // --- DATA_PRINCIPLE_SPINE 02-patch (cold-storage wiring) --------------
    /// <summary>
    /// Upsert by SHA-256 — increment ref-count on a repeat sighting, insert a
    /// fresh row (RefCount=1) on first sighting. SaveChanges is invoked
    /// directly so the index row is durable BEFORE the caller stamps the
    /// SHA-256 onto an <see cref="AiJob.RawInputRef"/>. Both DbContext-bound
    /// repositories (this one and <c>AiJobRepository</c>) share the same
    /// scoped <c>ShramSafalDbContext</c>, so this flushes any pending
    /// orchestrator writes too — which is fine: the orchestrator does the
    /// upsert call BEFORE it adds the AiJob to the tracker, so nothing else
    /// is in flight at this point.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>§P0.9 addendum — the subject linkage.</b> After the index row is
    /// durable, <c>(sha256, subjectUserId)</c> is recorded in
    /// <c>ssf.raw_blob_subjects</c>. That table is the only user→audio pointer
    /// that outlives a DPDP erasure, which deletes
    /// <c>ai_jobs WHERE user_id = X</c> and with it the former sole link
    /// (<c>ai_jobs.raw_input_ref</c>).
    /// </para>
    /// <para>
    /// <b>Why the linkage is NOT conditional on the ref-count increment.</b>
    /// The two answer different questions and are deliberately decoupled:
    /// <c>ref_count</c> counts persist events for a blob, the linkage counts
    /// DISTINCT subjects of it. Gating the insert on "was this a first
    /// sighting" would mean the SECOND farmer to upload an identical clip is
    /// never linked — precisely the many-to-many case this table exists for.
    /// </para>
    /// <para>
    /// <b>A null subject writes no row.</b> Absence means unknown. No
    /// placeholder, no <see cref="Guid.Empty"/>, no minted GUID.
    /// </para>
    /// <para>
    /// <b>Why neither write uses <c>ON CONFLICT</c>, despite that being the
    /// obvious idiom.</b> MEASURED on this schema as <c>agrisync_app</c>, with
    /// a committed <c>raw_blob_index</c> row that the tenant's RLS policy hides:
    /// plain <c>INSERT</c> → <c>23505</c>; <c>ON CONFLICT … DO NOTHING</c> →
    /// <c>ERROR: new row violates row-level security policy</c>;
    /// <c>ON CONFLICT … DO UPDATE</c> → same error; bare <c>UPDATE</c> →
    /// <c>UPDATE 0</c>, no error. <c>ON CONFLICT</c> needs the conflicting row
    /// to be policy-visible, and under <c>p_tenant_raw_blob_index</c> —
    /// an EXISTS-join to <c>ssf.ai_jobs</c> keyed on <c>agrisync.farm_id</c> —
    /// another farm's row is not. So the conflict is absorbed with a SAVEPOINT
    /// instead, which needs no visibility at all.
    /// </para>
    /// </remarks>
    public async Task UpsertRawBlobIndexAsync(RawBlobRef blobRef, Guid? subjectUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(blobRef);

        await UpsertBlobIndexRowAsync(blobRef, ct);

        // Flush any tracked work the caller had pending, preserving the
        // durability contract this method has always advertised. A no-op in
        // practice — the orchestrator upserts BEFORE adding the AiJob — but
        // free, and removing it would be a silent behaviour change for any
        // future caller that does have state in flight.
        await db.SaveChangesAsync(ct);

        // The index row is now durable, so the FK on the linkage row resolves.
        // (FK checks bypass RLS by design, so this holds even when the index
        // row belongs to a different tenant and is invisible here.)
        if (subjectUserId is not { } userId || userId == Guid.Empty)
        {
            return;
        }

        await InsertIgnoringDuplicateAsync(
            @"INSERT INTO ssf.raw_blob_subjects (sha256, user_id, first_seen_utc)
              VALUES ({0}, {1}, {2});",
            [blobRef.Sha256, userId, DateTime.UtcNow],
            ct);
    }

    /// <summary>
    /// §P0.9 — create-or-increment the <c>ssf.raw_blob_index</c> row without
    /// ever throwing, so the subject linkage that follows it always gets to run.
    ///
    /// <para>
    /// <b>The bug this replaces.</b> The previous EF read-then-write was
    /// <c>FirstOrDefaultAsync</c> → <c>Add</c> or <c>IncrementRefCount</c>. That
    /// read is RLS-filtered. When farmer B uploads bytes identical to farmer A's
    /// earlier clip, B cannot see A's index row, so EF took the INSERT branch
    /// and Postgres raised <c>23505</c>;
    /// <c>AiOrchestrator.TryPersistRawBlobAsync</c> swallowed it, and B got no
    /// linkage row and no <c>ai_jobs.raw_input_ref</c>. The flagship
    /// many-to-many case — the entire reason this is a join table — produced
    /// nothing in production. Two users uploading identical bytes concurrently
    /// hit the same shape.
    /// </para>
    ///
    /// <para>
    /// <b>UPDATE first, then INSERT.</b> The UPDATE is the atomic form of the
    /// old increment (it also fixes the read-modify-write lost-update race the
    /// EF version had). It affects 0 rows when the row is absent OR hidden —
    /// neither is an error. Only then do we try to create it.
    /// </para>
    ///
    /// <para>
    /// <b>Known, deliberate limitation.</b> When the row exists but is hidden
    /// from this tenant, <c>ref_count</c> is NOT incremented — the UPDATE
    /// matched nothing and the INSERT hit a duplicate. That undercount is a
    /// property of <c>p_tenant_raw_blob_index</c>, not of this method, and
    /// fixing it means changing that policy (out of scope for §P0.9). It is
    /// strictly better than the previous behaviour, where the same case threw
    /// and cost us the subject linkage as well as the increment.
    /// </para>
    /// </summary>
    private async Task UpsertBlobIndexRowAsync(RawBlobRef blobRef, CancellationToken ct)
    {
        var incremented = await db.Database.ExecuteSqlRawAsync(
            "UPDATE ssf.raw_blob_index SET ref_count = ref_count + 1 WHERE sha256 = {0};",
            [blobRef.Sha256],
            ct);

        if (incremented > 0)
        {
            return;
        }

        // First sighting (or a sighting of a row this tenant cannot see). The
        // domain factory still governs the initial state — RefCount=1 and the
        // FirstSeenUtc stamp come from RawBlobIndexEntry.New, not from SQL.
        var entry = RawBlobIndexEntry.New(blobRef);

        await InsertIgnoringDuplicateAsync(
            @"INSERT INTO ssf.raw_blob_index
                  (sha256, s3_key, content_type, size_bytes, first_seen_utc, ref_count)
              VALUES ({0}, {1}, {2}, {3}, {4}, {5});",
            [entry.Sha256, entry.S3Key, entry.ContentType, entry.SizeBytes, entry.FirstSeenUtc, entry.RefCount],
            ct);
    }

    /// <summary>
    /// Run an INSERT, treating a unique violation as success (the row is
    /// already there — possibly invisible to this tenant under RLS).
    ///
    /// <para>
    /// The SAVEPOINT is load-bearing, not defensive. In Postgres a failed
    /// statement poisons the whole transaction — every later command answers
    /// <c>25P02 current transaction is aborted</c> — and these writes run inside
    /// the per-request transaction <c>TenantTransactionMiddleware</c> opened. So
    /// catching <c>23505</c> without a savepoint would convert one duplicate
    /// blob into a failure of the entire request. Rolling back to the savepoint
    /// discards only the failed INSERT.
    /// </para>
    ///
    /// <para>
    /// With no ambient transaction each statement is its own implicit
    /// transaction, so a failure is already contained and no savepoint is
    /// needed — hence the null check rather than an assumption.
    /// </para>
    ///
    /// <para>
    /// <b>Every exit path settles the savepoint</b> — released on success,
    /// rolled back on ANY failure, not only on <c>23505</c>. An earlier version
    /// rolled back solely inside the unique-violation filter, so a different
    /// SQLSTATE (a <c>42501</c> permission denial, say — reachable on this very
    /// table before the GRANT landed) escaped with the savepoint unsettled and
    /// left the outer request transaction aborted: exactly the <c>25P02</c> this
    /// helper exists to prevent, on the path where it matters most. Non-duplicate
    /// failures are still rethrown; the rollback only keeps the caller's
    /// transaction usable enough to report them.
    /// </para>
    /// </summary>
    private async Task InsertIgnoringDuplicateAsync(string sql, object[] parameters, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction;

        if (transaction is null)
        {
            // Implicit per-statement transaction — a failure is already
            // contained, so there is nothing to protect the caller from.
            try
            {
                await db.Database.ExecuteSqlRawAsync(sql, parameters, ct);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                // Row already exists (possibly invisible to this tenant).
            }

            return;
        }

        var savepoint = "sp_blob_upsert_" + Guid.NewGuid().ToString("N");
        await transaction.CreateSavepointAsync(savepoint, ct);

        try
        {
            await db.Database.ExecuteSqlRawAsync(sql, parameters, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // Row already exists (possibly invisible to this tenant). Discard
            // only the failed INSERT and carry on.
            await RollBackQuietlyAsync(transaction, savepoint);
            return;
        }
        catch
        {
            // Anything else is a real error the caller must see — but leave the
            // outer transaction usable rather than poisoned on the way out.
            await RollBackQuietlyAsync(transaction, savepoint);
            throw;
        }

        // Success: release, so savepoints do not accumulate across the many
        // blobs a single request can persist.
        try
        {
            await transaction.ReleaseSavepointAsync(savepoint, ct);
        }
        catch (PostgresException)
        {
            // Releasing is housekeeping. If the provider or server declines it,
            // the savepoint is discarded at COMMIT anyway; failing the caller's
            // write over it would be strictly worse.
        }
    }

    /// <summary>
    /// Roll back to <paramref name="savepoint"/> without letting a secondary
    /// failure mask the primary one. If the connection is already broken the
    /// rollback cannot succeed and there is nothing left to protect.
    ///
    /// <para>
    /// Deliberately NOT passed the caller's <c>CancellationToken</c>: this runs
    /// on the failure path, and cancellation is one of the ways we get here. A
    /// cancelled token would abort the cleanup that exists precisely to leave
    /// the transaction usable.
    /// </para>
    /// </summary>
    private static async Task RollBackQuietlyAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        string savepoint)
    {
        try
        {
            await transaction.RollbackToSavepointAsync(savepoint, CancellationToken.None);
        }
        catch (Exception)
        {
            // Swallowed deliberately: the caller is already handling or
            // rethrowing a more informative exception.
        }
    }

    // --- SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 (transcript idempotency) ---
    // The unique key on ssf.transcript_history is
    // (audio_content_hash, transcript_provider, transcript_model_version,
    // transcript_mode). See TranscriptHistoryConfiguration.cs for the EF
    // mapping. The lookup hits the unique index
    // ux_transcript_history_audio_provider_model_mode by name.

    public async Task<TranscriptHistory?> GetTranscriptHistoryAsync(
        string audioContentHash,
        string transcriptProvider,
        string transcriptModelVersion,
        string transcriptMode,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(audioContentHash) ||
            string.IsNullOrWhiteSpace(transcriptProvider) ||
            string.IsNullOrWhiteSpace(transcriptModelVersion) ||
            string.IsNullOrWhiteSpace(transcriptMode))
        {
            return null;
        }

        return await db.TranscriptHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(
                h => h.AudioContentHash == audioContentHash &&
                     h.TranscriptProvider == transcriptProvider &&
                     h.TranscriptModelVersion == transcriptModelVersion &&
                     h.TranscriptMode == transcriptMode,
                ct);
    }

    /// <summary>
    /// "ON CONFLICT DO NOTHING" semantics. We pre-check the unique tuple
    /// inside the same DbContext to avoid the UPDATE landmine on a tracked
    /// entity collision; SaveChanges is invoked directly so the row is
    /// durable before the caller returns the transcript to the user. If a
    /// concurrent writer beat us to it (race window), the duplicate-key
    /// INSERT path raises a Postgres unique-violation which we catch +
    /// swallow — the loser's transcript text is presumed equivalent because
    /// the same audio + same (provider, model, mode) deterministically
    /// produces the same text.
    /// </summary>
    public async Task UpsertTranscriptHistoryAsync(TranscriptHistory history, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(history);

        // First-line check: if the row already exists, no-op. AsNoTracking
        // keeps the EF identity map clean so a later GET in the same scope
        // re-reads from DB if needed.
        var existing = await db.TranscriptHistories
            .AsNoTracking()
            .AnyAsync(
                h => h.AudioContentHash == history.AudioContentHash &&
                     h.TranscriptProvider == history.TranscriptProvider &&
                     h.TranscriptModelVersion == history.TranscriptModelVersion &&
                     h.TranscriptMode == history.TranscriptMode,
                ct);

        if (existing)
        {
            return;
        }

        try
        {
            await db.TranscriptHistories.AddAsync(history, ct);
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Race window between the pre-check and the SaveChanges: a
            // concurrent writer landed the same row. Detach our copy so
            // EF stops tracking it and the next SaveChanges in this scope
            // doesn't re-attempt the INSERT.
            db.Entry(history).State = EntityState.Detached;
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        // Npgsql surfaces unique-violation as SQLSTATE 23505 inside an
        // inner PostgresException. We avoid a hard reference to
        // Npgsql.PostgresException so the production assembly's reference
        // surface stays unchanged; instead, we sniff the SqlState property
        // via reflection-safe Exception.Data and the inner-exception
        // message. The defensive check is intentional — losing the race
        // and silently swallowing is the correct behavior per the
        // ON CONFLICT DO NOTHING semantics in the port contract.
        for (Exception? inner = ex; inner is not null; inner = inner.InnerException)
        {
            if (inner.GetType().Name == "PostgresException")
            {
                var sqlStateProp = inner.GetType().GetProperty("SqlState");
                if (sqlStateProp?.GetValue(inner) is string sqlState &&
                    string.Equals(sqlState, "23505", StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 06.1 / 06.2 (consent domain) ──────
    // spec: data-principle-spine-2026-05-05/06.2

    /// <summary>
    /// Fetch the live consent row for <paramref name="userId"/> or null
    /// when the user has never toggled any consent (first-time
    /// interaction). The <c>ssf.user_consent_state</c> PK is
    /// <c>user_id</c>; <see cref="DbSet{TEntity}.FindAsync"/> hits the
    /// identity map first so a within-request re-read is free.
    /// </summary>
    public async Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return null;
        }

        return await db.UserConsentStates.FirstOrDefaultAsync(s => s.UserId == userId, ct);
    }

    public async Task AddUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        await db.UserConsentStates.AddAsync(state, ct);
    }

    /// <summary>
    /// Replace the live consent row. The factory pattern on
    /// <see cref="UserConsentState"/> returns a NEW instance on every
    /// update; the handler hands us that new instance and we
    /// reattach + mark modified. Pre-existing rows that the handler
    /// already loaded through this same context get their tracked entry
    /// updated via <see cref="DbContext.Entry"/>.
    /// </summary>
    public async Task UpdateUserConsentStateAsync(UserConsentState state, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(state);

        // The handler loads the existing row, computes the diff, then
        // hands us a new value instance. Reuse the tracked entity
        // when present so EF emits an UPDATE; otherwise, attach and
        // mark Modified so EF still emits an UPDATE (not an INSERT —
        // the row exists in DB).
        var tracked = await db.UserConsentStates
            .FirstOrDefaultAsync(s => s.UserId == state.UserId, ct);

        if (tracked is null)
        {
            db.UserConsentStates.Attach(state);
            db.Entry(state).State = EntityState.Modified;
            return;
        }

        // Overwrite the tracked entity's scalar values from the new
        // instance — CurrentValues.SetValues copies every mapped
        // property by name without invalidating the tracking entry.
        db.Entry(tracked).CurrentValues.SetValues(state);
    }

    public async Task AddConsentAuditEntryAsync(ConsentAuditEntry entry, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await db.ConsentAuditEntries.AddAsync(entry, ct);
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 10.2 / 10.4 (PII review queue) ────
    // spec: data-principle-spine-2026-05-05/10.2

    public async Task AddPiiReviewQueueEntryAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry entry,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        await db.PiiReviewQueueEntries.AddAsync(entry, ct);
    }

    public async Task<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry?> GetPiiReviewQueueEntryAsync(
        Guid entryId,
        CancellationToken ct = default)
    {
        if (entryId == Guid.Empty)
        {
            return null;
        }

        return await db.PiiReviewQueueEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct);
    }

    public async Task<IReadOnlyList<ShramSafal.Domain.Privacy.Pii.PiiReviewQueueEntry>> ListPiiReviewQueueAsync(
        ShramSafal.Domain.Privacy.Pii.PiiReviewStatus status,
        int limit,
        CancellationToken ct = default)
    {
        var clamped = limit <= 0 ? 50 : Math.Min(limit, 200);
        return await db.PiiReviewQueueEntries
            .Where(e => e.Status == status)
            .OrderBy(e => e.OccurredAtUtc)
            .Take(clamped)
            .ToListAsync(ct);
    }

    // ── DATA_PRINCIPLE_SPINE sub-phase 08.1 (DPDP rights surface) ────────
    // spec: data-principle-spine-2026-05-05/08.1

    public async Task AddErasureRequestAsync(ErasureRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await db.ErasureRequests.AddAsync(request, ct);
    }

    public async Task AddExportRequestAsync(ExportRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await db.ExportRequests.AddAsync(request, ct);
    }

    public async Task AddBreachIncidentAsync(BreachIncident incident, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(incident);
        await db.BreachIncidents.AddAsync(incident, ct);
    }

    public async Task<List<ErasureRequest>> GetErasureRequestsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return new List<ErasureRequest>();
        }
        return await db.ErasureRequests
            .Where(r => r.RequestedByUserId == userId || r.OnBehalfOfUserId == userId)
            .OrderByDescending(r => r.RequestedAtUtc)
            .Take(50)
            .ToListAsync(ct);
    }

    public async Task<List<ExportRequest>> GetExportRequestsForUserAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return new List<ExportRequest>();
        }
        return await db.ExportRequests
            .Where(r => r.RequestedByUserId == userId || r.OnBehalfOfUserId == userId)
            .OrderByDescending(r => r.RequestedAtUtc)
            .Take(50)
            .ToListAsync(ct);
    }

    // ── AI Intelligence Plan WP-2b (Track B typed ledger writers) ────────
    // spec: ai-intelligence-plan-2026-06-25
    // Confirm-time derivation (LedgerDerivationService) stages these rows on
    // the DbSet; the caller's existing SaveChangesAsync commits them in the
    // same unit of work as the DailyLog (mirrors AddWeatherStampAsync at
    // L137). No SaveChanges here.

    public async Task AddFarmOperationAsync(FarmOperation op, CancellationToken ct = default)
    {
        await db.FarmOperations.AddAsync(op, ct);
    }

    public async Task AddApplicationInputItemAsync(ApplicationInputItem item, CancellationToken ct = default)
    {
        await db.ApplicationInputItems.AddAsync(item, ct);
    }

    public async Task AddIrrigationEntryAsync(IrrigationEntry e, CancellationToken ct = default)
    {
        await db.IrrigationEntries.AddAsync(e, ct);
    }

    public async Task AddLabourAssignmentAsync(LabourAssignment a, CancellationToken ct = default)
    {
        await db.LabourAssignments.AddAsync(a, ct);
    }

    public async Task AddMachineryUsageAsync(MachineryUsage m, CancellationToken ct = default)
    {
        await db.MachineryUsages.AddAsync(m, ct);
    }

    public async Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
    {
        await db.ObservationEvents.AddAsync(o, ct);
    }

    public async Task AddDisturbanceEventAsync(DisturbanceEvent d, CancellationToken ct = default)
    {
        await db.DisturbanceEvents.AddAsync(d, ct);
    }

    /// <summary>
    /// Supersession lookup — the CURRENT-version FarmOperation whose
    /// DerivedEventKey matches, or null. <c>DerivedEventKey</c> is mapped as a
    /// WHOLE-PROPERTY value converter (FarmOperationConfiguration L28-30), so we
    /// must compare the whole value object — EF Core cannot translate member
    /// access (<c>.Value</c>) on a value-converted property (it throws
    /// InvalidOperationException at query time). Constructing the key and
    /// comparing <c>o.DerivedEventKey == key</c> translates to
    /// <c>WHERE derived_event_key = @key</c>.
    /// </summary>
    public async Task<FarmOperation?> GetFarmOperationByKeyAsync(string derivedEventKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(derivedEventKey))
        {
            return null;
        }

        var key = new DerivedEventKey(derivedEventKey);
        return await db.FarmOperations
            .FirstOrDefaultAsync(o => o.DerivedEventKey == key && o.IsCurrentVersion, ct);
    }

    /// <summary>
    /// RoutineMemory upsert lookup — filter on farm_id + plot_id (nullable) +
    /// operation_type. PlotId null matches farm-wide patterns.
    /// </summary>
    public async Task<RoutinePattern?> GetRoutinePatternAsync(Guid farmId, Guid? plotId, string operationType, CancellationToken ct = default)
    {
        var normalizedOp = (operationType ?? string.Empty).Trim();

        return await db.RoutinePatterns
            .FirstOrDefaultAsync(
                p => p.FarmId == farmId && p.PlotId == plotId && p.OperationType == normalizedOp,
                ct);
    }

    public async Task AddRoutinePatternAsync(RoutinePattern p, CancellationToken ct = default)
    {
        await db.RoutinePatterns.AddAsync(p, ct);
    }

    private static List<Guid> NormalizeFarmIds(IEnumerable<Guid> farmIds)
    {
        return farmIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();
    }

    private sealed class OperatorDirectoryRow
    {
        public Guid UserId { get; set; }
        public string DisplayName { get; set; } = string.Empty;
        public string Role { get; set; } = "WORKER";
    }
}
