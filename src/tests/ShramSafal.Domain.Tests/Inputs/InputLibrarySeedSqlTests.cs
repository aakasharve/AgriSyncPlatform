// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 1)
using System.Text;
using System.Text.RegularExpressions;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Persistence.InputLibrary;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// Source 1 reaches the database from the embedded catalog.json, as INSERT statements the migration builds in C# (never a
/// SQL literal in the migration source). The statements are idempotent and quote-safe. The database side (the rows read back
/// equal to catalog.json) is the real-Postgres class <c>InputLibraryRlsRealPostgresTests</c>.
/// </summary>
public sealed class InputLibrarySeedSqlTests
{
    private static readonly Regex Tuple = new(@"^\(", RegexOptions.Multiline | RegexOptions.CultureInvariant);

    [Fact]
    public void Seed_Statements_AreIdempotent_AndCoverSource1()
    {
        var statements = InputLibrarySeedSql.ForEmbeddedSeed();

        Assert.All(statements, s => Assert.EndsWith("ON CONFLICT DO NOTHING;", s, StringComparison.Ordinal));
        var sources = statements.Where(s => s.StartsWith("INSERT INTO ssf.input_library_sources", StringComparison.Ordinal)).ToList();
        var products = statements.Where(s => s.StartsWith("INSERT INTO ssf.input_library_products", StringComparison.Ordinal)).ToList();
        var refs = statements.Where(s => s.StartsWith("INSERT INTO ssf.input_library_source_refs", StringComparison.Ordinal)).ToList();
        var meta = statements.Where(s => s.StartsWith("INSERT INTO ssf.input_library_meta", StringComparison.Ordinal)).ToList();

        Assert.Single(sources);
        Assert.Single(meta);
        Assert.Equal(297, products.Sum(s => Tuple.Matches(s).Count));
        Assert.Equal(297, refs.Sum(s => Tuple.Matches(s).Count));
        Assert.Equal(3, products.Count); // batched, so no statement is a 12,000-line literal
        Assert.DoesNotContain(statements, s => s.Contains("'draft'", StringComparison.Ordinal));
        Assert.Contains("'agro-dosage-guide-en'", sources[0], StringComparison.Ordinal);
        Assert.Contains("'inputs-2'", meta[0], StringComparison.Ordinal);
        // The statements for the five tables are the only ones: no policy, no grant, nothing for another table.
        Assert.All(statements, s => Assert.StartsWith("INSERT INTO ssf.input_library_", s, StringComparison.Ordinal));
    }

    [Fact]
    public void Seed_Quotes_AreDoubled_SoNoTextCanBreakOutOfItsLiteral()
    {
        var catalog = File.ReadAllText(InputReferenceFiles.Path("catalog.json"))
            .Replace("Agro Dosage Guide (English), 309 pp., founder copy", "Farmer's guide '); DROP TABLE ssf.farms; --", StringComparison.Ordinal);
        var workspace = InputLibraryWorkspace.FromCatalogJson(Encoding.UTF8.GetBytes(catalog));

        var sql = string.Join("\n", InputLibrarySeedSql.For(workspace));

        Assert.Contains("'Farmer''s guide ''); DROP TABLE ssf.farms; --'", sql, StringComparison.Ordinal);
    }
}
