// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 3 (founder D-73, 2026-11-06: "You, plus the people
// you give 'कामाचं नियोजन करणे'"). The truth table of the ONE gate every planning door asks: the primary account holder,
// or a seat holding PlanWork (not yet ended) — never a label — plus the MU-4 plot rule; and the MU §11.2 late window for
// a change the phone made offline before PlanWork ended.
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleChangeGateTests
{
    private static readonly Guid Farm = Guid.Parse("8b100000-0000-4000-8000-0000000000f1");
    private static readonly Guid Person = Guid.Parse("8b100000-0000-4000-8000-000000000011");
    private static readonly Guid HisPlot = Guid.Parse("8b100000-0000-4000-8000-0000000000a1");
    private static readonly Guid OtherPlot = Guid.Parse("8b100000-0000-4000-8000-0000000000a2");
    private static readonly DateTime Now = new(2026, 11, 6, 6, 0, 0, DateTimeKind.Utc);

    private static FarmAccess Seat(
        AppRole role,
        FarmPermission? stored = null,
        DateTime? planWorkEndsAtUtc = null,
        MembershipStatus status = MembershipStatus.Active,
        bool registrant = false,
        IReadOnlyCollection<Guid>? chosenPlots = null) =>
        new(
            role,
            status,
            registrant,
            stored,
            AuthorityExpiresAtJson: planWorkEndsAtUtc is { } end
                ? FarmAuthorities.SerializeExpiries(new Dictionary<FarmPermission, DateTime> { [FarmPermission.PlanWork] = end })
                : null,
            PlotScope: chosenPlots is null ? MembershipPlotScope.AllPlots : MembershipPlotScope.ChosenPlots,
            ScopePlotIds: chosenPlots);

    public static TheoryData<string, FarmAccess?, bool> NowRows() => new()
    {
        { "the primary owner (label PrimaryOwner)", Seat(AppRole.PrimaryOwner), true },
        { "the farm's registrant, whatever his seat says", Seat(AppRole.Worker, registrant: true), true },
        { "a मुकादम without PlanWork", Seat(AppRole.Mukadam), false },
        { "a मुकादम with PlanWork", Seat(AppRole.Mukadam, FarmPermission.PlanWork), true },
        { "a सहमालक without PlanWork (a label grants nothing, D-26)", Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney), false },
        { "a कामगार with PlanWork", Seat(AppRole.Worker, FarmPermission.PlanWork), true },
        { "PlanWork that ended yesterday", Seat(AppRole.Mukadam, FarmPermission.PlanWork, Now.AddDays(-1)), false },
        { "PlanWork that ends tomorrow", Seat(AppRole.Mukadam, FarmPermission.PlanWork, Now.AddDays(1)), true },
        { "a paused seat holding PlanWork", Seat(AppRole.Mukadam, FarmPermission.PlanWork, status: MembershipStatus.Suspended), false },
        { "a waiting request", Seat(AppRole.Mukadam, FarmPermission.PlanWork, status: MembershipStatus.PendingApproval), false },
        { "no seat at all", null, false },
    };

    [Theory]
    [MemberData(nameof(NowRows))]
    public async Task Who_may_change_a_plots_schedule_now(string who, FarmAccess? access, bool allowed)
    {
        var repo = new GateRepo(access);

        var decision = await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, decidedAtUtc: null);

        Assert.True((decision.Refusal is null) == allowed, who);
        Assert.False(decision.AcceptedAfterAuthorityEnded, who);
        if (!allowed)
        {
            Assert.Equal(ShramSafalErrors.Forbidden, decision.Refusal);
        }

        // The authority half alone (the planned-activity doors and plan generation) answers the same.
        Assert.Equal(allowed, await ScheduleChangeGate.MayChangeAsync(repo, Farm, Person, Now));
        Assert.Equal(allowed, await ScheduleChangeGate.RefuseAsync(repo, Farm, HisPlot, Person, Now) is null);
    }

    [Fact]
    public async Task A_chosen_plots_seat_changes_only_his_own_plots()
    {
        var repo = new GateRepo(Seat(AppRole.Mukadam, FarmPermission.PlanWork, chosenPlots: [HisPlot])) { ReadsByPlace = true };

        Assert.Null((await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, null)).Refusal);
        Assert.Equal(
            ShramSafalErrors.PlotScopeForbidden,
            (await ScheduleChangeGate.DecideAsync(repo, Farm, OtherPlot, Person, Now, null)).Refusal);
    }

    [Fact]
    public async Task A_chosen_plots_seat_without_PlanWork_is_refused_on_his_own_plot_too()
    {
        var repo = new GateRepo(Seat(AppRole.Mukadam, chosenPlots: [HisPlot])) { ReadsByPlace = true };

        Assert.Equal(
            ShramSafalErrors.Forbidden,
            (await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, null)).Refusal);
    }

    [Fact]
    public async Task A_change_made_before_PlanWork_ended_counts_and_is_flagged()
    {
        var ended = Now.AddDays(-2);
        var repo = new GateRepo(Seat(AppRole.Mukadam, FarmPermission.PlanWork, ended));

        // Made on the phone a day before the end, received two days after it: inside the late window (MU §11.2).
        var late = await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, decidedAtUtc: ended.AddDays(-1));
        Assert.Null(late.Refusal);
        Assert.True(late.AcceptedAfterAuthorityEnded);
        Assert.Equal(ended, late.AuthorityEndedAtUtc);
        Assert.Equal(ended.AddDays(-1), late.DecidedAtUtc);

        // Made after the end: refused (the sync layer keeps it whole for the owner; nothing is dropped).
        var after = await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, decidedAtUtc: ended.AddHours(1));
        Assert.Equal(ShramSafalErrors.Forbidden, after.Refusal);

        // No statement of when (an older phone, or an online door): only "held now" counts.
        Assert.Equal(ShramSafalErrors.Forbidden, (await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, null)).Refusal);

        // A statement "in the future" is read as now — after the end: refused.
        Assert.Equal(
            ShramSafalErrors.Forbidden,
            (await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, Now.AddDays(3))).Refusal);
    }

    [Fact]
    public async Task A_change_made_long_before_the_end_or_received_too_late_is_refused()
    {
        // Made 10 days before the end (window: 7 days before).
        var endedRecently = Now.AddDays(-1);
        var repo = new GateRepo(Seat(AppRole.Mukadam, FarmPermission.PlanWork, endedRecently));
        Assert.Equal(
            ShramSafalErrors.Forbidden,
            (await ScheduleChangeGate.DecideAsync(repo, Farm, HisPlot, Person, Now, endedRecently.AddDays(-10))).Refusal);

        // Received 9 days after the end (window: 7 days after).
        var endedLongAgo = Now.AddDays(-9);
        var old = new GateRepo(Seat(AppRole.Mukadam, FarmPermission.PlanWork, endedLongAgo));
        Assert.Equal(
            ShramSafalErrors.Forbidden,
            (await ScheduleChangeGate.DecideAsync(old, Farm, HisPlot, Person, Now, endedLongAgo.AddDays(-1))).Refusal);
    }

    [Fact]
    public async Task A_chosen_plots_seat_is_never_allowed_on_a_season_the_gate_cannot_see()
    {
        // lane L8b-1 fix round 1 (review H1) — a season id the farm's scope cannot see (missing, or another farm's under
        // RLS) used to answer "allowed": the plot rule then asked nothing. It is refused, never waved through.
        var repo = new GateRepo(Seat(AppRole.Mukadam, FarmPermission.PlanWork, chosenPlots: [HisPlot])) { ReadsByPlace = true };

        Assert.NotNull(await PlotScopeGate.RefuseCycleAsync(repo, Farm, Guid.NewGuid(), Person, Now));
    }

    [Fact]
    public void PlanWork_is_a_switch_the_owner_gives()
    {
        Assert.Contains(FarmAuthority.PlanWork, FarmAuthorities.Switchable);
        Assert.Contains(FarmAuthority.AssignWork, FarmAuthorities.Switchable); // lane L8c-1: assign work is enforced now
        Assert.Equal(FarmAuthority.PlanWork, ScheduleChangeGate.Authority);
    }

    /// <summary>One seat on one farm; by place only when the test says so (the MU-4 pre-filter).</summary>
    private sealed class GateRepo(FarmAccess? access) : Work.Handlers.StubShramSafalRepository, IShramSafalRepository
    {
        public bool ReadsByPlace { get; init; }

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(farmId == Farm && userId == Person ? access : null);

        public Task<IReadOnlyList<Guid>> GetFarmsMaybeReadByPlaceAsync(
            Guid userId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<Guid>>(ReadsByPlace ? farmIds.ToList() : []);

        // No season is visible to this double: what a farm's scope answers for a season it cannot see.
        public override Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult<ShramSafal.Domain.Crops.CropCycle?>(null);
    }
}
