using AgriSync.SharedKernel.Contracts.Roles; // AppRole.PrimaryOwner
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Tests.Logs; // InMemoryShramSafalRepository
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Guards the per-day read that
/// exposes ONLY the /10: membership gating, the null-when-no-aggregate case, the
/// server-side rollup off the persisted per-dimension breakdown, and (by
/// reflection) that the wire DTO never grows a lens field.
/// </summary>
public sealed class GetDayUnderstandingHandlerTests
{
    private static readonly Guid FarmId = Guid.Parse("00000000-0000-0000-0000-0000000000c2");
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly DateOnly Day = new(2026, 7, 13);

    // WHAT, COST and OBS_FACET covered; WEATHER and LEARN_FACET not.
    //
    // dfes-3 (2026-08-13): LEARN_FACET no longer takes part in the /10 while nothing
    // in production can earn it, so this roster is 47 of 55 → 8.5 → 9, not 47 of 70
    // → 6.71 → 7. The row itself is UNCHANGED — this is a dfes-2 roster read by the
    // dfes-3 rollup, which is exactly how already-persisted days pick the fix up: the
    // score is derived on read, so no backfill is needed for that half of the change.
    private static readonly ScoredDimension[] Roster =
    [
        new("WHAT", 20, true, 1.0, 1.0),
        new("COST", 12, true, 1.0, 1.0),
        new("WEATHER", 8, true, 0.0, 1.0),
        new("OBS_FACET", 15, true, 1.0, 1.0),
        new("LEARN_FACET", 15, true, 0.0, 1.0),
    ];

    private static DailyRichnessAggregate WithComponents(
        string componentsJson,
        DayClassification classification = DayClassification.RichWorkDay)
    {
        var aggregate = DailyRichnessAggregate.Create(
            Guid.NewGuid(), FarmId, Day, "Asia/Kolkata", DateTimeOffset.UtcNow);

        aggregate.ApplyDerivation(
            execScore: 80,
            insightScore: 60,
            learningScore: 40,
            classification: classification,
            flags: default,
            advancesStreak: true,
            advancesBar: true,
            shramPoints: 10,
            rewardReasonsJson: "[]",
            noWorkReasonCode: null,
            scoreEngineVersion: DfesTuning.ScoreEngineVersion,
            componentsJson: componentsJson);

        return aggregate;
    }

    private static DailyRichnessAggregate WithRoster(params ScoredDimension[] possible)
        => WithComponents(System.Text.Json.JsonSerializer.Serialize(
            new LensInput([], [], [], possible)));

