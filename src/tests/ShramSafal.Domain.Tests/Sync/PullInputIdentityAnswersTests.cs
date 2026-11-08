// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using ShramSafal.Domain.Tests.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Sync;

/// <summary>
/// The pull's read of his हो / नाही / फोटो answers (<see cref="PullInputIdentityAnswers"/>): their own delta (an answer never
/// moves its record's clock), only for a record he may see, only when the answer's farm IS its record's farm (E4), the newest
/// answer of each item with the speaker's and the check kept apart.
/// </summary>
public sealed class PullInputIdentityAnswersTests
{
    private static readonly DateTime Now = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmA = new(Guid.Parse("e5000000-0000-4000-8000-0000000000a1"));
    private static readonly FarmId FarmB = new(Guid.Parse("e5000000-0000-4000-8000-0000000000b1"));
    private static readonly UserId Maker = new(Guid.Parse("e5000000-0000-4000-8000-000000000001"));
    private static readonly Guid Reader = Guid.Parse("e5000000-0000-4000-8000-000000000002");

    private static DailyLog LogOn(FarmId farm) =>
        DailyLog.Create(Guid.NewGuid(), farm, Guid.NewGuid(), Guid.NewGuid(), Maker, new DateOnly(2026, 11, 8), null, null, Now.AddHours(-5));

    private static InputIdentityAssertion Answer(
        FarmId farm, DailyLog log, DateTime at, IdentityVerdict verdict = IdentityVerdict.Rejected, bool isCheck = false,
        string eventId = "e1", int slot = 0, UserId? by = null) =>
        InputIdentityAssertion.Record(
            Guid.NewGuid(), farm, log.PlotId, log.Id, eventId, slot, "calcium nitrate",
            verdict == IdentityVerdict.Confirmed ? "p-calcium-nitrate" : null, verdict,
            verdict == IdentityVerdict.Photo ? Guid.NewGuid() : null, "inputs-2.4", by ?? Maker, at,
            "req-" + Guid.NewGuid().ToString("N"), isCheck);

