using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Admin.GetFarmContacts;

/// <summary>
/// Ids is the raw <c>ids</c> query value: farm ids separated by commas. IsPlatformAdmin is the caller's resolved
/// admin scope.
/// </summary>
public sealed record GetFarmContactsQuery(string? Ids, Guid ActorId, bool IsPlatformAdmin);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). Farm names and owner phones for a list of farm
/// ids, so the pages the console polls every 30 seconds never open the audited cross-farm factory: they carry farm
/// ids only and the console asks here once per new id.
/// <list type="number">
/// <item>A caller who is not a platform admin is refused before anything is read, so no factory is opened (defence
/// in depth: the route gates first).</item>
/// <item>The ids must be 1 to <see cref="MaxIds"/> uuids separated by commas; anything else is refused before
/// anything is read.</item>
/// <item>A farm that does not exist is left out of the answer.</item>
/// </list>
/// <para><b>A repository failure is not caught.</b> It escapes to the server's error path (500); an empty answer
/// would read as "these farms have no name".</para>
/// </summary>
public sealed class GetFarmContactsHandler(IAdminMisRepository misRepo)
{
    public const int MaxIds = 200;

    public const string IdsInvalidCode = "admin.contacts_ids_invalid";

    public const string PlatformOnlyCode = "admin.platform_only";

    public async Task<Result<IReadOnlyList<FarmContactDto>>> HandleAsync(
        GetFarmContactsQuery query, CancellationToken ct = default)
    {
        if (!query.IsPlatformAdmin)
        {
            return Result.Failure<IReadOnlyList<FarmContactDto>>(
                Error.Forbidden(PlatformOnlyCode, "Farm names and phones are for platform owners only."));
        }

        if (!TryParseIds(query.Ids, out var ids))
        {
            return Result.Failure<IReadOnlyList<FarmContactDto>>(
                Error.Validation(IdsInvalidCode, $"Give 1 to {MaxIds} farm ids separated by commas."));
        }

        var contacts = await misRepo.GetFarmContactsAsync(query.ActorId, ids, ct);
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
