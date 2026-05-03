namespace ShramSafal.Domain.Wtl;

/// <summary>
/// Value object wrapping a worker's name as both raw text and a
/// normalized form used for fuzzy matching within a farm.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>. Equality is on
/// <see cref="Normalized"/> only — that is the field the
/// <see cref="WorkerRepositoryFindOrCreate"/> path scans against per farm.
/// </para>
/// <para>
/// Normalization rules:
/// </para>
/// <list type="bullet">
/// <item><description>trim leading and trailing whitespace</description></item>
/// <item><description>strip the most common Marathi honorifics
///   (<c>मा.</c>, <c>श्री.</c>, the suffix <c>भाऊ</c>) — these surface
///   from regex extraction and would otherwise create duplicate
///   <c>Worker</c> rows for the same person</description></item>
/// <item><description>lowercase via <see cref="string.ToLowerInvariant"/>
///   (no-op for Devanagari but keeps the contract clean for any
///   transliterated names that may slip through)</description></item>
/// </list>
/// <para>
/// Edge cases (e.g. <c>"रमेशजी"</c> versus <c>"रमेश"</c>) intentionally
/// stay distinct in v0 — see ADR §Consequences. WTL v1 introduces a
/// manual reconcile flow.
/// </para>
/// </remarks>
public sealed record WorkerName(string Raw, string Normalized)
{
    /// <summary>
    /// Constructs a <see cref="WorkerName"/> from a raw extracted token.
    /// Throws if <paramref name="raw"/> is null, empty, or whitespace.
    /// </summary>
    public static WorkerName From(string raw)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(raw);

        var trimmedRaw = raw.Trim();

        var normalized = trimmedRaw
            .Replace("मा.", string.Empty)
            .Replace("श्री.", string.Empty)
            .Replace("भाऊ", string.Empty)
            .Trim()
            .ToLowerInvariant();

        return new WorkerName(trimmedRaw, normalized);
    }
}
