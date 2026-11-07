using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who
/// and when"). One reviewer's मंजूर on one bill (a <see cref="CostEntry"/>): WHO approved, WHEN (the server's clock) and
/// WHICH version of the bill he saw (<see cref="CostEntry.ContentVersion"/> at that moment).
///
/// <para>A separate, append-only row — never a column flipped on the bill (doctrine P3). The bill keeps its own figures and
/// its own review flag; a later correction makes a new version, and this stamp then reads as "for an older version": it is
/// never carried to the new numbers. Money review only — a work record's मंजूर is a different thing (D-40: "मंजुरी म्हणजे
/// कामाच्या नोंदीची खात्री. पैसे दिल्याची नोंद वेगळी आहे.").</para>
/// </summary>
public sealed class CostEntryApproval : Entity<Guid>
{
    /// <summary>The longest client request id / app version kept with a stamp (the sync envelope's, never trusted for order).</summary>
    public const int MaxClientRequestId = 200;
    public const int MaxAppVersion = 64;

    private CostEntryApproval() : base(Guid.Empty) { } // EF Core

    private CostEntryApproval(
        Guid id,
        FarmId farmId,
        Guid costEntryId,
        int billVersion,
        UserId approvedByUserId,
        DateTime approvedAtUtc,
        string? clientRequestId,
        string? appVersion)
        : base(id)
    {
        FarmId = farmId;
        CostEntryId = costEntryId;
        BillVersion = billVersion;
        ApprovedByUserId = approvedByUserId;
        ApprovedAtUtc = approvedAtUtc;
        ClientRequestId = clientRequestId;
        AppVersion = appVersion;
    }

    /// <summary>The bill's farm — its own column, so the row policy needs no join (F8) and tenancy is asserted in code (E4).</summary>
    public FarmId FarmId { get; private set; }

    public Guid CostEntryId { get; private set; }

    /// <summary>The bill's <see cref="CostEntry.ContentVersion"/> this stamp is for.</summary>
    public int BillVersion { get; private set; }

    public UserId ApprovedByUserId { get; private set; }

    /// <summary>When the server took the approval (never the phone's clock).</summary>
    public DateTime ApprovedAtUtc { get; private set; }

    /// <summary>The sync request that carried it (null on the REST door). Telemetry, never an authorisation input (E9).</summary>
    public string? ClientRequestId { get; private set; }

    /// <summary>The app version that sent it. Telemetry, never an authorisation input (E9).</summary>
    public string? AppVersion { get; private set; }

    /// <summary>
    /// The stamp for <paramref name="entry"/> as it stands NOW (its current version). Only <see cref="CostEntry.Approve"/>
    /// makes one, after it has checked the version the reviewer saw.
    /// </summary>
    internal static CostEntryApproval For(
        Guid id,
        CostEntry entry,
        UserId approvedByUserId,
        DateTime approvedAtUtc,
        string? clientRequestId,
        string? appVersion)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("An approval needs its own id.", nameof(id));
        }

        if (approvedByUserId.IsEmpty)
        {
            throw new ArgumentException("An approval names who gave it.", nameof(approvedByUserId));
        }

        return new CostEntryApproval(
            id,
            entry.FarmId,
            entry.Id,
            entry.ContentVersion,
            approvedByUserId,
            approvedAtUtc,
            Clip(clientRequestId, MaxClientRequestId),
            Clip(appVersion, MaxAppVersion));
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length > max ? trimmed[..max] : trimmed;
    }
}

/// <summary>
/// lane BILL-1 — the one rule for "तपासायचे" on a bill: the server set it aside (<see cref="CostEntry.IsFlagged"/>) and no
/// stamp covers the version it stands at now. An approval clears the flag for THAT version only: a correction after it
/// makes a new version, and a flagged bill is then तपासायचे again (the flag itself is history and is never erased, P3).
/// </summary>
public static class CostEntryReview
{
    /// <summary>Is <paramref name="entry"/> waiting for a reviewer, given every stamp it has?</summary>
    public static bool NeedsReview(CostEntry entry, IEnumerable<CostEntryApproval> approvals)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(approvals);
        return entry.IsFlagged && !approvals.Any(a => a.CostEntryId == entry.Id && a.BillVersion == entry.ContentVersion);
    }

    /// <summary>The stamp to show: the most recent one (a stale approval is refused, so it is also the highest version).</summary>
    public static CostEntryApproval? Latest(CostEntry entry, IEnumerable<CostEntryApproval> approvals)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentNullException.ThrowIfNull(approvals);
        return approvals
            .Where(a => a.CostEntryId == entry.Id && a.FarmId == entry.FarmId)
            .OrderByDescending(a => a.ApprovedAtUtc)
            .ThenByDescending(a => a.BillVersion)
            .FirstOrDefault();
    }
}
