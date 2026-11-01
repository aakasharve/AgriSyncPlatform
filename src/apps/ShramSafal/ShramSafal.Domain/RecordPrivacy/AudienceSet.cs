namespace ShramSafal.Domain.RecordPrivacy;

/// <summary>
/// spec: plr-d10 lane PRV fix pass 3 (M-A) — an audience as a set of readers: <see cref="RecordAudience.Team"/> is the
/// widest, <see cref="RecordAudience.OnlyMe"/> the narrowest (the holder and the record's maker, who are in every
/// audience), and <see cref="RecordAudience.Selected"/> those two plus the chosen <see cref="People"/>. Pure.
/// </summary>
public sealed record AudienceSet(RecordAudience Audience, IReadOnlySet<Guid> People)
{
    public static AudienceSet Team { get; } = new(RecordAudience.Team, new HashSet<Guid>());

    public static AudienceSet OnlyMe { get; } = new(RecordAudience.OnlyMe, new HashSet<Guid>());

    /// <summary>The audience as stored: people count only for <see cref="RecordAudience.Selected"/>.</summary>
    public static AudienceSet Of(RecordAudience audience, IEnumerable<Guid>? people) =>
        audience == RecordAudience.Selected
            ? new AudienceSet(audience, (people ?? []).Where(p => p != Guid.Empty).ToHashSet())
            : new AudienceSet(audience, new HashSet<Guid>());

    /// <summary>
    /// Everyone in BOTH (never anyone in only one): the narrowest audience inside both. Selected people with nobody in
    /// common leave only the holder and the maker — <see cref="RecordAudience.OnlyMe"/>.
    /// </summary>
    public AudienceSet Intersect(AudienceSet other)
    {
        ArgumentNullException.ThrowIfNull(other);
        if (Audience == RecordAudience.Team)
        {
            return Of(other.Audience, other.People);
        }

        if (other.Audience == RecordAudience.Team)
        {
            return Of(Audience, People);
        }

        if (Audience == RecordAudience.OnlyMe || other.Audience == RecordAudience.OnlyMe)
        {
            return OnlyMe;
        }

        var common = People.Where(other.People.Contains).ToHashSet();
        return common.Count == 0 ? OnlyMe : new AudienceSet(RecordAudience.Selected, common);
    }

    /// <summary>The same readers (people compared as a set).</summary>
    public bool SameAs(AudienceSet other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Audience == other.Audience && (Audience != RecordAudience.Selected || People.SetEquals(other.People));
    }

    /// <summary>Does every reader of this audience also read <paramref name="other"/>? (this is inside other)</summary>
    public bool Within(AudienceSet other) => Intersect(other).SameAs(this);
}
