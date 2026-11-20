using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetFarmContacts;

/// <summary>
/// Ids is the raw <c>ids</c> query value: farm ids separated by commas. IsPlatformSeat is true when the caller's
/// seat belongs to the Platform organisation; MayReadPhones is the farmer_phones tick (or the founder). The audit
/// fields are the request's device and IP hash, written on the History row of a phone look. NamesOnly is the
/// <c>namesOnly=true</c> query value: the page shows farm names only, so no owner phone is loaded, sent or recorded.
/// </summary>
public sealed record GetFarmContactsQuery(
    string? Ids,
    Guid ActorId,
    bool IsPlatformSeat,
    bool MayReadPhones,
    string AuditDeviceId,
    string AuditIpHash,
    bool NamesOnly = false);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). Farm names and owner phones for a list of farm
/// ids, so the pages the console polls every 30 seconds never open the audited cross-farm factory: they carry farm
/// ids only and the console asks here once per new id.
/// <list type="number">
/// <item>A caller who is not a Platform seat is refused before anything is read, so no factory is opened (defence
/// in depth: the route gates first).</item>
/// <item>The ids must be 1 to <see cref="MaxIds"/> uuids separated by commas; anything else is refused before
/// anything is read.</item>
/// <item>A farm that does not exist is left out of the answer.</item>
/// <item>Without <c>MayReadPhones</c> every owner phone is <see cref="ControlRoomPhones.Hidden"/>; with it, a
/// <c>phones_shown</c> History row naming the farms is written BEFORE the answer is returned (a History failure
/// sends no phone), and only when at least one real phone is in the answer.</item>
/// <item>spec: trusted-control-room-2026-11-20 (G1 fix round 1, I-1). With <c>NamesOnly</c> (the pages that show farm
/// names only) the names-only read is used: no owner phone is loaded, every <c>OwnerPhone</c> is
/// <see cref="ControlRoomPhones.Hidden"/> whoever asks, and no <c>phones_shown</c> row is written, because no phone was
/// sent. <c>OwnerAccountId</c> is then <see cref="Guid.Empty"/>; the route never sends it.</item>
/// </list>
/// <para><b>A repository failure is not caught.</b> It escapes to the server's error path (500); an empty answer
/// would read as "these farms have no name".</para>
/// </summary>
public sealed class GetFarmContactsHandler(
    IAdminMisRepository misRepo, IControlRoomHistory history, IControlRoomStore controlRoomStore)
{
    public const int MaxIds = 200;

    public const string IdsInvalidCode = "admin.contacts_ids_invalid";

    public const string PlatformOnlyCode = "admin.platform_only";

    public async Task<Result<IReadOnlyList<FarmContactDto>>> HandleAsync(
        GetFarmContactsQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformSeat)
        {
            return Result.Failure<IReadOnlyList<FarmContactDto>>(
                Error.Forbidden(PlatformOnlyCode, "This is for ShramSafal's own team only."));
        }

        if (!TryParseIds(query.Ids, out var ids))
        {
            return Result.Failure<IReadOnlyList<FarmContactDto>>(
                Error.Validation(IdsInvalidCode, $"Give 1 to {MaxIds} farm ids separated by commas."));
        }

        if (query.NamesOnly)
        {
            var names = await misRepo.GetFarmNamesAsync(query.ActorId, ids, ct);
            return Result.Success<IReadOnlyList<FarmContactDto>>(names
                .Select(n => new FarmContactDto(n.FarmId, n.Name, ControlRoomPhones.Hidden, Guid.Empty))
                .ToList());
        }

        var contacts = await misRepo.GetFarmContactsAsync(query.ActorId, ids, ct);

        if (!query.MayReadPhones)
        {
            return Result.Success<IReadOnlyList<FarmContactDto>>(
                contacts.Select(c => c with { OwnerPhone = ControlRoomPhones.Hidden }).ToList());
        }

        var withPhone = contacts.Where(c => ControlRoomPhones.IsReal(c.OwnerPhone)).Select(c => c.FarmId).ToList();
        if (withPhone.Count > 0)
        {
            await ControlRoomPhones.RecordLookAsync(
                history, controlRoomStore, query.ActorId, query.AuditDeviceId, query.AuditIpHash,
                "contacts", withPhone, personCount: 0, count: withPhone.Count, ct);
        }

        return Result.Success(contacts);
    }

    /// <summary>
    /// Splits <paramref name="raw"/> on commas. Every entry, trimmed, must be a uuid (an empty entry is not), and
    /// there must be 1 to <see cref="MaxIds"/> entries. Repeated ids are asked for once.
    /// </summary>
    public static bool TryParseIds(string? raw, out IReadOnlyCollection<Guid> ids)
    {
        ids = [];
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        var entries = raw.Split(',');
        if (entries.Length > MaxIds)
        {
            return false;
        }

        var parsed = new HashSet<Guid>();
        foreach (var entry in entries)
        {
            if (!Guid.TryParse(entry.Trim(), out var id))
            {
                return false;
            }

            parsed.Add(id);
        }

        ids = parsed;
        return true;
    }
}
