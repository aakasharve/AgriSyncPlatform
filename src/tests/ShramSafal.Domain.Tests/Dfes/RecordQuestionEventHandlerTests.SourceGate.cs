// spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 3; founder D-B, D-D, D-G)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// Lane DFES-Q, the source gate. A question that STATES AGRONOMY (decided by the server from the question key, never from a
/// phone's claim) is recorded only with a source the SERVER resolved from Shram Safal's own published schedule: the phone sends
/// which look lines it used, never a document or a page. Old phones keep posting the old shape and are accepted unchanged (P11).
/// </summary>
public sealed partial class RecordQuestionEventHandlerTests
{
    private sealed class FakeSourceResolver(Dictionary<string, (string Doc, string Page)> known) : IQuestionSourceResolver
    {
        public IReadOnlyList<QuestionSourceRef>? Resolve(IReadOnlyList<string> lookLineIds)
            => lookLineIds.Count > 0 && lookLineIds.All(known.ContainsKey)
                ? lookLineIds.Select(id => new QuestionSourceRef(id, known[id].Doc, known[id].Page)).ToList()
                : null;
    }

    private static readonly FakeSourceResolver NrcLines = new(new()
    {
        ["grapes-fp-d12-buds"] = ("nrc-techbul-14-fruit-pruning", "23"),
    });

    private static RecordQuestionEventHandler Handler(CapturingRepo repo, IQuestionSourceResolver? resolver = null) =>
        new(repo, new NullDailyRichnessDerivationService(), new FixedClock(FixedNow),
            NullLogger<RecordQuestionEventHandler>.Instance, resolver);

    private static RecordQuestionEventCommand StageLook(Guid farmId, Guid userId, params string[] lookLineIds) =>
        ValidCommand(farmId, userId) with
        {
            QuestionKey = "stage.look",
            TriggerType = "StageWindow",
            QuestionType = "observation",
            AgronomistApproved = false,
            PromptOrigin = "pattern",
            PromptText = "10 काड्या मोजून सांगा, किती काड्यांवर कळ्या फुटल्या?",
            LookLineIds = lookLineIds,
        };

