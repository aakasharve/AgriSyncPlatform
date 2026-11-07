// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 1)
using System.Globalization;
using System.Text;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Persistence.InputLibrary;

/// <summary>
/// Source 1 reaches the database through the migration <c>AddInputLibrary</c>, which asks this class for its INSERT statements.
/// They are built here, in C#, from the library the build embeds (<c>catalog.json</c>, read through
/// <see cref="InputLibraryWorkspace.FromEmbeddedSeed"/>); no data is written into the migration source. Every statement ends in
/// <c>ON CONFLICT DO NOTHING</c>, so running the seed twice, or over rows that are already there, adds nothing.
///
/// <para>The migration runs this BEFORE it turns row-level security on, because from then on the app role may not write these
/// tables. The seed rows are written by the schema runner, as <c>cost_categories</c>' were.</para>
/// </summary>
public static class InputLibrarySeedSql
{
    private const int RowsPerStatement = 100;

    /// <summary>The seed statements for the library the build embeds, in dependency order (sources, products, refs, meta).</summary>
    public static IReadOnlyList<string> ForEmbeddedSeed() => For(InputLibraryWorkspace.FromEmbeddedSeed());

    /// <summary>The seed statements for a workspace (only its published rows are seeded; there are no conflicts to seed).</summary>
    public static IReadOnlyList<string> For(InputLibraryWorkspace workspace)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        var statements = new List<string>();

        statements.AddRange(Insert(
            "input_library_sources",
            "id, title, kind, received_on, checked_by, status, position",
            workspace.Sources.Where(s => s.Status == InputLibraryStatus.Published).Select(s => string.Join(
                ", ", Text(s.Id), Text(s.Title), Text(s.Kind), Text(s.ReceivedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)) + "::date",
                s.CheckedBy is null ? "NULL" : Text(s.CheckedBy), Text(s.Status), s.Position.ToString(CultureInfo.InvariantCulture)))));

        statements.AddRange(Insert(
            "input_library_products",
            "id, category, facts, match_key, status, ordinal",
            workspace.Products.Where(p => p.Status == InputLibraryStatus.Published).OrderBy(p => p.Ordinal).Select(p => string.Join(
                ", ", Text(p.Id), Text(p.Category), Text(p.Facts) + "::jsonb", Text(p.MatchKey), Text(p.Status), p.Ordinal.ToString(CultureInfo.InvariantCulture)))));

        statements.AddRange(Insert(
            "input_library_source_refs",
            "product_id, source_id, ref, entry",
            workspace.SourceRefs.Select(r => string.Join(
                ", ", Text(r.ProductId), Text(r.SourceId), Text(r.Ref), r.Entry is null ? "NULL" : Text(r.Entry)))));

        statements.AddRange(Insert(
            "input_library_meta",
            "id, shape_version, published_version, non_matching_words",
            [string.Join(", ", InputLibraryMeta.OnlyId.ToString(CultureInfo.InvariantCulture), Text(workspace.Meta.ShapeVersion),
                workspace.Meta.PublishedVersion.ToString(CultureInfo.InvariantCulture), Text(workspace.Meta.NonMatchingWords) + "::jsonb")]));

        return statements;
    }

    private static IEnumerable<string> Insert(string table, string columns, IEnumerable<string> tuples)
    {
        var batch = new List<string>(RowsPerStatement);
        foreach (var tuple in tuples)
        {
            batch.Add("(" + tuple + ")");
            if (batch.Count == RowsPerStatement)
            {
                yield return Statement(table, columns, batch);
                batch.Clear();
            }
        }

        if (batch.Count > 0)
        {
            yield return Statement(table, columns, batch);
        }
    }

    private static string Statement(string table, string columns, List<string> tuples) =>
        new StringBuilder()
            .Append("INSERT INTO ssf.").Append(table).Append(" (").Append(columns).AppendLine(") VALUES")
            .AppendJoin("," + Environment.NewLine, tuples)
            .AppendLine()
            .Append("ON CONFLICT DO NOTHING;")
            .ToString();

    /// <summary>A SQL string literal. Quotes are doubled; the server reads backslashes literally (standard_conforming_strings is on).</summary>
    internal static string Text(string value) => "'" + value.Replace("'", "''", StringComparison.Ordinal) + "'";
}