    private static PullReadWindow Window(DateTime since, params FarmId[] farms) =>
        new(
            farms.ToDictionary(
                f => (Guid)f,
                f => FarmReadScope.Of((Guid)f, new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, true, null), Now)!),
            since,
            Now);

    private static async Task<List<InputIdentityAssertion>> PullAsync(
        AssertInputIdentityHandlerTests.AnswerFake repo, PullReadWindow window, RecordVisibility? visibility = null,
        params DailyLog[] inThisResponse) =>
        await PullReadmittedAsync(repo, window, visibility, [], inThisResponse);

    private static async Task<List<InputIdentityAssertion>> PullReadmittedAsync(
        AssertInputIdentityHandlerTests.AnswerFake repo, PullReadWindow window, RecordVisibility? visibility,
        IReadOnlyCollection<Guid> readmitted, params DailyLog[] inThisResponse) =>
        await PullInputIdentityAnswers.ReadAsync(
            repo,
            window,
            visibility ?? RecordVisibility.None(Reader),
            inThisResponse.ToDictionary(l => l.Id, l => (Guid)l.FarmId),
            readmitted,
            CancellationToken.None);

    [Fact]
    public async Task OnlyTheNewestAnswerOfAnItem_TheSpeakersAndTheCheckApart()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.AddRange([
            Answer(FarmA, log, Now.AddMinutes(-30)),
            Answer(FarmA, log, Now.AddMinutes(-20), IdentityVerdict.Confirmed),
            Answer(FarmA, log, Now.AddMinutes(-10), IdentityVerdict.Photo, isCheck: true),
            Answer(FarmA, log, Now.AddMinutes(-5), IdentityVerdict.Rejected, isCheck: true),
            Answer(FarmA, log, Now.AddMinutes(-4), eventId: "e1", slot: 1),
        ]);

        var pulled = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA), null, log);

        Assert.Equal(3, pulled.Count);
        var speaker = Assert.Single(pulled, a => !a.IsCheck && a.MixIndex == 0);
        Assert.Equal(IdentityVerdict.Confirmed, speaker.Verdict);
        var check = Assert.Single(pulled, a => a.IsCheck);
        Assert.Equal(IdentityVerdict.Rejected, check.Verdict);
        Assert.Contains(pulled, a => a.MixIndex == 1);
        Assert.Equal(pulled.OrderBy(a => a.AssertedAtUtc).Select(a => a.Id), pulled.Select(a => a.Id));
    }

    [Fact]
    public async Task OnlyAnswersAfterThePhonesCursor_UnlessTheFarmIsReadFromTheBeginning()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.AddRange([Answer(FarmA, log, Now.AddHours(-3), eventId: "old"), Answer(FarmA, log, Now.AddMinutes(-5), eventId: "new")]);

        var since = await PullAsync(repo, Window(Now.AddHours(-1), FarmA), null, log);
        var fromStart = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA), null, log);

        Assert.Equal(["new"], since.Select(a => a.InputEventId).ToArray());
        Assert.Equal(2, fromStart.Count);
    }

    [Fact]
    public async Task AnAnswerAboutARecordKeptFromHim_IsNotSent()
    {
        var log = LogOn(FarmA);
        log.SetAudience(RecordAudience.OnlyMe, Now.AddHours(-1));
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddMinutes(-5)));
        var scopes = new Dictionary<Guid, FarmReadScope>
        {
            [(Guid)FarmA] = FarmReadScope.Of((Guid)FarmA, new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, null), Now)!,
        };
        var hidden = RecordVisibility.For(Reader, scopes, [RestrictedRecord.Of(log, [])]);

        var asTheReader = await PullAsync(repo, new PullReadWindow(scopes, DateTime.UnixEpoch, Now), hidden, log);
        var asTheHolder = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA), RecordVisibility.None(Reader), log);

        Assert.Empty(asTheReader);
        Assert.Single(asTheHolder);
    }

    [Fact]
    public async Task AnAnswerWhoseFarmIsNotItsRecordsFarm_IsNeverSent_E4()
    {
        // The row says farm A; its record belongs to farm B (a row a buggy writer could have made - FK checks bypass RLS).
        var log = LogOn(FarmB);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddMinutes(-5)));

        var inThisResponse = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA, FarmB), null, log);
        var notInThisResponse = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA, FarmB));

        Assert.Empty(inThisResponse);
        Assert.Empty(notInThisResponse);
    }

    [Fact]
    public async Task AnAnswerForARecordNotInThisResponse_IsSent_WhenTheFarmHoldsThatRecord()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddMinutes(-5)));

        // The record itself did not change since the cursor, so it is not in the response - its new answer still travels.
        var pulled = await PullAsync(repo, Window(Now.AddHours(-1), FarmA));

        Assert.Single(pulled);
    }

    // ── a record re-admitted to the reader brings its answers with it (like its photos) ──────────────

    [Fact]
    public async Task AnOldAnswer_OnARecordReadmittedSinceTheCursor_IsReSent()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.AddRange([
            Answer(FarmA, log, Now.AddHours(-5), eventId: "old"),
            Answer(FarmA, log, Now.AddHours(-6), IdentityVerdict.Confirmed, isCheck: true, eventId: "old"),
        ]);
        var window = Window(Now.AddHours(-1), FarmA);

        var withoutReadmission = await PullAsync(repo, window, null, log);
        var readmitted = await PullReadmittedAsync(repo, window, null, [log.Id], log);

        Assert.Empty(withoutReadmission);
        Assert.Equal(2, readmitted.Count);
        Assert.Contains(readmitted, a => a.IsCheck);
        Assert.Contains(readmitted, a => !a.IsCheck);
    }

    [Fact]
    public async Task AnOldAnswer_OnARecordNotReadmitted_IsNotReSent()
    {
        var readmittedLog = LogOn(FarmA);
        var otherLog = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(otherLog, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, otherLog, Now.AddHours(-5)));

        // Another record was readmitted; this one was not, and its answer is older than the cursor.
        var pulled = await PullReadmittedAsync(repo, Window(Now.AddHours(-1), FarmA), null, [readmittedLog.Id], readmittedLog, otherLog);

        Assert.Empty(pulled);
        Assert.Equal(1, repo.LatestReads);
    }

    [Fact]
    public async Task NothingReadmitted_ReadsNoOldAnswersAtAll()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddHours(-5)));

        var pulled = await PullReadmittedAsync(repo, Window(Now.AddHours(-1), FarmA), null, [], log);

        Assert.Empty(pulled);
        Assert.Equal(0, repo.LatestReads);
    }

    [Fact]
    public async Task TheAnswerForARecordThatStaysHidden_IsNotSent_EvenWhenTheReSendRuns()
    {
        var log = LogOn(FarmA);
        log.SetAudience(RecordAudience.OnlyMe, Now.AddHours(-1));
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddHours(-5)));
        var scopes = new Dictionary<Guid, FarmReadScope>
        {
            [(Guid)FarmA] = FarmReadScope.Of((Guid)FarmA, new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, null), Now)!,
        };
        var hidden = RecordVisibility.For(Reader, scopes, [RestrictedRecord.Of(log, [])]);

        var pulled = await PullReadmittedAsync(repo, new PullReadWindow(scopes, Now.AddHours(-1), Now), hidden, [log.Id], log);

        Assert.Empty(pulled);
    }

    [Fact]
    public async Task AReSentAnswer_WhoseFarmIsNotItsRecordsFarm_IsNeverSent_E4()
    {
        var log = LogOn(FarmB);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddHours(-5)));

        var pulled = await PullReadmittedAsync(repo, Window(Now.AddHours(-1), FarmA, FarmB), null, [log.Id], log);

        Assert.Empty(pulled);
    }

    [Fact]
    public async Task AnAnswerBothNewAndOnAReadmittedRecord_IsSentOnce()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        var fresh = Answer(FarmA, log, Now.AddMinutes(-5));
        repo.Rows.AddRange([fresh, Answer(FarmA, log, Now.AddHours(-5), eventId: "old")]);

        var pulled = await PullReadmittedAsync(repo, Window(Now.AddHours(-1), FarmA), null, [log.Id], log);

        Assert.Equal(2, pulled.Count);
        Assert.Single(pulled, a => a.Id == fresh.Id);
    }

    [Fact]
    public async Task TheCursorAdvancesToTheNewestAnswerSent_AndASecondPullWithItRepeatsNothing()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.AddRange([Answer(FarmA, log, Now.AddMinutes(-30), eventId: "a"), Answer(FarmA, log, Now.AddMinutes(-10), eventId: "b")]);

        var first = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA), null, log);
        var cursor = PullInputIdentityAnswers.AdvanceCursor(DateTime.UnixEpoch, first);
        Assert.Equal(2, first.Count);
        Assert.Equal(Now.AddMinutes(-10), cursor);

        var second = await PullAsync(repo, Window(cursor, FarmA), null, log);
        Assert.Empty(second);
        Assert.Equal(cursor, PullInputIdentityAnswers.AdvanceCursor(cursor, second));

        // A new answer afterwards comes back once, and the cursor moves to it.
        repo.Rows.Add(Answer(FarmA, log, Now.AddMinutes(-1), eventId: "c"));
        var third = await PullAsync(repo, Window(cursor, FarmA), null, log);
        Assert.Equal(["c"], third.Select(a => a.InputEventId).ToArray());
        var cursor3 = PullInputIdentityAnswers.AdvanceCursor(cursor, third);
        Assert.Equal(Now.AddMinutes(-1), cursor3);
        Assert.Empty(await PullAsync(repo, Window(cursor3, FarmA), null, log));
    }

    [Fact]
    public async Task ReSentOldAnswers_NeverMoveTheCursorBeyondTheDelta()
    {
        var log = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, log, Now.AddHours(-5)));
        var since = Now.AddHours(-1);

        var reSent = await PullReadmittedAsync(repo, Window(since, FarmA), null, [log.Id], log);

        Assert.Single(reSent);
        Assert.Equal(since, PullInputIdentityAnswers.AdvanceCursor(since, reSent));
    }

    [Fact]
    public async Task AnAnswerWhoseRecordIsGone_IsNeverSent()
    {
        var gone = LogOn(FarmA);
        var other = LogOn(FarmA);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(other, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmA, gone, Now.AddMinutes(-5)));

        var pulled = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA));

        Assert.Empty(pulled);
    }

    [Fact]
    public async Task AnAnswerOfAFarmThePullDoesNotRead_IsNeverSent()
    {
        var log = LogOn(FarmB);
        var repo = new AssertInputIdentityHandlerTests.AnswerFake(log, () => throw new InvalidOperationException());
        repo.Rows.Add(Answer(FarmB, log, Now.AddMinutes(-5)));

        var pulled = await PullAsync(repo, Window(DateTime.UnixEpoch, FarmA), null, log);

        Assert.Empty(pulled);
    }
}
