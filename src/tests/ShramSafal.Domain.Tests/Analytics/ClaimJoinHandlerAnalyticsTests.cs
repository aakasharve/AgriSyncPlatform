using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Analytics;

/// <summary>
/// MIS Integration Phase 2 Batch B4: verifies <see cref="ClaimJoinHandler"/>
/// emits an <c>invitation.claimed</c> analytics event on the genuine-claim
/// success path.
/// </summary>
public sealed class ClaimJoinHandlerAnalyticsTests
{
    [Fact]
    public async Task HandleAsync_OnNewClaim_EmitsInvitationClaimedEvent()
    {
        var analytics = new CapturingAnalyticsWriter();
        var farmRepo = new StubShramSafalRepository();
        var invRepo = new StubFarmInvitationRepository();

        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var workerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var farmIdGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var now = new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

        var farm = Farm.Create(farmIdGuid, "Patil Farm", ownerUserId, now);
        farm.AssignFarmCode("PATIL1", now);
        farmRepo.SeedFarm(farm);

        const string rawToken = "test-raw-token-value";
        var tokenHash = ComputeTokenHash(rawToken);
        var invitation = FarmInvitation.Issue(FarmInvitationId.New(), new FarmId(farmIdGuid), new UserId(ownerUserId), now);
        var token = FarmJoinToken.Issue(FarmJoinTokenId.New(), invitation.Id, new FarmId(farmIdGuid), rawToken, tokenHash, now);
        invRepo.SeedToken(token, invitation);

        var handler = new ClaimJoinHandler(
            invRepo,
            farmRepo,
            new SequentialIdGenerator(Guid.Parse("44444444-4444-4444-4444-444444444444")),
            new FixedClock(now),
            NullLogger<ClaimJoinHandler>.Instance,
            analytics);

        var result = await handler.HandleAsync(new ClaimJoinCommand(
            Token: rawToken,
            FarmCode: "PATIL1",
            CallerUserId: new UserId(workerUserId),
            PhoneVerified: true));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.WasAlreadyMember);
        // spec: plr-d10 lane MU-2 — the farm QR only asks: a waiting request, and the event says so.
        Assert.Equal(MembershipStatus.PendingApproval, result.Value.Status);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.InvitationClaimed, evt.EventType);
        Assert.Equal(workerUserId, evt.ActorUserId!.Value.Value);
        Assert.Equal(farmIdGuid, evt.FarmId!.Value.Value);
        Assert.Equal("joiner", evt.ActorRole);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("claimedByUserId", evt.PropsJson);
        Assert.Contains("\"outcome\":\"requested\"", evt.PropsJson);
    }

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a person who TYPED the code earlier holds a
    // waiting request. Until lane MU-2 the owner's QR activated it.
    // CONSCIOUS CHANGE — spec: plr-d10 lane MU-2: the farm QR only ASKS, so it answers the request as it is: the same
    // seat, still waiting, nothing written, no event.
    [Fact]
    public async Task HandleAsync_OverATypedCodeRequest_LeavesThatSeatWaitingAndEmitsNothing()
    {
        var analytics = new CapturingAnalyticsWriter();
        var farmRepo = new StubShramSafalRepository();
        var invRepo = new StubFarmInvitationRepository();

        var ownerUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var workerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var farmIdGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var now = new DateTime(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc);

        var farm = Farm.Create(farmIdGuid, "Patil Farm", ownerUserId, now);
        farm.AssignFarmCode("PATIL1", now);
        farmRepo.SeedFarm(farm);

        var request = FarmMembership.CreateJoinRequest(
            Guid.Parse("55555555-5555-5555-5555-555555555555"), new FarmId(farmIdGuid), new UserId(workerUserId), now.AddHours(-1));
        farmRepo.SeedMembership(request);

        const string rawToken = "test-raw-token-value";
        var invitation = FarmInvitation.Issue(FarmInvitationId.New(), new FarmId(farmIdGuid), new UserId(ownerUserId), now);
        var token = FarmJoinToken.Issue(FarmJoinTokenId.New(), invitation.Id, new FarmId(farmIdGuid), rawToken, ComputeTokenHash(rawToken), now);
        invRepo.SeedToken(token, invitation);

        var handler = new ClaimJoinHandler(
            invRepo,
            farmRepo,
            new SequentialIdGenerator(Guid.Parse("44444444-4444-4444-4444-444444444444")),
            new FixedClock(now),
            NullLogger<ClaimJoinHandler>.Instance,
            analytics);

        var result = await handler.HandleAsync(new ClaimJoinCommand(
            Token: rawToken,
            FarmCode: "PATIL1",
            CallerUserId: new UserId(workerUserId),
            PhoneVerified: true));

        Assert.True(result.IsSuccess);
        Assert.Equal(request.Id, result.Value.MembershipId);
        Assert.True(result.Value.WasAlreadyMember);
        Assert.Equal(MembershipStatus.PendingApproval, result.Value.Status);

        Assert.Single(farmRepo.Memberships);
        Assert.Equal(MembershipStatus.PendingApproval, request.Status);
        Assert.Equal(JoinedVia.SelfJoin, request.JoinedVia);
        Assert.Null(request.InvitationId);
        Assert.DoesNotContain(farmRepo.AuditEvents, a => a.Action == "MemberJoined");
        Assert.Empty(analytics.Events);

        // A second scan is the same answer: nothing is written.
        var again = await handler.HandleAsync(new ClaimJoinCommand(
            Token: rawToken,
            FarmCode: "PATIL1",
            CallerUserId: new UserId(workerUserId),
            PhoneVerified: true));

        Assert.True(again.IsSuccess);
        Assert.True(again.Value.WasAlreadyMember);
        Assert.Equal(MembershipStatus.PendingApproval, again.Value.Status);
        Assert.DoesNotContain(farmRepo.AuditEvents, a => a.Action == "MemberJoined");
        Assert.Empty(analytics.Events);
    }

    private static string ComputeTokenHash(string rawToken)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(rawToken), hash);
        var sb = new StringBuilder(64);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
