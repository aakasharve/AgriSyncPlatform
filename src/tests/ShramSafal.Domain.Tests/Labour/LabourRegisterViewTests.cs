using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Tests.Work.Handlers;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// D-H8, R1 read-path scope: ONE REGISTER, THREE VIEWS. "An attendance
/// register is safe to show anyone on the farm. A wage book is not." The
/// projection below is what stops stated money reaching a non-owner as a
/// roster; the ATTENDANCE grid stays shareable. It resolves on the exact
/// boundary Phase 0 documented (the caller's membership role) and redesigns
/// no farm privacy.
/// </summary>
public sealed class LabourRegisterViewTests
{
    private static LabourDataDto FullDto() => new(
        TopLevelIds: ["p1"],
        People:
        [
            new LabourPersonDto(
                Id: "p1", Name: "गणेश", Initial: "ग", Tone: "or", Role: "worker",
                Verified: true, Temporary: false, TaskScope: null, AppointedById: null,
                RecordedWages: 4200m, Paid: 2000m, Advance: 500m,
                TodayStatus: null, DaysThisWeek: null, MemberIds: null, Trust: null,
                Access: "review", DaysActive: 10, CleanRecord: null),
        ],
        Dashboard: new LabourDashboardDto(
            WeekLabel: "", WindowFrom: "", WindowTo: "", Insight: "",
            ManDays: 3m, ManDaysTrend: 0, Wages: 1200m, Advances: 0m, Owed: 2200m,
            Logs: 2, Pending: 1, Plots: [],
            Money: new LabourMoneyDto(4200m, 2000m, 0m, 2200m)),
        Ledger: new LabourLedgerDto(
            WeekLabel: "",
            Days: ["2026-08-24"],
            Rows:
            [
                new LabourLedgerRowDto("op:x", Guid.NewGuid(), "गणेश", "ग", "or",
                    [new LabourLedgerCellDto("full", null, null, null, false, null)]),
            ],
            CrewRows: []),
        Review:
        [
            new LabourReviewItemDto(
                "r1", "गणेश", "ग", "or", "आज", "Draft",
                new LabourPointsDto(4, null, null, 850m, []),
                Plot: null, PlotScope: "Farm"),
        ],
        Attendance: new LabourAttendanceDraftDto("", null, [], ""),
        View: "owner", Home: new LabourHomeDto(1200m, 12000m, 12, 4, 8));

