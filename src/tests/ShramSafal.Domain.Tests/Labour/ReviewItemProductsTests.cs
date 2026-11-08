// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 3a; founder D-95)
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Dfes;
using ShramSafal.Domain.Work;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// The approval card carries the record's products (D-95): from the record's LATEST stored content, the library's match and the
/// newest answers, the speaker's answer and the check kept apart, and how many products no checker has checked yet. A record that
/// only sprays used to arrive blank. Checking never blocks मंजूर: nothing the confirm path reads depends on it.
/// </summary>
public sealed class ReviewItemProductsTests
{
    private static readonly DateTime Now = NoonOn(Day).AddDays(1);

    [Fact]
    public async Task SprayOnlyRecord_ReviewItem_ListsItsProducts()
    {
        // Today it arrives blank: a spray, no labour, no cost. Now it names what was sprayed.
        var repo = Repo();
        repo.AddLog(SprayLog(Day), Document(FoundName, UnknownName, AmbiguousName));

        var card = (await Review(repo, Owner)).Single();

        card.Points.Count.Should().BeNull("a spray record carries no labour facts, as before");
        var products = card.Products!;
        products.Select(p => p.SpokenName).Should().Equal(FoundName, UnknownName, AmbiguousName);
        products[0].Match.Should().Be(new ReviewProductMatchDto("found", FoundId));
        products[1].Match.Should().Be(new ReviewProductMatchDto("notFound", null));
        products[2].Match.Should().Be(new ReviewProductMatchDto("ambiguous", null), "never the first-listed candidate");
        products.Should().OnlyContain(p => p.SpeakerAnswer == null && p.Check == null);
        card.UncheckedProductCount.Should().Be(3);
        products[0].InputEventId.Should().Be("e1");
        products.Select(p => p.MixIndex).Should().Equal(0, 1, 2);
    }