    [Fact]
    public async Task EmptyFarmId_ReturnsInvalidCommand()
    {
        var handler = new GetDayUnderstandingHandler(new InMemoryShramSafalRepository());

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(Guid.Empty, Day, UserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("InvalidCommand");
    }

    [Fact]
    public async Task EmptyCallerUserId_ReturnsInvalidCommand()
    {
        var handler = new GetDayUnderstandingHandler(new InMemoryShramSafalRepository());

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, Guid.Empty));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("InvalidCommand");
    }

    [Fact]
    public async Task NonMember_ReturnsForbidden()
    {
        var repo = new InMemoryShramSafalRepository(); // no membership seeded
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().EndWith("Forbidden");
    }

    [Fact]
    public async Task Member_NoAggregateForDay_ReturnsNullScore()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull("a successful result must carry a DTO");
        result.Value.Score.Should().BeNull(); // nothing logged → no number, not a failure
    }

    [Fact]
    public async Task Member_RollsThePersistedBreakdownIntoDayScore()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithRoster(Roster)); // 47 of 55 → 9
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull("a successful result must carry a DTO");
        result.Value.Score.Should().Be(9);
    }

    [Fact]
    public async Task Member_ScoresTheBreakdown_NotTheLensColumns()
    {
        // The lens columns say 80/60/40 — mean 60, which the OLD rollup turned into
        // 6. The breakdown is the truth now; the columns must not be consulted.
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithRoster(new ScoredDimension("WHAT", 20, true, 1.0, 1.0)));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.Value!.Score.Should().Be(10, "the fully-covered breakdown scores 10, not the columns' 6");
    }

    [Fact]
    public async Task Member_UnstampedComponents_ReturnsNullScore()
    {
        // A shell row carries "{}" — nothing scorable. No number, never a zero.
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithComponents("{}"));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull("a successful result must carry a DTO");
        result.Value.Score.Should().BeNull();
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{\"Possible\": \"wrong shape\"}")]
    [InlineData("[]")]
    public async Task Member_MalformedComponents_ReturnsNullScore_NeverThrows(string componentsJson)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithComponents(componentsJson));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Score.Should().BeNull("an unreadable breakdown means no number, not a zero");
    }

    [Fact]
    public async Task Member_LegacyRowWithoutARoster_IsScoredOnWhatThatEngineRecorded()
    {
        // A row written before the completeness roster existed. Rather than invent a
        // denominator for it, score the union of the three lens lists: 20/32 → 6.25 → 6.
        var legacy = System.Text.Json.JsonSerializer.Serialize(new LensInput(
            Execution: [new ScoredDimension("WHAT", 20, true, 1.0, 1.0),
                        new ScoredDimension("COST", 12, true, 0.0, 1.0)],
            Insight: [],
            Learning: []));

        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithComponents(legacy));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.Value!.Score.Should().Be(6);
    }

    [Fact]
    public async Task WrongDay_DoesNotReturnAnotherDaysAggregate()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithRoster(Roster)); // seeded on Day
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(
            new GetDayUnderstandingQuery(FarmId, Day.AddDays(-1), UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull("a successful result must carry a DTO");
        result.Value.Score.Should().BeNull();
    }

    // ── Task 6 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) ──────────
    // Founder ruling 2 (2026-08-14): "Reward honesty and mark its consistency —
    // no score needed for such days." The client cannot obey that ruling without
    // knowing the day was an honestly-declared no-work day, so the STORED
    // classification now crosses the boundary alongside the /10. It is the value
    // the classifier already stamped — this handler never derives a new one.
    [Theory]
    [InlineData(DayClassification.DeclaredNoWorkDay, "DeclaredNoWorkDay")]
    [InlineData(DayClassification.BasicWorkDay, "BasicWorkDay")]
    [InlineData(DayClassification.RichWorkDay, "RichWorkDay")]
    [InlineData(DayClassification.UnaccountedDay, "UnaccountedDay")]
    public async Task Member_ExposesTheStoredClassification(
        DayClassification stored, string expectedOnTheWire)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(WithComponents("{}", stored));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Classification.Should().Be(expectedOnTheWire);
    }

    [Fact]
    public async Task Member_DeclaredNoWorkDay_CarriesTheClassificationEvenWithNoScore()
    {
        // The exact shape the no-work screen depends on: nothing scorable ("{}" →
        // null score) but the day IS classified. A null classification here would
        // leave the client unable to tell an honest no-work day from a day the
        // server simply has not scored yet — and it would show him a number.
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        repo.SeededRichnessAggregates.Add(
            WithComponents("{}", DayClassification.DeclaredNoWorkDay));
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.Value!.Score.Should().BeNull();
        result.Value.Classification.Should().Be("DeclaredNoWorkDay");
    }

    [Fact]
    public async Task Member_NoAggregateForDay_ReturnsNullClassification()
    {
        // No row = the server has NO opinion on what kind of day this was. Naming
        // one here would be a fabricated classification.
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(FarmId, UserId, AppRole.PrimaryOwner);
        var handler = new GetDayUnderstandingHandler(repo);

        var result = await handler.HandleAsync(new GetDayUnderstandingQuery(FarmId, Day, UserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Classification.Should().BeNull();
    }

    [Fact]
    public void Dto_exposes_only_the_score_and_classification_never_a_lens_field()
    {
        // Contract guard. The client-facing DTO carries the /10 and — since
        // founder ruling 2 (2026-08-14) — the stored day classification, and
        // NOTHING else. If a future change adds a lens
        // (Execution/Insight/Learning) to the wire shape this fails loudly.
        var props = typeof(DayUnderstandingDto).GetProperties().Select(p => p.Name).ToArray();

        props.Should().BeEquivalentTo([
            nameof(DayUnderstandingDto.Score),
            nameof(DayUnderstandingDto.Classification),
        ]);
        props.Should().NotContain(n =>
            n.Contains("Execution", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Insight", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Learning", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Lens", StringComparison.OrdinalIgnoreCase));
    }
}
