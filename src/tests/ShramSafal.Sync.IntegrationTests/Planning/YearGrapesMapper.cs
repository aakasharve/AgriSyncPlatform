// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
// TEST-SIDE reader of the grape year file (G:\agrisync-scratch\schedule-kit\year\year.json: nine stages, 160 works, 84 challenges, every line with its source). It
// turns the file into the task format and back, so the round trip can prove nothing is lost. It is NOT the importer (slice 7 owns that): it only knows enough of the file
// to carry it through the format and read the same numbers out again.
//
// THE FILE HOLDS SHOWN DAYS and this mapper never shifts them twice. The file counts a season's day 1 as the pruning day (shown), so a day D of a season starts at stored
// (season base + D - 1): the fruit season counts from the fruit pruning (base 0), the April season from the April foundation pruning (base 177: "April day 1 = stored
// 177", the plan's Global Constraints), and the one reader line that leads up to the NEXT fruit pruning from stored 365. A day before the pruning is a plain negative number
// in the file (the kit's "-19" is stored -20: the file's own date column, iso0, says 25 Sep for 15 Oct, 20 days before). Nothing here subtracts a second time.
//
// What the format does NOT carry (and why that is not a loss): d (the day label), by and iso0 (dates worked out from the days for the sample year), ic (the icon, which
// follows the kind), the stage colour / art / month label / story (the founder's page), and `conflict` (always null: one value per point, 22 Nov). The mapper asserts
// `conflict` is null on every line, so nothing is dropped silently.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Sync.IntegrationTests.Planning;

internal static class YearGrapesMapper
{
    internal sealed record Mapped(
        IReadOnlyList<StageDefinition> Stages,
        IReadOnlyList<ScheduleStageSign> StageSigns,
        IReadOnlyList<ScheduleTaskContent> Tasks,
        IReadOnlyList<ScheduleChallengeContent> Challenges,
        IReadOnlyDictionary<string, int> BaseByTaskKey);

    private const int AprilBase = 177;
    private const int NextFruitBase = 365;
    private const string PageWord = " पान ";

    private static readonly Dictionary<string, ScheduleTaskKind> Kinds = new()
    {
        ["काम"] = ScheduleTaskKind.Work,
        ["औषध"] = ScheduleTaskKind.Spray,
        ["खत"] = ScheduleTaskKind.Nutrition,
        ["पाणी"] = ScheduleTaskKind.Irrigation,
        ["पाहणी"] = ScheduleTaskKind.Observe,
    };