    [Fact]
    public void RolesResolveToTheThreeViews()
    {
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.PrimaryOwner));
        Assert.Equal(LabourRegisterView.OwnerBook, GetLabourDataHandler.ResolveRegisterView(AppRole.SecondaryOwner));
        Assert.Equal(LabourRegisterView.CrewAttendance, GetLabourDataHandler.ResolveRegisterView(AppRole.Mukadam));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Worker));
        Assert.Equal(LabourRegisterView.OwnRow, GetLabourDataHandler.ResolveRegisterView(AppRole.Agronomist));
    }

    /// <summary>The owner's book is untouched — his record, every rupee.</summary>
    [Fact]
    public void OwnerBookPassesThroughWhole()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnerBook);

        Assert.Equal("owner", dto.View);
        Assert.Equal(2000m, dto.People[0].Paid);
        Assert.NotNull(dto.Dashboard.Money);
        Assert.Equal(850m, dto.Review[0].Points.Amount);
        Assert.Single(dto.Ledger.Rows);
        Assert.Equal(1200m, dto.Home.RojandariStated);
    }

    /// <summary>
    /// D-H8 + the Task 4.1 constraint verbatim: a मुकादम reading the register
    /// receives his crew's attendance and NO other worker's money. Money is
    /// ABSENT (null), never a fabricated ₹0 — blank is not zero.
    /// </summary>
    [Fact]
    public void CrewAttendanceViewCarriesAttendanceAndZeroMoneyMembers()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.CrewAttendance);

        Assert.Equal("crew", dto.View);
        Assert.Single(dto.Ledger.Rows);                       // attendance stays
        Assert.Null(dto.People[0].RecordedWages);             // the money roster does not
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.People[0].Advance);
        Assert.Null(dto.Dashboard.Wages);
        Assert.Null(dto.Dashboard.Advances);
        Assert.Null(dto.Dashboard.Owed);
        Assert.Null(dto.Dashboard.Money);
        Assert.Null(dto.Review[0].Points.Amount);
        Assert.Null(dto.Home.RojandariStated);
        Assert.Null(dto.Home.UkteAgreed);
        Assert.Equal(12, dto.Home.OnFarmToday);               // attendance counts are safe for anyone
    }

    /// <summary>
    /// The worker view: no identity link exists yet (FieldOperator carries no
    /// user id), so "his own row" is honestly EMPTY rows — never everyone's
    /// rows, and never any money. The view discriminator is on the wire so the
    /// narrowing lands later as data, not as a contract change.
    /// </summary>
    [Fact]
    public void OwnRowViewCarriesNoOtherRowsAndNoMoney()
    {
        var dto = GetLabourDataHandler.ApplyRegisterView(FullDto(), LabourRegisterView.OwnRow);

        Assert.Equal("own", dto.View);
        Assert.Empty(dto.Ledger.Rows);
        Assert.Empty(dto.Ledger.CrewRows);
        Assert.Single(dto.Ledger.Days);                       // the page itself is still drawn
        Assert.Null(dto.People[0].Paid);
        Assert.Null(dto.Dashboard.Money);
        Assert.Null(dto.Home.RojandariStated);
        Assert.Null(dto.Home.UkteAgreed);
    }

    // ─── F2 (task 4.2 review): the handler-level backstop ───────────────────

    private static readonly DateTime Now = new(2026, 8, 28, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid OwnerGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid MukadamGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid WorkerGuid = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid PlotGuid = Guid.Parse("88888888-8888-8888-8888-888888888888");

    /// <summary>
    /// The four facts above call ResolveRegisterView/ApplyRegisterView
    /// DIRECTLY, and every other handler-level suite drives HandleAsync as an
    /// OWNER — for whom the projection is identity. Delete the
    /// ApplyRegisterView wrapper at the handler's single Result.Success site
    /// and every one of them stays green while a मुकादम receives the whole
    /// wage book. This fact closes that hole: a Mukadam-role caller drives
    /// HandleAsync END TO END against seeded REAL money (recorded 3000, paid
    /// 500, owed 2500 in the owner's book) and pins the RETURNED DTO.
    /// Mutation-proved 2026-09-02: unwrapping the projection fails exactly
    /// this fact while the four direct-call facts stay green.
    /// </summary>
    [Fact]
    public async Task A_mukadam_caller_gets_crew_view_with_no_money_from_the_handler_itself()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmGuid, MukadamGuid, AppRole.Mukadam);
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), new UserId(WorkerGuid), AppRole.Worker, Now));
        // Real money an owner's book would show — the values the projection
        // must WITHHOLD (null), never zero out and never leak.
        repo.SeedJobCard(BuildCompletedJobCard(DateOnly.FromDateTime(Now), total: 3000m));
        repo.SeedPayoutAttributedTo(BuildCostEntry(DateOnly.FromDateTime(Now), amount: 500m), WorkerGuid);

        var result = await new GetLabourDataHandler(repo, new FixedClock(Now)).HandleAsync(
            new GetLabourDataQuery(new FarmId(FarmGuid), new UserId(MukadamGuid)));

        Assert.True(result.IsSuccess);
        var dto = result.Value!;

        Assert.Equal("crew", dto.View);

        var person = Assert.Single(dto.People);
        Assert.Null(person.RecordedWages);        // 3000m in the owner's book
        Assert.Null(person.Paid);                 //  500m in the owner's book
        Assert.Null(person.Advance);              //    0m in the owner's book — withheld is null, not 0
        Assert.Null(dto.Dashboard.Wages);         //  500m in the owner's book
        Assert.Null(dto.Dashboard.Advances);
        Assert.Null(dto.Dashboard.Owed);          // 2500m in the owner's book
        Assert.Null(dto.Dashboard.Money);         // the whole card stays owner-only
    }

    // ─── Builders + doubles (same idiom as LabourWindowScopingTests) ─────────

    private static CostEntry BuildCostEntry(DateOnly entryDate, decimal amount)
        => CostEntry.Create(
            Guid.NewGuid(), new FarmId(FarmGuid), plotId: null, cropCycleId: null,
            categoryId: "labour_misc", description: "मजुरी", amount: amount,
            currencyCode: "INR", entryDate: entryDate,
            createdByUserId: new UserId(OwnerGuid), location: null, createdAtUtc: Now);

    private static JobCard BuildCompletedJobCard(DateOnly plannedDate, decimal total)
    {
        var card = JobCard.CreateDraft(
            Guid.NewGuid(),
            new FarmId(FarmGuid),
            PlotGuid,
            cropCycleId: null,
            new UserId(OwnerGuid),
            plannedDate,
            [new JobCardLineItem("labour", 1m, new Money(total, Currency.Inr), null)],
            Now);

        card.Assign(new UserId(WorkerGuid), new UserId(OwnerGuid), AppRole.PrimaryOwner, Now);
        card.CompleteWithLog(Guid.NewGuid(), new UserId(WorkerGuid), Now);
        return card;
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<FarmMembership> _memberships = [];
        private readonly List<JobCard> _jobCards = [];
        private readonly List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)> _payouts = [];

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void SeedMembership(FarmMembership m) => _memberships.Add(m);
        public void SeedJobCard(JobCard j) => _jobCards.Add(j);
        public void SeedPayoutAttributedTo(CostEntry e, Guid workerUserId) => _payouts.Add((e, workerUserId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(_memberships.Where(m => m.FarmId == farmId).ToList());

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([]);

        public override Task<List<JobCard>> GetJobCardsForFarmAsync(
            FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
            => Task.FromResult(_jobCards.Where(j => j.FarmId == farmId).ToList());

        public override Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
            => Task.FromResult(_payouts
                .Where(p => p.CostEntry.FarmId == farmId
                    && (fromDate is null || p.CostEntry.EntryDate >= fromDate.Value)
                    && (toDateInclusive is null || p.CostEntry.EntryDate <= toDateInclusive.Value))
                .ToList());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(
            IEnumerable<Guid> costEntryIds, CancellationToken ct = default)
            => Task.FromResult(new List<FinanceCorrection>());
    }
}