    [Fact]
    public async Task An_old_phone_posting_the_old_shape_is_accepted_unchanged()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true);

        // The exact body a 1.0.17 phone sends: agronomistApproved true, none of the new fields.
        var result = await Handler(repo, NrcLines).HandleAsync(ValidCommand(farmId, userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("gap", repo.Captured!.QuestionKind);
        Assert.True(repo.Captured.AgronomistApproved);
        Assert.Null(repo.Captured.SourceRefsJson);
        Assert.Null(repo.Captured.PromptOrigin);
        Assert.Equal(userId, repo.Captured.AskedUserId);
    }

    [Theory]
    [InlineData("gap.dose")]
    [InlineData("gap.scope")]          // retired on new phones, still sent by old APKs in the field
    [InlineData("stage.confirm_current")]
    [InlineData("followup.observation_outcome")]
    [InlineData("learning.next_experiment")]
    public async Task Questions_that_state_no_agronomy_need_no_source(string questionKey)
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo).HandleAsync(
            ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { QuestionKey = questionKey }, CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task The_agronomist_flag_off_no_longer_rejects_a_question_that_states_no_agronomy()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo).HandleAsync(
            ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { AgronomistApproved = false }, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(repo.Captured!.AgronomistApproved); // stored as sent: the truth, nobody ticked it
    }

    [Fact]
    public async Task A_stage_question_with_an_NRC_cited_look_line_is_accepted_and_the_server_stores_the_source_it_resolved()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo, NrcLines).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "grapes-fp-d12-buds"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("stage_look", repo.Captured!.QuestionKind);
        Assert.Contains("\"docId\":\"nrc-techbul-14-fruit-pruning\"", repo.Captured.SourceRefsJson);
        Assert.Contains("\"page\":\"23\"", repo.Captured.SourceRefsJson);
        Assert.Contains("\"lineId\":\"grapes-fp-d12-buds\"", repo.Captured.SourceRefsJson);
        Assert.Equal("10 काड्या मोजून सांगा, किती काड्यांवर कळ्या फुटल्या?", repo.Captured.PromptText);
        Assert.Equal("pattern", repo.Captured.PromptOrigin);
    }

    /// <summary>
    /// The production resolver over the embedded schedule (sync-contract/schedules/*.dfes.json): a real look line of Shram Safal's own
    /// October-pruning schedule is accepted with the pages that schedule cites; a line it does not have is refused.
    /// </summary>
    [Fact]
    public async Task With_the_embedded_schedule_a_real_look_line_is_accepted_with_its_cited_pages_and_a_made_up_one_is_refused()
    {
        var resolver = new ShramSafal.Infrastructure.AI.Dfes.ScheduleSourceResolver();
        var repo = new CapturingRepo(memberOfFarm: true);

        var accepted = await Handler(repo, resolver).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "grapes-table-oct-fruit-pruning/sprout.0"), CancellationToken.None);
        var refused = await Handler(new CapturingRepo(memberOfFarm: true), resolver).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "grapes-table-oct-fruit-pruning/made-up"), CancellationToken.None);

        Assert.True(accepted.IsSuccess);
        Assert.Contains("\"lineId\":\"grapes-table-oct-fruit-pruning/sprout.0\"", repo.Captured!.SourceRefsJson);
        Assert.True(refused.IsFailure);
    }

    [Fact]
    public async Task A_stage_question_with_no_source_is_rejected()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo, NrcLines).HandleAsync(StageLook(Guid.NewGuid(), Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Captured);
    }

    [Fact]
    public async Task A_source_the_phone_names_itself_is_rejected_only_the_servers_own_schedule_counts()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        // A document-and-page string the server's schedule does not hold: a phone claim, not a source.
        var result = await Handler(repo, NrcLines).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "nrc-techbul-14-fruit-pruning:p23"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Captured);
    }

    [Fact]
    public async Task One_unknown_line_among_known_ones_rejects_the_whole_question()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo, NrcLines).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "grapes-fp-d12-buds", "made-up-line"), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task With_no_source_resolver_every_question_that_states_agronomy_is_refused()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo).HandleAsync(
            StageLook(Guid.NewGuid(), Guid.NewGuid(), "grapes-fp-d12-buds"), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Theory]
    [InlineData("safety.spray_wind_high")]
    [InlineData("weather.rain_before_spray")]
    [InlineData("advice.something_new")]  // an unknown key is treated as stating agronomy: fail closed
    public async Task Advice_keys_and_unknown_keys_need_a_source(string questionKey)
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo, NrcLines).HandleAsync(
            ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { QuestionKey = questionKey }, CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Ai_worded_text_needs_no_marathi_tick_but_bank_and_pattern_text_do()
    {
        var aiRepo = new CapturingRepo(memberOfFarm: true);
        var patternRepo = new CapturingRepo(memberOfFarm: true);
        var cmd = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { MarathiApproved = false };

        var ai = await Handler(aiRepo).HandleAsync(cmd with { PromptOrigin = "ai" }, CancellationToken.None);
        var pattern = await Handler(patternRepo).HandleAsync(cmd with { PromptOrigin = "pattern" }, CancellationToken.None);

        Assert.True(ai.IsSuccess);
        Assert.True(pattern.IsFailure);
    }

    [Fact]
    public async Task An_unknown_prompt_origin_is_rejected()
    {
        var repo = new CapturingRepo(memberOfFarm: true);

        var result = await Handler(repo).HandleAsync(
            ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { PromptOrigin = "agronomist" }, CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task A_why_not_answer_keeps_its_reason_and_challenge_and_an_unknown_reason_is_rejected()
    {
        var okRepo = new CapturingRepo(memberOfFarm: true);
        var badRepo = new CapturingRepo(memberOfFarm: true);
        var why = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with
        {
            QuestionKey = "schedule.why_not",
            TriggerType = "Schedule",
            QuestionType = "gap_fill",
            ScheduleCardRef = "grapes-fp:card-d10-ga3",
            DeviationReasonCode = "input_unavailable",
            DeviationChallenge = "दुकानात औषध संपलं होतं",
        };

        var ok = await Handler(okRepo).HandleAsync(why, CancellationToken.None);
        var bad = await Handler(badRepo).HandleAsync(why with { DeviationReasonCode = "lazy" }, CancellationToken.None);

        Assert.True(ok.IsSuccess);
        Assert.Equal("why_not", okRepo.Captured!.QuestionKind);
        Assert.Equal("input_unavailable", okRepo.Captured.DeviationReasonCode);
        Assert.Equal("दुकानात औषध संपलं होतं", okRepo.Captured.DeviationChallenge);
        Assert.Equal("grapes-fp:card-d10-ga3", okRepo.Captured.ScheduleCardRef);
        Assert.True(bad.IsFailure);
    }

    [Fact]
    public async Task The_person_asked_is_always_the_caller()
    {
        var callerId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true);

        await Handler(repo).HandleAsync(ValidCommand(Guid.NewGuid(), callerId), CancellationToken.None);

        Assert.Equal(callerId, repo.Captured!.AskedUserId);
    }
}