    public static Mapped Map(JsonElement root)
    {
        var stageElements = root.GetProperty("stages").EnumerateArray().ToList();
        var stageIndexByKey = stageElements.Select((s, i) => (Key: s.GetProperty("key").GetString()!, Index: i)).ToDictionary(x => x.Key, x => x.Index);

        // The stages: the file gives each stage's stored start (a0) and the stored start of the next (a1), so the last stored day is a1 - 1.
        var stages = stageElements
            .Select(s => new StageDefinition(s.GetProperty("n").GetString()!, s.GetProperty("a0").GetInt32(), s.GetProperty("a1").GetInt32() - 1))
            .ToList();

        // The signs a stage starts or ends on are the file's own words: "... ते काढणी" (to harvest), "काढणी ते खरड छाटणी" (harvest to the April pruning).
        var signs = new List<ScheduleStageSign>();
        for (var i = 0; i < stageElements.Count; i++)
        {
            var label = stageElements[i].GetProperty("days").GetString()!;
            var parts = label.Split(" ते ", 2, StringSplitOptions.None);
            if (parts.Length != 2)
            {
                continue;
            }

            string? start = parts[0].Contains("दिवस", StringComparison.Ordinal) ? null : parts[0];
            string? end = parts[1].Length > 0 && !char.IsDigit(parts[1][0]) && !(parts[1][0] >= '०' && parts[1][0] <= '९') ? parts[1] : null;
            if (start is not null || end is not null)
            {
                signs.Add(new ScheduleStageSign(i, start, end));
            }
        }

        var tasks = new List<ScheduleTaskContent>();
        var challenges = new List<ScheduleChallengeContent>();
        var bases = new Dictionary<string, int>(StringComparer.Ordinal);
        var orderInStage = new Dictionary<string, int>();

        foreach (var stage in stageElements)
        {
            var stageKey = stage.GetProperty("key").GetString()!;
            foreach (var e in stage.GetProperty("ev").EnumerateArray())
            {
                if (e.TryGetProperty("conflict", out var conflict) && conflict.ValueKind != JsonValueKind.Null)
                {
                    throw new InvalidOperationException($"{e.GetProperty("id").GetString()}: the file holds a conflict; the format has no place for it (one value per point).");
                }

                var id = e.GetProperty("id").GetString()!;
                var season = e.GetProperty("season").GetString()!;
                var nextFruit = stageKey == "s9" && season == "fruit" && e.GetProperty("origin").GetString() == "reader";
                var @base = season == "april" ? AprilBase : nextFruit ? NextFruitBase : 0;
                bases[id] = @base;
                var order = orderInStage.GetValueOrDefault(stageKey);
                orderInStage[stageKey] = order + 1;

                var when = Text(e, "when");
                var timing = e.GetProperty("d0").ValueKind == JsonValueKind.Null
                    ? ScheduleTaskTiming.None(when)
                    : ScheduleTaskTiming.OnDays(
                        @base + e.GetProperty("d0").GetInt32() - 1,
                        e.GetProperty("d1").ValueKind == JsonValueKind.Null ? null : @base + e.GetProperty("d1").GetInt32() - 1,
                        when);

                var ifThen = Pairs(e.GetProperty("ifthen"));
                var look = Text(e, "look");
                var plate = Text(e, "plate");
                var q = e.GetProperty("q");
                var needs = e.GetProperty("need").EnumerateArray().Select(n => n.GetString()!).ToList();

                tasks.Add(new ScheduleTaskContent(
                    TaskKey: id,
                    Name: e.GetProperty("t").GetString()!,
                    Kind: Kinds[e.GetProperty("k").GetString()!],
                    Timing: timing,
                    Basis: ScheduleBasis.Stated,
                    StageIndex: stageIndexByKey[stageKey],
                    Order: order,
                    Why: Text(e, "why"),
                    Dose: Text(e, "dose"),
                    Steps: Lines(e.GetProperty("steps")),
                    Products: needs.Select(ProductOf).ToList(),
                    Warnings: Lines(e.GetProperty("risk")),
                    Look: look is null && plate is null && ifThen.Count == 0 ? null : new ScheduleTaskLook(Sign: look, IfThen: ifThen, PhotoRef: plate),
                    Ask: q.ValueKind == JsonValueKind.Null
                        ? null
                        : new ScheduleTaskAsk(
                            q[0].GetString()!, null, [new ScheduleAnswer("yes", q[1].GetString()!), new ScheduleAnswer("no", q[2].GetString()!)]),
                    Sources: e.GetProperty("src").EnumerateArray().Select(s => SourceOf(s.GetString()!)).ToList(),
                    Origin: Text(e, "origin")));
            }

            var risks = stage.GetProperty("risks").EnumerateArray().ToList();
            for (var i = 0; i < risks.Count; i++)
            {
                var r = risks[i];
                challenges.Add(new ScheduleChallengeContent(
                    ChallengeKey: $"c-{stageKey}-{i + 1:00}",
                    Title: r.GetProperty("t").GetString()!,
                    StageIndex: stageIndexByKey[stageKey],
                    Order: i,
                    WhenWords: Text(r, "when"),
                    Signs: Text(r, "signs"),
                    Action: Text(r, "action"),
                    IfThen: Pairs(r.GetProperty("ifthen")),
                    Sources: r.GetProperty("src").EnumerateArray().Select(s => SourceOf(s.GetString()!)).ToList()));
            }
        }

        return new Mapped(stages, signs, tasks, challenges, bases);
    }

