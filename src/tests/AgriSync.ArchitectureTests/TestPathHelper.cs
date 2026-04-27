using System.Xml.Linq;

namespace AgriSync.ArchitectureTests;

internal static class TestPathHelper
{
    public static string GetAppsRoot()
    {
        var solutionRoot = GetSolutionRoot();
        // The on-disk folder is lowercase "apps". Windows is case-insensitive
        // so "Apps" used to resolve there too; Linux/CI is case-sensitive and
        // requires the exact name. See MEMORY.md "Folder casing" + the .sln
        // virtual-folder note.
        var appsRoot = Path.Combine(solutionRoot, "apps");

        if (!Directory.Exists(appsRoot))
        {
            throw new DirectoryNotFoundException($"apps directory not found at: {appsRoot}");
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
