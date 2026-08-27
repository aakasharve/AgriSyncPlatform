// spec: dfes-companion-2026-07-11 (wave-4.4) — founder model, 2026-08-17.
//
// The two things a worker actually carries with him, tested as models:
//
//   TIER 2  WorkerStatement    — an employer's own word, optional, always attributed.
//   TIER 3  WorkerDerivedCounts — what Shram Safal itself counted, or nothing.
//
// The load-bearing claim in both is the same and it is a claim about ABSENCE: an owner who
// said nothing must render as having said nothing, and a count that cannot be derived
// honestly must render as nothing — never as a zero, which a reader takes for a verdict on
// the man. So most of these tests assert null, and each one is paired with the case that
// produces a real value, because "always null" would pass every absence assertion here
// while being completely broken.

using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work;

public sealed class WorkerReputationTiersTests
{
    private static readonly DateTime Now = new(2026, 8, 17, 8, 0, 0, DateTimeKind.Utc);

    private static readonly FarmId ArveFarms = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly FarmId PatilFarms = new(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
    private static readonly Guid PlotGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");

    private static readonly UserId Ramesh = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId SomebodyElse = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly UserId ArveOwner = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));

    // ── TIER 2 — the employer's own word ────────────────────────────────────────────

    [Fact]
    public void A_statement_always_carries_the_farm_that_is_vouching()
    {
        // A reference is worth what its author is worth. A reader must be able to see WHO
        // spoke before deciding what the words mean, so the farm travels with the words.
        var statement = WorkerStatement.Write(
            id: Guid.NewGuid(),
            farmId: ArveFarms,
            farmName: "ARVE Farms",
            workerUserId: Ramesh,
            authoredByUserId: ArveOwner,
            remark: "Reliable with the sprayer. Turns up when he says he will.",
            authoredAtUtc: Now);

        statement.FarmId.Should().Be(ArveFarms);
        statement.FarmName.Should().Be("ARVE Farms");
        statement.AuthoredByUserId.Should().Be(ArveOwner);
        statement.WorkerUserId.Should().Be(Ramesh, "the subject and the author are different people");
        statement.Remark.Should().StartWith("Reliable");
    }

    [Fact]
    public void An_empty_statement_is_silence_and_silence_is_not_stored()
    {
        // Writing one is OPTIONAL. An owner with nothing to say writes nothing — and an
        // empty row would later render as a farm having said something hollow about a man,
        // or worse, as an unrated badge implying a review was owed.
        foreach (var nothing in new[] { "", "   ", "\t\n" })
        {
            var write = () => WorkerStatement.Write(
                Guid.NewGuid(), ArveFarms, "ARVE Farms", Ramesh, ArveOwner, nothing, Now);

            write.Should().Throw<ArgumentException>();
        }
    }

    [Fact]
    public void A_statement_cannot_be_written_without_naming_who_is_vouching()
    {
        var write = () => WorkerStatement.Write(
            Guid.NewGuid(), ArveFarms, "  ", Ramesh, ArveOwner, "Good worker.", Now);

        write.Should().Throw<ArgumentException>();
    }

    // ── TIER 3 — what Shram Safal itself counted ────────────────────────────────────

    [Fact]
    public void Completed_tasks_are_counted_from_real_job_cards()
    {
        var cards = new List<JobCard>
        {
            CompletedCard(ArveFarms, Ramesh),
            CompletedCard(ArveFarms, Ramesh),
        };

        var derived = WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value]);

        derived.CompletedTasks.Should().Be(2, "these fell out of work already recorded");
    }

    [Fact]
    public void Work_that_was_never_finished_is_not_counted_as_finished()
    {
        // Assigned but not completed, and cancelled: crediting either would be inventing
        // an achievement. Paired with a completed card so the count is shown to move.
        var cards = new List<JobCard>
        {
            AssignedCard(ArveFarms, Ramesh),
            CancelledCard(ArveFarms, Ramesh),
        };

        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value])
            .CompletedTasks.Should().BeNull();

        cards.Add(CompletedCard(ArveFarms, Ramesh));

        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value])
            .CompletedTasks.Should().Be(1, "the finished one, and only the finished one");
    }

    [Fact]
    public void No_completed_work_renders_as_nothing_rather_than_as_a_zero()
    {
        // A "0" beside a man's name reads as a verdict on him. The truth is only that this
        // system has not seen him finish anything here.
        var derived = WorkerDerivedCounts.FromJobCards([], Ramesh, [ArveFarms.Value]);

        derived.CompletedTasks.Should().BeNull();
        derived.CompletedTasks.Should().NotBe(0, "absent and zero are different claims");
    }

    [Fact]
    public void The_count_is_confined_to_the_farms_the_caller_was_permitted()
    {
        // Tier 3's half of the boundary. Even a permitted reputation read must not quietly
        // fold in a farm the caller was never granted.
        var cards = new List<JobCard>
        {
            CompletedCard(ArveFarms, Ramesh),
            CompletedCard(PatilFarms, Ramesh),
        };

        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [PatilFarms.Value])
            .CompletedTasks.Should().Be(1, "only the farm in the permitted set counts");

        // POSITIVE CONTROL — both cards are real and countable, so the 1 above is a filter
        // doing its job rather than a card that was never there.
        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value, PatilFarms.Value])
            .CompletedTasks.Should().Be(2);
    }

    [Fact]
    public void Another_mans_completed_work_is_never_counted_as_his()
    {
        var cards = new List<JobCard> { CompletedCard(ArveFarms, SomebodyElse) };

        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value])
            .CompletedTasks.Should().BeNull();

        cards.Add(CompletedCard(ArveFarms, Ramesh));

        WorkerDerivedCounts.FromJobCards(cards, Ramesh, [ArveFarms.Value])
            .CompletedTasks.Should().Be(1, "his one, not the other man's");
    }

    [Fact]
    public void Field_work_hours_are_absent_because_nothing_records_hours_worked()
    {
        // THE HONEST GAP, asserted rather than hidden. This card carries everything that
        // LOOKS like hours — a 4-hour line item, a start stamp and a completion stamp — and
        // still yields nothing, because planned hours are a plan and elapsed wall-clock is
        // not time worked. Doctrine P4: no fabricated numbers.
        var card = CompletedCard(ArveFarms, Ramesh, startedAtUtc: Now, completedAtUtc: Now.AddHours(9));

        var derived = WorkerDerivedCounts.FromJobCards([card], Ramesh, [ArveFarms.Value]);

        // Proves the card was genuinely seen — without this the null below would pass just
        // as well on an empty list, which is exactly the vacuous green to avoid.
        derived.CompletedTasks.Should().Be(1, "the card is present and countable");

        derived.FieldWorkHours.Should().BeNull(
            "no field in the model records hours actually worked; a plan is not an achievement");

        card.LineItems.Sum(i => i.ExpectedHours).Should().Be(4m,
            "the tempting number exists and is deliberately not used");
        card.StartedAtUtc.Should().NotBeNull();
        card.CompletedAtUtc.Should().NotBeNull();
    }

    [Fact]
    public void Nothing_is_the_shape_of_a_record_that_could_not_be_derived()
    {
        WorkerDerivedCounts.Nothing.CompletedTasks.Should().BeNull();
        WorkerDerivedCounts.Nothing.FieldWorkHours.Should().BeNull();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────────

    private static JobCard Draft(FarmId farmId) => JobCard.CreateDraft(
        Guid.NewGuid(), farmId, PlotGuid, null, ArveOwner,
        new DateOnly(2026, 8, 17),
        [new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null)],
        Now);

    private static JobCard AssignedCard(FarmId farmId, UserId worker)
    {
        var job = Draft(farmId);
        job.Assign(worker, ArveOwner, AgriSync.SharedKernel.Contracts.Roles.AppRole.Mukadam, Now);
        return job;
    }

    private static JobCard CompletedCard(
        FarmId farmId, UserId worker, DateTime? startedAtUtc = null, DateTime? completedAtUtc = null)
    {
        var job = AssignedCard(farmId, worker);
        if (startedAtUtc is { } started)
        {
            job.Start(worker, started);
        }

        job.CompleteWithLog(Guid.NewGuid(), ArveOwner, completedAtUtc ?? Now);
        return job;
    }

    private static JobCard CancelledCard(FarmId farmId, UserId worker)
    {
        var job = AssignedCard(farmId, worker);
        job.Cancel(ArveOwner, AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner, "rain", Now);
        return job;
    }
}
