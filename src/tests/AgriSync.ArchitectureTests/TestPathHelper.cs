using System.Xml.Linq;

namespace AgriSync.ArchitectureTests;

internal static class TestPathHelper
{
    public static string GetAppsRoot()
    {
        var solutionRoot = GetSolutionRoot();
        var appsRoot = Path.Combine(solutionRoot, "Apps");

        if (!Directory.Exists(appsRoot))
        {
            throw new DirectoryNotFoundException($"Apps directory not found at: {appsRoot}");
        }

        return appsRoot;
    }

    private static string GetSolutionRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "AgriSync.sln")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate AgriSync.sln from test execution directory.");
    }
}

internal static class ProjectReferenceReader
{
    public static IReadOnlyCollection<string> GetReferencedProjectPaths(string projectFilePath)
    {
        var projectDirectory = Path.GetDirectoryName(projectFilePath)
            ?? throw new InvalidOperationException($"Could not resolve project directory for {projectFilePath}");

        var document = XDocument.Load(projectFilePath);
        return document
            .Descendants("ProjectReference")
            .Select(reference => reference.Attribute("Include")?.Value)
            .Where(include => !string.IsNullOrWhiteSpace(include))
            .Select(include => Path.GetFullPath(Path.Combine(projectDirectory, include!)))
            .ToArray();
    }
}
