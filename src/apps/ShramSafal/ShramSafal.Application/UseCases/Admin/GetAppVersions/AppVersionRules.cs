namespace ShramSafal.Application.UseCases.Admin.GetAppVersions;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (ADR 0028); lifted for
/// company-mis-real-numbers-2026-11-15 (plan CR-2c, amendment E9, as C10 did).
/// The two app-version rules, in ONE place, so the app-versions page and the
/// Company MIS (#52) count the same way:
/// <list type="bullet">
/// <item><see cref="LatestPerPerson{T}"/>: a person counts once, on their MOST
/// RECENT row (not the highest version they ever had); two rows at the very
/// same instant: the higher version wins, so the answer does not depend on the
/// order the rows arrived in;</item>
/// <item><see cref="VersionOrder"/>: versions are ordered by their
/// dot-separated numbers, so 1.0.9 is older than 1.0.18; a part that is not a
/// number sorts lowest; a missing part counts as 0.</item>
/// </list>
/// Moved unchanged from <see cref="GetAppVersionsHandler"/>.
/// </summary>
public static class AppVersionRules
{
    /// <summary>Orders app versions by their dot-separated parts, read as numbers.</summary>
    public static IComparer<string> VersionOrder => VersionOrderComparer.Instance;

    /// <summary>One row per person: their most recent row.</summary>
    public static List<T> LatestPerPerson<T>(
        IEnumerable<T> rows, Func<T, Guid> person, Func<T, DateTime> seenAtUtc, Func<T, string> version)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(person);
        ArgumentNullException.ThrowIfNull(seenAtUtc);
        ArgumentNullException.ThrowIfNull(version);

        var latest = new Dictionary<Guid, T>();

        foreach (var row in rows)
        {
            var key = person(row);
            if (!latest.TryGetValue(key, out var best) || IsLater(row, best, seenAtUtc, version))
            {
                latest[key] = row;
            }
        }

        return latest.Values.ToList();
    }

    // Two rows at the very same instant: the higher version wins, so the
    // answer does not depend on the order the rows arrived in.
    private static bool IsLater<T>(T row, T best, Func<T, DateTime> seenAtUtc, Func<T, string> version) =>
        seenAtUtc(row) > seenAtUtc(best)
        || (seenAtUtc(row) == seenAtUtc(best)
            && VersionOrderComparer.Instance.Compare(version(row), version(best)) > 0);

    /// <summary>
    /// Orders app versions by their dot-separated parts, read as numbers. A
    /// part that is not a number (the "18-beta" of 1.0.18-beta) sorts below
    /// every number; a missing part counts as 0.
    /// </summary>
    private sealed class VersionOrderComparer : IComparer<string>
    {
        public static readonly VersionOrderComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            var a = (x ?? string.Empty).Split('.');
            var b = (y ?? string.Empty).Split('.');

            for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
            {
                var byPart = ComparePart(i < a.Length ? a[i] : "0", i < b.Length ? b[i] : "0");
                if (byPart != 0)
                {
                    return byPart;
                }
            }

            return 0;
        }

        private static int ComparePart(string a, string b)
        {
            var aIsNumber = IsNumber(a);
            var bIsNumber = IsNumber(b);

            if (aIsNumber && bIsNumber)
            {
                // Compared as digits, not parsed: a version header may be 32
                // characters long, which no integer type holds.
                var aDigits = a.AsSpan().TrimStart('0');
                var bDigits = b.AsSpan().TrimStart('0');
                return aDigits.Length != bDigits.Length
                    ? aDigits.Length.CompareTo(bDigits.Length)
                    : aDigits.SequenceCompareTo(bDigits);
            }

            if (aIsNumber != bIsNumber)
            {
                return aIsNumber ? 1 : -1;
            }

            return string.CompareOrdinal(a, b);
        }

        private static bool IsNumber(string part) => part.Length > 0 && part.All(char.IsAsciiDigit);
    }
}
