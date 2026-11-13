namespace ShramSafal.Domain.Compare;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3. The key तुलना gives each piece of work of a record
/// (<c>ownWork[].workKey</c>): the recognised work's part and its finest known detail (<c>spray:fungicide</c>, <c>nutrition:npk-0-52-34</c>,
/// <c>work:op_tying</c>), or <see cref="Unrecognised"/> for work the recogniser cannot read (R12). Moved here unchanged from
/// the farm compare read so the read that SHOWS a key and the write that CHECKS one (<c>logreason.set</c>) can never disagree.
/// </summary>
public static class CompareWorkKey
{
    /// <summary>The key of a record the recogniser could not read. A reason is never kept on one (R12: not counted as anything).</summary>
    public const string Unrecognised = "unrecognised";

    public static string Of(WorkIdentity? identity)
    {
        if (identity is null)
        {
            return Unrecognised;
        }

        var part = identity.Part.ToString().ToLowerInvariant();
        var detail = identity.Role ?? identity.NutrientKey ?? identity.OperationKey;
        return detail is null ? part : $"{part}:{detail}";
    }

    /// <summary>The key of the work a task's words say (the same recogniser तुलना reads a record with).</summary>
    public static string OfWords(string? activityType) =>
        string.IsNullOrWhiteSpace(activityType) ? Unrecognised : Of(WorkRecogniser.Recognise(activityType));
}
