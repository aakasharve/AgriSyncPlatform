using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.ClaimJoin;

/// <summary>
/// Worker-side claim handler. The worker has already proven possession
/// of the phone via OTP (Phase 3); the endpoint layer has already
/// checked that the JWT carries <c>phone_verified=true</c>. Here we
/// redeem the QR token and produce a FarmMembership.
///
/// Idempotency (plan §8.6.3):
///   - Same user hitting the endpoint twice with the same token must
///     return the same membership row, not a duplicate.
///   - A revoked token must return a recoverable error, never a silent
///     zero-membership success.
///
/// Authorization:
///   - The token is the authorization artifact for this path. If a
///     caller has both a valid OTP-verified JWT AND a valid token, they
///     are allowed to become a member. Owner-side permissions are
///     checked separately at issue / rotate time.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (ClaimJoin): caller-shape validation lives
/// in <see cref="ClaimJoinValidator"/>; ownership has no authorizer (the
/// token IS the authorization artifact). When this handler is resolved
/// via the pipeline, the validator runs before the body. Direct
/// construction (legacy unit tests) bypasses that decorator and exercises
/// the body verbatim — body still owns token-hash lookup, revoked-token
/// handling, farm-not-found, farm-code mismatch, idempotency, audit,
/// save, and analytics.
/// </para>
/// </summary>
public sealed class ClaimJoinHandler(
    IFarmInvitationRepository invitationRepository,
    IShramSafalRepository farmRepository,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<ClaimJoinHandler> logger,
    IAnalyticsWriter analytics)
    : IHandler<ClaimJoinCommand, ClaimJoinResult>
{
    public async Task<Result<ClaimJoinResult>> HandleAsync(ClaimJoinCommand command, CancellationToken ct = default)
    {
        // Caller-shape validation (CallerUserId.IsEmpty / PhoneVerified /
        // Token+FarmCode non-whitespace) lives in ClaimJoinValidator and
        // runs as a pipeline stage. The body trusts those gates have
        // already passed when reached through IHandler<,>; direct callers
        // must enforce the same invariants themselves.

        var tokenHash = IssueFarmInviteHandler.ComputeTokenHash(command.Token);
        var tokenRow = await invitationRepository.GetTokenByHashAsync(tokenHash, ct);

        if (tokenRow is null || tokenRow.IsRevoked)
        {
            // Same error for "not found" and "revoked" — no oracle for
            // attackers probing token space.
            return Result.Failure<ClaimJoinResult>(Error.Unauthenticated(
                "join.token_invalid",
                "This QR is no longer valid. Ask the farmer for a new one."));
        }

        var farm = await farmRepository.GetFarmByIdAsync(tokenRow.FarmId.Value, ct);
        if (farm is null)
        {
            return Result.Failure<ClaimJoinResult>(Error.NotFound(
                "join.farm_missing",
                "The farm for this QR could not be found."));
        }

        // Defence-in-depth: worker's scanner also sends the farm code,
        // which must match the farm bound to the token. This catches QR
        // payloads spliced together from two different farms.
        if (!string.IsNullOrWhiteSpace(farm.FarmCode)
            && !string.Equals(farm.FarmCode, command.FarmCode, StringComparison.OrdinalIgnoreCase))
        {
            logger.LogWarning(
                "Claim rejected: token for farm {FarmId} but QR carried farm code '{ClaimedCode}' ≠ '{RealCode}'.",
                farm.Id, command.FarmCode, farm.FarmCode);
            return Result.Failure<ClaimJoinResult>(Error.Validation(
                "join.farm_code_mismatch",
                "This QR looks tampered with. Ask the farmer to share it again."));
        }

        var utcNow = clock.UtcNow;
        var existing = await farmRepository.GetFarmMembershipAsync(farm.Id.Value, command.CallerUserId.Value, ct);

        if (existing is not null && !existing.IsTerminal)
        {
            // Idempotent: same user scanning same QR returns the same
            // membership row.
            return Result.Success(new ClaimJoinResult(
                MembershipId: existing.Id,
                FarmId: farm.Id,
                FarmName: farm.Name,
                Role: existing.Role.ToString(),
                WasAlreadyMember: true));
        }

        // Plan §5.1 Flow A: no approval gate, so membership lands Active
        // immediately. JoinedVia = QrScan so audit queries can tell
        // scan-path memberships apart from bootstrap + manual adds.
        var membership = FarmMembership.CreateFromInvitation(
            id: idGenerator.New(),
            farmId: farm.Id,
            userId: command.CallerUserId,
            role: AppRole.Worker,
            joinedVia: JoinedVia.QrScan,
            invitationId: tokenRow.InvitationId,
            requireApproval: false,
            grantedAtUtc: utcNow);

        membership.ClaimWithoutApproval(utcNow);

        await farmRepository.AddFarmMembershipAsync(membership, ct);
        await farmRepository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: farm.Id.Value,
                entityType: "FarmMembership",
                entityId: membership.Id,
                action: "MemberJoined",
                actorUserId: command.CallerUserId.Value,
                actorRole: membership.Role.ToString().ToLowerInvariant(),
                payload: new { farmId = farm.Id, userId = command.CallerUserId, role = membership.Role.ToString(), joinedVia = "QrScan" },
                clientCommandId: null,
                occurredAtUtc: utcNow), ct);
        await farmRepository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.InvitationClaimed,
            OccurredAtUtc: utcNow,
            ActorUserId: command.CallerUserId,
            FarmId: farm.Id,
            OwnerAccountId: null,
            ActorRole: membership.Role.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = farm.Id,
                claimedByUserId = command.CallerUserId,
                role = membership.Role.ToString().ToLowerInvariant()
            })
        ), ct);

        return Result.Success(new ClaimJoinResult(
            MembershipId: membership.Id,
            FarmId: farm.Id,
            FarmName: farm.Name,
            Role: membership.Role.ToString(),
            WasAlreadyMember: false));
    }
}
