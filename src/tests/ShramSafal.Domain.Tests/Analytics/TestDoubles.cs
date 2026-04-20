using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Domain.Tests.Analytics;

internal sealed class FixedClock : IClock
{
    public FixedClock(DateTime now) => UtcNow = now;
    public DateTime UtcNow { get; set; }
}

internal sealed class SequentialIdGenerator : IIdGenerator
{
    private readonly Queue<Guid> _queue;
    public SequentialIdGenerator(params Guid[] ids) => _queue = new Queue<Guid>(ids);
    public Guid New() => _queue.Count == 0 ? Guid.NewGuid() : _queue.Dequeue();
}

internal sealed class AllowAllAuthorizationEnforcer : IAuthorizationEnforcer
{
    public Task EnsureIsFarmMember(UserId userId, FarmId farmId) => Task.CompletedTask;
    public Task EnsureIsOwner(UserId userId, FarmId farmId) => Task.CompletedTask;
    public Task EnsureCanVerify(UserId userId, Guid logId) => Task.CompletedTask;
    public Task EnsureCanEditLog(UserId userId, Guid logId) => Task.CompletedTask;
}

internal sealed class StubFarmInvitationRepository : IFarmInvitationRepository
{
    private readonly Dictionary<FarmInvitationId, FarmInvitation> _invitations = new();
    private readonly Dictionary<FarmInvitationId, FarmJoinToken> _tokensByInvitation = new();
    private readonly Dictionary<string, FarmJoinToken> _tokensByHash = new();

    public int SaveCalls { get; private set; }

    public void SeedToken(FarmJoinToken token, FarmInvitation invitation)
    {
        _invitations[invitation.Id] = invitation;
        _tokensByInvitation[invitation.Id] = token;
        _tokensByHash[token.TokenHash] = token;
    }

    public Task AddInvitationAsync(FarmInvitation invitation, CancellationToken ct = default)
    {
        _invitations[invitation.Id] = invitation;
        return Task.CompletedTask;
    }

    public Task AddTokenAsync(FarmJoinToken token, CancellationToken ct = default)
    {
        _tokensByInvitation[token.InvitationId] = token;
        _tokensByHash[token.TokenHash] = token;
        return Task.CompletedTask;
    }

    public Task<FarmInvitation?> GetActiveInvitationByFarmAsync(FarmId farmId, CancellationToken ct = default)
    {
        var inv = _invitations.Values.FirstOrDefault(i => i.FarmId == farmId && i.IsActive);
        return Task.FromResult(inv);
    }

    public Task<FarmJoinToken?> GetActiveTokenByInvitationAsync(FarmInvitationId invitationId, CancellationToken ct = default)
    {
        _tokensByInvitation.TryGetValue(invitationId, out var tok);
        return Task.FromResult(tok is null || tok.IsRevoked ? null : tok);
    }

    public Task<FarmJoinToken?> GetTokenByHashAsync(string tokenHash, CancellationToken ct = default)
    {
        _tokensByHash.TryGetValue(tokenHash, out var tok);
        return Task.FromResult(tok);
    }

    public Task SaveChangesAsync(CancellationToken ct = default)
    {
        SaveCalls++;
        return Task.CompletedTask;
    }
}

internal sealed class AllowEntitlementPolicy : IEntitlementPolicy
{
    public Task<EntitlementDecision> EvaluateAsync(
        UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
        => Task.FromResult(new EntitlementDecision(Allowed: true, EntitlementReason.Allowed, SubscriptionStatus: null));
}
