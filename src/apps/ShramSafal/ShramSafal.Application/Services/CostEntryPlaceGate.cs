using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 fix round 1 (review H1). The single-bill doors that CHANGE
/// a bill (approve it, correct it) ask THE place rule the read side uses (<see cref="RecordPlaceRule"/>) for EVERY seat it
/// narrows — a chosen-plots seat, and an own-records seat (the स्वतःचं काम scope or the कामगार label, §11.7: "other people's
/// money never reaches him") — not only the chosen-plots one. A bill his pull would never send him is, to these doors, a bill
/// that is not there: <see cref="Domain.Common.ShramSafalErrors.CostEntryNotFound"/>, exactly as a bill of another farm, with
/// no figure and no version in the answer.
/// </summary>
public static class CostEntryPlaceGate
{
    /// <summary>Is <paramref name="entry"/> outside what <paramref name="userId"/>'s seat may see by its PLACE (or its maker)?</summary>
    public static async Task<bool> HiddenFromAsync(
        IShramSafalRepository repository, CostEntry entry, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(entry);
        var farmId = (Guid)entry.FarmId;

        // Cheap for everyone else: a seat that may read by place is found first by one bounded read (MU-4's pre-filter).
        if ((await repository.GetFarmsMaybeReadByPlaceAsync(userId, [farmId], ct)).Count == 0)
        {
            return false;
        }

        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct);
        if (!RecordPlaceRule.Narrows(scope))
        {
            return false;
        }

        var place = RecordPlace.OfCost(entry.Id, farmId, entry.CreatedByUserId.Value, entry.EntryDate, entry.CreatedAtUtc,
            entry.PlotId, entry.SourceAiJobId, entry.ClientAttachmentIdsJson);
        return !RecordPlaceRule.MaySee(scope, userId, place);
    }
}