    /// <summary>Reads the format back into the file's own fields (the ones the format carries), so they can be compared with the file line by line.</summary>
    public static Dictionary<string, object?> ExportEvent(ScheduleTaskContent t, int @base)
    {
        int? Day(int? stored) => stored is null ? null : stored.Value - @base + 1;
        return new Dictionary<string, object?>
        {
            ["id"] = t.TaskKey,
            ["d0"] = Day(t.Timing.FromDay),
            ["d1"] = Day(t.Timing.ToDay),
            ["when"] = t.Timing.WhenWords ?? string.Empty,
            ["k"] = Kinds.Single(k => k.Value == t.Kind).Key,
            ["t"] = t.Name,
            ["why"] = t.Why ?? string.Empty,
            ["steps"] = t.Steps!.ToList(),
            ["dose"] = t.Dose ?? string.Empty,
            ["need"] = t.Products!.Select(p => p.DoseAsWritten is null ? p.Name : p.Name + ": " + p.DoseAsWritten).ToList(),
            ["ifthen"] = (t.Look?.IfThen ?? []).Select(p => new[] { p.If, p.Then }).ToList(),
            ["risk"] = t.Warnings!.ToList(),
            ["look"] = t.Look?.Sign ?? string.Empty,
            ["q"] = t.Ask is null ? null : new List<string> { t.Ask.Question, t.Ask.Answers!.Single(a => a.Answer == "yes").Changes, t.Ask.Answers!.Single(a => a.Answer == "no").Changes },
            ["src"] = t.Sources!.Select(s => s.Page is null ? s.Document : s.Document + PageWord + s.Page).ToList(),
            ["plate"] = t.Look?.PhotoRef,
            ["origin"] = t.Origin ?? string.Empty,
        };
    }

    /// <summary>The same fields read straight from the file (an absent text is an empty one, as in <see cref="ExportEvent"/>).</summary>
    public static Dictionary<string, object?> FileEvent(JsonElement e)
    {
        int? Day(string name) => e.GetProperty(name).ValueKind == JsonValueKind.Null ? null : e.GetProperty(name).GetInt32();
        return new Dictionary<string, object?>
        {
            ["id"] = e.GetProperty("id").GetString(),
            ["d0"] = Day("d0"),
            ["d1"] = Day("d1"),
            ["when"] = Text(e, "when") ?? string.Empty,
            ["k"] = e.GetProperty("k").GetString(),
            ["t"] = e.GetProperty("t").GetString(),
            ["why"] = Text(e, "why") ?? string.Empty,
            ["steps"] = e.GetProperty("steps").EnumerateArray().Select(x => x.GetString()!).ToList(),
            ["dose"] = Text(e, "dose") ?? string.Empty,
            ["need"] = e.GetProperty("need").EnumerateArray().Select(x => x.GetString()!).ToList(),
            ["ifthen"] = e.GetProperty("ifthen").EnumerateArray().Select(p => new[] { p[0].GetString()!, p[1].GetString()! }).ToList(),
            ["risk"] = e.GetProperty("risk").EnumerateArray().Select(x => x.GetString()!).ToList(),
            ["look"] = Text(e, "look") ?? string.Empty,
            ["q"] = e.GetProperty("q").ValueKind == JsonValueKind.Null ? null : e.GetProperty("q").EnumerateArray().Select(x => x.GetString()!).ToList(),
            ["src"] = e.GetProperty("src").EnumerateArray().Select(x => x.GetString()!).ToList(),
            ["plate"] = Text(e, "plate"),
            ["origin"] = Text(e, "origin") ?? string.Empty,
        };
    }

    private static string? Text(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;

    private static List<string> Lines(JsonElement array) => array.EnumerateArray().Select(x => x.GetString()!).ToList();

    private static List<ScheduleIfThen> Pairs(JsonElement array) =>
        array.EnumerateArray().Select(p => new ScheduleIfThen(p[0].GetString()!, p[1].GetString()!)).ToList();

    private static ScheduleProduct ProductOf(string need)
    {
        var at = need.IndexOf(": ", StringComparison.Ordinal);
        return at < 0 ? new ScheduleProduct(need) : new ScheduleProduct(need[..at], need[(at + 2)..]);
    }

    private static ScheduleSource SourceOf(string line)
    {
        var at = line.LastIndexOf(PageWord, StringComparison.Ordinal);
        return at < 0 ? new ScheduleSource(line) : new ScheduleSource(line[..at], line[(at + PageWord.Length)..]);
    }
}
