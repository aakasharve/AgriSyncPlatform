using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// F254 (a): the data-export job must list the CMP-D3 reasons table, so a person's export carries the reasons on their own logs.
/// Source scan, like the sibling manifest test: no database needed.
/// </summary>
public sealed class ExportManifestLogPracticeReasonsTests
{
    [Fact]
    public void ExportWorker_writes_log_practice_reasons_for_the_person()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "src", "apps", "ShramSafal", "ShramSafal.Infrastructure", "Privacy", "ExportWorker.cs")))
            dir = Path.GetDirectoryName(dir);
        Assert.NotNull(dir);

        var src = File.ReadAllText(Path.Combine(dir!, "src", "apps", "ShramSafal", "ShramSafal.Infrastructure", "Privacy", "ExportWorker.cs"));
        Assert.Contains("log_practice_reasons.json", src);
        Assert.Contains("admin.LogPracticeReasons", src);
        Assert.Contains("AuthorUserId == userKey", src);
        Assert.Contains("OperatorUserId == userKey", src);
    }
}
