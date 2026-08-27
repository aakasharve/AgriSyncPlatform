// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Domain.Consent;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Analytics;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Observability;

/// <summary>
/// CWE-117 — "Log entries created from user input". CodeQL raised seven of these on PR #55:
/// four in <see cref="RecordQuestionEventHandler"/> (the client's <c>QuestionKey</c>) and three
/// in <see cref="LinkConsentGateToUserHandler"/> (the client's <c>PreRegistrationSessionId</c>).
/// An eighth of the same shape was found by the sweep in <see cref="ClaimJoinHandler"/> (the
/// scanner's <c>FarmCode</c>).
///
/// <para><b>Why these particular lines cannot be allowed to lie.</b> Every one of them is a
/// place where something failed and NOTHING ELSE says so: a question refused by the
/// both-approved gate, an answer naming a log that does not exist, an answer naming another
/// farm's log, a consent link refused, a spliced QR. None of them fails the farmer's request and
/// none of them reaches a screen. The log line is the entire observer. A client that can put a
/// newline in one of these fields can append a line indistinguishable from one we wrote — so it
/// could manufacture "Consent gate acceptance linked to a user" for a link that never happened,
/// in the audit trail of a DPDP record. Evidence an attacker can author is not evidence.</para>
///
/// <para><b>What is asserted.</b> Not that <c>LogSafe</c> works — <c>LogSafeTests</c> does that.
/// These drive the REAL handlers and assert at the sink: one call in, one line out, no CR/LF
/// anywhere in the rendered message OR in any structured property (Serilog writes both), and the
/// forged text never at the start of a line. They also assert the opposite direction, which is
/// the failure mode a careless fix would introduce: the line is still emitted and still names the
/// value. Deleting the observer would "fix" CodeQL and re-open the silence.</para>
///
/// <para><b>And what must never be here at all.</b> <c>LogSafe</c> sanitises; it does not redact.
/// The farmer's spoken answer (<c>Response</c>) and the consent notice body
/// (<c>DisplayedNoticeText</c>) are client input too, and the fix for those is not to wrap them —
/// it is that they are never handed to a log sink in the first place. Locked below.</para>
/// </summary>
public sealed class LogInjectionAtDfesAndConsentSinksTests
{
    /// <summary>
    /// The attack: a plausible value, a line break, then text shaped exactly like a line this
    /// application emits. Split by a log reader — or by CloudWatch — the tail becomes its own
    /// entry, and it is the consent success line, which is the worst one to be able to forge.
    /// </summary>
    private const string ForgedTail = "warn: Consent gate acceptance linked to a user for session preauth-999";

