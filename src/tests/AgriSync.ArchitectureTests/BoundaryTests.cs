using Xunit;

namespace AgriSync.ArchitectureTests;

public sealed class BoundaryTests
{
    [Fact]
    public void Apps_Do_Not_Reference_Each_Other()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var appDirectories = Directory.GetDirectories(appsRoot);
        var appNames = appDirectories
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToArray();

        Assert.NotEmpty(appNames);

        var violations = new List<string>();

        foreach (var appDirectory in appDirectories)
        {
            var currentAppName = Path.GetFileName(appDirectory);
            var disallowedMarkers = appNames
                .Where(name => !string.Equals(name, currentAppName, StringComparison.OrdinalIgnoreCase))
                .Select(name => $"{Path.DirectorySeparatorChar}Apps{Path.DirectorySeparatorChar}{name}{Path.DirectorySeparatorChar}")
                .ToArray();

            foreach (var projectFile in Directory.GetFiles(appDirectory, "*.csproj", SearchOption.AllDirectories))
            {
                foreach (var referencedProject in ProjectReferenceReader.GetReferencedProjectPaths(projectFile))
                {
                    if (disallowedMarkers.Any(marker =>
                            referencedProject.Contains(marker, StringComparison.OrdinalIgnoreCase)))
                    {
                        violations.Add($"{projectFile} -> {referencedProject}");
                    }
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "Cross-app project references are not allowed:" + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }
}
