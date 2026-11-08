// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 1 (founder D-24 / D-24c / D-24a, D-26, D-29, D-79).
// The truth tables of the task record: who may make, change, cancel and answer a task, the scope CHECKs, "undated is never
// late", crew words only with an assignee, and "a headcount creates nothing" (the aggregate names no attendance, labour or
// cost type). Pure: no database, no clock.
using System.Reflection;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedWorkTests
{
    internal static readonly Guid Farm = Guid.Parse("8c100000-0000-4000-8000-0000000000f1");
    internal static readonly Guid Creator = Guid.Parse("8c100000-0000-4000-8000-000000000011");
    internal static readonly Guid Raju = Guid.Parse("8c100000-0000-4000-8000-000000000012");
    internal static readonly Guid Stranger = Guid.Parse("8c100000-0000-4000-8000-000000000013");
    internal static readonly Guid PlotA = Guid.Parse("8c100000-0000-4000-8000-0000000000a1");
    internal static readonly Guid PlotB = Guid.Parse("8c100000-0000-4000-8000-0000000000a2");
    internal static readonly DateTime Now = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);

    internal static PlannedWorkDetails Details(
        PlannedWorkScope scope = PlannedWorkScope.Plot,
        Guid[]? plots = null,
        Guid? assignee = null,
        string? crew = null,
        int? headcount = null,
        DateOnly? date = null,
        PlannedWorkLooseWhen? loose = null,
        TimeOnly? time = null) =>
        new(
            "द्राक्षाला फवारणी",
            scope,
            plots ?? (scope == PlannedWorkScope.Plot ? [PlotA] : []),
            date,
            loose,
            time,
            assignee,
            crew,
            headcount,
            QuantityText: null,
            PayMode: null,
            Note: null);

    internal static PlannedWork Make(PlannedWorkDetails? details = null, Guid? by = null) =>
        PlannedWork.Create(
            Guid.NewGuid(), new FarmId(Farm), details ?? Details(), PlannedWorkSource.Planning, PlannedWorkSourceKind.PlanForm,
            new DateOnly(2026, 11, 8), by ?? Creator, Now);

    internal static PlannedWorkSeat Seat(
        Guid? user = null,
        bool primary = false,
        bool plan = false,
        bool assign = false,
        bool seeAll = false,
        bool active = true,
        IReadOnlySet<Guid>? chosen = null) =>
        new(user ?? Stranger, active, primary, plan, assign, seeAll, chosen);

    // ── who may make ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_personal_reminder_grants_no_authority_any_active_member_may_make_one()
    {
        // No assignee, or assigned to oneself.
        PlannedWorkAuthority.MayMake(Seat(Creator), assignee: null).Should().BeTrue();
        PlannedWorkAuthority.MayMake(Seat(Creator), assignee: Creator).Should().BeTrue();
        // …but a seat that is not Active makes nothing.
        PlannedWorkAuthority.MayMake(Seat(Creator, active: false), assignee: null).Should().BeFalse();
    }

    [Theory]
    [InlineData("primary owner", true, false, false, true)]
    [InlineData("सहमालक without grants", false, false, false, false)]
    [InlineData("मुकादम with AssignWork", false, true, false, true)]
    [InlineData("मुकादम with only PlanWork", false, false, true, false)]
    [InlineData("worker with nothing", false, false, false, false)]
    public void Assigning_to_someone_else_needs_the_primary_owner_or_AssignWork(
        string seat, bool primary, bool assign, bool plan, bool expected)
    {
        seat.Should().NotBeNullOrEmpty();
        PlannedWorkAuthority.MayMake(Seat(Creator, primary: primary, assign: assign, plan: plan), Raju).Should().Be(expected);
    }

    [Fact]
    public void An_expired_AssignWork_grant_is_not_held()
    {
        // The seat is built from what is stored AND not yet ended (FarmAccessPolicy.Holds): an ended grant never reaches the rule.
        var ended = new FarmAccess(
            AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false,
            FarmPermission.AssignWork,
            AuthorityExpiresAtJson: FarmAuthorities.SerializeExpiries(
                new Dictionary<FarmPermission, DateTime> { [FarmPermission.AssignWork] = Now.AddHours(-1) }));
        var live = ended with
        {
            AuthorityExpiresAtJson = FarmAuthorities.SerializeExpiries(
                new Dictionary<FarmPermission, DateTime> { [FarmPermission.AssignWork] = Now.AddHours(1) }),
        };

        PlannedWorkAuthority.MayMake(PlannedWorkSeats.From(ended, Creator, Now), Raju).Should().BeFalse();
        PlannedWorkAuthority.MayMake(PlannedWorkSeats.From(live, Creator, Now), Raju).Should().BeTrue();
        PlannedWorkAuthority.MayMake(PlannedWorkSeats.From(null, Creator, Now), assignee: null).Should().BeFalse("no seat, no task");
    }

    [Fact]
    public void The_seat_is_the_farm_seat_never_a_label()
    {
        // सहमालक holds nothing by himself; the primary owner's label holds everything (D-26).
        var coOwner = new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, null);
        var owner = coOwner with { Role = AppRole.PrimaryOwner };

        PlannedWorkAuthority.MayMake(PlannedWorkSeats.From(coOwner, Creator, Now), Raju).Should().BeFalse();
        PlannedWorkAuthority.MayMake(PlannedWorkSeats.From(owner, Creator, Now), Raju).Should().BeTrue();
        PlannedWorkSeats.From(coOwner with { StoredPermissions = FarmPermission.SeeAllTasks }, Creator, Now)
            .HoldsSeeAllTasks.Should().BeTrue();
        PlannedWorkSeats.From(coOwner, Creator, Now).HoldsSeeAllTasks.Should().BeFalse();
    }

    // ── who may edit and cancel ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Editing_someone_elses_task_needs_the_primary_owner_or_PlanWork()
    {
        PlannedWorkAuthority.MayEdit(Seat(Stranger), Creator, Raju, Raju).Should().BeFalse();
        PlannedWorkAuthority.MayEdit(Seat(Stranger, plan: true), Creator, Raju, Raju).Should().BeTrue("PlanWork changes the plan");
        PlannedWorkAuthority.MayEdit(Seat(Stranger, primary: true), Creator, Raju, Raju).Should().BeTrue();
        PlannedWorkAuthority.MayCancel(Seat(Stranger), Creator, Raju).Should().BeFalse();
        PlannedWorkAuthority.MayCancel(Seat(Stranger, plan: true), Creator, Raju).Should().BeTrue();
        PlannedWorkAuthority.MayCancel(Seat(Stranger, primary: true), Creator, Raju).Should().BeTrue();
    }

    [Fact]
    public void Moving_someone_elses_task_to_another_person_also_needs_AssignWork()
    {
        var other = Guid.NewGuid();
        PlannedWorkAuthority.MayEdit(Seat(Stranger, plan: true), Creator, Raju, other).Should().BeFalse();
        PlannedWorkAuthority.MayEdit(Seat(Stranger, plan: true, assign: true), Creator, Raju, other).Should().BeTrue();
    }

    [Fact]
    public void The_creator_changes_his_own_while_he_still_holds_what_he_used_to_make_it()
    {
        // A personal reminder: always his.
        PlannedWorkAuthority.MayEdit(Seat(Creator), Creator, null, null).Should().BeTrue();
        PlannedWorkAuthority.MayCancel(Seat(Creator), Creator, null).Should().BeTrue();
        PlannedWorkAuthority.MayCancel(Seat(Creator), Creator, Creator).Should().BeTrue();
        // Work he handed to Raju: only while he still holds AssignWork.
        PlannedWorkAuthority.MayEdit(Seat(Creator, assign: true), Creator, Raju, Raju).Should().BeTrue();
        PlannedWorkAuthority.MayEdit(Seat(Creator), Creator, Raju, Raju).Should().BeFalse();
        PlannedWorkAuthority.MayCancel(Seat(Creator, assign: true), Creator, Raju).Should().BeTrue();
        PlannedWorkAuthority.MayCancel(Seat(Creator), Creator, Raju).Should().BeFalse();
        // An ended seat changes nothing.
        PlannedWorkAuthority.MayEdit(Seat(Creator, active: false), Creator, null, null).Should().BeFalse();
    }

    // ── the record's own shape ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Scope_and_plot_rows_agree()
    {
        Make(Details(PlannedWorkScope.Plot, [PlotA])).Plots.Should().ContainSingle();
        Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB])).Plots.Should().HaveCount(2);
        Make(Details(PlannedWorkScope.Farm)).Plots.Should().BeEmpty();
        Make(Details(PlannedWorkScope.Unspecified)).Plots.Should().BeEmpty();

        var bad = new[]
        {
            Details(PlannedWorkScope.Plot, []),
            Details(PlannedWorkScope.Plot, [PlotA, PlotB]),
            Details(PlannedWorkScope.MultiPlot, [PlotA]),
            Details(PlannedWorkScope.Farm, [PlotA]),
            Details(PlannedWorkScope.Unspecified, [PlotA]),
            Details(PlannedWorkScope.MultiPlot, [PlotA, PlotA]),
        };
        foreach (var details in bad)
        {
            FluentActions.Invoking(() => Make(details)).Should().Throw<ArgumentException>($"{details.Scope} with {details.PlotIds.Count} plots");
        }
    }

    [Fact]
    public void A_task_has_a_date_or_a_loose_word_never_both_and_a_time_needs_a_date()
    {
        FluentActions.Invoking(() => Make(Details(date: new DateOnly(2026, 11, 9), loose: PlannedWorkLooseWhen.Week)))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => Make(Details(time: new TimeOnly(7, 30)))).Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => Make(Details(loose: PlannedWorkLooseWhen.Week, time: new TimeOnly(7, 30)))).Should().Throw<ArgumentException>();
        Make(Details(date: new DateOnly(2026, 11, 9), time: new TimeOnly(7, 30))).PlannedTime.Should().Be(new TimeOnly(7, 30));
    }

    [Fact]
    public void Undated_and_loose_are_never_late()
    {
        var today = new DateOnly(2026, 11, 8);
        Make(Details()).IsLate(today).Should().BeFalse("no date: never overdue (D-24c)");
        Make(Details(loose: PlannedWorkLooseWhen.Anytime)).IsLate(today.AddYears(1)).Should().BeFalse();
        Make(Details(loose: PlannedWorkLooseWhen.Week)).IsLate(today.AddYears(1)).Should().BeFalse();
        Make(Details(date: today)).IsLate(today).Should().BeFalse("today is not late");
        Make(Details(date: today.AddDays(-1))).IsLate(today).Should().BeTrue();

        var cancelled = Make(Details(date: today.AddDays(-1)));
        cancelled.Cancel(Creator, "ठरवलं नाही", Now);
        cancelled.IsLate(today).Should().BeFalse("closed work is never late");
    }

    [Fact]
    public void Crew_fields_need_an_assignee()
    {
        FluentActions.Invoking(() => Make(Details(crew: "मुकादम आणि ५ बायका"))).Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => Make(Details(headcount: 5))).Should().Throw<ArgumentException>();
        var crew = Make(Details(assignee: Raju, crew: "मुकादम आणि ५ बायका", headcount: 6));
        crew.CrewText.Should().Be("मुकादम आणि ५ बायका");
        crew.ExpectedHeadcount.Should().Be(6);
        foreach (var bad in new[] { 0, -1, 1000 })
        {
            FluentActions.Invoking(() => Make(Details(assignee: Raju, headcount: bad))).Should().Throw<ArgumentException>($"headcount {bad}");
        }
    }

    [Fact]
    public void Headcount_creates_nothing()
    {
        // D-24a / P4: the aggregate names no attendance, labour, cost, job-card, wage or payment type, in any member.
        var forbidden = new[] { "Attendance", "Labour", "Cost", "JobCard", "Wage", "Payment", "Finance", "Ledger" };
        var types = new[] { typeof(PlannedWork), typeof(PlannedWorkPlot), typeof(PlannedWorkDetails) };
        var named = new List<Type>();
        foreach (var type in types)
        {
            const BindingFlags all = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
            named.AddRange(type.GetProperties(all).Select(p => p.PropertyType));
            named.AddRange(type.GetFields(all).Select(f => f.FieldType));
            foreach (var method in type.GetMethods(all).Cast<MethodBase>().Concat(type.GetConstructors(all)))
            {
                named.AddRange(method.GetParameters().Select(p => p.ParameterType));
                if (method is MethodInfo info)
                {
                    named.Add(info.ReturnType);
                }
            }
        }

        named.Should().NotBeEmpty();
        foreach (var type in named.SelectMany(Flatten).Distinct())
        {
            var text = $"{type.Namespace}.{type.Name}";
            forbidden.Any(word => text.Contains(word, StringComparison.Ordinal)).Should().BeFalse($"{text} is not for planned work to know");
        }

        // And the words stay words: pay mode, quantity and crew text are stored as given and change nothing else.
        var task = Make(Details(assignee: Raju, headcount: 8) with { PayMode = PlannedWorkPayMode.Daily, QuantityText = "२ एकर" });
        task.PayMode.Should().Be(PlannedWorkPayMode.Daily);
        task.QuantityText.Should().Be("२ एकर");
        task.Plots.Should().ContainSingle().Which.Status.Should().Be(PlannedWorkPlotStatus.Pending);
    }

    private static IEnumerable<Type> Flatten(Type type)
    {
        yield return type;
        if (type.HasElementType)
        {
            foreach (var inner in Flatten(type.GetElementType()!))
            {
                yield return inner;
            }
        }

        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments().SelectMany(Flatten))
            {
                yield return argument;
            }
        }
    }

    // ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_reminder_is_open_and_assigned_work_starts_assigned()
    {
        Make().Status.Should().Be(PlannedWorkStatus.Open);
        Make(Details(assignee: Raju)).Status.Should().Be(PlannedWorkStatus.Assigned);
        Make().RecordedOn.Should().Be(new DateOnly(2026, 11, 8), "the farm-local day it was made (D-29)");
    }

    [Fact]
    public void Seen_and_accept_are_the_assignees_only_and_stamped_once()
    {
        var task = Make(Details(assignee: Raju));

        task.MarkSeen(Stranger, Now).Should().Be(PlannedWorkStep.NotAssignee);
        task.MarkSeen(Raju, Now.AddMinutes(1)).Should().Be(PlannedWorkStep.Applied);
        task.Status.Should().Be(PlannedWorkStatus.Seen);
        task.SeenAtUtc.Should().Be(Now.AddMinutes(1));
        task.MarkSeen(Raju, Now.AddMinutes(9)).Should().Be(PlannedWorkStep.AlreadyDone);
        task.SeenAtUtc.Should().Be(Now.AddMinutes(1), "stamped once");

        task.Accept(Stranger, Now).Should().Be(PlannedWorkStep.NotAssignee);
        task.Accept(Raju, Now.AddMinutes(2)).Should().Be(PlannedWorkStep.Applied);
        task.Status.Should().Be(PlannedWorkStatus.Accepted);
        task.Accept(Raju, Now.AddMinutes(8)).Should().Be(PlannedWorkStep.AlreadyDone);
        task.AcceptedAtUtc.Should().Be(Now.AddMinutes(2));
        task.MarkSeen(Raju, Now.AddMinutes(10)).Should().Be(PlannedWorkStep.AlreadyDone, "seen after accepted changes nothing");
        task.Status.Should().Be(PlannedWorkStatus.Accepted);
    }

    [Fact]
    public void Accepting_without_seeing_stamps_seen_too()
    {
        var task = Make(Details(assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(3)).Should().Be(PlannedWorkStep.Applied);
        task.SeenAtUtc.Should().Be(Now.AddMinutes(3));
        task.AcceptedAtUtc.Should().Be(Now.AddMinutes(3));
    }

    [Fact]
    public void A_reminder_has_no_assignee_to_see_or_accept_it()
    {
        Make().MarkSeen(Creator, Now).Should().Be(PlannedWorkStep.NotAssignee);
        Make().Accept(Creator, Now).Should().Be(PlannedWorkStep.NotAssignee);
    }

    [Fact]
    public void Cancel_closes_the_work_once_and_a_closed_task_takes_no_step()
    {
        var task = Make(Details(assignee: Raju));
        task.Cancel(Creator, "पाऊस आला", Now.AddMinutes(1)).Should().Be(PlannedWorkStep.Applied);
        task.Status.Should().Be(PlannedWorkStatus.Cancelled);
        task.CancelledByUserId.Should().Be(Creator);
        task.CancelReason.Should().Be("पाऊस आला");
        task.Cancel(Stranger, "दुसरं", Now.AddMinutes(5)).Should().Be(PlannedWorkStep.AlreadyDone);
        task.CancelledByUserId.Should().Be(Creator, "stamped once");

        task.Accept(Raju, Now.AddMinutes(6)).Should().Be(PlannedWorkStep.Closed);
        task.MarkSeen(Raju, Now.AddMinutes(6)).Should().Be(PlannedWorkStep.Closed);
        task.Edit(Details(), Now.AddMinutes(7)).Should().Be(PlannedWorkStep.Closed);
    }

    [Fact]
    public void Editing_moves_the_clock_forward_and_a_reassign_resets_the_answers_and_remembers_the_old_assignee()
    {
        var task = Make(Details(assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(1));
        var before = task.ModifiedAtUtc;
        var other = Guid.NewGuid();

        task.Edit(Details(assignee: other), Now.AddMinutes(2)).Should().Be(PlannedWorkStep.Applied);

        task.AssigneeUserId.Should().Be(other);
        task.Status.Should().Be(PlannedWorkStatus.Assigned);
        task.SeenAtUtc.Should().BeNull();
        task.AcceptedAtUtc.Should().BeNull();
        task.FormerAssigneeUserIds.Should().Equal(Raju);
        task.ModifiedAtUtc.Should().BeAfter(before);
        (task.ModifiedAtUtc.Ticks % TimeSpan.TicksPerSecond).Should().NotBe(0, "never exactly on a whole second (the cursor rule)");
    }

    [Fact]
    public void Editing_the_words_keeps_the_answers_of_the_same_assignee()
    {
        var task = Make(Details(assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(1));

        task.Edit(Details(assignee: Raju, date: new DateOnly(2026, 11, 20)), Now.AddMinutes(2));

        task.Status.Should().Be(PlannedWorkStatus.Accepted);
        task.PlannedDate.Should().Be(new DateOnly(2026, 11, 20));
        task.FormerAssigneeUserIds.Should().BeEmpty();
    }

    [Fact]
    public void Moving_to_other_plots_drops_the_old_rows_and_brings_back_a_dropped_plot()
    {
        var task = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB]));

        task.Edit(Details(PlannedWorkScope.Plot, [PlotB]), Now.AddMinutes(1));
        task.Plots.Where(p => p.Status != PlannedWorkPlotStatus.Dropped).Select(p => p.PlotId).Should().Equal(PlotB);
        task.Plots.Single(p => p.PlotId == PlotA).Status.Should().Be(PlannedWorkPlotStatus.Dropped, "no row is ever deleted");

        task.Edit(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB]), Now.AddMinutes(2));
        task.Plots.Should().HaveCount(2).And.OnlyContain(p => p.Status == PlannedWorkPlotStatus.Pending);
    }

    [Fact]
    public void A_non_assignee_is_not_the_assignee_on_a_closed_task_too_L005()
    {
        // Fix round 1 (L005): the assignee is checked BEFORE the state, so the old assignee's late answer to a cancelled task
        // is still "not yours" (ShramSafal.Forbidden), never "changed first".
        var task = Make(Details(assignee: Raju));
        task.Cancel(Creator, null, Now);
        task.MarkSeen(Stranger, Now.AddMinutes(1)).Should().Be(PlannedWorkStep.NotAssignee);
        task.Accept(Stranger, Now.AddMinutes(1)).Should().Be(PlannedWorkStep.NotAssignee);
        task.MarkSeen(Raju, Now.AddMinutes(1)).Should().Be(PlannedWorkStep.Closed, "the real assignee meets the closed state");
        task.Accept(Raju, Now.AddMinutes(1)).Should().Be(PlannedWorkStep.Closed);
        Make().Accept(Creator, Now).Should().Be(PlannedWorkStep.NotAssignee);
    }

    // ── Task 6: the authorities are live ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Switchable_contains_PlanWork_AssignWork_SeeAllTasks()
    {
        FarmAuthorities.Switchable.Should().Contain([FarmAuthority.PlanWork, FarmAuthority.AssignWork, FarmAuthority.SeeAllTasks]);
        FarmAuthorities.All.Should().Contain(FarmAuthority.SeeAllTasks);
    }

    [Fact]
    public void SeeAllTasks_takes_the_next_free_bit_and_no_stored_bit_moves()
    {
        ((int)FarmPermission.SeeAllTasks).Should().Be(1 << 11);
        FarmAuthorities.BitOf(FarmAuthority.SeeAllTasks).Should().Be(FarmPermission.SeeAllTasks);
        FarmPermissionDefaults.All.HasFlag(FarmPermission.SeeAllTasks).Should().BeTrue();
        // Persisted values never move (R19).
        ((int)FarmPermission.SeeMoney).Should().Be(1);
        ((int)FarmPermission.SeeWages).Should().Be(2);
        ((int)FarmPermission.AddCost).Should().Be(4);
        ((int)FarmPermission.PlanWork).Should().Be(8);
        ((int)FarmPermission.Invite).Should().Be(16);
        ((int)FarmPermission.AddTestRecord).Should().Be(32);
        ((int)FarmPermission.AssignWork).Should().Be(64);
        ((int)FarmPermission.ConfirmRecords).Should().Be(128);
        ((int)FarmPermission.EditFarmSetup).Should().Be(256);
        ((int)FarmPermission.ManageScheduleTemplates).Should().Be(512);
        ((int)FarmPermission.ReviewMoney).Should().Be(1024);
        FarmPermissionDefaults.Names(FarmPermission.SeeAllTasks).Should().Equal("SeeAllTasks");
        FarmPermissionDefaults.TryParse(["seeAllTasks"], out var parsed).Should().BeTrue();
        parsed.Should().Be(FarmPermission.SeeAllTasks);
    }
}
