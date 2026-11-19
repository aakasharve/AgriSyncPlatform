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
    /// Builds the list from the configuration section's own value and its children
    /// (review round 1, V1). The key must be a LIST
    /// (<c>CompanyMis__ExcludedUserIds__0</c>, <c>__1</c>, ...). Set as one value
    /// (<c>CompanyMis__ExcludedUserIds=...</c>) it has no children, and reading it as
    /// a list would silently give an empty list, so every test account would be
    /// counted: a value of its own stops start-up instead. The message never
    /// repeats the value.
    /// </summary>
    public static CompanyMisExclusions FromConfiguration(string? ownValue, IEnumerable<string?>? children)
    {
        if (!string.IsNullOrWhiteSpace(ownValue))
        {
            throw new InvalidOperationException(
                $"Configuration '{ConfigurationKey}' is set as a single value; it must be a list: "
                + "CompanyMis__ExcludedUserIds__0, CompanyMis__ExcludedUserIds__1, ... "
                + "Fix the server environment; the value itself is not repeated here.");
        }

        return Parse(children);
    }

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
