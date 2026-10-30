using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Consent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36) — one choice a
/// person made about the OPTIONAL improvement permission, "माझ्या अनुभवातून श्रमसफल अधिक
/// सक्षम होऊ द्या": may his voice recordings, his corrections and the related work context
/// be used to train and evaluate the systems behind ShramSafal.
///
/// <para><b>Separate by construction</b> (D-36: "Keep improvement permission separate from
/// required service acceptance, original-voice storage and authorised playback"). It is its
/// own table, written only by its own endpoint and read only by
/// <c>ImprovementPermissionGate</c>. The service tick, the "keep my original voice" switch
/// and the old <c>CrossFarmAggregation</c> / <c>VerbatimTrainingCorpus</c> flags never
/// count as this permission.</para>
///
/// <para><b>Append-only.</b> A withdrawal is a NEW row with <see cref="Allowed"/> false;
/// "allowed on the 3rd, withdrawn on the 9th" stays readable. The app role holds no
/// UPDATE / DELETE / TRUNCATE on the table. The newest row is the person's current
/// choice; no row at all means OFF (the default).</para>
///
/// <para><b>Belongs to one person.</b> <see cref="UserId"/> is always the account that
/// made the choice — taken from the caller's token, never from a request body — and the
/// table's row-level policy only shows a person his own rows.</para>
/// </summary>
public sealed class ImprovementPermissionEvent : Entity<Guid>
{
    /// <summary>Longest version / language / app-version string accepted (the column width).</summary>
    public const int MaxShortTextLength = 60;

    private ImprovementPermissionEvent() : base(Guid.Empty) { } // EF Core

    private ImprovementPermissionEvent(
        Guid id,
        Guid userId,
        bool allowed,
        string wordingVersion,
        string languageShown,
        string appVersion,
        DateTime chosenAtUtc)
        : base(id)
    {
        UserId = userId;
        Allowed = allowed;
        WordingVersion = wordingVersion;
        LanguageShown = languageShown;
        AppVersion = appVersion;
        ChosenAtUtc = chosenAtUtc;
    }

    /// <summary>The person who made the choice. Never empty.</summary>
    public Guid UserId { get; private set; }

    /// <summary>True = he switched it ON. False = OFF (a withdrawal, or an explicit "no").</summary>
    public bool Allowed { get; private set; }

    /// <summary>The version of the words he was shown when he chose. Stored as sent.</summary>
    public string WordingVersion { get; private set; } = null!;

    /// <summary>The language the words were shown in (mr / en).</summary>
    public string LanguageShown { get; private set; } = null!;

    /// <summary>The app build that showed the words.</summary>
    public string AppVersion { get; private set; } = null!;

    /// <summary>Server time the choice was recorded.</summary>
    public DateTime ChosenAtUtc { get; private set; }

    /// <summary>
    /// Records a choice. Throws on missing evidence — a permission row that cannot say who
    /// chose, what words he saw or when, proves nothing.
    /// </summary>
    public static ImprovementPermissionEvent Record(
        Guid id,
        Guid userId,
        bool allowed,
        string wordingVersion,
        string languageShown,
        string appVersion,
        DateTime chosenAtUtc)
    {
        if (id == Guid.Empty) throw new ArgumentException("id required", nameof(id));
        if (userId == Guid.Empty) throw new ArgumentException("userId required", nameof(userId));
        if (chosenAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("chosenAtUtc must be UTC", nameof(chosenAtUtc));
        }

        return new ImprovementPermissionEvent(
            id,
            userId,
            allowed,
            RequireShort(wordingVersion, nameof(wordingVersion)),
            RequireShort(languageShown, nameof(languageShown)),
            RequireShort(appVersion, nameof(appVersion)),
            chosenAtUtc);
    }

    /// <summary>True when this row is an ON given against exactly <paramref name="currentWordingVersion"/>.</summary>
    public bool AllowsUnder(string currentWordingVersion) =>
        Allowed && string.Equals(WordingVersion, currentWordingVersion, StringComparison.Ordinal);

    private static string RequireShort(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} required", name);
        var trimmed = value.Trim();
        if (trimmed.Length > MaxShortTextLength)
        {
            throw new ArgumentException($"{name} longer than {MaxShortTextLength}", name);
        }
        return trimmed;
    }
}
