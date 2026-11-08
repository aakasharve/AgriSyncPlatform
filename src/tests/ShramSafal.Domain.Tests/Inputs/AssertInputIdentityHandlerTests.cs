// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Inputs.AssertInputIdentity;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// <c>assert_input_identity</c>: his हो / नाही / फोटो answer about one product of one saved record (founders D-92 and D-95).
///
/// <para>An answer is an overlay and never an edit (D-92, P7): these facts hold the record's content version, its tasks and its
/// stored content exactly as they were. His words (<c>spokenName</c>) come from the STORED item, never from the request. The
/// speaker answers as himself (<c>is_check = false</c>); a holder of the confirm-records authority gives the check
/// (<c>is_check = true</c>) - the server's call from the sender's standing, never a field on the wire.</para>
/// </summary>
public sealed class AssertInputIdentityHandlerTests
{
    private static readonly DateTime Now = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("c3000000-0000-4000-8000-000000000001"));
    private static readonly FarmId OtherFarm = new(Guid.Parse("c3000000-0000-4000-8000-000000000002"));
    private static readonly Guid Plot = Guid.Parse("c3000000-0000-4000-8000-0000000000a1");
    private static readonly Guid Cycle = Guid.Parse("c3000000-0000-4000-8000-0000000000c1");

    private static readonly Guid Speaker = Guid.Parse("c3000000-0000-4000-8000-000000000011");
    private static readonly Guid Owner = Guid.Parse("c3000000-0000-4000-8000-000000000012");
    private static readonly Guid Checker = Guid.Parse("c3000000-0000-4000-8000-000000000013");
    private static readonly Guid OtherMember = Guid.Parse("c3000000-0000-4000-8000-000000000014");
    private static readonly Guid Stranger = Guid.Parse("c3000000-0000-4000-8000-000000000015");

    private const string Document = """
        {"schema":1,"inputs":[
          {"id":"e1","method":"Drip","mix":[
            {"id":"m0","productName":"calcium nitrate"},
            {"id":"m1","productName":"19:19:19","npkGrade":"19:19:19"}]},
          {"id":"e2","method":"Spray","mix":[{"id":"m0","productName":"   "}]}]}
        """;

    private static string CalciumNitrateId => InputCatalog.Match("calcium nitrate", null).ProductId!;

    private sealed class Fixture
    {
        public DailyLog Log { get; }
        public DailyLogContent Content { get; set; }
        public AnswerFake Repo { get; }
        public AssertInputIdentityHandler Handler { get; }

        public Fixture(string document = Document)
        {
            Log = DailyLog.Create(Guid.NewGuid(), Farm, Plot, Cycle, new UserId(Speaker), new DateOnly(2026, 11, 8), null, null, Now.AddHours(-3));
            Content = DailyLogContent.Create(
                Guid.NewGuid(), Log, 1, document, DailyLogContent.OriginCreate, null, new UserId(Speaker), Now.AddHours(-3), null, null);
            Repo = new AnswerFake(Log, () => Content);
            Handler = new AssertInputIdentityHandler(Repo, new FixedClock(Now));
        }

        public AssertInputIdentityCommand Command(
            Guid by,
            string verdict = "confirmed",
            string eventId = "e1",
            int mixIndex = 0,
            string? productId = "",
            string requestId = "req-1",
            Guid? farm = null,
            Guid? attachment = null,
            Guid? assertionId = null) =>
            new(assertionId ?? Guid.NewGuid(), farm ?? (Guid)Farm, Log.Id, eventId, mixIndex, verdict,
                productId == "" ? CalciumNitrateId : productId, "inputs-2.4", attachment, by, requestId);
    }

    [Fact]
    public async Task Assert_BySpeaker_Stored_AsSpeakerAnswer()
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Speaker));

        Assert.True(result.IsSuccess, result.IsSuccess ? "" : result.Error.Code);
        var row = Assert.Single(f.Repo.Rows);
        Assert.False(row.IsCheck, "the speaker's answer is his own, never the check (D-95)");
        Assert.Equal(Speaker, row.AssertedByUserId.Value);
        Assert.False(result.Value.IsCheck);
    }

    [Fact]
    public async Task Assert_ByConfirmRecordsHolder_Stored_AsCheck()
    {
        var f = new Fixture();

        var byOwner = await f.Handler.HandleAsync(f.Command(Owner, requestId: "owner-1"));
        var byChecker = await f.Handler.HandleAsync(f.Command(Checker, requestId: "checker-1"));

        Assert.True(byOwner.IsSuccess && byChecker.IsSuccess);
        Assert.All(f.Repo.Rows, r => Assert.True(r.IsCheck, "a holder of the confirm-records authority gives the check"));
        Assert.Equal(2, f.Repo.Rows.Count);
    }

    [Fact]
    public async Task Assert_BySpeakerWhoAlsoHoldsConfirmRecords_IsTheCheck_TheServerDecides()
    {
        // The primary account holder who recorded the day himself: he is both. The flag follows his standing, not the request.
        var f = new Fixture();
        f.Repo.Access[Speaker] = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);

        var result = await f.Handler.HandleAsync(f.Command(Speaker));

        Assert.True(result.IsSuccess);
        Assert.True(Assert.Single(f.Repo.Rows).IsCheck);
    }

    [Fact]
    public async Task Assert_ByOtherMember_IsForbidden()
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(OtherMember));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
        Assert.Empty(f.Repo.Rows);
        Assert.Equal(0, f.Repo.Saves);
    }

    [Fact]
    public async Task Assert_ByAPersonWithNoSeatOnTheFarm_IsForbidden()
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Stranger));

        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_ItemNotInLatestContent_IsRejected_SyncInvalidPayload()
    {
        var f = new Fixture();

        foreach (var (eventId, slot) in new[] { ("e9", 0), ("e1", 2), ("e1", 99) })
        {
            var result = await f.Handler.HandleAsync(f.Command(Speaker, eventId: eventId, mixIndex: slot, requestId: $"r-{eventId}-{slot}"));
            Assert.True(result.IsFailure, $"{eventId}/{slot}");
            Assert.Equal("ShramSafal.SyncInvalidPayload", result.Error.Code);
        }

        // An item whose words are gone (blank, or erased) has nothing to copy: refused the same way.
        var blank = await f.Handler.HandleAsync(f.Command(Speaker, eventId: "e2", requestId: "r-blank"));
        Assert.Equal("ShramSafal.SyncInvalidPayload", blank.Error.Code);

        // And a record that has no stored content at all (an older phone's, made before content existed).
        var bare = new Fixture();
        bare.Repo.NoContent = true;
        var none = await bare.Handler.HandleAsync(bare.Command(Speaker));
        Assert.Equal("ShramSafal.SyncInvalidPayload", none.Error.Code);
        Assert.Empty(f.Repo.Rows);
        Assert.Empty(bare.Repo.Rows);
    }

    [Theory]
    [InlineData("{not json")]
    [InlineData("[1, 2")]
    [InlineData("nope")]
    public async Task Assert_StoredContentThatCannotBeRead_IsRefusedVisibly_NeverStoredWithABlankName(string unreadable)
    {
        // A stored document that is not JSON at all: the item cannot be found, so the answer is refused with the code every
        // phone parks visibly - and nothing is stored, no blank name, no row, no audit row, no save.
        var f = new Fixture("{\"schema\":1}");
        f.Content = DailyLogContent.Create(
            Guid.NewGuid(), f.Log, 1, unreadable, DailyLogContent.OriginCreate, null,
            new UserId(Speaker), Now.AddHours(-3), null, null);

        var result = await f.Handler.HandleAsync(f.Command(Speaker));

        Assert.True(result.IsFailure);
        Assert.Equal("ShramSafal.SyncInvalidPayload", result.Error.Code);
        Assert.Empty(f.Repo.Rows);
        Assert.Empty(f.Repo.Audits);
        Assert.Equal(0, f.Repo.Saves);
    }

    [Fact]
    public void SpokenNameOf_SaysWhyItCouldNotFindTheName()
    {
        var unreadable = AssertInputIdentityHandler.SpokenNameOf("{not json", "e1", 0);
        var missing = AssertInputIdentityHandler.SpokenNameOf(Document, "e9", 0);
        var found = AssertInputIdentityHandler.SpokenNameOf(Document, "e1", 1);

        Assert.True(unreadable.IsFailure);
        Assert.Contains("cannot be read", unreadable.Error.Description);
        Assert.True(missing.IsFailure);
        Assert.Contains("no such product", missing.Error.Description);
        Assert.Equal("19:19:19", found.Value);
        Assert.Equal("ShramSafal.SyncInvalidPayload", unreadable.Error.Code);
        Assert.Equal("ShramSafal.SyncInvalidPayload", missing.Error.Code);
    }

    [Fact]
    public async Task Assert_ItemRemovedByALaterVersion_IsRejected_NotAppliedToTheOldOne()
    {
        var f = new Fixture();
        f.Content = DailyLogContent.Create(
            Guid.NewGuid(), f.Log, 1, """{"schema":1,"inputs":[{"id":"e1","method":"Drip","mix":[{"id":"m0","productName":"contof plus"}]}]}""",
            DailyLogContent.OriginRevision, 1, new UserId(Speaker), Now.AddHours(-1), null, null);

        var onTheNewItem = await f.Handler.HandleAsync(f.Command(Speaker, mixIndex: 0, productId: null, verdict: "rejected", requestId: "r-new"));
        var onTheGoneSlot = await f.Handler.HandleAsync(f.Command(Speaker, mixIndex: 1, requestId: "r-gone"));

        Assert.True(onTheNewItem.IsSuccess);
        Assert.Equal("contof plus", Assert.Single(f.Repo.Rows).SpokenName);
        Assert.Equal("ShramSafal.SyncInvalidPayload", onTheGoneSlot.Error.Code);
    }

    [Fact]
    public async Task Assert_CopiesHisWordsFromTheStoredItem_NeverFromTheRequest()
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Speaker, mixIndex: 1, productId: CalciumNitrateId));

        Assert.True(result.IsSuccess);
        var row = Assert.Single(f.Repo.Rows);
        Assert.Equal("19:19:19", row.SpokenName);
        Assert.Equal("e1", row.InputEventId);
        Assert.Equal(1, row.MixIndex);
        Assert.Equal(Plot, row.PlotId);
        Assert.Equal("inputs-2.4", row.CatalogVersion);
        Assert.Equal(Now, row.AssertedAtUtc);
        Assert.Equal("19:19:19", result.Value.SpokenName);
    }

    [Theory]
    [InlineData("p-no-such-product")]
    [InlineData("g045")]
    public async Task Assert_ConfirmedProductIdNotInCatalog_IsRejected(string productId)
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Speaker, productId: productId));

        Assert.True(result.IsFailure);
        Assert.Equal("ShramSafal.SyncInvalidPayload", result.Error.Code);
        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_ConfirmedWithNoProduct_AndAnyUnknownVerdict_AreRejected()
    {
        var f = new Fixture();

        var noProduct = await f.Handler.HandleAsync(f.Command(Speaker, productId: null));
        var unknownProductOnRejected = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "rejected", productId: "p-no-such-product", requestId: "r2"));
        var unknownVerdict = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "maybe", requestId: "r3"));

        Assert.Equal("ShramSafal.SyncInvalidPayload", noProduct.Error.Code);
        Assert.Equal("ShramSafal.SyncInvalidPayload", unknownProductOnRejected.Error.Code);
        Assert.Equal("ShramSafal.SyncInvalidPayload", unknownVerdict.Error.Code);
        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_RejectedAndPhoto_NeedNoProduct_AndKeepTheirPhoto()
    {
        var f = new Fixture();
        var photo = Guid.NewGuid();

        var rejected = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "rejected", productId: null, requestId: "r-no"));
        var photoAnswer = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "photo", productId: null, attachment: photo, requestId: "r-photo"));

        Assert.True(rejected.IsSuccess && photoAnswer.IsSuccess);
        Assert.Equal("rejected", rejected.Value.Verdict);
        Assert.Equal("photo", photoAnswer.Value.Verdict);
        Assert.Equal(photo, photoAnswer.Value.AttachmentId);
    }

    [Fact]
    public async Task Assert_PhotoWithNoAttachment_IsRefused()
    {
        var f = new Fixture();

        var none = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "photo", productId: null, attachment: null, requestId: "r-none"));
        var empty = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "photo", productId: null, attachment: Guid.Empty, requestId: "r-empty"));

        Assert.Equal("ShramSafal.SyncInvalidPayload", none.Error.Code);
        Assert.Equal("ShramSafal.SyncInvalidPayload", empty.Error.Code);
        Assert.Empty(f.Repo.Rows);
        Assert.Equal(0, f.Repo.Saves);
    }

    [Fact]
    public async Task Assert_PhotoWhoseAttachmentTheServerCannotFindYet_IsStillKeptAsAPointer()
    {
        // The phone may be offline when the photo uploads: the answer can reach the server first. The pointer is kept (IT3 counts
        // a photo only when the attachment row exists when it scores).
        var f = new Fixture();
        var notUploadedYet = Guid.NewGuid();

        var result = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "photo", productId: null, attachment: notUploadedYet));

        Assert.True(result.IsSuccess);
        Assert.Equal(notUploadedYet, Assert.Single(f.Repo.Rows).AttachmentId);
    }

    [Fact]
    public async Task Assert_APhotoOfAnotherFarm_IsRefused()
    {
        var f = new Fixture();
        var foreign = Attachment.Create(Guid.NewGuid(), OtherFarm, Guid.NewGuid(), "DailyLog", "x.jpg", "image/jpeg", new UserId(Speaker), Now);
        f.Repo.Attachments[foreign.Id] = foreign;

        var result = await f.Handler.HandleAsync(f.Command(Speaker, verdict: "photo", productId: null, attachment: foreign.Id));

        Assert.Equal("ShramSafal.SyncInvalidPayload", result.Error.Code);
        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_Twice_SameClientMutationId_IsIdempotent()
    {
        var f = new Fixture();
        var first = await f.Handler.HandleAsync(f.Command(Speaker, requestId: "same-request"));

        // The same sync request again - even after the record's content moved on, even with a different answer id.
        f.Content = DailyLogContent.Create(
            Guid.NewGuid(), f.Log, 1, """{"schema":1,"inputs":[]}""", DailyLogContent.OriginRevision, 1, new UserId(Speaker), Now, null, null);
        var again = await f.Handler.HandleAsync(f.Command(Speaker, requestId: "same-request", assertionId: Guid.NewGuid()));

        Assert.True(first.IsSuccess && again.IsSuccess);
        Assert.Single(f.Repo.Rows);
        Assert.Equal(first.Value.AssertionId, again.Value.AssertionId);
        Assert.Equal(1, f.Repo.Saves);
    }

    [Fact]
    public async Task Assert_SameClientMutationIdFromAnotherPerson_IsNotHandedTheirAnswer()
    {
        var f = new Fixture();
        await f.Handler.HandleAsync(f.Command(Speaker, requestId: "shared"));

        var other = await f.Handler.HandleAsync(f.Command(Owner, requestId: "shared"));

        Assert.True(other.IsFailure);
        Assert.Single(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_DoesNotChangeContentVersion_OrTasks()
    {
        var f = new Fixture();
        f.Log.AddTask(Guid.NewGuid(), "Spraying", null, Now.AddHours(-3));
        var versionBefore = f.Log.ContentVersion;
        var tasksBefore = f.Log.Tasks.Select(t => (t.Id, t.ActivityType, t.ExecutionStatus)).ToList();
        var modifiedBefore = f.Log.ModifiedAtUtc;
        var documentBefore = f.Content.DocumentJson;
        var contentVersionBefore = f.Content.ContentVersion;
        var verificationBefore = f.Log.CurrentVerificationStatus;

        var result = await f.Handler.HandleAsync(f.Command(Speaker));

        Assert.True(result.IsSuccess);
        Assert.Equal(versionBefore, f.Log.ContentVersion);
        Assert.Equal(tasksBefore, f.Log.Tasks.Select(t => (t.Id, t.ActivityType, t.ExecutionStatus)).ToList());
        Assert.Equal(modifiedBefore, f.Log.ModifiedAtUtc);
        Assert.Equal(verificationBefore, f.Log.CurrentVerificationStatus);
        Assert.Equal(documentBefore, f.Content.DocumentJson);
        Assert.Equal(contentVersionBefore, f.Content.ContentVersion);
        Assert.Equal(0, f.Repo.ContentWrites);
        Assert.Equal(0, f.Repo.LogWrites);
    }

    [Fact]
    public async Task Assert_OnARecordOfAnotherFarm_IsNotFound()
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Speaker, farm: (Guid)OtherFarm));

        Assert.Equal(ShramSafalErrors.DailyLogNotFound.Code, result.Error.Code);
        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_OnARecordKeptFromHim_IsRefused_LikeEveryChangeToIt()
    {
        var f = new Fixture();
        f.Log.SetAudience(RecordAudience.OnlyMe, Now.AddHours(-1));

        var byTheChecker = await f.Handler.HandleAsync(f.Command(Checker));
        var byTheSpeaker = await f.Handler.HandleAsync(f.Command(Speaker, requestId: "r-speaker"));

        Assert.Equal(ShramSafalErrors.RecordAudienceClosed.Code, byTheChecker.Error.Code);
        Assert.True(byTheSpeaker.IsSuccess, "the maker still sees his own record");
    }

    [Fact]
    public async Task Assert_WritesOneAuditRow_WithoutHisWords()
    {
        var f = new Fixture();

        await f.Handler.HandleAsync(f.Command(Speaker));

        var audit = Assert.Single(f.Repo.Audits);
        Assert.Equal("InputIdentityAsserted", audit.Action);
        Assert.Equal(Farm.Value, audit.FarmId);
        Assert.Equal("InputIdentityAssertion", audit.EntityType);
        Assert.DoesNotContain("spokenName", audit.Payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("calcium nitrate", audit.Payload, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, f.Repo.Saves);
    }

    [Fact]
    public async Task Assert_RefusesAnEmptyOrMalformedCommand()
    {
        var f = new Fixture();

        foreach (var bad in new[]
        {
            f.Command(Speaker) with { AssertionId = Guid.Empty },
            f.Command(Speaker) with { DailyLogId = Guid.Empty },
            f.Command(Speaker) with { MixIndex = -1 },
            f.Command(Speaker) with { InputEventId = " " },
            f.Command(Speaker) with { ClientMutationId = "" },
            f.Command(Speaker) with { AssertedByUserId = Guid.Empty },
        })
        {
            var result = await f.Handler.HandleAsync(bad);
            Assert.True(result.IsFailure);
        }

        Assert.Empty(f.Repo.Rows);
    }

    [Fact]
    public async Task Assert_StoresRow_AndPullReturnsIt()
    {
        // The pull's own read (PullInputIdentityAnswers): what the handler stored is what a phone receives - the speaker's
        // answer and the check apart, for a record he may see, nothing of another farm's.
        var f = new Fixture();
        await f.Handler.HandleAsync(f.Command(Speaker, requestId: "p-1"));
        await f.Handler.HandleAsync(f.Command(Owner, requestId: "p-2", productId: CalciumNitrateId));

        var scope = FarmReadScope.Of((Guid)Farm, new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, true, null), Now)!;
        var window = new PullReadWindow(new Dictionary<Guid, FarmReadScope> { [(Guid)Farm] = scope }, DateTime.UnixEpoch, Now);
        var pulled = await PullInputIdentityAnswers.ReadAsync(
            f.Repo, window, RecordVisibility.None(Owner), new Dictionary<Guid, Guid> { [f.Log.Id] = (Guid)Farm }, [], CancellationToken.None);

        Assert.Equal(2, pulled.Count);
        Assert.Contains(pulled, a => a.AssertedByUserId.Value == Speaker && !a.IsCheck);
        Assert.Contains(pulled, a => a.AssertedByUserId.Value == Owner && a.IsCheck);
        Assert.All(pulled, a => Assert.Equal(f.Log.Id, a.DailyLogId));
        var dto = InputIdentityAssertionDto.From(pulled[0]);
        Assert.Equal("confirmed", dto.Verdict);
        Assert.Equal("calcium nitrate", dto.SpokenName);
    }

    /// <summary>A strict repository fake: every member the handler does not use throws, so a surprise read fails loudly.</summary>
    internal sealed class AnswerFake : FakeShramSafalRepository, IShramSafalRepository
    {
        private readonly DailyLog log;
        private readonly Func<DailyLogContent> content;

        public AnswerFake(DailyLog log, Func<DailyLogContent> content)
        {
            this.log = log;
            this.content = content;
            Access[Speaker] = new FarmAccess(AppRole.Worker, MembershipStatus.Active, false, null);
            Access[Owner] = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
            Access[Checker] = new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.ConfirmRecords);
            Access[OtherMember] = new FarmAccess(AppRole.Worker, MembershipStatus.Active, false, null);
        }

        public Dictionary<Guid, FarmAccess> Access { get; } = [];
        public List<InputIdentityAssertion> Rows { get; } = [];
        public List<AuditEvent> Audits { get; } = [];
        public Dictionary<Guid, Attachment> Attachments { get; } = [];
        public bool NoContent { get; set; }
        public int Saves { get; private set; }
        public int ContentWrites { get; private set; }
        public int LogWrites { get; private set; }

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) =>
            Task.FromResult<DailyLog?>(dailyLogId == log.Id ? log : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<AppRole?>(farmId == (Guid)Farm && Access.TryGetValue(userId, out var a) ? a.Role : null);

        Task<FarmAccess?> IShramSafalRepository.GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct) =>
            Task.FromResult<FarmAccess?>(farmId == (Guid)Farm && Access.TryGetValue(userId, out var a) ? a : null);

        Task<DailyLogContent?> IShramSafalRepository.GetCurrentDailyLogContentAsync(Guid dailyLogId, CancellationToken ct) =>
            Task.FromResult<DailyLogContent?>(NoContent || dailyLogId != log.Id ? null : content());

        Task IShramSafalRepository.AddInputIdentityAssertionAsync(InputIdentityAssertion assertion, CancellationToken ct)
        {
            Rows.Add(assertion);
            return Task.CompletedTask;
        }

        Task<InputIdentityAssertion?> IShramSafalRepository.GetInputIdentityAssertionByClientMutationIdAsync(
            Guid farmId, string clientMutationId, CancellationToken ct) =>
            Task.FromResult(Rows.FirstOrDefault(r => (Guid)r.FarmId == farmId && r.ClientMutationId == clientMutationId));

        Task<List<InputIdentityAssertion>> IShramSafalRepository.GetInputIdentityAssertionsChangedSinceAsync(
            IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct)
        {
            var ids = farmIds.ToHashSet();
            return Task.FromResult(Rows.Where(r => ids.Contains((Guid)r.FarmId) && r.AssertedAtUtc > sinceUtc).ToList());
        }

        public int LatestReads { get; private set; }

        Task<IReadOnlyList<InputIdentityAssertion>> IShramSafalRepository.GetLatestInputIdentityAssertionsForLogsAsync(
            IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct)
        {
            LatestReads++;
            // As the real read: only an answer whose farm IS its record's farm counts, then the newest of each item.
            var newest = Rows
                .Where(r => dailyLogIds.Contains(r.DailyLogId) && r.DailyLogId == log.Id && r.FarmId == log.FarmId)
                .GroupBy(r => (r.DailyLogId, r.InputEventId, r.MixIndex, r.IsCheck))
                .Select(g => g.OrderByDescending(r => r.AssertedAtUtc).ThenByDescending(r => r.Id).First())
                .ToList();
            return Task.FromResult<IReadOnlyList<InputIdentityAssertion>>(newest);
        }

        Task<IReadOnlyList<DailyLog>> IShramSafalRepository.GetDailyLogsForFarmByIdsAsync(
            FarmId farmId, IReadOnlyCollection<Guid> ids, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<DailyLog>>(farmId == log.FarmId && ids.Contains(log.Id) ? [log] : []);

        Task IShramSafalRepository.AddDailyLogContentAsync(DailyLogContent c, CancellationToken ct)
        {
            ContentWrites++;
            return Task.CompletedTask;
        }

        public override Task AddDailyLogAsync(DailyLog l, CancellationToken ct = default)
        {
            LogWrites++;
            return Task.CompletedTask;
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audits.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) =>
            Task.FromResult(Attachments.GetValueOrDefault(attachmentId));

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow => now;
    }
}
