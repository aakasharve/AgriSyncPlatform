// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 1)
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Inputs;

/// <summary>What he said about one product of one saved record (D-92): <c>हो</c>, <c>नाही</c> or <c>फोटो</c>.</summary>
public enum IdentityVerdict
{
    /// <summary>"Yes, this is that product." Carries the library product he confirmed.</summary>
    Confirmed,

    /// <summary>"No, that is not it."</summary>
    Rejected,

    /// <summary>"I kept a photo of the packet." A photo counts as half an identity (D-93); that count is IT3's.</summary>
    Photo,
}

/// <summary>The three answers as they travel on the wire and sit in the database: lower-case words.</summary>
public static class IdentityVerdictWire
{
    public const string Confirmed = "confirmed";
    public const string Rejected = "rejected";
    public const string Photo = "photo";

    public static string ToWire(IdentityVerdict verdict) => verdict switch
    {
        IdentityVerdict.Confirmed => Confirmed,
        IdentityVerdict.Rejected => Rejected,
        IdentityVerdict.Photo => Photo,
        _ => throw new ArgumentOutOfRangeException(nameof(verdict), verdict, "Unknown identity answer."),
    };

    /// <summary>Reads a wire word (any case). Anything else is not an answer.</summary>
    public static bool TryParse(string? wire, out IdentityVerdict verdict)
    {
        switch (wire?.Trim().ToLowerInvariant())
        {
            case Confirmed:
                verdict = IdentityVerdict.Confirmed;
                return true;
            case Rejected:
                verdict = IdentityVerdict.Rejected;
                return true;
            case Photo:
                verdict = IdentityVerdict.Photo;
                return true;
            default:
                verdict = default;
                return false;
        }
    }
}

/// <summary>
/// One answer about the identity of one product named in one saved record: <c>ssf.input_identity_assertions</c>.
///
/// <para><b>An overlay, never an edit (founder D-92; doctrine P1, P3, P7).</b> The record's content document, its
/// version, its tasks, its quantities and its confirmation are not touched: an answer is a separate, append-only row,
/// and the app role holds SELECT and INSERT on the table only. The newest row for the same item
/// (<see cref="DailyLogId"/>, <see cref="InputEventId"/>, <see cref="MixIndex"/>) is the current answer, read by
/// <see cref="AssertedAtUtc"/>; the earlier rows stay as history.</para>
///
/// <para><b>Whose answer it is (founder D-95).</b> The speaker's answer is optional and is kept as his, never as the
/// check (<see cref="IsCheck"/> is <c>false</c>). The check is an answer from a holder of <c>ConfirmRecords</c> on the
/// farm (<see cref="IsCheck"/> is <c>true</c>). The server sets the flag from the sender's standing at that moment;
/// the phone never sends it.</para>
///
/// <para><see cref="SpokenName"/> is copied by the server from the stored content item, never read from the request.
/// <see cref="CatalogVersion"/> is the library version the phone matched against.</para>
/// </summary>
public sealed class InputIdentityAssertion : Entity<Guid>
{
    /// <summary>The longest item id the record's content accepts (<c>LogContentDocument</c>), so the same bound here.</summary>
    public const int MaxInputEventId = 128;

    /// <summary>The longest sync request id kept with an answer (the same bound as the other append-only ledgers).</summary>
    public const int MaxClientMutationId = 200;

    /// <summary>The longest library version string kept.</summary>
    public const int MaxCatalogVersion = 64;

    /// <summary>The longest product id kept (<c>p-...</c>).</summary>
    public const int MaxCatalogProductId = 128;

    /// <summary>His words for the product are clipped here, never refused: a copy of a label, not a quantity.</summary>
    public const int MaxSpokenName = 500;

    private InputIdentityAssertion() : base(Guid.Empty) { } // EF Core

