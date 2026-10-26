// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.JoinByCode;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a person TYPES a farm's code to ask to join
/// it (<c>POST /shramsafal/join/by-code</c>). Sibling of <c>ClaimJoinHandler</c>, with three
/// deliberate differences:
/// <list type="bullet">
/// <item><b>A request, never access.</b> The seat is created
/// <see cref="MembershipStatus.PendingApproval"/> through
/// <see cref="FarmMembership.CreateJoinRequest"/>, which takes no role: the placeholder is
/// <c>Worker</c> and the owner chooses the real role when approving (step 2). The QR token
/// remains the only artifact that joins without approval. What makes "never access" TRUE is
/// not this handler but the Active-only gates it relies on: the sync pull's farm list, the
/// push and REST farm scopes, every role/member check (<c>IShramSafalRepository</c>) and the
/// user-scoped data RLS policies (migration <c>RequireActiveMembershipForUserScopedDataReads</c>)
/// all refuse a PendingApproval seat — pinned end to end by
/// <c>PendingJoinRequestAccessRealPostgresTests</c>. <b>Those gates live in THIS release's
/// code.</b> Every older binary counts any seat that has not ended as a member, so the rows this
/// handler writes become real access if an older binary is put back against this database
/// (E8): a code rollback past this release must first run
/// <c>src/AgriSync.Bootstrapper/Scripts/end-typed-code-join-requests.sql</c>.</item>
/// <item><b>One answer for every wrong code.</b> Blank, malformed, wrong and unknown codes all
/// return <see cref="ShramSafalErrors.JoinCodeUnknown"/>, which names no farm. Guessing is made
/// pointless by the endpoint's <c>"join"</c> rate limit, not here.</item>
/// <item><b>The farm is found under RLS by the code alone.</b>
/// <see cref="IJoinCodeTenantScope"/> stage 1 makes exactly the row with that code visible;
/// stage 2 scopes the rest of the request to that farm (see the port for the staging, and
/// <c>JoinCodeTenantScope</c> for why a GUC policy and not an exempt lookup table).</item>
/// </list>
///
/// <para><b>Existing seats</b> follow ClaimJoin: a live (non-terminal) seat is returned as it is
/// — Active, PendingApproval or Suspended — and nothing is written, so a repeat is idempotent and
/// a paused person cannot type their way back to a fresh request. A Revoked or Exited seat is
/// history: a new PendingApproval request is created beside it, and the old row is untouched.
/// The farm's registrant is its owner by the repository's own rule, so typing their own code
/// answers <c>Active</c> and writes nothing.</para>
/// </summary>
public sealed class JoinByCodeHandler(
    IShramSafalRepository farmRepository,
    IIdGenerator idGenerator,
    IClock clock,
    IJoinCodeTenantScope? tenantScope = null)
    : IHandler<JoinByCodeCommand, JoinByCodeResult>
{
    public async Task<Result<JoinByCodeResult>> HandleAsync(JoinByCodeCommand command, CancellationToken ct = default)
    {
        // Identity gates (authenticated, phone verified) live in JoinByCodeValidator.

        var code = FarmCode.Normalize(command.FarmCode);
        if (code is null)
        {
            return Result.Failure<JoinByCodeResult>(ShramSafalErrors.JoinCodeUnknown);
        }

        // Stage 1: only the farm with exactly this code becomes visible. Null only for direct-
        // construction unit tests (no interceptor exists there); production DI always supplies
        // it, and an absent scope fails CLOSED (the interceptor throws), never open.
        if (tenantScope is not null)
        {
            await tenantScope.BeginCodeLookupAsync(code, ct);
        }

        var farm = await farmRepository.GetFarmByJoinCodeAsync(code, ct);
        if (farm is null)
        {
            return Result.Failure<JoinByCodeResult>(ShramSafalErrors.JoinCodeUnknown);
        }

        // Stage 2: the farm id comes from the row the code found, never from the request.
        if (tenantScope is not null)
        {
            await tenantScope.PublishCodeFarmScopeAsync(farm.Id.Value, command.CallerUserId.Value, ct);
        }

        var existing = await farmRepository.GetFarmMembershipAsync(farm.Id.Value, command.CallerUserId.Value, ct);
        if (existing is not null && !existing.IsTerminal)
        {
            return Result.Success(new JoinByCodeResult(farm.Id, farm.Name, ContractStatus(existing.Status), WasAlreadyMember: true));
        }

        if (farm.OwnerUserId == command.CallerUserId)
        {
            return Result.Success(new JoinByCodeResult(farm.Id, farm.Name, MembershipStatus.Active, WasAlreadyMember: true));
        }

        var utcNow = clock.UtcNow;
        var request = FarmMembership.CreateJoinRequest(
            id: idGenerator.New(),
            farmId: farm.Id,
            userId: command.CallerUserId,
            requestedAtUtc: utcNow);

        await farmRepository.AddFarmMembershipAsync(request, ct);
        await farmRepository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "FarmMembership",
                entityId: request.Id,
                action: "MemberJoinRequested",
                actorUserId: command.CallerUserId.Value,
                // The person holds NO role on this farm until the owner approves; writing the
                // Worker placeholder here would record a role nobody granted.
                actorRole: "joiner",
                payload: new
                {
                    farmId = farm.Id,
                    userId = command.CallerUserId,
                    status = request.Status.ToString(),
                    placeholderRole = request.Role.ToString(),
                    joinedVia = request.JoinedVia.ToString(),
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
            // A concurrent request by the SAME person (double tap) won the insert. Same outcome
            // as the live-seat path above: return the winner's row. No second audit row.
            var winner = await farmRepository.GetFarmMembershipAsync(farm.Id.Value, command.CallerUserId.Value, ct);
            if (winner is null || winner.IsTerminal)
            {
                return Result.Failure<JoinByCodeResult>(Error.Conflict(
                    "join.concurrent_claim_unresolved",
                    "Could not complete the request. Please try again."));
            }

            return Result.Success(new JoinByCodeResult(farm.Id, farm.Name, ContractStatus(winner.Status), WasAlreadyMember: true));
        }

        return Result.Success(new JoinByCodeResult(farm.Id, farm.Name, request.Status, WasAlreadyMember: false));
    }

    /// <summary>
    /// The fixed contract names three statuses (Active / PendingApproval / Suspended). A live
    /// <see cref="MembershipStatus.PendingOtpClaim"/> seat (an invitation not yet claimed — no
    /// live path stores one today) has not been let in either, so it is answered as the
    /// waiting state it is rather than as a value the phone does not know.
    /// </summary>
    private static MembershipStatus ContractStatus(MembershipStatus status) =>
        status == MembershipStatus.PendingOtpClaim ? MembershipStatus.PendingApproval : status;
}
