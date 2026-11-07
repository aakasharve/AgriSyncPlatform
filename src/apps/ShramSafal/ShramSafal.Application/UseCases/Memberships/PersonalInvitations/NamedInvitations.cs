using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Identity;

namespace ShramSafal.Application.UseCases.Memberships.PersonalInvitations;

/// <summary>
/// spec: plr-d10 lane MU-2 fix round 1 (review M-1, SEC-2) — a named invitation is the owner's approval given in ADVANCE,
/// for a person who has not joined yet. Once that person is let in another way (the owner approved his wall-QR or
/// typed-code request, or let him in from another invitation), the old card has done its job: every invitation on that
/// farm still waiting for his proven number ends, with an audit row, so it can never outlive a later decision of the
/// owner's (a removal, a pause).
/// </summary>
public static class NamedInvitations
{
    /// <summary>The reason on the audit row.</summary>
    public const string JoinedAnotherWay = "JoinedAnotherWay";

    /// <summary>
    /// Ends (stages, does not save) every waiting invitation of <paramref name="farmId"/> naming the proven number of
    /// <paramref name="personUserId"/>, except <paramref name="exceptInvitationId"/>, and stages one audit row for each.
    /// A person with no proven number has none to end. Returns how many ended.
    /// </summary>
    public static async Task<int> EndForPersonLetInAsync(
        IPersonalInvitationRepository invitations,
        IShramSafalRepository repository,
        IUserDirectory users,
        Guid farmId,
        Guid personUserId,
        Guid? exceptInvitationId,
        UserId decidedBy,
        DateTime nowUtc,
        string appVersion,
        string deviceId,
        string ipHash,
        CancellationToken ct)
    {
        var phone = IndianMobile.Normalize(await users.GetVerifiedPhoneAsync(personUserId, ct));
        if (phone is null)
        {
            return 0;
        }

        var ended = 0;
        foreach (var waiting in await invitations.GetWaitingForPhoneAsync(farmId, phone, ct))
        {
            if (waiting.Id == exceptInvitationId || waiting.FarmId.Value != farmId || !waiting.Withdraw(decidedBy, nowUtc))
            {
                continue;
            }

            ended++;
            await repository.AddAuditEventAsync(AuditEventFactory.Create(
                entityType: "PersonalInvitation",
                entityId: waiting.Id,
                action: "PersonalInvitationWithdrawn",
                actorUserId: decidedBy.Value,
                actorRole: "primaryowner",
                payload: new { invitationId = waiting.Id, reason = JoinedAnotherWay, userId = personUserId },
                farmId: farmId,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(appVersion) || appVersion == "unknown" ? AppVersionProvider.Current : appVersion,
                deviceId: deviceId,
                ipHash: ipHash,
                sourceAiJobId: null), ct);
        }

        return ended;
    }
}
