using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT; CTO ruling on founder question 1 = A). A person's own identity card
/// (<c>public.user_identity_profiles</c>) holds his Farmer ID, village, taluka, district and PIN, which are HIS alone. Outside the User context only
/// three files may name the table: the pull's people reader (which may select <c>name_mr</c> and <c>name_en</c> and nothing else of it) and the two
/// privacy workers (erasure deletes the row, export gives it to him). A new reader that names the table fails here and forces the conversation.
/// </summary>
public sealed class IdentityCardReadersPinTests
{
    private const string Table = "user_identity_profiles";

    [Fact]
    public void Only_the_two_name_columns_of_a_persons_card_leave_the_User_context()
    {
        var apps = TestPathHelper.GetAppsRoot();
        var src = TestPathHelper.GetSolutionRoot();
        var user = Path.Combine(apps, "User") + Path.DirectorySeparatorChar;
        var mentions = new[] { apps, Path.Combine(src, "AgriSync.Bootstrapper"), Path.Combine(src, "AgriSync.BuildingBlocks"), Path.Combine(src, "AgriSync.SharedKernel") }
            .SelectMany(dir => Directory.GetFiles(dir, "*.cs", SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}tests{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.StartsWith(user, StringComparison.OrdinalIgnoreCase))
            .Where(f => File.ReadAllText(f).Contains(Table, StringComparison.Ordinal))
            .Select(f => Path.GetFileName(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        mentions.Should().Equal(["ErasureWorker.cs", "ExportWorker.cs", "ShramSafalRepository.cs"],
            "outside the User context only the people reader and the two privacy workers may name the identity card table");

        var repository = File.ReadAllText(Path.Combine(apps, "ShramSafal", "ShramSafal.Infrastructure", "Persistence", "Repositories", "ShramSafalRepository.cs"));
        repository.Should().Contain($"left join public.{Table} idp", "the people reader joins the card as idp");
        Regex.Matches(repository, @"\bidp\.(?<column>[a-z_*]+)")
            .Select(m => m.Groups["column"].Value)
            .Distinct()
            .OrderBy(c => c, StringComparer.Ordinal)
            .Should().Equal(["name_en", "name_mr", "user_id"], "the people reader reads his two names (and joins on his id), nothing else of his card");
    }
}