    private InputIdentityAssertion(
        Guid id,
        FarmId farmId,
        Guid? plotId,
        Guid dailyLogId,
        string inputEventId,
        int mixIndex,
        string spokenName,
        string? catalogProductId,
        IdentityVerdict verdict,
        Guid? attachmentId,
        string catalogVersion,
        UserId assertedByUserId,
        DateTime assertedAtUtc,
        string clientMutationId,
        bool isCheck)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        DailyLogId = dailyLogId;
        InputEventId = inputEventId;
        MixIndex = mixIndex;
        SpokenName = spokenName;
        CatalogProductId = catalogProductId;
        Verdict = verdict;
        AttachmentId = attachmentId;
        CatalogVersion = catalogVersion;
        AssertedByUserId = assertedByUserId;
        AssertedAtUtc = assertedAtUtc;
        ClientMutationId = clientMutationId;
        IsCheck = isCheck;
    }

    /// <summary>The record's farm: its own column, so the row policy needs no join (F8); asserted in code too (E4).</summary>
    public FarmId FarmId { get; private set; }

    /// <summary>The record's plot, when it has exactly one.</summary>
    public Guid? PlotId { get; private set; }

    public Guid DailyLogId { get; private set; }

    /// <summary>The id of the input event in the record's content (<c>inputs[].id</c>).</summary>
    public string InputEventId { get; private set; } = string.Empty;

    /// <summary>The slot in that event's <c>mix[]</c>.</summary>
    public int MixIndex { get; private set; }

    /// <summary>His words for the product, copied from the stored content item.</summary>
    public string SpokenName { get; private set; } = string.Empty;

    /// <summary>The library product he confirmed (<c>p-...</c>); required for <see cref="IdentityVerdict.Confirmed"/>.</summary>
    public string? CatalogProductId { get; private set; }

    public IdentityVerdict Verdict { get; private set; }

    /// <summary>The packet photo, for <see cref="IdentityVerdict.Photo"/>.</summary>
    public Guid? AttachmentId { get; private set; }

    /// <summary>The library version the phone matched against (<c>inputs-2.4</c>).</summary>
    public string CatalogVersion { get; private set; } = string.Empty;

    public UserId AssertedByUserId { get; private set; }

    /// <summary>When the server took the answer (its clock, never the phone's).</summary>
    public DateTime AssertedAtUtc { get; private set; }

    /// <summary>The sync request that carried it; with the farm it is unique, so a replay changes nothing.</summary>
    public string ClientMutationId { get; private set; } = string.Empty;

    /// <summary>True when the sender held <c>ConfirmRecords</c> on the farm at that moment (D-95): the check. False: the speaker's own answer.</summary>
    public bool IsCheck { get; private set; }

    /// <summary>Makes the one new row. Nothing here is ever changed afterwards.</summary>
    public static InputIdentityAssertion Record(
        Guid id,
        FarmId farmId,
        Guid? plotId,
        Guid dailyLogId,
        string inputEventId,
        int mixIndex,
        string spokenName,
        string? catalogProductId,
        IdentityVerdict verdict,
        Guid? attachmentId,
        string catalogVersion,
        UserId by,
        DateTime atUtc,
        string clientMutationId,
        bool isCheck = false)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("An answer needs its own id.", nameof(id));
        }

        if (farmId.Value == Guid.Empty)
        {
            throw new ArgumentException("An answer belongs to a farm.", nameof(farmId));
        }

        if (dailyLogId == Guid.Empty)
        {
            throw new ArgumentException("An answer is about a saved record.", nameof(dailyLogId));
        }

        if (string.IsNullOrWhiteSpace(inputEventId) || inputEventId.Trim().Length > MaxInputEventId)
        {
            throw new ArgumentException($"The input item id is required and at most {MaxInputEventId} characters.", nameof(inputEventId));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(mixIndex);

        if (string.IsNullOrWhiteSpace(spokenName))
        {
            throw new ArgumentException("An answer is about a product he named: his words are required.", nameof(spokenName));
        }

        if (!Enum.IsDefined(verdict))
        {
            throw new ArgumentOutOfRangeException(nameof(verdict), verdict, "Unknown identity answer.");
        }

        var productId = string.IsNullOrWhiteSpace(catalogProductId) ? null : catalogProductId.Trim();
        if (productId is not null && productId.Length > MaxCatalogProductId)
        {
            throw new ArgumentException($"A product id is at most {MaxCatalogProductId} characters.", nameof(catalogProductId));
        }

        if (verdict == IdentityVerdict.Confirmed && productId is null)
        {
            throw new ArgumentException("A confirmed answer names the library product he confirmed.", nameof(catalogProductId));
        }

        // A photo answer IS the photo: it names the attachment. (The attachment row may not be on the server yet when the answer
        // arrives - the phone may upload it later - so only the pointer is required here; whether the row exists is for whoever
        // counts a photo answer.)
        if (verdict == IdentityVerdict.Photo && (attachmentId is null || attachmentId == Guid.Empty))
        {
            throw new ArgumentException("A photo answer names its photo.", nameof(attachmentId));
        }

        if (string.IsNullOrWhiteSpace(catalogVersion) || catalogVersion.Trim().Length > MaxCatalogVersion)
        {
            throw new ArgumentException($"The library version is required and at most {MaxCatalogVersion} characters.", nameof(catalogVersion));
        }

        if (by.IsEmpty)
        {
            throw new ArgumentException("An answer names who gave it.", nameof(by));
        }

        if (string.IsNullOrWhiteSpace(clientMutationId) || clientMutationId.Trim().Length > MaxClientMutationId)
        {
            throw new ArgumentException($"The request id is required and at most {MaxClientMutationId} characters.", nameof(clientMutationId));
        }

        var words = spokenName.Trim();
        return new InputIdentityAssertion(
            id,
            farmId,
            plotId == Guid.Empty ? null : plotId,
            dailyLogId,
            inputEventId.Trim(),
            mixIndex,
            words.Length > MaxSpokenName ? words[..MaxSpokenName] : words,
            productId,
            verdict,
            attachmentId == Guid.Empty ? null : attachmentId,
            catalogVersion.Trim(),
            by,
            atUtc,
            clientMutationId.Trim(),
            isCheck);
    }
}
