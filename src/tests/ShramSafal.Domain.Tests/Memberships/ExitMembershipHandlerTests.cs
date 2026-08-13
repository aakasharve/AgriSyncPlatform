// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// <c>ExitMembershipHandler</c> — the DECISIONS. What must be true before a line
/// saying someone left is written, and what must be true when it is not.
///
/// <para><b>What this file deliberately does NOT claim.</b> It cannot prove the
/// exit persists: an in-memory double hands back the same object it was seeded
/// with, so a mutation is "visible" here whether or not EF would have written it.
/// That is exactly how the original defect survived — the handler looked correct
/// against a double while <c>AsNoTracking()</c> threw the write away in
/// production. Persistence, the loss of access, and the RLS behaviour are proven
/// against real Postgres as <c>agrisync_app</c> in
/// <c>ShramSafal.Sync.IntegrationTests.Memberships.ExitMembershipRealPostgresTests</c>.
/// What lives here is everything that is a decision rather than a write.</para>
/// </summary>
public sealed class ExitMembershipHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 13, 9, 0, 0, DateTimeKind.Utc);

    private static readonly Guid FarmA = Guid.Parse("ea000000-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("e1111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerA = Guid.Parse("e3333333-3333-3333-3333-333333333333");

    // ═════════════════════════════════════════════════════════════════════════
    // Idempotency — a retry is not a second decision.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Re_exiting_an_already_exited_member_succeeds_and_writes_no_second_audit_row()
    {
        var (repo, handler) = Build();
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);

        var first = await handler.HandleAsync(new FarmId(FarmA), new UserId(WorkerA));
        first.IsSuccess.Should().BeTrue();
        first.Value!.AlreadyExited.Should().BeFalse();

        var second = await handler.HandleAsync(new FarmId(FarmA), new UserId(WorkerA));

        second.IsSuccess.Should().BeTrue(
            "a farmer on a rural connection re-sending the same request must converge, not be told "
            + "something went wrong about a farm they have demonstrably already left");
        second.Value!.AlreadyExited.Should().BeTrue();
        second.Value.MembershipId.Should().Be(first.Value.MembershipId);

        repo.AuditEvents.Count(e => e.Action == "MemberExited").Should().Be(1,
            "leaving once is one event in history; re-sending the request is not a second departure (P3)");
    }

    [Fact]
    public async Task The_repeat_exit_reaches_the_terminal_row_at_all_only_because_the_read_is_status_blind()
    {
        var (repo, handler) = Build();
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);
        await handler.HandleAsync(new FarmId(FarmA), new UserId(WorkerA));

        // The port's OTHER membership reads all filter Revoked/Exited out. If the
        // exit path used one of them the row below would be invisible and the
        // handler would answer "you are not a member of this farm".
        (await repo.GetFarmMembershipAsync(FarmA, WorkerA)).Should().BeNull();
        (await repo.GetTrackedFarmMembershipIncludingTerminalAsync(FarmA, WorkerA))
            .Should().NotBeNull().And.Match<FarmMembership>(m => m.IsTerminal);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Nothing is falsified when the write cannot happen.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task A_live_membership_the_request_cannot_scope_to_is_refused_and_leaves_no_trace()
    {
        var repo = new StubShramSafalRepository();
        var scope = StubCallerFarmTenantScope.Refusing();
        var handler = new ExitMembershipHandler(
            repo, new FixedClock(Now), new CapturingAnalyticsWriter(), scope);
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);

        var result = await handler.HandleAsync(new FarmId(FarmA), new UserId(WorkerA));

        result.IsFailure.Should().BeTrue(
            "no agrisync.farm_id means the UPDATE matches zero rows — answering 200 there is the "
            + "exact defect this handler was rewritten to remove");
        result.Error.Code.Should().Be("exit.forbidden");

        repo.AuditEvents.Should().BeEmpty("an audit trail that records things that did not happen is "
            + "worse than no audit trail");
        repo.SaveCalls.Should().Be(0);
        repo.Memberships.Single(m => m.UserId.Value == WorkerA).Status
            .Should().Be(MembershipStatus.Active, "the row must be exactly as it was");
    }

    [Fact]
    public async Task An_already_exited_member_still_gets_the_idempotent_answer_when_the_scope_refuses()
    {
        // The real helper refuses BOTH a non-member and an already-exited member —
        // it cannot tell them apart, because both fail the same non-terminal
        // membership predicate. So the refusal must not be allowed to swallow the
        // idempotent case, or every retried exit becomes a 403.
        var repo = new StubShramSafalRepository();
        var handler = new ExitMembershipHandler(
            repo, new FixedClock(Now), new CapturingAnalyticsWriter(),
            StubCallerFarmTenantScope.Refusing());
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);
        repo.Memberships.Single(m => m.UserId.Value == WorkerA).Exit(Now, isLastActivePrimaryOwner: false);

        var result = await handler.HandleAsync(new FarmId(FarmA), new UserId(WorkerA));

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyExited.Should().BeTrue();
        repo.AuditEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task A_caller_with_no_membership_at_all_is_a_404_and_writes_nothing()
    {
        var (repo, handler) = Build();
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);
        var stranger = Guid.Parse("e9999999-9999-9999-9999-999999999999");

        var result = await handler.HandleAsync(new FarmId(FarmA), new UserId(stranger));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("exit.no_membership");
        repo.AuditEvents.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Invariant I3 — a farm is never left without an owner.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_only_active_primary_owner_cannot_leave_and_nothing_is_written()
    {
        var (repo, handler) = Build();
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);

        var result = await handler.HandleAsync(new FarmId(FarmA), new UserId(OwnerA));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("exit.last_primary_owner");
        repo.Memberships.Single(m => m.UserId.Value == OwnerA).Status
            .Should().Be(MembershipStatus.Active);
        repo.AuditEvents.Should().BeEmpty(
            "the refusal is not a departure and must not be recorded as one");
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task A_primary_owner_may_leave_once_a_second_active_primary_owner_exists()
    {
        var (repo, handler) = Build();
        SeedFarmWithOwnerAnd(repo, AppRole.Worker, WorkerA);
        var secondOwner = Guid.Parse("e2222222-2222-2222-2222-222222222222");
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), FarmA, secondOwner, AppRole.PrimaryOwner, Now));

        var result = await handler.HandleAsync(new FarmId(FarmA), new UserId(OwnerA));

        result.IsSuccess.Should().BeTrue();
        repo.Memberships.Count(m => m.Role == AppRole.PrimaryOwner && m.Status == MembershipStatus.Active)
            .Should().Be(1, "the farm still has an owner, which is the whole content of invariant I3");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private static (StubShramSafalRepository Repo, ExitMembershipHandler Handler) Build()
    {
        var repo = new StubShramSafalRepository();
        var handler = new ExitMembershipHandler(
            repo, new FixedClock(Now), new CapturingAnalyticsWriter(),
            StubCallerFarmTenantScope.Granting());
        return (repo, handler);
    }

    private static void SeedFarmWithOwnerAnd(StubShramSafalRepository repo, AppRole role, Guid userId)
    {
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), FarmA, OwnerA, AppRole.PrimaryOwner, Now));
        repo.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(), FarmA, userId, role, Now));
    }
}
