using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

/// <summary>
/// Issues (or returns the existing) Active farm invitation.
///
/// Idempotent by design — calling this endpoint twice in a row returns
/// the SAME invitation + token, so the owner can open the "Share farm
/// QR" sheet any number of times without invalidating QRs they have
/// already shared on WhatsApp. To invalidate, the owner must explicitly
/// call rotate.
///
/// Authorization: the caller must be an owner of the farm
/// (<see cref="IAuthorizationEnforcer.EnsureIsOwner"/>).
/// </summary>
public sealed class IssueFarmInviteHandler(
    IFarmInvitationRepository invitationRepository,
    IShramSafalRepository farmRepository,
    IAuthorizationEnforcer authz,
    IClock clock,
    IAnalyticsWriter analytics)
{
    public async Task<Result<IssueFarmInviteResult>> HandleAsync(
        IssueFarmInviteCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty)
        {
            return Result.Failure<IssueFarmInviteResult>(ShramSafalErrors.InvalidCommand);
        }

        await authz.EnsureIsOwner(command.CallerUserId, command.FarmId);

        var farm = await farmRepository.GetFarmByIdAsync(command.FarmId.Value, ct)
            ?? throw new InvalidOperationException($"Farm '{command.FarmId}' not found.");

        var utcNow = clock.UtcNow;

        // 1. Reuse existing Active invitation if present (idempotent).
        var existing = await invitationRepository.GetActiveInvitationByFarmAsync(command.FarmId, ct);
        if (existing is not null)
        {
            var existingToken = await invitationRepository.GetActiveTokenByInvitationAsync(existing.Id, ct);
            if (existingToken is not null)
            {
                return Result.Success(new IssueFarmInviteResult(
                    InvitationId: existing.Id,
                    JoinTokenId: existingToken.Id,
                    FarmId: farm.Id,
                    FarmName: farm.Name,
                    FarmCode: farm.FarmCode ?? "",
                    Token: existingToken.RawToken,
                    IssuedAtUtc: existingToken.CreatedAtUtc));
            }
            // Edge case: invitation exists but its token was manually
            // cleared. Treat as "issue a fresh token for the existing
            // invitation." Fall through.
        }

        // 2. Create a new invitation + token.
        var invitation = existing ?? FarmInvitation.Issue(
            FarmInvitationId.New(),
            command.FarmId,
            command.CallerUserId,
            utcNow);

        var rawToken = GenerateRawToken();
        var tokenHash = ComputeTokenHash(rawToken);

        var token = FarmJoinToken.Issue(
            FarmJoinTokenId.New(),
            invitation.Id,
            command.FarmId,
            rawToken,
            tokenHash,
            utcNow);

        if (existing is null)
        {
            await invitationRepository.AddInvitationAsync(invitation, ct);
        }
        await invitationRepository.AddTokenAsync(token, ct);
        await invitationRepository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.InvitationIssued,
            OccurredAtUtc: utcNow,
            ActorUserId: command.CallerUserId,
            FarmId: command.FarmId,
            OwnerAccountId: null,
            ActorRole: AppRole.PrimaryOwner.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                invitationId = invitation.Id,
                farmId = command.FarmId,
                inviteeRole = AppRole.Worker.ToString().ToLowerInvariant(),
                expiresAtUtc = (DateTime?)null
            })
        ), ct);

        return Result.Success(new IssueFarmInviteResult(
            InvitationId: invitation.Id,
            JoinTokenId: token.Id,
            FarmId: farm.Id,
            FarmName: farm.Name,
            FarmCode: farm.FarmCode ?? "",
            Token: rawToken,
            IssuedAtUtc: token.CreatedAtUtc));
    }

    internal static string GenerateRawToken()
    {
        Span<byte> bytes = stackalloc byte[24]; // 192 bits
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    internal static string ComputeTokenHash(string rawToken)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(rawToken), hash);
        var sb = new StringBuilder(64);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
