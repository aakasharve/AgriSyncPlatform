using System.Text.Json;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.AI.Dfes;

/// <summary>
/// Lane DFES-Q (founder D-B, D-G, 2026-11-21) - the sources of a question that states agronomy come only from Shram Safal's OWN
/// published schedule: the Schedule Maker's output, projected to its look lines by <c>sync-contract/scripts/project-dfes-schedule.mjs</c>
/// and embedded here (<c>sync-contract/schedules/*.dfes.json</c>, the same file the phone reads). Never a PDF, never the phone's word.
///
/// <para>A line counts only when it carries at least one source (document and page) and is neither marked as the schedule's own
/// choice (<c>ourChoice</c>) nor left to an expert (<c>expertDecides</c>). All or nothing: one unknown line, an empty list, or a
/// line that does not count rejects the whole question (fail closed, P4).</para>
/// </summary>
internal sealed class ScheduleSourceResolver : IQuestionSourceResolver
{
    private const string ResourcePrefix = "ShramSafal.Infrastructure.Schedules.";
    private const string ResourceSuffix = ".dfes.json";

    private readonly Dictionary<string, IReadOnlyList<QuestionSourceRef>> _sourcesByLine;

    public ScheduleSourceResolver()
        : this(ReadEmbeddedSchedules())
    {
    }

    /// <summary>Builds the resolver from schedule documents in the projected shape (the embedded ones in production).</summary>
    internal ScheduleSourceResolver(IEnumerable<string> scheduleDocuments)
    {
        _sourcesByLine = new Dictionary<string, IReadOnlyList<QuestionSourceRef>>(StringComparer.Ordinal);
        foreach (var json in scheduleDocuments)
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("lines", out var lines) || lines.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var line in lines.EnumerateArray())
            {
                var id = line.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(id) || IsTrue(line, "ourChoice") || IsTrue(line, "expertDecides"))
                {
                    continue;
                }

                var sources = ReadSources(id, line);
                if (sources.Count == 0)
                {
                    continue;
                }

                if (!_sourcesByLine.TryAdd(id, sources))
                {
                    throw new InvalidOperationException($"Schedule look line '{id}' appears twice; line ids must be unique.");
                }
            }
        }
    }

    /// <summary>How many look lines can stand as a source (for tests and diagnostics).</summary>
    internal int LineCount => _sourcesByLine.Count;

    public IReadOnlyList<QuestionSourceRef>? Resolve(IReadOnlyList<string> lookLineIds)
    {
        if (lookLineIds is null || lookLineIds.Count == 0)
        {
            return null;
        }

        var resolved = new List<QuestionSourceRef>();
        foreach (var id in lookLineIds)
        {
            if (id is null || !_sourcesByLine.TryGetValue(id, out var sources))
            {
                return null;
            }

            resolved.AddRange(sources);
        }

        return resolved;
    }

    private static List<QuestionSourceRef> ReadSources(string lineId, JsonElement line)
    {
        var sources = new List<QuestionSourceRef>();
        if (!line.TryGetProperty("sources", out var array) || array.ValueKind != JsonValueKind.Array)
        {
            return sources;
        }

        foreach (var source in array.EnumerateArray())
        {
            var docId = source.TryGetProperty("docId", out var d) ? d.GetString() : null;
            var page = source.TryGetProperty("page", out var p) ? p.GetString() : null;
            if (!string.IsNullOrWhiteSpace(docId) && !string.IsNullOrWhiteSpace(page))
            {
                sources.Add(new QuestionSourceRef(lineId, docId, page));
            }
        }

        return sources;
    }

    private static bool IsTrue(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static IEnumerable<string> ReadEmbeddedSchedules()
    {
        var assembly = typeof(ScheduleSourceResolver).Assembly;
        var names = assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal) && n.EndsWith(ResourceSuffix, StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal);
        foreach (var name in names)
        {
            using var stream = assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"Embedded schedule '{name}' could not be opened.");
            using var reader = new StreamReader(stream);
            yield return reader.ReadToEnd();
        }
    }
}
