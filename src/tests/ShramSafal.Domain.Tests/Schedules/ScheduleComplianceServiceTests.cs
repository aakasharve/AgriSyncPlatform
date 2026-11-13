using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleComplianceServiceTests
{
    private static readonly FarmId Farm = new(Guid.NewGuid());
    private static readonly Guid Plot = Guid.NewGuid();
    private static readonly Guid Cycle = Guid.NewGuid();
    private static readonly DateOnly CycleStart = new(2026, 4, 1);
    private const string CropKey = "grapes";
    private const string TaskType = "fertigation";
    private const string Stage = "flowering";

    [Fact]
    public async Task NoActiveSubscription_ReturnsUnscheduled()
    {
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = null,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.Unscheduled, result.Outcome);
        Assert.Null(result.SubscriptionId);
        Assert.Null(result.MatchedTaskId);
    }

    [Fact]
    public async Task LoggedOnPrescribedDay_ReturnsOnTime()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.OnTime, result.Outcome);
        Assert.Equal(0, result.DeltaDays);
        Assert.Equal(subscription.SubscriptionId, result.SubscriptionId);
        Assert.Equal(template.Tasks[0].Id, result.MatchedTaskId);
    }

    [Fact]
    public async Task LoggedFiveDaysEarly_ReturnsEarly()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(5)));

        Assert.Equal(ComplianceOutcome.Early, result.Outcome);
        Assert.Equal(-5, result.DeltaDays);
    }

    [Fact]
    public async Task LoggedFiveDaysLate_ReturnsLate()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(15)));

        Assert.Equal(ComplianceOutcome.Late, result.Outcome);
        Assert.Equal(5, result.DeltaDays);
    }

    // ------- lane L8b-3 (R6, D-76): a plot-season may follow several schedules; a record is measured against the मुख्य one -------

    private static ScheduleSubscription FollowingAt(short slot, ScheduleTemplateId? templateId = null) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Cycle, CropKey, templateId ?? ScheduleTemplateId.New(), "v1",
            DateTime.UtcNow.AddDays(-10 + slot), null, ScheduleOrigin.Outside, ScheduleCheckState.Checked, slot);

    private static ScheduleTemplate InstitutionRow(Guid id)
    {
        var row = ScheduleTemplate.Import(
            id, "Grapes - University Schedule", ScheduleOwnerType.Institution, "Test University", "grape",
            new UserId(Guid.NewGuid()), TenantScope.Public, DateTime.UtcNow,
            [new StageDefinition("Post Pruning", 0, 99)],
            [new ImportedActivity("cut", "Pruning", 10, 10, FrequencyMode.OneTime, 1)],
            out var problem);
        Assert.Null(problem);
        return row!;
    }

    [Fact]
    public async Task Several_followed_schedules_are_measured_against_the_lowest_outside_place_when_no_Institution_schedule_is_checked()
    {
        var (_, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var low = FollowingAt(1);
        var high = FollowingAt(2);
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [high, low], Template = template };

        var result = await new ScheduleComplianceService(repo).EvaluateAsync(new ScheduleComplianceQuery(Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.OnTime, result.Outcome);
        Assert.Equal(low.SubscriptionId, result.SubscriptionId);
    }

    [Fact]
    public async Task A_checked_Institution_schedule_in_place_3_is_the_one_a_record_is_measured_against()
    {
        var (_, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var institutionTemplate = ScheduleTemplateId.New();
        var low = FollowingAt(1);
        var institution = FollowingAt(3, institutionTemplate);
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [low, institution], Template = template };
        var row = InstitutionRow(institutionTemplate.Value);
        repo.LibraryRows[row.Id] = row;
        repo.Checks.Add(ScheduleCheck.Approve(row, row.Activities.Select(a => a.Id).ToList(), new UserId(Guid.NewGuid()), "Checker", DateTime.UtcNow, out var problem)!);
        Assert.Null(problem);

        var result = await new ScheduleComplianceService(repo).EvaluateAsync(new ScheduleComplianceQuery(Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(institution.SubscriptionId, result.SubscriptionId);
    }

    [Fact]
    public async Task A_library_schedule_resolves_to_nothing_in_the_compliance_model_so_the_answer_is_Unscheduled_before_and_after()
    {
        // crop_schedule_templates (the old model) holds none of the library's ids: the lookup finds nothing, 3 + 1 or not.
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [FollowingAt(1), FollowingAt(2)], Template = null };

        var result = await new ScheduleComplianceService(repo).EvaluateAsync(new ScheduleComplianceQuery(Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.Unscheduled, result.Outcome);
    }

    // ------- lane CMP-D2: compliance resolves a LIBRARY schedule (schedule_templates) and stamps against the मुख्य one -------

    private static ScheduleTemplate SprayRow(Guid id, int day, string name = "Grapes - University Schedule")
    {
        var row = ScheduleTemplate.Import(
            id, name, ScheduleOwnerType.Institution, "Test University", "grape",
            new UserId(Guid.NewGuid()), TenantScope.Public, DateTime.UtcNow,
            [new StageDefinition("Post Pruning", 0, 99)],
            [new ImportedActivity("spray", "बुरशीनाशक फवारणी", day, day, FrequencyMode.OneTime, 1)],
            out var problem);
        Assert.Null(problem);
        return row!;
    }

    [Fact]
    public async Task A_library_subscription_is_stamped_against_its_stored_days_not_Unscheduled()
    {
        var templateId = ScheduleTemplateId.New();
        var followed = FollowingAt(1, templateId);
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [followed], Template = null };
        repo.LibraryRows[templateId.Value] = SprayRow(templateId.Value, day: 10);

        var onTheDay = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(10)));
        var late = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(15)));

        Assert.Equal(ComplianceOutcome.OnTime, onTheDay.Outcome);
        Assert.Equal(followed.SubscriptionId, onTheDay.SubscriptionId);
        Assert.Equal(0, onTheDay.DeltaDays);
        Assert.NotNull(onTheDay.MatchedTaskId);
        Assert.Equal(ComplianceOutcome.Late, late.Outcome);
        Assert.Equal(5, late.DeltaDays);
    }

    [Fact]
    public void Compliance_keeps_ONE_tolerance_source_the_shared_on_time_days()
    {
        // P006 (review CMPD2-REVIEW-1): the library stamp reads the existing constant instead of a duplicate "3".
        Assert.Null(typeof(ScheduleComplianceService).GetField("LibraryOnTimeDays"));
    }

    [Fact]
    public async Task A_library_stamp_is_on_time_up_to_the_shared_tolerance_and_late_after_it()
    {
        var templateId = ScheduleTemplateId.New();
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [FollowingAt(1, templateId)], Template = null };
        repo.LibraryRows[templateId.Value] = SprayRow(templateId.Value, day: 10);
        var service = new ScheduleComplianceService(repo);
        var tolerance = Domain.Compare.ScheduledWorkMatcher.OnTimeToleranceDays;

        var edge = await service.EvaluateAsync(new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(10 + tolerance)));
        var past = await service.EvaluateAsync(new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(10 + tolerance + 1)));

        Assert.Equal(ComplianceOutcome.OnTime, edge.Outcome);
        Assert.Equal(ComplianceOutcome.Late, past.Outcome);
    }

    [Fact]
    public async Task A_library_subscription_counts_from_its_own_reference_date()
    {
        var templateId = ScheduleTemplateId.New();
        var followed = ScheduleSubscription.Adopt(
            Guid.NewGuid(), Farm, Plot, Cycle, CropKey, templateId, "v1", DateTime.UtcNow.AddDays(-10), new DateOnly(2026, 4, 11),
            ScheduleOrigin.Outside, ScheduleCheckState.Checked, 1);
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [followed], Template = null };
        repo.LibraryRows[templateId.Value] = SprayRow(templateId.Value, day: 10); // day 0 = 11 April -> 21 April

        var result = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, new DateOnly(2026, 4, 21)));

        Assert.Equal(ComplianceOutcome.OnTime, result.Outcome);
        Assert.Equal(0, result.DeltaDays);
    }

    [Fact]
    public async Task A_library_row_that_does_not_store_its_days_stays_Unscheduled_and_other_work_is_not_matched()
    {
        var thin = ScheduleTemplate.Create(Guid.NewGuid(), "Grapes - sample", "Pruning", DateTime.UtcNow);
        thin.AddActivity(Guid.NewGuid(), "बुरशीनाशक फवारणी", 10, FrequencyMode.OneTime, 1);
        var stored = SprayRow(Guid.NewGuid(), day: 10);
        var repo = new FakeRepo { Cycle = BuildCycle(), Template = null };

        repo.Followed = [FollowingAt(1, new ScheduleTemplateId(thin.Id))];
        repo.LibraryRows[thin.Id] = thin;
        var unstored = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(10)));
        Assert.Equal(ComplianceOutcome.Unscheduled, unstored.Outcome);

        repo.Followed = [FollowingAt(1, new ScheduleTemplateId(stored.Id))];
        repo.LibraryRows[stored.Id] = stored;
        var otherWork = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "ठिबक सिंचन", Stage, CycleStart.AddDays(10)));
        Assert.Equal(ComplianceOutcome.Unscheduled, otherWork.Outcome);
    }

    [Fact]
    public async Task Several_library_schedules_are_stamped_against_the_main_one()
    {
        var mainId = ScheduleTemplateId.New();
        var otherId = ScheduleTemplateId.New();
        var main = FollowingAt(1, mainId);
        var other = FollowingAt(2, otherId);
        var repo = new FakeRepo { Cycle = BuildCycle(), Followed = [other, main], Template = null };
        repo.LibraryRows[mainId.Value] = SprayRow(mainId.Value, day: 10, "Grapes - main");
        repo.LibraryRows[otherId.Value] = SprayRow(otherId.Value, day: 12, "Grapes - other");

        var result = await new ScheduleComplianceService(repo).EvaluateAsync(
            new ScheduleComplianceQuery(Cycle, "बुरशीनाशक फवारणी", Stage, CycleStart.AddDays(10)));

        Assert.Equal(main.SubscriptionId, result.SubscriptionId);
        Assert.Equal(0, result.DeltaDays);
    }

    private static CropCycle BuildCycle() =>
        CropCycle.Create(Cycle, Farm, Plot, CropKey, Stage, CycleStart, endDate: null, createdAtUtc: DateTime.UtcNow);

    private static (ScheduleSubscription Subscription, CropScheduleTemplate Template) BuildSubscriptionAndTemplate(
        int dayOffset,
        int tolerance)
    {
        var templateId = ScheduleTemplateId.New();
        var task = PrescribedTask.Create(
            PrescribedTaskId.New(),
            TaskType,
            Stage,
            dayOffset,
            tolerance);

        var template = CropScheduleTemplate.Create(
            templateId.Value,
            templateKey: "test-template-v1",
            cropKey: CropKey,
            regionCode: null,
            name: "Test Template",
            versionTag: "v1",
            createdAtUtc: DateTime.UtcNow,
            tasks: new[] { task });
        template.Publish();

        var subscription = ScheduleSubscription.Adopt(
            Guid.NewGuid(),
            Farm,
            Plot,
            Cycle,
            CropKey,
            templateId,
            "v1",
            DateTime.UtcNow);

        return (subscription, template);
    }

    // Minimal stub — the service only calls three methods; everything else throws if misused.
    private sealed class FakeRepo : IShramSafalRepository
    {
        public CropCycle? Cycle { get; set; }
        public ScheduleSubscription? ActiveSubscription { get; set; }

        /// <summary>lane L8b-3 - several followed schedules (3 + 1); when set it is what the plot-season follows, else <see cref="ActiveSubscription"/>.</summary>
        public List<ScheduleSubscription>? Followed { get; set; }

        /// <summary>The library rows (owner type) and checks the मुख्य pick reads when several are followed.</summary>
        public Dictionary<Guid, ScheduleTemplate> LibraryRows { get; } = new();
        public List<ScheduleCheck> Checks { get; } = new();
        public CropScheduleTemplate? Template { get; set; }

        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(Cycle);

        public Task<List<ScheduleSubscription>> GetActiveScheduleSubscriptionsAsync(
            Guid plotId, Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(Followed ?? (ActiveSubscription is null ? [] : [ActiveSubscription]));

        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) =>
            Task.FromResult(LibraryRows.GetValueOrDefault(templateId));

        public Task<IReadOnlyList<ScheduleCheck>> GetScheduleChecksAsync(
            IReadOnlyCollection<Guid> scheduleTemplateIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ScheduleCheck>>(Checks.Where(c => scheduleTemplateIds.Contains(c.ScheduleTemplateId)).ToList());

        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
            ScheduleTemplateId templateId, CancellationToken ct = default) =>
            Task.FromResult(Template);

        // ---- Unused members — throw if touched by production code paths we don't expect. ----

        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();

        // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
        // required interface members; no-op in this test stub.
        public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
    }
}
