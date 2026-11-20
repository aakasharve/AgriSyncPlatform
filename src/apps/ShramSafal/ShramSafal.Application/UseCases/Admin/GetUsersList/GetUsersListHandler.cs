using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetUsersList;

/// <summary>
/// MayReadPhones is the farmer_phones tick (or the founder). Without it the search matches display names only (a
/// phone number typed in the search finds nothing) and every phone is hidden. The audit fields are the request's
/// device and IP hash, written on the History row of a phone look.
/// </summary>
public sealed record GetUsersListQuery(
    int Page,
    int PageSize,
    string? Search,
    Guid ActorId,
    bool MayReadPhones,
    string AuditDeviceId,
    string AuditIpHash);

public sealed class GetUsersListHandler(
    IAdminMisRepository misRepo, IControlRoomHistory history, IControlRoomStore controlRoomStore)
{
    public async Task<Result<AdminResponseDto<UsersListDto>>> HandleAsync(
        GetUsersListQuery q, CancellationToken ct = default)
    {
        var users = await misRepo.GetUsersListAsync(q.Page, q.PageSize, q.Search, matchPhone: q.MayReadPhones, ct);

        if (!q.MayReadPhones)
        {
            users = users with { Items = users.Items.Select(u => u with { Phone = ControlRoomPhones.Hidden }).ToList() };
        }
        else
        {
            // The look is written to History BEFORE the page is returned; a History failure sends no phone.
            var seen = users.Items.Count(u => ControlRoomPhones.IsReal(u.Phone));
            if (seen > 0)
            {
                await ControlRoomPhones.RecordLookAsync(
                    history, controlRoomStore, q.ActorId, q.AuditDeviceId, q.AuditIpHash,
                    "users", farmIds: null, personCount: seen, count: seen, ct);
            }
        }

        return Result.Success(new AdminResponseDto<UsersListDto>(users,
            new AdminMetaDto("live", "current", DateTime.UtcNow, 60)));
    }
}