    [Fact]
    public async Task SpeakerAnswer_ShownSeparately_FromCheck()
    {
        var repo = Repo();
        var log = repo.AddLog(SprayLog(Day), Document(FoundName));
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Speaker, at: NoonOn(Day)));

        var speakerOnly = (await Review(repo, Owner)).Single();
        speakerOnly.Products!.Single().SpeakerAnswer!.Verdict.Should().Be("confirmed");
        speakerOnly.Products!.Single().SpeakerAnswer!.AssertedByUserId.Should().Be(Speaker);
        speakerOnly.Products!.Single().Check.Should().BeNull("the speaker's answer is his, not the check");
        speakerOnly.UncheckedProductCount.Should().Be(1, "his own yes does not check the product");

        repo.Answers.Add(Answer(log, IdentityVerdict.Rejected, Checker, isCheck: true, at: NoonOn(Day).AddHours(1)));
        var both = (await Review(repo, Owner)).Single().Products!.Single();
        both.SpeakerAnswer!.Verdict.Should().Be("confirmed", "the speaker's answer is kept, not overwritten");
        both.Check!.Verdict.Should().Be("rejected");
        both.Check.AssertedByUserId.Should().Be(Checker);
    }

    [Fact]
    public async Task CheckedProducts_NotCountedAsUnchecked()
    {
        var repo = Repo();
        var log = repo.AddLog(SprayLog(Day), Document(FoundName, FoundName2, UnknownName));
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, slot: 0));
        repo.Answers.Add(Answer(log, IdentityVerdict.Rejected, Checker, isCheck: true, slot: 1, spoken: FoundName2));
        // A check by the record's own speaker is not a check (D-95): the third product's "check" comes from him.
        repo.Answers.Add(Answer(log, IdentityVerdict.Rejected, Speaker, isCheck: true, slot: 2, spoken: UnknownName));

        var card = (await Review(repo, Owner)).Single();

        card.UncheckedProductCount.Should().Be(1, "a check of any kind (yes or no) checks a product; the speaker's own does not");
        card.Products!.Select(p => p.Check is not null).Should().Equal(true, true, false);
    }

    [Fact]
    public async Task TheCardStaysOpenToTheOwnersDecision_WithProductsUnchecked()
    {
        // The card is offered with products unchecked; the decision itself (the real approval, through the real recompute that
        // reads those products) is VerifyLogRecomputeTests.ApproveWithUncheckedProducts_StillSucceeds.
        var repo = Repo();
        repo.AddLog(SprayLog(Day), Document(FoundName, UnknownName));

        var card = (await Review(repo, Owner)).Single();

        card.UncheckedProductCount.Should().Be(2);
        card.Status.Should().Be("Draft");
    }

    // ── fix pass 1 ───────────────────────────────────────────────────────────

    [Fact]
    public async Task F1_AnAuthorWhoHoldsConfirmRecords_CannotDisplaceTheManagersRealCheck()
    {
        // The owner is the record's author AND a ConfirmRecords holder (his answers are stored is_check = true). Manager M gives a
        // real check (yes) at T1; the owner then answers no at T2. The owner's answer is HIS (the speaker's), not a check, so it
        // must not displace M's check: the product stays checked-yes and the card shows M's check.
        var repo = Repo();
        var log = repo.AddLog(SprayLog(Day, speaker: Owner), Document(FoundName));
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, at: NoonOn(Day)));
        repo.Answers.Add(Answer(log, IdentityVerdict.Rejected, Owner, isCheck: true, at: NoonOn(Day).AddHours(1)));

        var judged = (await ShramSafal.Application.Services.ProductIdentityReader.JudgeAsync(repo, [log])).Values.Single().Single();
        var card = (await Review(repo, Owner)).Single();

        judged.Basis.Should().Be(ProductIdentityBasis.CheckedYes);
        judged.Coverage.Should().Be(1.0);
        card.Products!.Single().Check!.AssertedByUserId.Should().Be(Checker);
        card.Products!.Single().Check!.Verdict.Should().Be("confirmed");
        card.Products!.Single().SpeakerAnswer!.Verdict.Should().Be("rejected", "the owner's no is kept as his own answer");
        card.UncheckedProductCount.Should().Be(0);
    }

    [Fact]
    public async Task F4_ACheckThatDoesNotCount_IsNotACheckOnTheCard()
    {
        // The card uses the score's own rule: a photo with no attachment row, or a yes naming a product other than the one the
        // library found, is passed over - it is not a check and the product stays unchecked.
        var repo = Repo();
        var log = repo.AddLog(SprayLog(Day), Document(FoundName, FoundName2));
        repo.Answers.Add(Answer(log, IdentityVerdict.Photo, Checker, isCheck: true, slot: 0, attachment: Guid.NewGuid()));
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, slot: 1, spoken: FoundName2, productId: FoundId));

        var card = (await Review(repo, Owner)).Single();

        card.Products!.Select(p => p.Check).Should().OnlyContain(c => c == null, "neither answer counts, so neither is a check");
        card.UncheckedProductCount.Should().Be(2);

        // The same photo with its attachment row present, and a yes naming the found product, ARE checks.
        var photo = repo.Answers[0].AttachmentId!.Value;
        repo.Attachments[photo] = PhotoRow(photo);
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, slot: 1, spoken: FoundName2, productId: FoundId2, at: NoonOn(Day).AddHours(1)));
        var counted = (await Review(repo, Owner)).Single();
        counted.UncheckedProductCount.Should().Be(0);
    }

    // ── who is shown the products, and the rest of the contract ──────────────

    [Fact]
    public async Task AReaderWhoMayNotHearTheWords_GetsNoProducts()
    {
        // His words go to the speaker, the primary account holder and a holder of the confirm-records authority (the rule that
        // guards the original voice). A seat that can see the card but holds none of those is not shown them: the list is
        // absent (null), never an empty list that would read as "no product".
        var repo = Repo();
        repo.AddLog(SprayLog(Day), Document(FoundName));
        repo.Roles[Stranger] = AppRole.SecondaryOwner;
        repo.Members.Add(Stranger);

        var asOwner = await Review(repo, Owner);
        var asSpeaker = await Review(repo, Speaker);
        var asNoGrant = await Review(repo, Stranger);

        asOwner.Single().Products.Should().NotBeNull();
        asSpeaker.Single().Products.Should().NotBeNull("the speaker hears his own words");
        asNoGrant.Should().NotBeEmpty("the seat sees the card (it may act on it); the proof below must not pass on an empty list");
        asNoGrant.Should().OnlyContain(c => c.Products == null && c.UncheckedProductCount == null);
    }

    [Fact]
    public async Task ARecordNamingNoProduct_HasAnEmptyList_AndNothingUnchecked()
    {
        var repo = Repo();
        repo.AddLog(SprayLog(Day), """{"schema":1,"inputs":[]}""");
        repo.AddLog(SprayLog(Day.AddDays(-1)), null); // no stored content at all

        var cards = await Review(repo, Owner);

        cards.Should().HaveCount(2);
        cards.Should().OnlyContain(c => c.Products != null && c.Products.Count == 0 && c.UncheckedProductCount == 0);
    }

    [Fact]
    public async Task AnAnswerOfAnotherRecord_NeverShowsOnThisCard()
    {
        var repo = Repo();
        var one = repo.AddLog(SprayLog(Day), Document(FoundName));
        var two = repo.AddLog(SprayLog(Day.AddDays(-1)), Document(FoundName));
        repo.Answers.Add(Answer(two, IdentityVerdict.Confirmed, Checker, isCheck: true));

        var cards = await Review(repo, Owner);

        cards.Single(c => c.Id == one.Id.ToString()).Products!.Single().Check.Should().BeNull();
        cards.Single(c => c.Id == two.Id.ToString()).Products!.Single().Check.Should().NotBeNull();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static ReviewRepo Repo()
    {
        var repo = new ReviewRepo();
        repo.Roles[Owner] = AppRole.PrimaryOwner;
        repo.Roles[Speaker] = AppRole.Worker;
        repo.Roles[Checker] = AppRole.SecondaryOwner;
        return repo;
    }

    private static async Task<IReadOnlyList<LabourReviewItemDto>> Review(ReviewRepo repo, Guid caller)
    {
        var result = await new GetLabourDataHandler(repo, new ClockAt(Now)).HandleAsync(
            new GetLabourDataQuery(new FarmId(TheFarm), new UserId(caller)));
        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : "");
        return result.Value!.Review;
    }

    /// <summary>The reads the labour page makes, over the records and answers the test holds.</summary>
    private sealed class ReviewRepo : ProductRepo, IShramSafalRepository
    {
        public Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default) =>
            Task.FromResult(new List<FarmMembership>());

        public override Task<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>>([]);

        public Task<List<JobCard>> GetJobCardsForFarmAsync(FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default) =>
            Task.FromResult(new List<JobCard>());

        public Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default) =>
            Task.FromResult(new List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>());

        public override Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) =>
            Task.FromResult(new List<FinanceCorrection>());

        public Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default) =>
            Task.FromResult(Logs.Where(l => l.FarmId == farmId).ToList());

        public Task<IReadOnlyList<AttendanceMark>> GetAttendanceMarksForFarmInWindowAsync(
            FarmId farmId, DateOnly? from, DateOnly? toInclusive, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AttendanceMark>>([]);

        public Task<List<LabourAssignment>> GetLabourAssignmentsForFarmInWindowAsync(
            FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default) =>
            Task.FromResult(new List<LabourAssignment>());
    }
}
