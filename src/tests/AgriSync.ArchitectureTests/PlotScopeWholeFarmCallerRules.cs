// spec: plr-d10 SEC-1 server fixes (D-184), finding F03 (server half) - a plot-limited seat cannot write a whole-farm log
using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// SEC-1 F03 (server half) - <c>PlotScopeGate.RefuseWholeFarmAsync</c> is the question "may this seat write a record that
/// belongs to the WHOLE farm?". It is asked only where "no plot" is an explicit whole-farm choice by the person writing:
/// <c>CreateDailyLogHandler</c> (scope Farm) and, for a move onto the farm (wholeFarm), <c>MoveDailyLogHandler</c>.
///
/// <para>It must stay a SEPARATE question from <c>PlotScopeGate.RefuseAsync</c>, whose "no plot named means no refusal"
/// answer about 20 other callers rely on (a shared or unallocated bill, a "plot not fixed" reminder, a farm-level warning
/// all legitimately name no plot). If a caller beyond the two handlers asked the whole-farm question, a seat on chosen plots
/// would suddenly be refused for work that names no plot at all, and every one of those records would stop saving for him.
/// If either of the two stopped asking it, a chosen-plots seat could again write (or move a record onto) the whole farm.</para>
///
/// <para>A source scan, honestly bounded: executable source of every production file (comments stripped), every mention of
/// the method name. It does not see reflection or a name built from strings.</para>
/// </summary>
public sealed class PlotScopeWholeFarmCallerRules
{
    private const string MethodName = "RefuseWholeFarmAsync";

    private const string Declaring = "apps/ShramSafal/ShramSafal.Application/Services/PlotScopeGate.cs";
    private const string CreateHandler = "apps/ShramSafal/ShramSafal.Application/UseCases/Logs/CreateDailyLog/CreateDailyLogHandler.cs";
    private const string MoveHandler = "apps/ShramSafal/ShramSafal.Application/UseCases/Logs/MoveDailyLog/MoveDailyLogHandler.cs";

    [Fact]
    public void The_whole_farm_question_is_asked_by_create_daily_log_and_nowhere_beyond_the_two_log_handlers()
    {
        var mentions = MentionsByFile();

        // Vacuity guard: the scan must see the declaration and the create handler, or a moved file or a drifted name would
        // pass by matching nothing.
        mentions.Should().ContainKey(Declaring, $"{MethodName} must still be declared in PlotScopeGate");
        mentions.Should().ContainKey(CreateHandler,
            "CreateDailyLogHandler must ask the whole-farm question for scope Farm, or a chosen-plots seat can write the whole farm's log");

        // The move handler may reach the same answer by the gate's other public question about a seat's chosen plots (it
        // already read it for the plot move), so it is ALLOWED to mention the method but not required to; the move is proved
        // by behaviour in WholeFarmLogPlotScopeRealPostgresTests. Nothing else may ask it.
        var allowed = new[] { Declaring, CreateHandler, MoveHandler }.ToHashSet(StringComparer.OrdinalIgnoreCase);
        mentions.Keys.Where(file => !allowed.Contains(file)).Should().BeEmpty(
            $"{MethodName} refuses a chosen-plots seat for a record with NO plot. Asked anywhere else, it would refuse him for "
            + "shared bills, unspecified reminders and farm-level signals that name no plot by design (they use "
            + "PlotScopeGate.RefuseAsync, whose no-plot answer is null). Change this rule deliberately, in review, if a new "
            + "explicit whole-farm write door is added.");
    }

    private static Dictionary<string, int> MentionsByFile()
    {
        var mention = new Regex($@"\b{Regex.Escape(MethodName)}\b", RegexOptions.Compiled);
        return ProductionSourceFiles()
            .Select(file => (File: Relative(file), Count: mention.Matches(StripComments(File.ReadAllText(file))).Count))
            .Where(x => x.Count > 0)
            .ToDictionary(x => x.File, x => x.Count, StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> ProductionSourceFiles()
    {
        var srcRoot = TestPathHelper.GetSolutionRoot();
        var sep = Path.DirectorySeparatorChar;
        return Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(path =>
                !path.Contains($"{sep}tests{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}obj{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}bin{sep}", StringComparison.OrdinalIgnoreCase) &&
                !path.Contains($"{sep}node_modules{sep}", StringComparison.OrdinalIgnoreCase));
    }

    private static string Relative(string fullPath) =>
        Path.GetRelativePath(TestPathHelper.GetSolutionRoot(), fullPath).Replace('\\', '/');

    private static string StripComments(string source)
    {
        var withoutBlockComments = Regex.Replace(source, @"/\*.*?\*/", string.Empty, RegexOptions.Singleline);
        return Regex.Replace(withoutBlockComments, @"^[^\S\r\n]*//.*$", string.Empty, RegexOptions.Multiline);
    }
}
