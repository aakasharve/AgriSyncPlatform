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
/// redeem the QR token and produce a FarmMembership REQUEST.
///
/// spec: plr-d10 lane MU-2 (MU design §5, anti-goal "a generic QR that silently makes someone an operational
/// member"): the farm QR only ASKS to join. Until MU-2 a fresh scan made an Active Worker at once and answered a
/// typed-code request by activating it; now a fresh scan makes a PendingApproval seat (QrScan, the Worker
/// placeholder) and the owner chooses label, plots and authorities when he approves it. A personal invitation
/// (<c>PersonalInvitation</c>) is the only way in that is decided before the claim.
///
/// Idempotency (plan §8.6.3):
///   - Same user hitting the endpoint twice with the same token must
///     return the same membership row, not a duplicate.
///   - A revoked token must return a recoverable error, never a silent
///     zero-membership success.
///   - Every live seat (Active, Suspended, a waiting request) is returned as
///     it is, and nothing is written: existing Active seats are untouched (P10).
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
    IAnalyticsWriter analytics,
    IJoinClaimTenantScope? tenantScope = null)
    : IHandler<ClaimJoinCommand, ClaimJoinResult>
{
    public async Task<Result<ClaimJoinResult>> HandleAsync(ClaimJoinCommand command, CancellationToken ct = default)
    {
        // Caller-shape validation (CallerUserId.IsEmpty / PhoneVerified /
        // Token+FarmCode non-whitespace) lives in ClaimJoinValidator and
        // runs as a pipeline stage. The body trusts those gates have
        // already passed when reached through IHandler<,>; direct callers
        // must enforce the same invariants themselves.

        // The claimant is not a member yet, so there is no farm claim to publish for the first
        // read. Stage 1 only silences the tenant interceptor (no GUC, no RLS-table visibility);
        // the lookup below touches ssf.farm_join_tokens alone. See IJoinClaimTenantScope.
        // Null only for legacy direct-construction unit tests (no interceptor exists there);
        // production DI always supplies it, and an absent scope fails CLOSED (the interceptor
        // throws), never open.
        tenantScope?.BeginTokenLookup();

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

        // Stage 2: the token is valid, so the farm it is bound to - and only that farm - becomes
        // the tenant scope for the farm read, the membership read and the membership + audit
        // INSERTs below. The farm id comes from the token row, never from the request.
        if (tenantScope is not null)
        {
            await tenantScope.PublishTokenFarmScopeAsync(
                tokenRow.FarmId.Value, command.CallerUserId.Value, ct);
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
            // CWE-117 sibling of the four DFES sinks CodeQL flagged on PR #55, found by
            // the same sweep. ClaimedCode is the code the SCANNER sent, so a newline in it
            // forges a log line — and this line is the only trace a spliced QR leaves,
            // which makes it exactly the wrong line to let an attacker author. RealCode is
            // NOT wrapped: it is server-generated (FarmCode.New) and never
            // client-writable.
            logger.LogWarning(
                "Claim rejected: token for farm {FarmId} but QR carried farm code '{ClaimedCode}' ≠ '{RealCode}'.",
                farm.Id, LogSafe.Text(command.FarmCode), farm.FarmCode);
            return Result.Failure<ClaimJoinResult>(Error.Validation(
                "join.farm_code_mismatch",
                "This QR looks tampered with. Ask the farmer to share it again."));
        }

        var utcNow = clock.UtcNow;
        var existing = await farmRepository.GetFarmMembershipAsync(farm.Id.Value, command.CallerUserId.Value, ct);

        // spec: plr-d10 lane MU-2 (MU design §5; founder D-22 "every join waits for the owner") — the farm QR on a wall,
        // shared around, only ASKS to join. Any live seat is answered as it is and nothing is written: an Active seat stays
        // Active (P10 — no seat that exists is changed), a paused one stays paused, and a waiting request (typed code or an
        // earlier scan) stays a request the owner answers. The QR no longer activates a typed-code request either.
        if (existing is not null && !existing.IsTerminal)
        {
            return Result.Success(new ClaimJoinResult(
                MembershipId: existing.Id,
                FarmId: farm.Id,
                FarmName: farm.Name,
                Role: existing.Role.ToString(),
                WasAlreadyMember: true,
                Status: existing.Status));
        }

        // A fresh scan makes a PendingApproval request under this QR's invitation (QrScan, the Worker placeholder the
        // owner replaces when approving — he chooses label, plots and authorities then). Nothing is granted.
        var membership = FarmMembership.CreateFromInvitation(
            id: idGenerator.New(),
            farmId: farm.Id,
            userId: command.CallerUserId,
            role: AppRole.Worker,
            joinedVia: JoinedVia.QrScan,
            invitationId: tokenRow.InvitationId,
            requireApproval: true,
            grantedAtUtc: utcNow);

        await farmRepository.AddFarmMembershipAsync(membership, ct);
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — X-Device-Id / IP hash / X-App-Version from the endpoint.
        await farmRepository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "FarmMembership",
                entityId: membership.Id,
                action: "MemberJoinRequested",
                actorUserId: command.CallerUserId.Value,
                // A waiting seat holds no role yet (same wording as a typed-code request).
                actorRole: "joiner",
                payload: new
                {
                    farmId = farm.Id,
                    userId = command.CallerUserId,
                    placeholderRole = membership.Role.ToString(),
                    joinedVia = "QrScan",
                    status = membership.Status.ToString(),
                },
                farmId: farm.Id.Value,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null), ct);
        if (!await farmRepository.TrySaveNewMembershipAsync(ct))
        {
            // A concurrent claim by the SAME user (QR double-tap) won the insert: return the winner's row idempotently.
            // No second audit row.
            var winner = await farmRepository.GetFarmMembershipAsync(farm.Id.Value, command.CallerUserId.Value, ct);
            if (winner is null || winner.IsTerminal)
            {
                return Result.Failure<ClaimJoinResult>(Error.Conflict(
                    "join.concurrent_claim_unresolved",
                    "Could not complete joining. Please scan the QR again."));
            }

            return Result.Success(new ClaimJoinResult(
                MembershipId: winner.Id,
                FarmId: farm.Id,
                FarmName: farm.Name,
                Role: winner.Role.ToString(),
                WasAlreadyMember: true,
                Status: winner.Status));
        }

        await EmitJoinRequestedAsync(command, farm, utcNow, ct);

        return Result.Success(new ClaimJoinResult(
            MembershipId: membership.Id,
            FarmId: farm.Id,
            FarmName: farm.Name,
            Role: membership.Role.ToString(),
            WasAlreadyMember: false,
            Status: membership.Status));
    }

    /// <summary>
    /// spec: plr-d10 lane MU-2 — the scan made a request, not a member. The analytics event says so: the
    /// <see cref="AnalyticsEventType.InvitationClaimed"/> stream keeps its meaning with <c>outcome = "requested"</c>, and
    /// the role is the joiner's (none yet).
    /// </summary>
    private Task EmitJoinRequestedAsync(ClaimJoinCommand command, Farm farm, DateTime utcNow, CancellationToken ct)
        => analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.InvitationClaimed,
            OccurredAtUtc: utcNow,
            ActorUserId: command.CallerUserId,
            FarmId: farm.Id,
            OwnerAccountId: null,
            ActorRole: "joiner",
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = farm.Id,
                claimedByUserId = command.CallerUserId,
                outcome = "requested",
            })
        ), ct);
}