    public static TheoryData<string> HostileValues() => new()
    {
        "gap.dose\n" + ForgedTail,
        "gap.dose\r\n" + ForgedTail,
        "gap.dose\r" + ForgedTail,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // RecordQuestionEventHandler — the four sinks CodeQL flagged.
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly DateTime Now = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid AnsweredLogId = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly DateOnly LogDay = new(2026, 7, 12);

    /// <summary>The farmer's own words. Must never appear in a log line, sanitised or not.</summary>
    private const string FarmersOwnWords = "पानांवरचे डाग वाढले, दोन ओळींत जास्त.";

    private static RecordQuestionEventCommand Question(Guid farmId, string questionKey) => new(
        CallerUserId: Guid.NewGuid(), FarmId: farmId, PlotId: null, DailyLogId: null,
        QuestionKey: questionKey, Crop: "grapes", ExpectedStage: "flowering",
        ActualStageApplicability: null, AnchorDateType: "log_date", TriggerType: "Gap",
        QuestionType: "gap_fill", Lens: "Execution", DepthLevel: 1, Priority: 4, Cooldown: 3,
        AnswerModes: "voice", SafetyClass: "informational",
        AgronomistApproved: true, MarathiApproved: true,
        BankVersion: "dfes-bank-1", QuestionEngineVersion: "dfes-qengine-1",
        AnswerObservationId: null, ShownAtUtc: Now, TriggerReason: "gap DOSE",
        WeatherContext: null, Response: FarmersOwnWords, StageConfirmed: null,
        PhotoSubmitted: false, Skipped: false);

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_1_the_both_approved_gate_cannot_be_made_to_write_a_second_line(string hostile)
    {
        var logger = new CapturingLogger<RecordQuestionEventHandler>();
        var repo = new QuestionRepo(memberOfFarm: true);
        var handler = BuildQuestionHandler(repo, logger);
        var cmd = Question(Guid.NewGuid(), hostile) with { AgronomistApproved = false };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        // Pre-condition: this really is the rejection path, and it really did log.
        Assert.True(result.IsFailure);
        Assert.Null(repo.Captured);
        var line = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, line.Level);

        AssertOneUnforgeableLine(line);
        // The observer survived the fix: it still says what was rejected, and still names it.
        Assert.Contains("not both-approved", line.RenderedMessage, StringComparison.Ordinal);
        Assert.Contains("gap.dose", line.RenderedMessage, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_2_the_idempotent_replay_line_cannot_be_made_to_write_a_second_line(string hostile)
    {
        var logger = new CapturingLogger<RecordQuestionEventHandler>();
        var farmId = Guid.NewGuid();
        var alreadyThere = QuestionEvent.Create(
            id: Guid.NewGuid(), dailyLogId: AnsweredLogId, farmId: farmId, plotId: null,
            questionKey: hostile, crop: "grapes", expectedStage: null, actualStageApplicability: null,
            anchorDateType: "log_date", triggerType: "Gap", questionType: "gap_fill", lens: "Execution",
            depthLevel: 1, priority: 4, cooldown: 3, answerModes: "voice", safetyClass: "informational",
            agronomistApproved: true, marathiApproved: true, bankVersion: "dfes-bank-1",
            questionEngineVersion: "dfes-qengine-1", answerObservationId: null, shownAtUtc: Now,
            triggerReason: null, weatherContext: null, response: null, stageConfirmed: null,
            photoSubmitted: false, skipped: false, createdAtUtc: Now);
        var repo = new QuestionRepo(memberOfFarm: true, existing: alreadyThere);
        var handler = BuildQuestionHandler(repo, logger);
        var cmd = Question(farmId, hostile) with { DailyLogId = AnsweredLogId };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(alreadyThere.Id, result.Value);
        var line = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Information, line.Level);

        AssertOneUnforgeableLine(line);
        Assert.Contains("Idempotent replay", line.RenderedMessage, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_3_the_missing_log_line_cannot_be_made_to_write_a_second_line(string hostile)
    {
        var logger = new CapturingLogger<RecordQuestionEventHandler>();
        // No log seeded, so GetDailyLogByIdAsync returns null — the "names a daily_log which
        // does not exist" branch. It fails nothing and reaches nobody except this line.
        var repo = new QuestionRepo(memberOfFarm: true);
        var handler = BuildQuestionHandler(repo, logger);
        var cmd = Question(Guid.NewGuid(), hostile) with { DailyLogId = AnsweredLogId };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(repo.CapturedObservation);
        var line = Assert.Single(logger.Entries, e => e.Level == LogLevel.Warning);

        AssertOneUnforgeableLine(line);
        Assert.Contains("does not exist", line.RenderedMessage, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_4_the_cross_farm_guard_cannot_be_made_to_write_a_second_line(string hostile)
    {
        var logger = new CapturingLogger<RecordQuestionEventHandler>();
        // The log exists but belongs to somebody else — an attempted cross-tenant write,
        // reported nowhere except this line.
        var repo = new QuestionRepo(memberOfFarm: true, log: LogFor(Guid.NewGuid()));
        var handler = BuildQuestionHandler(repo, logger);
        var cmd = Question(Guid.NewGuid(), hostile) with { DailyLogId = AnsweredLogId };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(repo.CapturedObservation);
        var line = Assert.Single(logger.Entries, e => e.Level == LogLevel.Warning);

        AssertOneUnforgeableLine(line);
        Assert.Contains("no observation written", line.RenderedMessage, StringComparison.Ordinal);
    }

    /// <summary>
    /// The half <c>LogSafe</c> cannot do. <c>Response</c> is the farmer's spoken noticing,
    /// verbatim; it is persisted and turned into an observation, and it must never reach an ops
    /// log at all. If a future change starts logging it, sanitising it would not help.
    /// </summary>
    [Fact]
    public async Task The_farmers_own_words_are_never_logged_at_any_of_the_four_sinks()
    {
        var cases = new (QuestionRepo Repo, RecordQuestionEventCommand Command)[]
        {
            (new QuestionRepo(memberOfFarm: true),
             Question(Guid.NewGuid(), "gap.dose") with { AgronomistApproved = false }),
            (new QuestionRepo(memberOfFarm: true),
             Question(Guid.NewGuid(), "gap.dose") with { DailyLogId = AnsweredLogId }),
            (new QuestionRepo(memberOfFarm: true, log: LogFor(Guid.NewGuid())),
             Question(Guid.NewGuid(), "gap.dose") with { DailyLogId = AnsweredLogId }),
        };

        foreach (var (repo, command) in cases)
        {
            var logger = new CapturingLogger<RecordQuestionEventHandler>();
            await BuildQuestionHandler(repo, logger).HandleAsync(command, CancellationToken.None);

            // Guard the guard: a case that logged nothing would make the assertions vacuous.
            Assert.NotEmpty(logger.Entries);
            foreach (var entry in logger.Entries)
            {
                Assert.DoesNotContain(FarmersOwnWords, entry.RenderedMessage, StringComparison.Ordinal);
                Assert.DoesNotContain(
                    FarmersOwnWords,
                    string.Join(" | ", entry.Properties.Values.Select(v => v?.ToString() ?? string.Empty)),
                    StringComparison.Ordinal);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LinkConsentGateToUserHandler — the three sinks CodeQL flagged.
    //
    // These are the audit trail of a DPDP record. A forged line here is worse than a missing
    // one, which is why the forged tail above is shaped like this handler's own success line.
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly DateTime LinkedAt = new(2026, 8, 27, 9, 15, 0, DateTimeKind.Utc);
    private static readonly Guid Farmer = Guid.Parse("c04e5a7e-0000-0000-0000-00000000000a");

    /// <summary>The notice body. Client-supplied; hashed server-side, never logged.</summary>
    private const string NoticeBody = "आम्ही तुमची माहिती कशी वापरतो — संपूर्ण सूचना मजकूर";

    private static LinkConsentGateToUserCommand Link(string sessionId) => new(
        UserId: Farmer,
        PreRegistrationSessionId: sessionId,
        NoticeVersion: "notice-2026-08-16.1",
        PrivacyPolicyVersion: "privacy-2026-08-16.1",
        TermsVersion: "terms-2026-08-16.1",
        DisplayedLanguage: "mr",
        AcceptedPurposeCodes: new List<string> { "ACCOUNT_AUTHENTICATION" },
        DataCategoryCodes: new List<string> { "IDENTITY_AND_CONTACT" },
        Source: "web",
        AppVersion: "1.2.3",
        DisplayedNoticeText: NoticeBody);

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_5_the_consent_link_success_line_cannot_be_forged(string hostile)
    {
        var logger = new CapturingLogger<LinkConsentGateToUserHandler>();
        var repo = new ConsentRepo();
        var handler = BuildConsentHandler(repo, logger);

        var result = await handler.HandleAsync(Link(hostile), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var line = Assert.Single(logger.Entries);

        AssertOneUnforgeableLine(line);
        Assert.Contains("Consent gate acceptance linked to a user", line.RenderedMessage, StringComparison.Ordinal);
        // The session id is still named — it is the only handle on the acceptance being linked.
        Assert.Contains("gap.dose", line.RenderedMessage, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_6_the_consent_link_replay_line_cannot_be_forged(string hostile)
    {
        var logger = new CapturingLogger<LinkConsentGateToUserHandler>();
        var facts = new ConsentLedgerFacts(
            Farmer, hostile.Trim(), "notice-2026-08-16.1", "privacy-2026-08-16.1",
            "terms-2026-08-16.1", "mr", "ACCOUNT_AUTHENTICATION", "IDENTITY_AND_CONTACT",
            ConsentRecordSource.Web, "1.2.3", Sha256Hex(NoticeBody));
        var repo = new ConsentRepo(
            TermsAcceptanceEvent.LinkToUser(Guid.NewGuid(), facts, LinkedAt),
            ConsentGrantEvent.LinkToUser(Guid.NewGuid(), facts, LinkedAt));
        var handler = BuildConsentHandler(repo, logger);

        var result = await handler.HandleAsync(Link(hostile), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.AlreadyLinked);
        var line = Assert.Single(logger.Entries);

        AssertOneUnforgeableLine(line);
        Assert.Contains("Consent gate link replay", line.RenderedMessage, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_7_the_consent_refusal_line_cannot_be_forged(string hostile)
    {
        var logger = new CapturingLogger<LinkConsentGateToUserHandler>();
        var handler = BuildConsentHandler(new ConsentRepo(), logger);

        // "unrecognised source" — a real refusal, reached only after every completeness check
        // has passed, so the hostile session id is genuinely on the line rather than having
        // been short-circuited away by an earlier guard.
        var result = await handler.HandleAsync(Link(hostile) with { Source = "sms" }, CancellationToken.None);

        Assert.True(result.IsFailure);
        var line = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, line.Level);

        AssertOneUnforgeableLine(line);
        // A refused link leaves an acceptance orphaned. This line must keep saying so — it is
        // the only place that failure lands.
        Assert.Contains("Refused consent gate link", line.RenderedMessage, StringComparison.Ordinal);
        Assert.Contains("unrecognised source", line.RenderedMessage, StringComparison.Ordinal);
        Assert.Contains("stays orphaned", line.RenderedMessage, StringComparison.Ordinal);
    }

    /// <summary>
    /// <c>LogSafe.Text</c> replaced a hand-rolled <c>"(none supplied)"</c> ternary on the refusal
    /// line. Absent, empty and whitespace-only still say so — and a value made entirely of
    /// control characters, which used to render as a blank that reads "nothing was sent", now
    /// says <c>unknown</c>, which is what a probe actually is.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\r\t")]
    public async Task A_missing_or_probing_session_id_is_reported_as_unknown_not_as_a_blank(string sessionId)
    {
        var logger = new CapturingLogger<LinkConsentGateToUserHandler>();
        var handler = BuildConsentHandler(new ConsentRepo(), logger);

        var result = await handler.HandleAsync(Link(sessionId), CancellationToken.None);

        Assert.True(result.IsFailure);
        var line = Assert.Single(logger.Entries);
        AssertOneUnforgeableLine(line);
        Assert.Equal(LogSafe.Unknown, line.Properties["PreRegistrationSessionId"]);
    }

    [Fact]
    public async Task The_notice_body_and_the_consent_codes_are_never_logged()
    {
        // LogSafe could not have made these safe — it sanitises, it does not redact. They are
        // hashed and stored; the log gets the session id and a fixed reason, nothing else.
        var commands = new[]
        {
            Link("preauth-abc123"),
            Link("preauth-abc123") with { Source = "sms" },
        };

        foreach (var command in commands)
        {
            var logger = new CapturingLogger<LinkConsentGateToUserHandler>();
            await BuildConsentHandler(new ConsentRepo(), logger).HandleAsync(command, CancellationToken.None);

            Assert.NotEmpty(logger.Entries);
            foreach (var entry in logger.Entries)
            {
                Assert.DoesNotContain(NoticeBody, entry.RenderedMessage, StringComparison.Ordinal);
                Assert.DoesNotContain("ACCOUNT_AUTHENTICATION", entry.RenderedMessage, StringComparison.Ordinal);
                Assert.DoesNotContain("IDENTITY_AND_CONTACT", entry.RenderedMessage, StringComparison.Ordinal);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ClaimJoinHandler — the eighth sink, found by the sweep rather than by CodeQL.
    // ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(HostileValues))]
    public async Task Sink_8_the_spliced_QR_line_cannot_be_forged_by_the_scanner(string hostile)
    {
        var logger = new CapturingLogger<ClaimJoinHandler>();
        var ownerId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        var farmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var farmRepo = new StubShramSafalRepository();
        var farm = Farm.Create(farmGuid, "Patil Farm", ownerId, Now);
        farm.AssignFarmCode("PATIL1", Now);
        farmRepo.SeedFarm(farm);

        const string rawToken = "test-raw-token-value";
        var invRepo = new StubFarmInvitationRepository();
        var invitation = FarmInvitation.Issue(
            FarmInvitationId.New(), new FarmId(farmGuid), new UserId(ownerId), Now);
        invRepo.SeedToken(
            FarmJoinToken.Issue(
                FarmJoinTokenId.New(), invitation.Id, new FarmId(farmGuid),
                rawToken, Sha256Hex(rawToken), Now),
            invitation);

        var handler = new ClaimJoinHandler(
            invRepo, farmRepo,
            new SequentialIdGenerator(Guid.Parse("44444444-4444-4444-4444-444444444444")),
            new FixedClock(Now), logger, new CapturingAnalyticsWriter());

        var result = await handler.HandleAsync(new ClaimJoinCommand(
            Token: rawToken,
            FarmCode: hostile,
            CallerUserId: new UserId(Guid.Parse("11111111-1111-1111-1111-111111111111")),
            PhoneVerified: true));

        Assert.True(result.IsFailure);
        Assert.Equal("join.farm_code_mismatch", result.Error.Code);
        var line = Assert.Single(logger.Entries, e => e.Level == LogLevel.Warning);

        AssertOneUnforgeableLine(line);
        Assert.Contains("Claim rejected", line.RenderedMessage, StringComparison.Ordinal);
        // The real, server-generated code is still shown beside the claimed one.
        Assert.Contains("PATIL1", line.RenderedMessage, StringComparison.Ordinal);
    }

    // ── the shared assertion ─────────────────────────────────────────────────

    /// <summary>
    /// One call in, one line out. Checks the rendered message AND every structured property,
    /// because Serilog writes both and a line break in either is the injection.
    /// </summary>
    private static void AssertOneUnforgeableLine(CapturedLogEntry entry)
    {
        Assert.DoesNotContain('\n', entry.RenderedMessage);
        Assert.DoesNotContain('\r', entry.RenderedMessage);

        foreach (var value in entry.Properties.Values)
        {
            var text = value?.ToString() ?? string.Empty;
            Assert.DoesNotContain('\n', text);
            Assert.DoesNotContain('\r', text);
        }

        // The forged text may survive as characters — the guard defuses, it does not delete —
        // but it can never BEGIN a line, which is the only thing that makes it a forgery.
        Assert.Single(entry.RenderedMessage.Split('\n'));
        Assert.False(
            entry.RenderedMessage.StartsWith(ForgedTail, StringComparison.Ordinal),
            "the forged entry must never be able to start a line of its own");
    }

    // ── plumbing ─────────────────────────────────────────────────────────────

    private static RecordQuestionEventHandler BuildQuestionHandler(
        QuestionRepo repo, ILogger<RecordQuestionEventHandler> logger)
        => new(repo, new NoOpDerivation(), new FixedUtcClock(Now), logger);

    private static LinkConsentGateToUserHandler BuildConsentHandler(
        ConsentRepo repo, ILogger<LinkConsentGateToUserHandler> logger)
        => new(repo, new GuidIds(), new FixedUtcClock(LinkedAt), logger);

    private static DailyLog LogFor(Guid farmId) => DailyLog.Create(
        AnsweredLogId, new FarmId(farmId), Guid.NewGuid(), Guid.NewGuid(),
        new UserId(Guid.NewGuid()), LogDay, null, null, Now);

    private static string Sha256Hex(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    private sealed class FixedUtcClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

    private sealed class GuidIds : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class NoOpDerivation : IDailyRichnessDerivationService
    {
        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    private sealed class QuestionRepo(bool memberOfFarm, DailyLog? log = null, QuestionEvent? existing = null)
        : FakeShramSafalRepository
    {
        public QuestionEvent? Captured { get; private set; }
        public ObservationEvent? CapturedObservation { get; private set; }

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(memberOfFarm);

        public override Task<QuestionEvent?> FindQuestionEventAsync(
            Guid dailyLogId, string questionKey, CancellationToken ct = default)
            => Task.FromResult(existing);

        public override Task AddQuestionEventAsync(QuestionEvent e, CancellationToken ct = default)
        { Captured = e; return Task.CompletedTask; }

        public override Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
        { CapturedObservation = o; return Task.CompletedTask; }

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(log is not null && log.Id == dailyLogId ? log : null);

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ConsentRepo(
        TermsAcceptanceEvent? existingTermsLink = null,
        ConsentGrantEvent? existingGrantLink = null) : FakeShramSafalRepository
    {
        public override Task AddTermsAcceptanceEventAsync(TermsAcceptanceEvent e, CancellationToken ct = default)
            => Task.CompletedTask;

        public override Task AddConsentGrantEventAsync(ConsentGrantEvent e, CancellationToken ct = default)
            => Task.CompletedTask;

        public override Task<TermsAcceptanceEvent?> FindTermsAcceptanceLinkAsync(
            Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
            => Task.FromResult(existingTermsLink);

        public override Task<ConsentGrantEvent?> FindConsentGrantLinkAsync(
            Guid userId, string preRegistrationSessionId, CancellationToken ct = default)
            => Task.FromResult(existingGrantLink);

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed record CapturedLogEntry(
        LogLevel Level,
        string RenderedMessage,
        IReadOnlyDictionary<string, object?> Properties);

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        private readonly List<CapturedLogEntry> _entries = [];

        public IReadOnlyList<CapturedLogEntry> Entries => _entries;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var properties = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (state is IReadOnlyList<KeyValuePair<string, object?>> structured)
            {
                foreach (var pair in structured)
                {
                    if (pair.Key != "{OriginalFormat}")
                    {
                        properties[pair.Key] = pair.Value;
                    }
                }
            }

            _entries.Add(new CapturedLogEntry(logLevel, formatter(state, exception), properties));
        }
    }
}
