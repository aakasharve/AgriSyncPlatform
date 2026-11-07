// spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (the owner's kept-work card; MU-2 N-3; PRV N-1)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Application.UseCases.Memberships.KeptWork;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// spec: plr-d10 lane MU-1 - what the owner's kept-work read answers, who may ask, what it never carries; the NotInForce
/// closure (MU-2 review N-3); and the ledger's phrase removal that no longer splits a task on " · " (PRV REVIEW-4 N-1).
/// The same read is proven against real Postgres (E4 both ways) in PersonalInvitationRealPostgresTests.MuOne.
/// </summary>
public sealed class KeptWorkMuOneTests
{
    private static readonly DateTime Now = new(2026, 11, 7, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000f1");
    private static readonly Guid Owner = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000a1");
    private static readonly Guid CoOwner = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000a2");
    private static readonly Guid Worker = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000a3");

    private static AuditEvent Row(string action, string entityType, object payload, Guid actor, DateTime? at = null)
    {
        var row = AuditEventFactory.Create(
            entityType: entityType, entityId: Guid.NewGuid(), action: action, actorUserId: actor, actorRole: "worker",
            payload: payload, farmId: Farm, clientCommandId: null, appVersion: "t", deviceId: "d", ipHash: "sha256:t",
            sourceAiJobId: null);
        // The factory stamps "now"; the window test needs older rows.
        if (at is { } when)
        {
            typeof(AuditEvent).GetProperty(nameof(AuditEvent.OccurredAtUtc))!.SetValue(row, when);
        }

        return row;
    }

    [Fact]
    public async Task The_primary_holder_reads_what_was_kept_with_what_who_when_and_why_and_never_the_work_itself()
    {
        var repo = new KeptRepo(
            Row("WorkKeptForOwner", "RefusedSyncMutation",
                new { mutationType = "add_cost_entry", refusal = "ShramSafal.Forbidden", mutation = new { amount = 98765, note = "secret" } }, Worker, Now),
            Row("AcceptedAfterResponsibilityEnded", "AttendanceMark",
                new { authority = "TakeAttendance", authorityEndedAtUtc = Now.AddDays(-1) }, Worker, Now),
            Row("WorkKeptForOwnerDailyCapReached", "RefusedSyncMutation", new { farmDay = "2026-11-07", cap = 200 }, Worker, Now),
            Row("SomethingElse", "X", new { }, Worker, Now));
        repo.Primary.Add(Owner);

        var result = await new GetKeptWorkHandler(repo, new FixedClock(Now)).HandleAsync(Farm, Owner);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Select(i => i.Kind).Should().BeEquivalentTo(
            [GetKeptWorkHandler.KindRefused, GetKeptWorkHandler.KindArrivedLate, GetKeptWorkHandler.KindCapReached]);
        var refused = result.Value!.Single(i => i.Kind == GetKeptWorkHandler.KindRefused);
        refused.What.Should().Be("add_cost_entry");
        refused.Why.Should().Be("ShramSafal.Forbidden");
        refused.WhoName.Should().Be("रमेश");
        refused.WhoUserId.Should().Be(Worker);
        var late = result.Value!.Single(i => i.Kind == GetKeptWorkHandler.KindArrivedLate);
        late.Why.Should().Be("TakeAttendance");
        late.AuthorityEndedAtUtc.Should().Be(Now.AddDays(-1));
        System.Text.Json.JsonSerializer.Serialize(result.Value).Should().NotContain("98765").And.NotContain("secret",
            "the kept mutation's body is never sent - only what / who / when / why");
    }

    [Theory]
    [InlineData("coowner")]
    [InlineData("worker")]
    [InlineData("stranger")]
    public async Task Only_the_primary_holder_may_read_it_everyone_else_is_forbidden_with_no_rows(string who)
    {
        var repo = new KeptRepo(Row("WorkKeptForOwner", "RefusedSyncMutation", new { mutationType = "x" }, Worker, Now));
        repo.Primary.Add(Owner);
        var caller = who switch { "coowner" => CoOwner, "worker" => Worker, _ => Guid.NewGuid() };

        var result = await new GetKeptWorkHandler(repo, new FixedClock(Now)).HandleAsync(Farm, caller);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().Be(ShramSafalErrors.Forbidden);
        repo.RowsRead.Should().Be(0, "the audit rows are not even read for anyone but the primary holder");
    }

    [Fact]
    public async Task It_reads_only_the_last_window_newest_first_and_at_most_the_cap()
    {
        var rows = Enumerable.Range(0, GetKeptWorkHandler.MaxRows + 20)
            .Select(i => Row("WorkKeptForOwner", "RefusedSyncMutation", new { mutationType = $"m{i}" }, Worker, Now.AddMinutes(-i)))
            .Append(Row("WorkKeptForOwner", "RefusedSyncMutation", new { mutationType = "old" }, Worker,
                Now.AddDays(-(GetKeptWorkHandler.WindowDays + 5))))
            .ToArray();
        var repo = new KeptRepo(rows);
        repo.Primary.Add(Owner);

        var result = await new GetKeptWorkHandler(repo, new FixedClock(Now)).HandleAsync(Farm, Owner);

        result.Value!.Should().HaveCount(GetKeptWorkHandler.MaxRows);
        result.Value!.Select(i => i.What).Should().NotContain("old");
        result.Value!.First().What.Should().Be("m0");
    }

    [Fact]
    public async Task A_row_whose_payload_cannot_be_read_is_still_listed_with_no_reason()
    {
        var bad = Row("WorkKeptForOwner", "RefusedSyncMutation", new { }, Worker, Now);
        typeof(AuditEvent).GetProperty(nameof(AuditEvent.Payload))!.SetValue(bad, "{not json");
        var repo = new KeptRepo(bad);
        repo.Primary.Add(Owner);

        var result = await new GetKeptWorkHandler(repo, new FixedClock(Now)).HandleAsync(Farm, Owner);

        result.Value!.Should().ContainSingle().Which.Why.Should().BeNull("never a guessed reason");
    }

    // ── MU-2 N-3: an authority that needs one that is not in force is not in force either ──────────────────

    [Fact]
    public void Review_money_is_not_in_force_wherever_money_is_not()
    {
        FarmAuthorities.NotInForce(AppRole.Worker, MembershipPlotScope.AllPlots)
            .Should().Contain([FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ReviewMoney]);
        FarmAuthorities.NotInForce(AppRole.Mukadam, MembershipPlotScope.OwnWork)
            .Should().Contain(FarmAuthority.ReviewMoney);
        FarmAuthorities.NotInForce(AppRole.SecondaryOwner, MembershipPlotScope.AllPlots)
            .Should().NotContain(FarmAuthority.ReviewMoney, "money is in force for him");
        FarmAuthorities.NotInForce(AppRole.PrimaryOwner, MembershipPlotScope.OwnWork).Should().BeEmpty();
    }

    // ── PRV N-1: a task that holds " · " ──────────────────────────────────────────────────────────────────

    [Fact]
    public void A_withheld_phrase_that_itself_holds_a_join_is_removed_whole_not_in_two_fragments()
    {
        // The money task is the WHOLE phrase "फवारणी · ₹500 खर्च" (spoken with a dot in it): both halves go, "खत" stays.
        GetLabourDataHandler.WithoutPhrases("खत · फवारणी · ₹500 खर्च", new HashSet<string> { "फवारणी · ₹500 खर्च" }).Should().Be("खत");
        GetLabourDataHandler.WithoutPhrases("खत · फवारणी", new HashSet<string> { "फवारणी" }).Should().Be("खत");
        GetLabourDataHandler.WithoutPhrases("फवारणी · खत", new HashSet<string> { "फवारणी" }).Should().Be("खत");
        GetLabourDataHandler.WithoutPhrases("फवारणी", new HashSet<string> { "फवारणी" }).Should().BeEmpty();
        // A phrase inside another word is not removed.
        GetLabourDataHandler.WithoutPhrases("खतफवारणी · खत", new HashSet<string> { "फवारणी" }).Should().Be("खतफवारणी · खत");
        GetLabourDataHandler.WithoutPhrases("a · b · c", new HashSet<string> { "b" }).Should().Be("a · c");
    }

    // ── doubles ──────────────────────────────────────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    private sealed class KeptRepo(params AuditEvent[] rows) : StubShramSafalRepository, IShramSafalRepository
    {
        public HashSet<Guid> Primary { get; } = [];
        public int RowsRead { get; private set; }

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(
                farmId != Farm ? null
                : Primary.Contains(userId) ? new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, true, null)
                : userId == CoOwner ? new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.SeeMoney | FarmPermission.SeeWages)
                : userId == Worker ? new FarmAccess(AppRole.Worker, MembershipStatus.Active, false, null)
                : null);

        Task<IReadOnlyList<AuditEvent>> IShramSafalRepository.GetAuditEventsForFarmByActionsAsync(
            Guid farmId, IReadOnlyCollection<string> actions, DateTime sinceUtc, int limit, CancellationToken ct)
        {
            RowsRead++;
            return Task.FromResult<IReadOnlyList<AuditEvent>>(rows
                .Where(r => r.FarmId == farmId && actions.Contains(r.Action) && r.OccurredAtUtc >= sinceUtc)
                .OrderByDescending(r => r.OccurredAtUtc).Take(limit).ToList());
        }

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<SyncOperatorDto>>([new SyncOperatorDto(Worker, "रमेश", "Worker")]);
    }
}
