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

    [Fact]
    public void BuildingBlocks_Does_Not_Depend_On_App_Projects()
    {
        var solutionRoot = typeof(TestPathHelper)
            .Assembly
            .GetType("AgriSync.ArchitectureTests.TestPathHelper") is not null
            ? Directory.GetParent(TestPathHelper.GetAppsRoot())!.FullName
            : throw new InvalidOperationException("Could not resolve solution root.");

        var buildingBlocksProject = Directory
            .GetFiles(solutionRoot, "AgriSync.BuildingBlocks.csproj", SearchOption.AllDirectories)
            .Single();

        var referencedProjectPaths = ProjectReferenceReader.GetReferencedProjectPaths(buildingBlocksProject);
        var violations = referencedProjectPaths
            .Where(path =>
            {
                var fileName = Path.GetFileName(path);
                return fileName.StartsWith("ShramSafal.", StringComparison.OrdinalIgnoreCase)
                    || fileName.StartsWith("User.", StringComparison.OrdinalIgnoreCase);
            })
            .ToList();

        Assert.True(
            violations.Count == 0,
            "AgriSync.BuildingBlocks cannot reference app projects:" + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }

    [Fact]
    public void Application_Does_Not_Depend_On_Its_Own_Infrastructure()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var applicationProjects = Directory.GetFiles(appsRoot, "*.Application.csproj", SearchOption.AllDirectories);

        Assert.NotEmpty(applicationProjects);

        var violations = new List<string>();

        foreach (var applicationProject in applicationProjects)
        {
            var projectDirectory = Path.GetDirectoryName(applicationProject) ?? string.Empty;
            var appRoot = Directory.GetParent(projectDirectory)?.Parent?.FullName ?? string.Empty;
            var appName = Path.GetFileName(appRoot);
            if (string.IsNullOrWhiteSpace(appName))
            {
                continue;
            }

            var disallowedProjectName = $"{appName}.Infrastructure.csproj";
            foreach (var referencedProject in ProjectReferenceReader.GetReferencedProjectPaths(applicationProject))
            {
                if (string.Equals(Path.GetFileName(referencedProject), disallowedProjectName, StringComparison.OrdinalIgnoreCase))
                {
                    violations.Add($"{applicationProject} -> {referencedProject}");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "Application projects cannot reference their own Infrastructure projects:" + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }

    [Fact]
    public void ShramSafal_Domain_Does_Not_Depend_On_User_Domain()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var shramSafalDomainProject = Directory
            .GetFiles(appsRoot, "ShramSafal.Domain.csproj", SearchOption.AllDirectories)
            .Single();

        var referencedProjectPaths = ProjectReferenceReader.GetReferencedProjectPaths(shramSafalDomainProject);
        var violations = referencedProjectPaths
            .Where(path => string.Equals(Path.GetFileName(path), "User.Domain.csproj", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Assert.True(
            violations.Count == 0,
            "ShramSafal.Domain cannot reference User.Domain:" + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }

    /// <summary>
    /// Sub-plan 03 Task 4: application handlers must surface business
    /// outcomes via <c>Result.Failure</c>, never via thrown exceptions.
    /// Domain-layer invariants (programming errors) keep their throws —
    /// this test only walks <c>*.Application/UseCases/**/*Handler.cs</c>.
    /// </summary>
    [Fact]
    public void Application_handlers_must_not_throw_InvalidOperationException_or_ArgumentException()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var applicationProjects = Directory.GetFiles(appsRoot, "*.Application.csproj", SearchOption.AllDirectories);

        Assert.NotEmpty(applicationProjects);

        var offenders = new List<string>();

        foreach (var applicationProject in applicationProjects)
        {
            var projectDirectory = Path.GetDirectoryName(applicationProject) ?? string.Empty;
            var useCasesDirectory = Path.Combine(projectDirectory, "UseCases");
            if (!Directory.Exists(useCasesDirectory))
            {
                continue;
            }

            foreach (var handlerFile in Directory.EnumerateFiles(useCasesDirectory, "*Handler.cs", SearchOption.AllDirectories))
            {
                var text = File.ReadAllText(handlerFile);
                if (text.Contains("throw new InvalidOperationException")
                    || text.Contains("throw new ArgumentException"))
                {
                    offenders.Add(handlerFile);
                }
            }
        }

        Assert.True(
            offenders.Count == 0,
            "Application handlers must return Result.Failure, not throw. " +
            "If you really need an exception (e.g. programming error), file a Pending Task " +
            "documenting why and reference it from the offending handler:" +
            Environment.NewLine + string.Join(Environment.NewLine, offenders));
    }
}
