using Xunit;

namespace AgriSync.ArchitectureTests;

public sealed class DependencyRuleTests
{
    [Fact]
    public void Domain_Does_Not_Depend_On_Infrastructure()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var domainProjectFiles = Directory.GetFiles(appsRoot, "*.Domain.csproj", SearchOption.AllDirectories);

        Assert.NotEmpty(domainProjectFiles);

        var violations = new List<string>();

        foreach (var domainProjectFile in domainProjectFiles)
        {
            var referencedProjectPaths = ProjectReferenceReader.GetReferencedProjectPaths(domainProjectFile);
            foreach (var referencedProjectPath in referencedProjectPaths)
            {
                if (Path.GetFileName(referencedProjectPath)
                    .EndsWith(".Infrastructure.csproj", StringComparison.OrdinalIgnoreCase))
                {
                    violations.Add($"{domainProjectFile} -> {referencedProjectPath}");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "Domain projects cannot reference Infrastructure projects:" + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }
}
