using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>
/// The ONE canonical JSON form of a task or challenge. The content hash is taken over exactly this text, and the database keeps exactly this text, so
/// a field that is part of the content is part of the hash and part of what is stored, by construction. Every property is written, null or not (no
/// field is silently left out); camelCase names; enums as snake_case words (the phone's schema spells them the same); Devanagari written as itself.
/// </summary>
internal static class ScheduleTaskJson
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower, allowIntegerValues: false) },
    };

    internal static string Sha256Hex(string text) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}

/// <summary>
/// Everything a schedule task says, and nothing about where it is kept (no row id, no version, no owner): the value the content hash covers.
/// <list type="bullet">
/// <item><b>Identity</b>: <see cref="TaskKey"/> (permanent across versions), <see cref="StageIndex"/> (the stage of the version it belongs to, first = 0), <see cref="Order"/>.</item>
/// <item><b>What</b>: <see cref="Name"/>, <see cref="Kind"/>.</item>
/// <item><b>When</b>: <see cref="Timing"/> (one timer or none yet, the repeat, the words).</item>
/// <item><b>How</b>: <see cref="Why"/>, <see cref="Dose"/> (as written), <see cref="Steps"/>, <see cref="Products"/>, the two safety gaps, <see cref="Warnings"/>.</item>
/// <item><b>Look</b> and <b>Ask</b>: what to see afterwards, and the one question.</item>
/// <item><b>Truth</b>: <see cref="Sources"/> (document and page per line), <see cref="Basis"/> (stated, our choice, experience, assumed), <see cref="Origin"/>.</item>
/// </list>
/// P9: only the key, the name, the kind, the timing and the basis are required; every other part may be absent and never refuses a task.
/// </summary>
public sealed record ScheduleTaskContent(
    string TaskKey,
    string Name,
    ScheduleTaskKind Kind,
    ScheduleTaskTiming Timing,
    ScheduleBasis Basis,
    int StageIndex = 0,
    int Order = 0,
    string? Why = null,
    string? Dose = null,
    IReadOnlyList<string>? Steps = null,
    IReadOnlyList<ScheduleProduct>? Products = null,
    int? ReEntryHours = null,
    int? PreHarvestDays = null,
    IReadOnlyList<string>? Warnings = null,
    ScheduleTaskLook? Look = null,
    ScheduleTaskAsk? Ask = null,
    IReadOnlyList<ScheduleSource>? Sources = null,
    string? Origin = null)
{
    public const int MaxNameLength = 200;
    public const int MaxStages = 40;
    public const int MaxOrder = 9999;
    public const int MaxReEntryHours = 720;
    public const int MaxPreHarvestDays = 365;
    public const int MaxLines = 20;
    public const int MaxLineLength = 1000;
    public const int MaxProducts = 30;
    public const int MaxSources = 40;
    public const int MaxLongText = 2000;

    private static readonly Regex KeyShape = new("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>A task or challenge key: 1 to 80 plain characters (letters, digits, <c>.</c> <c>_</c> <c>-</c>), the first a letter or digit.</summary>
    public static bool IsValidKey(string? key) => key is not null && KeyShape.IsMatch(key);

    /// <summary>The same content with every absent list written as an empty one (an absent list and an empty list are the same content).</summary>
    public ScheduleTaskContent Normalized() => this with
    {
        Steps = Steps ?? [],
        Products = Products ?? [],
        Warnings = Warnings ?? [],
        Sources = Sources ?? [],
        Look = Look is null ? null : Look with { IfThen = Look.IfThen ?? [] },
        Ask = Ask is null ? null : Ask with { Answers = Ask.Answers ?? [] },
    };

    /// <summary>The canonical JSON (see <see cref="ScheduleTaskJson"/>): what the hash is taken over and what the database keeps.</summary>
    public string ToCanonicalJson() => JsonSerializer.Serialize(Normalized(), ScheduleTaskJson.Options);

    /// <summary>Reads canonical JSON back. Throws <see cref="JsonException"/> on text that is not a task.</summary>
    public static ScheduleTaskContent? FromCanonicalJson(string json) =>
        JsonSerializer.Deserialize<ScheduleTaskContent>(json, ScheduleTaskJson.Options)?.Normalized();

    /// <summary>SHA-256 (lower-case hex) of the canonical JSON: it changes when ANY field of the task changes.</summary>
    public string ContentHash() => ScheduleTaskJson.Sha256Hex(ToCanonicalJson());

    // spec: plr-d10 schedule slice 3 - the strict reader for a task a phone sends (ownschedule.item.save): the canonical names, and a key the format does not
    // know is a refusal (F5: the push is strict, so a nested object is too), never silently dropped.
    private static readonly JsonSerializerOptions WireOptions = new(ScheduleTaskJson.Options)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        // The five required parts (key, name, kind, timing, basis) must be SENT: an absent kind or basis would otherwise read as the first word of its list.
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
    };

    /// <summary>
    /// Reads a task as a phone sends it (the canonical JSON names, camelCase, snake_case words) and checks it (<see cref="Check"/>). <c>false</c> and the
    /// reason for text that is not a task, a key the format does not know, or a task that does not hold together. Never refuses for a missing OPTIONAL part (P9).
    /// </summary>
    public static bool TryParseWire(string json, out ScheduleTaskContent? content, out ScheduleTaskProblem? problem)
    {
        content = null;
        try
        {
            content = JsonSerializer.Deserialize<ScheduleTaskContent>(json, WireOptions)?.Normalized();
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or ArgumentException or InvalidOperationException)
        {
            problem = new("ScheduleTaskWire", "The task is not in the task format.");
            return false;
        }

        if (content is null)
        {
            problem = new("ScheduleTaskWire", "The task is missing.");
            return false;
        }

        problem = content.Check();
        if (problem is not null)
        {
            content = null;
            return false;
        }

        return true;
    }

    /// <summary>Whether the task holds together. <c>null</c> = fine. Never refuses a task for a missing OPTIONAL part (P9).</summary>
    public ScheduleTaskProblem? Check()
    {
        if (!IsValidKey(TaskKey))
        {
            return new("ScheduleTaskKey", "A task needs a key of 1 to 80 plain characters (letters, digits, '.', '_', '-').");
        }

        if (string.IsNullOrWhiteSpace(Name) || Name.Length > MaxNameLength)
        {
            return new("ScheduleTaskName", $"A task needs a name of 1 to {MaxNameLength} characters.");
        }

        if (!Enum.IsDefined(Kind) || !Enum.IsDefined(Basis))
        {
            return new("ScheduleTaskKind", "The kind or the basis is not one the format knows.");
        }

        if (StageIndex < 0 || StageIndex >= MaxStages)
        {
            return new("ScheduleTaskStage", $"A task belongs to a stage of its version (0 to {MaxStages - 1}).");
        }

        if (Order < 0 || Order > MaxOrder)
        {
            return new("ScheduleTaskOrder", $"The order of a task is 0 to {MaxOrder}.");
        }

        if (ReEntryHours is < 0 or > MaxReEntryHours || PreHarvestDays is < 0 or > MaxPreHarvestDays)
        {
            return new("ScheduleTaskGap", $"The re-entry gap is 0 to {MaxReEntryHours} hours and the pre-harvest gap 0 to {MaxPreHarvestDays} days.");
        }

        if (Timing is null)
        {
            return new("ScheduleTaskTimer", "A task has a timing (a timer or none yet).");
        }

        if (Timing.Check(TaskKey) is { } timing)
        {
            return timing;
        }

        return CheckBounds();
    }

    private ScheduleTaskProblem? CheckBounds()
    {
        static ScheduleTaskProblem Bounds(string what) => new("ScheduleTaskBounds", what);

        if (Over(Why, MaxLongText) || Over(Dose, MaxLongText) || Over(Origin, 120))
        {
            return Bounds($"The why and the dose may be at most {MaxLongText} characters, the origin at most 120.");
        }

        if (TooMany(Steps, MaxLines, MaxLineLength) || TooMany(Warnings, MaxLines, MaxLineLength))
        {
            return Bounds($"A task has at most {MaxLines} steps and {MaxLines} warnings, each at most {MaxLineLength} characters.");
        }

        if (Products is { Count: > MaxProducts } || (Products?.Any(p => p is null || string.IsNullOrWhiteSpace(p.Name) || p.Name.Length > MaxNameLength
                || Over(p.DoseAsWritten, MaxLineLength) || Over(p.Unit, 120) || Over(p.PerWhat, 200) || Over(p.Water, 200)) ?? false))
        {
            return Bounds($"A task has at most {MaxProducts} products, each with a name of 1 to {MaxNameLength} characters.");
        }

        if (CheckSources(Sources) is { } sources)
        {
            return sources;
        }

        if (Look is { } look
            && (Over(look.Where, MaxLineLength) || Over(look.Sample, MaxLineLength) || Over(look.Sign, MaxLineLength) || Over(look.Threshold, MaxLineLength)
                || Over(look.PhotoRef, 120) || CheckIfThen(look.IfThen) is not null))
        {
            return Bounds($"What to look at is words of at most {MaxLineLength} characters with at most {MaxLines} if-thens.");
        }

        if (Ask is { } ask
            && (string.IsNullOrWhiteSpace(ask.Question) || ask.Question.Length > MaxLineLength || Over(ask.When, 200)
                || (ask.Answers is { } answers && (answers.Count > 10 || answers.Any(a => a is null || string.IsNullOrWhiteSpace(a.Answer) || a.Answer.Length > 40
                    || Over(a.Changes, MaxLineLength))))))
        {
            return Bounds($"The question is 1 to {MaxLineLength} characters with at most 10 answers (a code of 1 to 40 characters, and what it changes).");
        }

        return null;
    }

    internal static bool Over(string? text, int max) => text is not null && text.Length > max;

    internal static bool TooMany(IReadOnlyList<string>? lines, int maxCount, int maxLength) =>
        lines is not null && (lines.Count > maxCount || lines.Any(l => l is null || l.Length > maxLength));

    internal static ScheduleTaskProblem? CheckIfThen(IReadOnlyList<ScheduleIfThen>? pairs) =>
        pairs is not null && (pairs.Count > MaxLines || pairs.Any(p => p is null || string.IsNullOrWhiteSpace(p.If) || p.If.Length > MaxLineLength
            || p.Then is null || p.Then.Length > MaxLineLength))
            ? new("ScheduleTaskBounds", $"At most {MaxLines} if-thens, each side at most {MaxLineLength} characters and the 'if' not blank.")
            : null;

    internal static ScheduleTaskProblem? CheckSources(IReadOnlyList<ScheduleSource>? sources) =>
        sources is not null && (sources.Count > MaxSources || sources.Any(s => s is null || string.IsNullOrWhiteSpace(s.Document) || s.Document.Length > MaxNameLength
            || Over(s.Page, 120)))
            ? new("ScheduleTaskBounds", $"At most {MaxSources} sources, each naming its document (at most {MaxNameLength} characters) and where in it (at most 120).")
            : null;
}

