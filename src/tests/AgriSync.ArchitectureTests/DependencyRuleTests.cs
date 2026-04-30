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
    /// Sub-plan 03 Task 10: application code must NEVER swallow exceptions
    /// silently. Two failure modes are flagged:
    /// <list type="number">
    /// <item>EMPTY body — <c>catch { }</c>, <c>catch (X) { /* note */ }</c>,
    /// where after stripping comments the body has nothing in it.</item>
    /// <item>NON-EMPTY body but NO observability signal — the body
    /// returns / assigns / falls through without re-throwing,
    /// producing a <c>Result.Failure</c>, recording a
    /// <c>DegradedComponent</c>, logging via <c>ILogger</c>, or
    /// emitting an <c>Activity</c> event. Example:
    /// <c>catch { storagePath = string.Empty; }</c></item>
    /// </list>
    /// The full set of permitted signals is enumerated in
    /// <see cref="ObservabilityTokens"/>. NO whitelist — every new
    /// silent-swallow fails the build with the file:line.
    /// </summary>
    private static readonly string[] ObservabilityTokens =
    {
        "throw",                              // re-throw / new exception
        "Result.Failure",                     // typed failure return
        "Result.Success",                     // explicit success short-circuit
        "MutationExecutionOutcome.Failure",   // PushSyncBatch typed-failure builder
        "MutationExecutionOutcome.Success",   // ditto, success builder
        "CreateFailedResult",                 // PushSyncBatch private failure helper
        "CreateDuplicateResult",              // PushSyncBatch private duplicate helper
        "Activity.Current",                   // OTel observability seam
        "ActivityEvent",                      // explicit Activity event
        ".Log",                               // ILogger.LogXxx (anchors on the dot)
        "_logger",                            // common field name
        "_log.",                              // alt field name
        "logger.",                            // local var
        "Logger.",                            // PascalCase property
        "degraded.Add",                       // DegradedComponent collection
        "Degraded.Add",                       // PascalCase variant
    };

    [Fact]
    public void Application_layer_must_not_silently_swallow_exceptions()
    {
        var appsRoot = TestPathHelper.GetAppsRoot();
        var applicationProjects = Directory.GetFiles(appsRoot, "*.Application.csproj", SearchOption.AllDirectories);

        Assert.NotEmpty(applicationProjects);

        var catchOpener = new System.Text.RegularExpressions.Regex(
            @"\bcatch\b\s*(\([^)]*\))?\s*\{",
            System.Text.RegularExpressions.RegexOptions.Compiled);

        var offenders = new List<string>();

        foreach (var applicationProject in applicationProjects)
        {
            var projectDirectory = Path.GetDirectoryName(applicationProject) ?? string.Empty;
            foreach (var sourceFile in Directory.EnumerateFiles(projectDirectory, "*.cs", SearchOption.AllDirectories))
            {
                if (sourceFile.Contains(Path.DirectorySeparatorChar + "obj" + Path.DirectorySeparatorChar)
                    || sourceFile.Contains(Path.DirectorySeparatorChar + "bin" + Path.DirectorySeparatorChar))
                {
                    continue;
                }
                var text = File.ReadAllText(sourceFile);
                foreach (System.Text.RegularExpressions.Match m in catchOpener.Matches(text))
                {
                    var openBraceIdx = m.Index + m.Length - 1; // points at `{`
                    var bodyEndIdx = FindMatchingBrace(text, openBraceIdx);
                    if (bodyEndIdx < 0) continue; // unbalanced source — don't false-positive
                    var body = text.Substring(openBraceIdx + 1, bodyEndIdx - openBraceIdx - 1);
                    var stripped = StripCommentsAndWhitespace(body);
                    var lineNumber = text[..m.Index].Count(c => c == '\n') + 1;
                    var snippet = m.Value.TrimEnd();

                    if (stripped.Length == 0)
                    {
                        offenders.Add($"{sourceFile}:{lineNumber}: {snippet} <empty body>");
                        continue;
                    }

                    // Non-empty body — require at least one observability
                    // signal. Anything else is a silent swallow.
                    var hasSignal = false;
                    foreach (var token in ObservabilityTokens)
                    {
                        if (stripped.Contains(token, StringComparison.Ordinal))
                        {
                            hasSignal = true;
                            break;
                        }
                    }
                    if (!hasSignal)
                    {
                        offenders.Add($"{sourceFile}:{lineNumber}: {snippet} <body has no observability signal>");
                    }
                }
            }
        }

        Assert.True(
            offenders.Count == 0,
            "Application code must NOT silently swallow exceptions. Each " +
            "catch block body must contain at least one of: " +
            "throw / Result.Failure / Result.Success / Activity.Current / " +
            "ActivityEvent / .Log* / logger / degraded.Add. Offenders:" +
            Environment.NewLine + string.Join(Environment.NewLine, offenders));
    }

    private static int FindMatchingBrace(string text, int openBraceIdx)
    {
        var depth = 1;
        for (var i = openBraceIdx + 1; i < text.Length; i++)
        {
            var c = text[i];
            // Skip string literals (very rough — sufficient for C# without
            // raw-string features in catch bodies, which would be unusual).
            if (c == '"')
            {
                i++;
                while (i < text.Length && text[i] != '"')
                {
                    if (text[i] == '\\' && i + 1 < text.Length) { i++; }
                    i++;
                }
                continue;
            }
            if (c == '{') depth++;
            else if (c == '}')
            {
                depth--;
                if (depth == 0) return i;
            }
        }
        return -1;
    }

    private static string StripCommentsAndWhitespace(string body)
    {
        // Strip // line comments.
        var lineCommentStripped = System.Text.RegularExpressions.Regex.Replace(
            body, @"//[^\n]*", string.Empty);
        // Strip /* block comments */.
        var blockCommentStripped = System.Text.RegularExpressions.Regex.Replace(
            lineCommentStripped, @"/\*.*?\*/", string.Empty,
            System.Text.RegularExpressions.RegexOptions.Singleline);
        return blockCommentStripped.Trim();
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
