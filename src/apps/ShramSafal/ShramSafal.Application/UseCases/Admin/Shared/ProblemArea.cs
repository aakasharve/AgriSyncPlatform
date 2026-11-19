using AgriSync.BuildingBlocks.Analytics;

namespace ShramSafal.Application.UseCases.Admin.Shared;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2, amendment C6). Which part of the app a problem
/// belongs to: syncing, saving entries, voice, or other. Each problem lands in exactly one area.
///
/// <para>
/// The route is the recorded key <c>props->>'route'</c>, written by the request middleware as
/// <c>"VERB /pattern"</c> with the group prefix in front (for example <c>"POST /shramsafal/logs"</c>). Only the
/// pattern's ending is matched, so the prefix does not matter. The rule:
/// </para>
/// <list type="bullet">
/// <item>a failed <c>ai.invocation</c> is <see cref="Voice"/>;</item>
/// <item>a <c>client.error</c> (a problem the phone reported) or a row with no route is <see cref="Other"/>;</item>
/// <item>a route ending in <c>/sync/push</c> or <c>/sync/pull</c> is <see cref="Sync"/>;</item>
/// <item><c>POST …/logs</c> and any <c>…/logs/{id:guid}/…</c> are <see cref="Entries"/>;</item>
/// <item>a route ending in one of the voice routes (<see cref="VoiceEndings"/>) is <see cref="Voice"/>;</item>
/// <item>anything else is <see cref="Other"/>.</item>
/// </list>
/// <para>
/// <see cref="KnownRoutes"/> lists the routes the server records today for the three named areas, taken from the
/// route map (<c>SyncEndpoints</c>, <c>LogsEndpoints</c>, <c>AiEndpoints</c>, <c>AiStreamingEndpoints</c>,
/// <c>AiTranscribeStreamEndpoints</c>, <c>VoiceDiaryEndpoints</c>).
/// </para>
/// </summary>
public static class ProblemArea
{
    public const string Sync = "sync", Entries = "entries", Voice = "voice", Other = "other";

    /// <summary>The outcome an <c>ai.invocation</c> row carries when the call failed.</summary>
    private const string FailureOutcome = "failure";

    private static readonly string[] SyncEndings = ["/sync/push", "/sync/pull"];

    /// <summary><c>POST</c> to a route ending here saves an entry.</summary>
    private const string EntrySaveEnding = "/logs";

    /// <summary>Any route with this segment acts on one saved entry.</summary>
    private const string OneEntrySegment = "/logs/{id:guid}/";

    /// <summary>Voice parse, the streaming voice routes, and the voice diary.</summary>
    public static IReadOnlyList<string> VoiceEndings { get; } =
    [
        "/ai/voice-parse",
        "/ai/parse-voice",
        "/ai/parse-voice-stream",
        "/ai/transcribe-stream",
        "/voice-diary/persist",
        "/voice-diary/by-range",
        "/voice-diary/by-id/{clipId:guid}",
    ];

    /// <summary>
    /// The area of one problem. <paramref name="routePattern"/> is the recorded <c>props->>'route'</c>
    /// (<c>"VERB /pattern"</c>); <paramref name="outcome"/> is <c>props->>'outcome'</c>. Always one of
    /// <see cref="Sync"/>, <see cref="Entries"/>, <see cref="Voice"/>, <see cref="Other"/>.
    /// </summary>
    public static string For(string eventType, string? routePattern, string? outcome)
    {
        if (string.Equals(eventType, AnalyticsEventType.AiInvocation, StringComparison.Ordinal))
        {
            return string.Equals(outcome, FailureOutcome, StringComparison.Ordinal) ? Voice : Other;
        }

        if (string.Equals(eventType, AnalyticsEventType.ClientError, StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(routePattern))
        {
            return Other;
        }

        var text = routePattern.Trim();
        var space = text.IndexOf(' ');
        var verb = space > 0 ? text[..space] : string.Empty;
        var path = (space > 0 ? text[(space + 1)..] : text).Trim().TrimEnd('/');

        if (path.Length == 0)
        {
            return Other;
        }

        if (EndsWithAny(path, SyncEndings))
        {
            return Sync;
        }

        if ((string.Equals(verb, "POST", StringComparison.OrdinalIgnoreCase)
                && path.EndsWith(EntrySaveEnding, StringComparison.OrdinalIgnoreCase))
            || path.Contains(OneEntrySegment, StringComparison.OrdinalIgnoreCase))
        {
            return Entries;
        }

        if (EndsWithAny(path, VoiceEndings))
        {
            return Voice;
        }

        return Other;
    }

    private static bool EndsWithAny(string path, IReadOnlyList<string> endings)
    {
        foreach (var ending in endings)
        {
            if (path.EndsWith(ending, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
