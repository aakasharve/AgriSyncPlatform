// spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-PARSE-FIX; doctrine P4)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// Lane AI-PARSE-FIX - a future task is not "what happened". The founder's real log said "खुरपणी पण करायची आहे" (weeding is still
/// to be done) and the model stored it as a done crop activity; the guard now tags it <c>plannedOnly</c>. The DFES lens must not read
/// that tag as work done: a day whose only "activity" is a future task did not record what happened (P4: no figure on evidence that
/// does not exist).
/// </summary>
public sealed class DfesLensExtractorPlannedOnlyTests
{
    private const string DoneWeedingDay = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "खुरपणी", "sourceText": "खुरपणी केली" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    private const string StillToDoWeedingDay = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "खुरपणी", "status": "pending", "plannedOnly": true, "sourceText": "खुरपणी पण करायची आहे" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    [Fact]
    public void ADoneActivity_CoversWhatHappened()
    {
        WhatCoverage(DoneWeedingDay).Should().Be(1.0);
    }

    [Fact]
    public void AFutureTaskTaggedPlannedOnly_DoesNotCoverWhatHappened_OnlyTheSummaryDoes()
    {
        // Same day, same summary; the only activity is a future task: WHAT is covered by the summary alone (0.5), not by the task (1.0).
        WhatCoverage(StillToDoWeedingDay).Should().Be(0.5);
    }

    private static double WhatCoverage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([doc.RootElement], [], ScoredUnderVersion: "dfes-4"),
            probe,
            clientDatePlausible: true);

        return input.Possible!.Single(d => d.Name == "WHAT").Coverage;
    }
}
