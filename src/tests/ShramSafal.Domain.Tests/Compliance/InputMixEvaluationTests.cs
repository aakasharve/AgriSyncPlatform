// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Tasks 3 and 4)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

/// <summary>
/// The wrong-mix alert through the REAL evaluation handler (<see cref="EvaluateComplianceHandler"/>): it opens a Critical
/// acknowledge-only signal, पाहिलं does not bring it back, a new wrong mix does, and a record revised so the mix is gone
/// resolves it. The real rules are unreviewed (founder D-96), so these run with a TEST-ONLY reviewed rule in force - the
/// handler's own seam - and a separate fact proves an unreviewed rule opens nothing.
/// </summary>
public sealed class InputMixEvaluationTests
{
    private static readonly FarmId Farm = new(Guid.Parse("d4000000-0000-4000-8000-000000000001"));
    private static readonly UserId Speaker = new(Guid.Parse("d4000000-0000-4000-8000-000000000002"));
    private static readonly UserId Owner = new(Guid.Parse("d4000000-0000-4000-8000-000000000003"));
    private static readonly Guid Plot = Guid.Parse("d4000000-0000-4000-8000-0000000000a1");
    private static readonly Guid Cycle = Guid.Parse("d4000000-0000-4000-8000-0000000000c1");
    private static readonly DateTime Now = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 11, 8);

    private static readonly LocalizedText Why = new("कॅल्शियम आणि फॉस्फेट एकत्र टाकल्यावर साका बनतो", "calcium and phosphate form a precipitate");
    private static readonly LocalizedText NextTime = new("वेगळं द्या", "give them separately");
    private static readonly RuleSource Source = new("UF/IFAS EDIS HS1202 (test)", "UF/IFAS", "https://example.org/edis", "2026-11-06");

    private static readonly MixRule Reviewed = new(
        "T-R1", "never", new RuleSelector("calcium-source", null), new RuleSelector("phosphate-source", null),
        Why, Why, NextTime, [Source], "test-fixture", "2026-11-06", [MixVerdict.Fertigation, MixVerdict.Spray]);

    private static readonly LocalizedText SulphateWhy = new("कॅल्शियम आणि सल्फेट एकत्र टाकल्यावर जिप्सम बनतो", "calcium and sulphate form gypsum");
    private static readonly LocalizedText SulphateNextTime = new("सल्फेट वेगळं द्या", "give the sulphate separately");
    private static readonly RuleSource SulphateSource = new("Purdue Fertilizer Compatibility (test)", "Purdue", "https://example.org/purdue", "2026-11-06");

    /// <summary>An R2-style rule: calcium x sulphate, with its own words and its own source.</summary>
    private static readonly MixRule ReviewedSulphate = new(
        "T-R2", "never", new RuleSelector("calcium-source", null), new RuleSelector("sulphate-source", null),
        SulphateWhy, SulphateWhy, SulphateNextTime, [SulphateSource], "test-fixture", "2026-11-06", [MixVerdict.Fertigation, MixVerdict.Spray]);

    /// <summary>Calcium nitrate with potassium sulphate (0:0:50): a sulphate, not a phosphate.</summary>
    private const string CalciumWithSulphate = """{"schema":1,"inputs":[{"id":"e1","method":"Drip","mix":[{"id":"m0","productName":"calcium nitrate"},{"id":"m1","productName":"0:0:50","npkGrade":"0:0:50"}]}]}""";

    private const string WrongMix = """{"schema":1,"inputs":[{"id":"e1","method":"Drip","mix":[{"id":"m0","productName":"calcium nitrate"},{"id":"m1","productName":"19:19:19","npkGrade":"19:19:19"}]}]}""";
    private const string SeparateEvents = """{"schema":1,"inputs":[{"id":"e1","method":"Drip","mix":[{"id":"m0","productName":"calcium nitrate"}]},{"id":"e2","method":"Drip","mix":[{"id":"m1","productName":"19:19:19","npkGrade":"19:19:19"}]}]}""";

    private sealed class Harness
    {
        public EvalFake Repo { get; } = new();
        public InMemorySignals Signals { get; } = new();
        public DateTime Clock { get; set; } = Now;

        public EvaluateComplianceHandler Handler(IReadOnlyList<MixRule>? rules) =>
            new(Repo, Signals, new EmptyTestInstances(), new MovableClock(this), NullLogger<EvaluateComplianceHandler>.Instance, rules);

        public (DailyLog Log, DailyLogContent Content) Record(string document, DateOnly? day = null, string? origin = null, DailyLog? existing = null)
        {
            var log = existing ?? DailyLog.Create(Guid.NewGuid(), Farm, Plot, Cycle, Speaker, day ?? Today, null, null, Now.AddHours(-2));
            if (existing is not null)
            {
                log.NoteContentChanged();
            }

            var content = DailyLogContent.Create(
                Guid.NewGuid(), log, 1, document, origin ?? DailyLogContent.OriginCreate,
                existing is null ? null : log.ContentVersion - 1, Speaker, Now.AddHours(-1), null, null);
            Repo.Put(log, content);
            return (log, content);
        }

        private sealed class MovableClock(Harness h) : IClock
        {
            public DateTime UtcNow => h.Clock;
        }
    }

    [Fact]
    public async Task WrongMix_Evaluate_OpensACriticalAcknowledgeOnlySignal_NamingTheMix()
    {
        var h = new Harness();
        var (log, _) = h.Record(WrongMix);

        var result = await h.Handler([Reviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.Opened);
        var signal = Assert.Single(h.Signals.All);
        Assert.Equal(ComplianceRuleCode.InputMixNeverTogether, signal.RuleCode);
        Assert.Equal(ComplianceSeverity.Critical, signal.Severity);
        Assert.Equal(ComplianceSuggestedAction.AcknowledgeOnly, signal.SuggestedAction);
        Assert.Equal("हे मिश्रण चुकीचं आहे", signal.TitleMr);
        Assert.Equal(Plot, signal.PlotId);
        Assert.Equal(Cycle, signal.CropCycleId);
        Assert.True(signal.IsOpen);
        Assert.Contains("UF/IFAS EDIS HS1202 (test)", signal.DescriptionEn);
        using var payload = JsonDocument.Parse(signal.PayloadJson);
        Assert.Equal(log.Id, payload.RootElement.GetProperty("logId").GetGuid());
    }

    [Fact]
    public async Task UnreviewedRule_Evaluate_OpensNothing_D96()
    {
        var h = new Harness();
        h.Record(WrongMix);
        var unreviewed = Reviewed with { ReviewedBy = null, ReviewedOn = null };

        var viaTestRules = await h.Handler([unreviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));
        var viaNoRules = await h.Handler([]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, viaTestRules.Value!.Opened);
        Assert.Equal(0, viaNoRules.Value!.Opened);
        Assert.Empty(h.Signals.All);
    }

    // ── nothing shippable: nothing is read, nothing is judged (B003) ──────────────────────────────────

    [Fact]
    public async Task UnreviewedRules_NeverReadTheWeeksContentsOrTheAcknowledgedSignals()
    {
        var h = new Harness();
        h.Record(WrongMix);
        var unreviewed = Reviewed with { ReviewedBy = null, ReviewedOn = null };

        foreach (var rules in new IReadOnlyList<MixRule>[] { [unreviewed], [], [Reviewed with { Sources = [] }] })
        {
            await h.Handler(rules).HandleAsync(new EvaluateComplianceCommand(Farm));
        }

        Assert.Equal(0, h.Repo.ContentReads);
        Assert.Equal(0, h.Signals.AcknowledgedReads);
        Assert.Empty(h.Signals.All);
    }

    [Fact]
    public async Task AReviewedRule_ReadsTheContentsAndTheAcknowledgedSignals()
    {
        var h = new Harness();
        h.Record(WrongMix);

        await h.Handler([Reviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(1, h.Repo.ContentReads);
        Assert.Equal(1, h.Signals.AcknowledgedReads);
    }

    [Fact]
    public async Task AReviewedRule_WithNoRecordInTheLastWeek_ReadsNeitherAgain()
    {
        var h = new Harness();
        h.Record(WrongMix, day: Today.AddDays(-30));

        await h.Handler([Reviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, h.Repo.ContentReads);
        Assert.Equal(0, h.Signals.AcknowledgedReads);
    }

    [Fact]
    public async Task ProductionDefault_WithNoRulesInForceGiven_FollowsTheRuleFile_AndTodayThatIsNothing()
    {
        // The handler as production builds it: no rules passed in, so the rule file's SHIPPABLE rules apply. They are empty
        // until the founder's agronomist ticks R1 / R2 (D-96), so the founder's own example - calcium nitrate and 19:19:19 in
        // one drip tank, in the last 7 days - raises NOTHING and reads nothing. Written against the live file so it keeps
        // passing the day R1 is ticked: then exactly one alert.
        var h = new Harness();
        h.Record(WrongMix);

        var result = await h.Handler(null).HandleAsync(new EvaluateComplianceCommand(Farm));

        var calciumPhosphateInATank = MixRules.Shippable.Any(r =>
            r.Verdict == "never"
            && r.AppliesTo is not null && r.AppliesTo.Contains(MixVerdict.Fertigation)
            && ((r.A.Tag == "calcium-source" && r.B.Tag == "phosphate-source") || (r.A.Tag == "phosphate-source" && r.B.Tag == "calcium-source")));
        Assert.True(result.IsSuccess);
        Assert.Equal(calciumPhosphateInATank ? 1 : 0, result.Value!.Opened);
        Assert.Equal(calciumPhosphateInATank ? 1 : 0, h.Signals.All.Count);
        if (MixRules.Shippable.Count == 0)
        {
            Assert.Equal(0, h.Repo.ContentReads);
            Assert.Equal(0, h.Signals.AcknowledgedReads);
        }
    }

    [Fact]
    public async Task SameDaySeparateEvents_Evaluate_OpensNothing()
    {
        var h = new Harness();
        h.Record(SeparateEvents);

        var result = await h.Handler([Reviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, result.Value!.Opened);
        Assert.Empty(h.Signals.All);
    }

    [Fact]
    public async Task EvaluatingAgain_RefreshesTheOpenSignal_NeverASecondOne()
    {
        var h = new Harness();
        h.Record(WrongMix);
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        var again = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, again.Value!.Opened);
        Assert.Equal(1, again.Value!.Refreshed);
        Assert.Single(h.Signals.All);
    }

    [Fact]
    public async Task AcknowledgedMix_DoesNotReopen()
    {
        var h = new Harness();
        h.Record(WrongMix);
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        h.Signals.All.Single().Acknowledge(Owner, Now.AddMinutes(5));

        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, next.Value!.Opened);
        Assert.Single(h.Signals.All);
        Assert.Empty(await h.Signals.GetOpenForFarmAsync(Farm));
    }

    [Fact]
    public async Task NewMixAfterAck_Opens()
    {
        var h = new Harness();
        h.Record(WrongMix, day: Today.AddDays(-1));
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        h.Signals.All.Single().Acknowledge(Owner, Now.AddMinutes(5));

        // Another day, the same wrong mix: a different record, so a new alert.
        var (second, _) = h.Record(WrongMix);
        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(1, next.Value!.Opened);
        var open = Assert.Single(await h.Signals.GetOpenForFarmAsync(Farm));
        using var payload = JsonDocument.Parse(open.PayloadJson);
        Assert.Equal(second.Id, payload.RootElement.GetProperty("logId").GetGuid());
        Assert.Equal(2, h.Signals.All.Count);
    }

    [Fact]
    public async Task RevisedContentWithoutMix_AutoResolves()
    {
        var h = new Harness();
        var (log, _) = h.Record(WrongMix);
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        Assert.True(h.Signals.All.Single().IsOpen);

        // He fixes "एकाच टाकीत" to "वेगळं": the next version of the record keeps the two products apart.
        h.Record(SeparateEvents, origin: DailyLogContent.OriginRevision, existing: log);
        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(1, next.Value!.AutoResolved);
        var signal = Assert.Single(h.Signals.All);
        Assert.False(signal.IsOpen);
        Assert.NotNull(signal.ResolvedAtUtc);
    }

    [Fact]
    public async Task ARevisionThatKeepsTheMix_IsANewVersion_SoAnAcknowledgedAlertSeesItAgain()
    {
        // The fingerprint carries the record's version (the plan's rule): a record edited after पाहिलं and still holding the
        // wrong mix is judged afresh. Pinned so the choice is visible.
        var h = new Harness();
        var (log, _) = h.Record(WrongMix);
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        h.Signals.All.Single().Acknowledge(Owner, Now.AddMinutes(5));

        h.Record(WrongMix, origin: DailyLogContent.OriginRevision, existing: log);
        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(1, next.Value!.Opened);
    }

    [Fact]
    public async Task AnAcknowledgedMix_StaysQuiet_WhileItsRecordCounts_AndAfterItLeavesTheWindow()
    {
        // The 30-day memory is longer than the 7-day window on purpose: a mix is never re-raised while its record counts, and once its record is older than 7 days nothing is raised at all.
        var h = new Harness();
        h.Record(WrongMix);
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        h.Signals.All.Single().Acknowledge(Owner, Now.AddMinutes(5));

        h.Clock = Now.AddDays(6);
        var withinWindow = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        h.Clock = Now.AddDays(9);
        var pastWindow = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, withinWindow.Value!.Opened);
        Assert.Equal(0, pastWindow.Value!.Opened);
    }

    [Fact]
    public async Task ARecordWithNoSinglePlot_OpensNothing_AndTheHandlerStillSucceeds()
    {
        var h = new Harness();
        var farmWide = DailyLog.CreateForFarm(Guid.NewGuid(), Farm, Speaker, Today, null, null, Now.AddHours(-2));
        h.Repo.Put(farmWide, DailyLogContent.Create(
            Guid.NewGuid(), farmWide, 1, WrongMix, DailyLogContent.OriginCreate, null, Speaker, Now.AddHours(-2), null, null));

        var result = await h.Handler([Reviewed]).HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value!.Opened);
    }

    [Fact]
    public async Task ANewerRedMixOfAnotherRule_ReplacesTheOpenSignalsWordsAndSources_NotOnlyItsEvidence()
    {
        var h = new Harness();
        h.Record(WrongMix, day: Today.AddDays(-1));
        var handler = h.Handler([Reviewed, ReviewedSulphate]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        var open = Assert.Single(h.Signals.All);
        Assert.Contains("UF/IFAS EDIS HS1202 (test)", open.DescriptionEn);
        Assert.Contains(Why.En, open.DescriptionEn);

        // A newer record on the same plot breaks the OTHER rule (calcium x sulphate): the one open signal now speaks for it.
        var (newer, _) = h.Record(CalciumWithSulphate);
        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, next.Value!.Opened);
        Assert.Same(open, Assert.Single(h.Signals.All));
        Assert.True(open.IsOpen);
        using var payload = JsonDocument.Parse(open.PayloadJson);
        Assert.Equal("T-R2", payload.RootElement.GetProperty("ruleId").GetString());
        Assert.Equal(newer.Id, payload.RootElement.GetProperty("logId").GetGuid());
        foreach (var words in new[] { open.DescriptionEn, open.DescriptionMr })
        {
            Assert.Contains("Purdue Fertilizer Compatibility (test)", words);
            Assert.DoesNotContain("UF/IFAS EDIS HS1202 (test)", words);
        }

        Assert.Contains(SulphateWhy.En, open.DescriptionEn);
        Assert.Contains(SulphateNextTime.En, open.DescriptionEn);
        Assert.Contains(SulphateWhy.Mr, open.DescriptionMr);
        Assert.DoesNotContain(Why.En, open.DescriptionEn);
        // The rule's own title is the same for every mix and stays.
        Assert.Equal("Products that must not be mixed were given together", open.TitleEn);
        Assert.Equal("हे मिश्रण चुकीचं आहे", open.TitleMr);
    }

    [Fact]
    public async Task AnOpenSignal_FollowsTheMixThatIsThere_WhenTheMixItNamedIsRevisedAwayAndAnotherStands()
    {
        var h = new Harness();
        var (older, _) = h.Record(WrongMix, day: Today.AddDays(-2));
        var handler = h.Handler([Reviewed]);
        await handler.HandleAsync(new EvaluateComplianceCommand(Farm));
        var open = h.Signals.All.Single();

        // A newer wrong mix on the same plot appears while the older one is still open: one open signal per plot and rule,
        // so the signal now names the newer mix - never a mix that is not there.
        var (newer, _) = h.Record(WrongMix);
        h.Clock = Now.AddHours(8);
        var next = await handler.HandleAsync(new EvaluateComplianceCommand(Farm));

        Assert.Equal(0, next.Value!.Opened);
        Assert.Same(open, Assert.Single(h.Signals.All));
        using var payload = JsonDocument.Parse(open.PayloadJson);
        Assert.Equal(newer.Id, payload.RootElement.GetProperty("logId").GetGuid());
        Assert.NotEqual(older.Id, payload.RootElement.GetProperty("logId").GetGuid());
    }

    // ── a store that cannot say what was acknowledged must not look as though nothing was (B009) ─────────

    [Fact]
    public async Task ASignalStoreThatDoesNotOverrideGetAcknowledgedSince_RefusesInsteadOfAnsweringNone()
    {
        IComplianceSignalRepository bare = new BareSignals();

        await Assert.ThrowsAsync<NotSupportedException>(
            () => bare.GetAcknowledgedSinceAsync(Farm, ComplianceRuleCode.InputMixNeverTogether, Now.AddDays(-30)));
    }

    [Fact]
    public async Task AReviewedEvaluation_OnAStoreThatCannotSayWhatWasAcknowledged_FailsLoudly_NeverReopensSilently()
    {
        var h = new Harness();
        h.Record(WrongMix);
        var handler = new EvaluateComplianceHandler(
            h.Repo, new BareSignals(), new EmptyTestInstances(), new FixedClock(Now), NullLogger<EvaluateComplianceHandler>.Instance, [Reviewed]);

        await Assert.ThrowsAsync<NotSupportedException>(() => handler.HandleAsync(new EvaluateComplianceCommand(Farm)));
    }

    // ── doubles ──────────────────────────────────────────────────────────────────────────

    private sealed class EvalFake : FakeShramSafalRepository, IShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> logs = [];
        private readonly Dictionary<Guid, DailyLogContent> contents = [];

        /// <summary>The newest content of a log is the one with the highest version: later Puts replace earlier ones.</summary>
        public void Put(DailyLog log, DailyLogContent content)
        {
            logs[log.Id] = log;
            if (!contents.TryGetValue(log.Id, out var held) || content.ContentVersion >= held.ContentVersion)
            {
                contents[log.Id] = content;
            }
        }

        public override Task<List<ShramSafal.Domain.Farms.Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(new List<ShramSafal.Domain.Farms.Plot>());

        Task<List<DailyLog>> IShramSafalRepository.GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct) =>
            Task.FromResult(logs.Values.Where(l => l.FarmId == farmId).ToList());

        /// <summary>How many times the evaluation read a week of stored record contents.</summary>
        public int ContentReads { get; private set; }

        Task<IReadOnlyList<DailyLogContent>> IShramSafalRepository.GetCurrentDailyLogContentsAsync(
            IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct)
        {
            ContentReads++;
            return Task.FromResult<IReadOnlyList<DailyLogContent>>(dailyLogIds.Where(contents.ContainsKey).Select(id => contents[id]).ToList());
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => Task.CompletedTask;

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemorySignals : IComplianceSignalRepository
    {
        public List<ComplianceSignal> All { get; } = [];

        public Task<ComplianceSignal?> FindOpenAsync(FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(All.FirstOrDefault(s => s.IsOpen && s.PlotId == plotId && s.RuleCode == ruleCode && s.CropCycleId == cropCycleId));

        public Task<IReadOnlyList<ComplianceSignal>> GetOpenForFarmAsync(FarmId farmId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>(All.Where(s => s.FarmId == farmId && s.IsOpen).ToList());

        public Task<IReadOnlyList<ComplianceSignal>> GetForFarmAsync(FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>(All.Where(s => s.FarmId == farmId).ToList());

        public Task<ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(All.FirstOrDefault(s => s.Id == id));

        /// <summary>How many times the evaluation read the acknowledged signals of the wrong-mix rule.</summary>
        public int AcknowledgedReads { get; private set; }

        public Task<IReadOnlyList<ComplianceSignal>> GetAcknowledgedSinceAsync(
            FarmId farmId, string ruleCode, DateTime sinceUtc, CancellationToken ct = default)
        {
            AcknowledgedReads++;
            return Task.FromResult<IReadOnlyList<ComplianceSignal>>(
                All.Where(s => s.FarmId == farmId && s.RuleCode == ruleCode && s.AcknowledgedAtUtc >= sinceUtc).ToList());
        }

        public Task<IReadOnlyList<ComplianceSignal>> GetSinceCursorAsync(FarmId farmId, DateTime cursor, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>(All.Where(s => s.LastSeenAtUtc > cursor).ToList());

        public void Add(ComplianceSignal signal) => All.Add(signal);

        public Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default) =>
            Task.FromResult<DateTime?>(All.Count == 0 ? null : All.Max(s => s.LastSeenAtUtc));

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow => now;
    }

    /// <summary>A signal store that does what a store written before this rule existed does: nothing it was not asked.</summary>
    private sealed class BareSignals : IComplianceSignalRepository
    {
        public Task<ComplianceSignal?> FindOpenAsync(FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default) =>
            Task.FromResult<ComplianceSignal?>(null);
        public Task<IReadOnlyList<ComplianceSignal>> GetOpenForFarmAsync(FarmId farmId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>([]);
        public Task<IReadOnlyList<ComplianceSignal>> GetForFarmAsync(FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>([]);
        public Task<ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ComplianceSignal?>(null);
        public Task<IReadOnlyList<ComplianceSignal>> GetSinceCursorAsync(FarmId farmId, DateTime cursor, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ComplianceSignal>>([]);
        public void Add(ComplianceSignal signal) { }
        public Task<DateTime?> GetLatestEvaluationTimeAsync(FarmId farmId, CancellationToken ct = default) => Task.FromResult<DateTime?>(null);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class EmptyTestInstances : ITestInstanceRepository
    {
        public Task AddAsync(ShramSafal.Domain.Tests.TestInstance instance, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddRangeAsync(IEnumerable<ShramSafal.Domain.Tests.TestInstance> instances, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Tests.TestInstance?> GetByIdAsync(Guid testInstanceId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ShramSafal.Domain.Tests.TestInstance>> GetByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ShramSafal.Domain.Tests.TestInstance>> GetByFarmIdAndStatusAsync(
            FarmId farmId, IReadOnlyCollection<ShramSafal.Domain.Tests.TestInstanceStatus> statuses, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ShramSafal.Domain.Tests.TestInstance>>([]);
        public Task<IReadOnlyList<ShramSafal.Domain.Tests.TestInstance>> GetOverdueAsync(DateOnly today, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ShramSafal.Domain.Tests.TestInstance>> GetModifiedSinceAsync(
            IReadOnlyCollection<FarmId> farmIds, DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
