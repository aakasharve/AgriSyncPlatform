namespace ShramSafal.Application.UseCases.Admin.GetCompanyMis;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, decision 4). The user
/// ids of test accounts left out of every company count. Read once at start
/// from the configuration key <see cref="ConfigurationKey"/> (an array of user
/// GUIDs). Git carries an empty array; real ids live only in the server's
/// environment. The answer carries only how many there are, never the ids.
/// </summary>
public sealed record CompanyMisExclusions(IReadOnlySet<Guid> UserIds)
{
    public const string ConfigurationKey = "CompanyMis:ExcludedUserIds";

    public static CompanyMisExclusions None { get; } = new(new HashSet<Guid>());

    /// <summary>
    /// Trims every entry and ignores empty or missing ones. An entry that is not
    /// a GUID stops start-up: the message names the key and the entry's position,
    /// never the value (it might be a phone number pasted by mistake).
    /// </summary>
    public static CompanyMisExclusions Parse(IEnumerable<string?>? raw)
    {
        var ids = new HashSet<Guid>();
        if (raw is null)
        {
            return new CompanyMisExclusions(ids);
        }

        var position = 0;
        foreach (var entry in raw)
        {
            var text = entry?.Trim();
            if (!string.IsNullOrEmpty(text))
            {
                if (!Guid.TryParse(text, out var id))
                {
                    throw new InvalidOperationException(
                        $"Configuration '{ConfigurationKey}' entry at position {position} is not a user id (GUID). " +
                        "Fix the server environment value; the value itself is not repeated here.");
                }

                ids.Add(id);
            }

            position++;
        }

        return new CompanyMisExclusions(ids);
    }
}
