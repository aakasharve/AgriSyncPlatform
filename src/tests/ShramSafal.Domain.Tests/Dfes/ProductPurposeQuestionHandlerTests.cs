// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;
using ShramSafal.Application.UseCases.Dfes.GetProductPurposes;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// Sathi's product-purpose question end to end on the server (part 03 B4): the answer route
/// (<c>POST /shramsafal/question-events</c>, key <c>product.purpose</c>) and its read-back
/// (<c>GET /shramsafal/question-events/product-purposes</c>). The answer is an append-only question event linked to ONE product
/// slot of ONE record, with who answered, by chip or voice, and when; it is never an edit of the record; the score goes up only on
/// a real answer.
/// </summary>
public sealed class ProductPurposeQuestionHandlerTests
{
    private static readonly DateTime Now = NoonOn(Day);

    /// <summary>A member of the farm who is neither the speaker nor a holder of the confirm-records authority.</summary>
    private static readonly Guid OtherMember = Guid.Parse("33000000-0000-4000-8000-000000000035");

    // ── the answer is stored, linked to the record and the product ───────────

    [Fact]
    public async Task ASpeakersChipAnswer_IsStoredOnThatProduct_WithWhoHowAndWhen()
    {
        var f = new Fixture();

        var result = await f.Answer(Speaker, "करपा", ProductPurposeAnswerModes.Chip, "downy");

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : "");
        var row = f.Repo.QuestionEvents.Should().ContainSingle().Subject;
        row.Id.Should().Be(result.Value);
        row.DailyLogId.Should().Be(f.Log.Id);
        row.FarmId.Should().Be(TheFarm);
        row.PlotId.Should().Be(f.Log.PlotId, "the record's own plot, never a value from the body");
        row.QuestionKey.Should().Be("product.purpose:0:e1", "the server names the product slot in the stored key");
        row.QuestionKind.Should().Be(QuestionKinds.ProductPurpose);
        row.Response.Should().Be("करपा");
        row.AnswerMode.Should().Be("chip");
        row.AnswerCode.Should().Be("downy");
        row.ProductName.Should().Be(FoundName, "copied from the stored record, never from the request");
        row.AskedUserId.Should().Be(Speaker, "the person who answered is the caller");
        row.CreatedAtUtc.Should().Be(Now, "when the server took it, on its own clock");
        row.AnswerObservationId.Should().BeNull("what a product was for is not something he saw in the field");
        f.Repo.Observations.Should().BeEmpty();
    }

    [Fact]
    public async Task AVoiceAnswer_KeepsHisWordsVerbatim()
    {
        var f = new Fixture();

        var result = await f.Answer(Speaker, "  डावणी साठी मारलं  ", ProductPurposeAnswerModes.Voice, code: null);

        result.IsSuccess.Should().BeTrue();
        var row = f.Repo.QuestionEvents.Single();
        row.Response.Should().Be("डावणी साठी मारलं");
        row.AnswerMode.Should().Be("voice");
        row.AnswerCode.Should().BeNull();
    }

    [Fact]
    public async Task ACheckerMayAnswer_AnotherMemberMayNot()
    {
        var f = new Fixture();

        (await f.Answer(Checker, "करपा")).IsSuccess.Should().BeTrue("a holder of the confirm-records authority may answer (D-95)");

        var g = new Fixture();
        var refused = await g.Answer(OtherMember, "करपा");
        refused.Error.Should().Be(ShramSafalErrors.Forbidden);
        g.Repo.QuestionEvents.Should().BeEmpty();
    }

    // ── nothing but a real answer is stored ──────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task NoWords_IsNeverStored(string? words)
    {
        var f = new Fixture();

        var result = await f.Handler.HandleAsync(f.Command(Speaker, words, ProductPurposeAnswerModes.Chip, null));

        result.Error.Should().Be(ShramSafalErrors.InvalidCommand);
        f.Repo.QuestionEvents.Should().BeEmpty();
        f.Derivation.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task ALetGo_IsNeverStored_SoItCanStillBeAnsweredLater()
    {
        var f = new Fixture();

        var letGo = await f.Handler.HandleAsync(f.Command(Speaker, null, ProductPurposeAnswerModes.Chip, null) with { Skipped = true });
        letGo.IsFailure.Should().BeTrue();
        f.Repo.QuestionEvents.Should().BeEmpty();

        (await f.Answer(Speaker, "करपा")).IsSuccess.Should().BeTrue("nothing was kept, so a later answer still lands");
    }

    [Fact]
    public async Task TheShape_IsTheServersRule()
    {
        var f = new Fixture();
        var good = f.Command(Speaker, "करपा", ProductPurposeAnswerModes.Chip, "downy");

        foreach (var bad in new[]
        {
            good with { AnswerMode = null },
            good with { AnswerMode = "typed" },
            good with { AnswerMode = ProductPurposeAnswerModes.Voice }, // a voice answer carries no chip code
            good with { AnswerCode = "Downy Mildew" },
            good with { InputEventId = null },
            good with { InputEventId = "  " },
            good with { InputEventId = new string('x', 129) },
            good with { InputEventId = new string('x', 110) }, // the stored key would pass the column's 120
            good with { MixIndex = null },
            good with { MixIndex = -1 },
            good with { DailyLogId = null },
            good with { QuestionKey = "product.purpose:0:e1" }, // the phone never names the slot in the key
            good with { Response = new string('क', ProductPurpose.MaxResponseLength + 1) },
            good with { DeviationReasonCode = "no_time" },
            good with { ScheduleCardRef = "card-1" },
            good with { PhotoAttachmentId = Guid.NewGuid() },
            good with { AnswerObservationId = Guid.NewGuid() },
            good with { LookLineIds = ["task:a:look"] },
        })
        {
            var result = await f.Handler.HandleAsync(bad);
            result.Error.Should().Be(ShramSafalErrors.InvalidCommand);
        }

        f.Repo.QuestionEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task TheProductFields_BelongToThisQuestionAlone()
    {
        var f = new Fixture();
        var gap = f.Command(Speaker, "10 ml", null, null) with { QuestionKey = "gap.dose", InputEventId = null, MixIndex = null };

        (await f.Handler.HandleAsync(gap with { InputEventId = "e1" })).Error.Should().Be(ShramSafalErrors.InvalidCommand);
        (await f.Handler.HandleAsync(gap with { MixIndex = 0 })).Error.Should().Be(ShramSafalErrors.InvalidCommand);
        (await f.Handler.HandleAsync(gap with { AnswerMode = "voice" })).Error.Should().Be(ShramSafalErrors.InvalidCommand);
        (await f.Handler.HandleAsync(gap with { AnswerCode = "downy" })).Error.Should().Be(ShramSafalErrors.InvalidCommand);
        f.Repo.QuestionEvents.Should().BeEmpty();
    }

    // ── which record, which product ──────────────────────────────────────────

    [Fact]
    public async Task AProductTheRecordDoesNotHold_IsRefused_Visibly()
    {
        var f = new Fixture();

        var noSlot = await f.Handler.HandleAsync(f.Command(Speaker, "करपा", "chip", null) with { MixIndex = 4 });
        var noEvent = await f.Handler.HandleAsync(f.Command(Speaker, "करपा", "chip", null) with { InputEventId = "e9" });

        noSlot.Error.Code.Should().Be("ShramSafal.SyncInvalidPayload");
        noEvent.Error.Code.Should().Be("ShramSafal.SyncInvalidPayload");
        f.Repo.QuestionEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task AnotherFarmsRecord_IsNotFound()
    {
        var f = new Fixture(farmOfLog: OtherFarm);

        var result = await f.Answer(Speaker, "करपा");

        result.Error.Should().Be(ShramSafalErrors.DailyLogNotFound);
        f.Repo.QuestionEvents.Should().BeEmpty();
    }

    // ── the first answer stands ──────────────────────────────────────────────

    [Fact]
    public async Task TheSameAnswerAgain_IsTheStoredRow_ADifferentOneIsRefused()
    {
        var f = new Fixture();
        var first = await f.Answer(Speaker, "करपा", "chip", "downy");

        var retry = await f.Answer(Speaker, "करपा", "chip", "downy");
        var changed = await f.Answer(Speaker, "भुरी", "chip", "powdery");

        retry.Value.Should().Be(first.Value, "an offline retry is the same answer, never a second row");
        changed.Error.Should().Be(ShramSafalErrors.ProductPurposeAlreadyAnswered, "the first answer stands and is never silently replaced");
        f.Repo.QuestionEvents.Should().ContainSingle();
    }

    [Fact]
    public async Task EachProductOfATankMix_HasItsOwnAnswer()
    {
        var f = new Fixture(document: Document(FoundName, FoundName2));

        (await f.Answer(Speaker, "करपा", slot: 0)).IsSuccess.Should().BeTrue();
        (await f.Answer(Speaker, "भुरी", slot: 1)).IsSuccess.Should().BeTrue();

        f.Repo.QuestionEvents.Select(q => (q.QuestionKey, q.ProductName)).Should().BeEquivalentTo(new[]
        {
            ("product.purpose:0:e1", FoundName),
            ("product.purpose:1:e1", FoundName2),
        });
    }

    // ── never an edit of the record ──────────────────────────────────────────

    [Fact]
    public async Task AnAnswerDaysLater_IsTaken_AndTheRecordIsNotTouched()
    {
        // Another lane locks the speaker's own changes 24 h after creation; an answer is not a change of the record.
        var f = new Fixture(clockAt: Now.AddDays(3));
        var modifiedBefore = f.Log.ModifiedAtUtc;
        var contentBefore = f.Repo.Contents[f.Log.Id];

        var result = await f.Answer(Speaker, "करपा");

        result.IsSuccess.Should().BeTrue();
        f.Log.ModifiedAtUtc.Should().Be(modifiedBefore);
        f.Repo.Contents[f.Log.Id].Should().BeSameAs(contentBefore);
        f.Repo.ContentWrites.Should().Be(0);
        f.Repo.LogWrites.Should().Be(0);
        f.Derivation.Calls.Should().Equal(new[] { (TheFarm, Day) }, "the record's WORK day is rescored, not the day he answered");
    }

    // ── the score goes up only on a real answer ──────────────────────────────

    [Fact]
    public async Task ARealAnswer_RescoresTheWorkDay_DoesNotKnow_DoesNot()
    {
        var f = new Fixture(document: Document(FoundName, FoundName2));

        await f.Answer(Speaker, "माहीत नाही", "chip", ProductPurpose.UnknownCode, slot: 0);
        f.Derivation.Calls.Should().BeEmpty("\"he does not know\" is kept as his answer and moves nothing");

        await f.Answer(Speaker, "करपा", "chip", "downy", slot: 1);
        f.Derivation.Calls.Should().Equal(new[] { (TheFarm, Day) });
    }

    [Fact]
    public async Task TheMeter_GoesUpOnARealAnswer_AndOnlyThen()
    {
        // The real recompute and the real farm-day read over the same store: the number the phone's meter shows.
        var f = new Fixture(document: Document(FoundName, FoundName2), realScoring: true);
        await f.Scoring!.RecomputeAsync(TheFarm, Day);
        var before = await f.ScoreAsync();

        await f.Answer(Speaker, "माहीत नाही", "chip", ProductPurpose.UnknownCode, slot: 0);
        var afterDontKnow = await f.ScoreAsync();

        await f.Answer(Speaker, "करपा", "chip", "downy", slot: 1);
        var afterAnswer = await f.ScoreAsync();

        before.Should().NotBeNull();
        afterDontKnow.Should().Be(before, "a \"don't know\" is not a purpose");
        afterAnswer.Should().BeGreaterThan(before!.Value, "founder's design: the score goes up on a real answer");
    }

    // ── the read-back the phone shows on the product row ─────────────────────

    [Fact]
    public async Task TheRead_SaysWhichProductsToAsk_AndShowsTheAnswer()
    {
        var f = new Fixture(document: """
            {"schema":1,"inputs":[
              {"id":"e1","method":"Spray","mix":[{"id":"m0","productName":"calcium nitrate"},{"id":"m1","productName":"Progibb"}]},
              {"id":"e2","method":"Spray","reason":"Disease","mix":[{"id":"m0","productName":"प्रेम गोल्ड"}]}]}
            """);
        await f.Answer(Speaker, "करपा", "chip", "downy", slot: 0);

        var read = await f.ReadAs(Speaker);

        read.IsSuccess.Should().BeTrue(read.IsFailure ? read.Error.Code : "");
        read.Value!.DailyLogId.Should().Be(f.Log.Id);
        read.Value.MayAnswer.Should().BeTrue();
        var items = read.Value.Items;
        items.Select(i => (i.InputEventId, i.MixIndex, i.ProductName, i.Ask)).Should().Equal(
            ("e1", 0, FoundName, false),
            ("e1", 1, FoundName2, true),
            ("e2", 0, UnknownName, false));
        items[0].Answer!.Response.Should().Be("करपा");
        items[0].Answer!.AnswerMode.Should().Be("chip");
        items[0].Answer!.AnswerCode.Should().Be("downy");
        items[0].Answer!.AnsweredByUserId.Should().Be(Speaker);
        items[0].Answer!.Counts.Should().BeTrue();
        items[0].CatalogProductId.Should().Be(FoundId);
        items[1].Answer.Should().BeNull();
        items[2].PurposeStated.Should().BeTrue();
        items[2].StatedReason.Should().Be("Disease");
        items[2].CatalogProductId.Should().BeNull("the library does not know that name");
    }

    [Fact]
    public async Task TheRead_WithholdsHisSpokenWords_FromAMemberWhoMayNotHearThem()
    {
        var f = new Fixture();
        await f.Answer(Speaker, "डावणी साठी मारलं", ProductPurposeAnswerModes.Voice, null);

        var other = (await f.ReadAs(OtherMember)).Value!;
        var owner = (await f.ReadAs(Owner)).Value!;

        other.MayAnswer.Should().BeFalse();
        other.Items[0].Ask.Should().BeFalse("it is answered");
        other.Items[0].Answer!.Response.Should().BeNull();
        other.Items[0].Answer!.ResponseWithheld.Should().BeTrue();
        owner.Items[0].Answer!.Response.Should().Be("डावणी साठी मारलं");
        owner.MayAnswer.Should().BeTrue();
    }

    [Fact]
    public async Task TheRead_ShowsAChipsWordsToEveryoneWhoMaySeeTheRecord()
    {
        var f = new Fixture();
        await f.Answer(Speaker, "करपा", ProductPurposeAnswerModes.Chip, "downy");

        var other = (await f.ReadAs(OtherMember)).Value!;

        other.Items[0].Answer!.Response.Should().Be("करपा", "a chip's words are the app's, not his");
        other.Items[0].Answer!.ResponseWithheld.Should().BeFalse();
    }

    [Fact]
    public async Task TheRead_IsRefused_ForAStranger_AndAnotherFarmsRecord()
    {
        var f = new Fixture();
        (await f.ReadAs(Stranger)).Error.Should().Be(ShramSafalErrors.Forbidden);

        var g = new Fixture(farmOfLog: OtherFarm);
        (await g.ReadAs(Speaker)).Error.Should().Be(ShramSafalErrors.DailyLogNotFound);

        var h = new Fixture();
        (await h.ReadHandler.HandleAsync(new GetProductPurposesQuery(Speaker, TheFarm, Guid.Empty))).Error
            .Should().Be(ShramSafalErrors.InvalidCommand);
    }

    // ── fixture ──────────────────────────────────────────────────────────────

    private sealed class Fixture
    {
        public Fixture(string? document = null, Guid? farmOfLog = null, DateTime? clockAt = null, bool realScoring = false)
        {
            Log = SprayLog(Day, PlotA, Speaker, farmOfLog ?? TheFarm);
            Repo = new PurposeRepo();
            Repo.AddLog(Log, document ?? Document(FoundName));
            Repo.Plots.Add(Plot.Create(PlotA, new FarmId(TheFarm), "A", 1m, NoonOn(Day)));
            Repo.Access[Speaker] = new FarmAccess(AppRole.Worker, MembershipStatus.Active, false, null);
            Repo.Access[Owner] = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
            Repo.Access[Checker] = new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, false, FarmPermission.ConfirmRecords);
            Repo.Access[OtherMember] = new FarmAccess(AppRole.Worker, MembershipStatus.Active, false, null);
            foreach (var (user, access) in Repo.Access)
            {
                Repo.Roles[user] = access.Role;
            }

            var clock = new ClockAt(clockAt ?? Now);
            if (realScoring)
            {
                Scoring = new DailyRichnessDerivationService(Repo, new NoJobs(), new SeqIds(), clock);
            }

            Handler = new RecordQuestionEventHandler(
                Repo, (IDailyRichnessDerivationService?)Scoring ?? Derivation, clock, NullLogger<RecordQuestionEventHandler>.Instance);
            ReadHandler = new GetProductPurposesHandler(Repo, clock);
            Clock = clock;
        }

        public DailyLog Log { get; }
        public PurposeRepo Repo { get; }
        public RecordingDerivation Derivation { get; } = new();
        public DailyRichnessDerivationService? Scoring { get; }
        public RecordQuestionEventHandler Handler { get; }
        public GetProductPurposesHandler ReadHandler { get; }
        private ClockAt Clock { get; }

        public RecordQuestionEventCommand Command(Guid caller, string? response, string? mode, string? code, int slot = 0) => new(
            CallerUserId: caller, FarmId: TheFarm, PlotId: null, DailyLogId: Log.Id,
            QuestionKey: ProductPurpose.QuestionKey, Crop: "grapes", ExpectedStage: null, ActualStageApplicability: null,
            AnchorDateType: "log_date", TriggerType: "Product", QuestionType: "product_purpose", Lens: "Execution",
            DepthLevel: 1, Priority: 1, Cooldown: 0, AnswerModes: "chip,voice", SafetyClass: "informational",
            AgronomistApproved: false, MarathiApproved: true, BankVersion: "dfes-bank-test", QuestionEngineVersion: "dfes-qengine-test",
            AnswerObservationId: null, ShownAtUtc: Clock.UtcNow, TriggerReason: null, WeatherContext: null,
            Response: response, StageConfirmed: null, PhotoSubmitted: false, Skipped: false,
            PromptText: "हे कोणत्या रोगासाठी मारलं?", PromptOrigin: "pattern", LookLineIds: [],
            InputEventId: "e1", MixIndex: slot, AnswerMode: mode, AnswerCode: code);

        public Task<AgriSync.BuildingBlocks.Results.Result<Guid>> Answer(
            Guid caller, string response, string mode = ProductPurposeAnswerModes.Chip, string? code = null, int slot = 0) =>
            Handler.HandleAsync(Command(caller, response, mode, code, slot));

        public Task<AgriSync.BuildingBlocks.Results.Result<ProductPurposesDto>> ReadAs(Guid caller) =>
            ReadHandler.HandleAsync(new GetProductPurposesQuery(caller, TheFarm, Log.Id));

        public async Task<int?> ScoreAsync()
        {
            var read = await new GetDayUnderstandingHandler(Repo).HandleAsync(new GetDayUnderstandingQuery(TheFarm, Day, Owner));
            read.IsSuccess.Should().BeTrue(read.IsFailure ? read.Error.Code : "");
            return read.Value!.Score;
        }
    }

    internal sealed class RecordingDerivation : IDailyRichnessDerivationService
    {
        public List<(Guid FarmId, DateOnly Day)> Calls { get; } = [];

        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
        {
            Calls.Add((farmId, localDate));
            return Task.CompletedTask;
        }
    }

    /// <summary>The product store, plus what the answer route and its read touch. Strict: anything else throws.</summary>
    internal sealed class PurposeRepo : ProductRepo, IShramSafalRepository
    {
        public Dictionary<Guid, FarmAccess> Access { get; } = [];
        public List<ObservationEvent> Observations { get; } = [];
        public int ContentWrites { get; private set; }
        public int LogWrites { get; private set; }
        public int Saves { get; private set; }

        Task<FarmAccess?> IShramSafalRepository.GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct) =>
            Task.FromResult<FarmAccess?>(farmId == TheFarm && Access.TryGetValue(userId, out var a) ? a : null);

        Task<DailyLogContent?> IShramSafalRepository.GetCurrentDailyLogContentAsync(Guid dailyLogId, CancellationToken ct) =>
            Task.FromResult(Contents.GetValueOrDefault(dailyLogId));

        public override Task AddQuestionEventAsync(QuestionEvent e, CancellationToken ct = default)
        {
            QuestionEvents.Add(e);
            return Task.CompletedTask;
        }

        public override Task<QuestionEvent?> FindQuestionEventAsync(Guid dailyLogId, string questionKey, CancellationToken ct = default) =>
            Task.FromResult(QuestionEvents.FirstOrDefault(q => q.DailyLogId == dailyLogId && q.QuestionKey == questionKey));

        public override Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
        {
            Observations.Add(o);
            return Task.CompletedTask;
        }

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

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }
}
