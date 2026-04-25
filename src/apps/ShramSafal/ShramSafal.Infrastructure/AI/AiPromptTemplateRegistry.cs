using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiPromptTemplateRegistry
{
    private const string ResourceRoot = "AI.Prompts";
    private static readonly IReadOnlyList<string> RequiredBucketIds =
    [
        "workDone",
        "irrigation",
        "inputs",
        "labour",
        "machinery",
        "expenses",
        "tasks",
        "observations"
    ];

    private readonly PromptModule _systemBase;
    private readonly PromptModule _outputContract;
    private readonly IReadOnlyDictionary<string, PromptModule> _bucketModules;
    private readonly PromptModule _disturbance;
    private readonly string _contentHash;

    public AiPromptTemplateRegistry()
    {
        _systemBase = LoadModule("core/systemBase.md", "v1");
        _outputContract = LoadModule("core/outputContract.md", "v1");
        _bucketModules = RequiredBucketIds.ToDictionary(
            bucketId => bucketId,
            bucketId => LoadModule($"buckets/{bucketId}.v1.md", "v1"),
            StringComparer.Ordinal);
        _disturbance = LoadModule("inner/disturbance.v1.md", "v1");

        _contentHash = AiPromptLineage.ComputeContentHash(
            string.Join(
                "\n---\n",
                new[]
                {
                    _systemBase.Content,
                    _outputContract.Content,
                    string.Join("\n---\n", _bucketModules.Values.Select(x => x.Content)),
                    _disturbance.Content
                }));
    }

    public string CurrentVoicePromptVersion => BuildVersionString();

    public string BuildVoiceParsingPrompt(
        VoiceParseContext context,
        string farmKnowledge,
        string visualContext,
        string learnedVocabulary,
        string marathiVocab,
        string workerMarkers,
        string fewShotExamples)
    {
        var bucketRules = string.Join(
            Environment.NewLine + Environment.NewLine,
            RequiredBucketIds.Select(bucketId =>
                $"### Visible Bucket: {bucketId}{Environment.NewLine}{_bucketModules[bucketId].Content}"));

        var prompt = $"""
                     <!-- AGRISYNC_PROMPT_VERSION {CurrentVoicePromptVersion} -->
                     {_systemBase.Content}

                     {farmKnowledge}
                     {visualContext}
                     {learnedVocabulary}

                     WORKER MARKERS:
                     {workerMarkers}

                     MARATHI VOCABULARY MAPPINGS:
                     {marathiVocab}

                     BUCKET RULES:
                     {bucketRules}

                     INNER MODIFIER:
                     {_disturbance.Content}

                     OUTPUT CONTRACT:
                     {_outputContract.Content}

                     FEW SHOT EXAMPLES:
                     {fewShotExamples}

                     FINAL RULE:
                     Return minified JSON only.
                     """;

        return prompt.Trim();
    }

    private string BuildVersionString()
    {
        var bucketVersions = string.Join(
            ",",
            RequiredBucketIds.Select(bucketId => $"{bucketId}:{_bucketModules[bucketId].Version}"));

        return $"base:{_systemBase.Version};output:{_outputContract.Version};buckets:{bucketVersions};disturbance:{_disturbance.Version};hash:{_contentHash}";
    }

    private static PromptModule LoadModule(string relativePath, string fallbackVersion)
    {
        var assembly = typeof(AiPromptTemplateRegistry).Assembly;
        var resourceSuffix = $"{ResourceRoot}.{relativePath.Replace('/', '.')}";
        var resourceName = assembly
            .GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith(resourceSuffix, StringComparison.OrdinalIgnoreCase));

        if (resourceName is null)
        {
            throw new InvalidOperationException($"AI prompt module '{relativePath}' is missing from embedded resources.");
        }

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"AI prompt module '{relativePath}' could not be opened.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return new PromptModule(relativePath, ExtractVersion(relativePath, fallbackVersion), reader.ReadToEnd().Trim());
    }

    private static string ExtractVersion(string relativePath, string fallbackVersion)
    {
        var fileName = Path.GetFileName(relativePath);
        var parts = fileName.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length >= 3 && parts[^2].StartsWith('v') ? parts[^2] : fallbackVersion;
    }

    private sealed record PromptModule(string RelativePath, string Version, string Content);
}

internal static class AiPromptLineage
{
    private const string ModularVersionMarker = "AGRISYNC_PROMPT_VERSION";
    private const string LegacyPromptVersion = "legacy-2026-02-22";

    public static string ResolvePromptVersion(string systemPrompt)
    {
        var markerIndex = systemPrompt.IndexOf(ModularVersionMarker, StringComparison.Ordinal);
        if (markerIndex >= 0)
        {
            var lineEnd = systemPrompt.IndexOf('\n', markerIndex);
            var line = lineEnd >= 0 ? systemPrompt[markerIndex..lineEnd] : systemPrompt[markerIndex..];
            return line
                .Replace(ModularVersionMarker, string.Empty, StringComparison.Ordinal)
                .Replace("-->", string.Empty, StringComparison.Ordinal)
                .Trim();
        }

        return $"{LegacyPromptVersion};hash:{ComputeContentHash(systemPrompt)}";
    }

    public static string ComputeContentHash(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(bytes).ToLowerInvariant()[..16];
    }
}