/// <summary>
/// One challenge of a stage (a disease, a pest, the weather, a nutrient disorder): what it is, when it comes, the signs, what to do, the if-thens and the
/// sources. A challenge has no timer: it names its season in words and belongs to a stage. Like a task it is content with a hash over every field.
/// </summary>
public sealed record ScheduleChallengeContent(
    string ChallengeKey,
    string Title,
    int StageIndex = 0,
    int Order = 0,
    string? WhenWords = null,
    string? Signs = null,
    string? Action = null,
    IReadOnlyList<ScheduleIfThen>? IfThen = null,
    IReadOnlyList<ScheduleSource>? Sources = null)
{
    public ScheduleChallengeContent Normalized() => this with { IfThen = IfThen ?? [], Sources = Sources ?? [] };

    public string ToCanonicalJson() => JsonSerializer.Serialize(Normalized(), ScheduleTaskJson.Options);

    public static ScheduleChallengeContent? FromCanonicalJson(string json) =>
        JsonSerializer.Deserialize<ScheduleChallengeContent>(json, ScheduleTaskJson.Options)?.Normalized();

    public string ContentHash() => ScheduleTaskJson.Sha256Hex(ToCanonicalJson());

    /// <summary>Whether the challenge holds together. <c>null</c> = fine.</summary>
    public ScheduleTaskProblem? Check()
    {
        if (!ScheduleTaskContent.IsValidKey(ChallengeKey))
        {
            return new("ScheduleChallengeKey", "A challenge needs a key of 1 to 80 plain characters (letters, digits, '.', '_', '-').");
        }

        if (string.IsNullOrWhiteSpace(Title) || Title.Length > ScheduleTaskContent.MaxNameLength)
        {
            return new("ScheduleChallengeTitle", $"A challenge needs a title of 1 to {ScheduleTaskContent.MaxNameLength} characters.");
        }

        if (StageIndex < 0 || StageIndex >= ScheduleTaskContent.MaxStages)
        {
            return new("ScheduleChallengeStage", $"A challenge belongs to a stage of its version (0 to {ScheduleTaskContent.MaxStages - 1}).");
        }

        if (Order < 0 || Order > ScheduleTaskContent.MaxOrder)
        {
            return new("ScheduleChallengeOrder", $"The order of a challenge is 0 to {ScheduleTaskContent.MaxOrder}.");
        }

        if (ScheduleTaskContent.Over(WhenWords, ScheduleTaskContent.MaxLineLength) || ScheduleTaskContent.Over(Signs, ScheduleTaskContent.MaxLongText)
            || ScheduleTaskContent.Over(Action, ScheduleTaskContent.MaxLongText)
            || ScheduleTaskContent.CheckIfThen(IfThen) is not null || ScheduleTaskContent.CheckSources(Sources) is not null)
        {
            return new("ScheduleChallengeBounds", "A challenge's words and lists are within the format's bounds.");
        }

        return null;
    }
}
