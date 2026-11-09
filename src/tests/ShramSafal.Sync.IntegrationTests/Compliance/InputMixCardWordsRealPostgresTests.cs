// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT-S1 (register item F168; founder D-96, doctrine P4 and P7).
//
// A wrong-mix card says the wrong-mix words. The card's TopSignalRuleCode names the rule and the phone files the card under it,
// so its title and description must be that signal's own, not whatever rank branch (overdue work, a dispute, stage health)
// matched first. Real Postgres as agrisync_app (doctrine E3, asserted first in every fact), through the real host and the real
// sync pull, on the same farm the sibling InputMixAttentionTests use: that farm already holds one planned task whose date has
// passed (a spray planned for 2026-10-01, never recorded) and one soft-test instance due and uncollected.
//
// The merge owner runs this class (it needs the throwaway cluster the other RealPostgres suites use):
//   dotnet test src/tests/ShramSafal.Sync.IntegrationTests --filter "FullyQualifiedName~InputMixCardWordsRealPostgresTests"
using System;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Compliance;

[Trait("Category", "RequiresPostgres")]
public sealed class InputMixCardWordsRealPostgresTests(ITestOutputHelper output) : InputMixAttentionTestsBase(output)
{
    [Fact]
    public async Task WrongMix_WithAnOverduePlanTask_CardSaysTheSignalsOwnWords_AndIsFiledUnderTheMixRule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertThePlannedTaskIsPastDueAsync();
        await RecordAsync("its1-w-wrong", WrongMix());
        (await EvaluateAsync()).Opened.Should().Be(1);

        var (_, root) = await PullAsync(Owner);

        AssertCardSaysTheSignalsWords(root);
    }

    [Fact]
    public async Task WrongMix_OnAQuieterSignal_WithAnOverduePlanTask_StillSaysTheSignalsOwnWords()
    {
        // The branch that used to win here was the overdue/stage one: the signal is lowered to Watch (which does not lift the
        // card's rank on its own) so the plan task's lateness is what ranks the plot, and the card must still say the mix words.
        await AssertAppRoleIsNotVacuousAsync();
        await AssertThePlannedTaskIsPastDueAsync();
        await RecordAsync("its1-q-wrong", WrongMix());
        (await EvaluateAsync()).Opened.Should().Be(1);
        await LowerTheOpenMixSignalToWatchAsync();

        var (_, root) = await PullAsync(Owner);

        AssertCardSaysTheSignalsWords(root);
    }

    private void AssertCardSaysTheSignalsWords(JsonElement root)
    {
        var card = CardOf(root, PlotA);
        card.Should().NotBeNull("the plot has an open wrong-mix signal and a task past its date");
        var signal = ArrayOf(root, "complianceSignals").Should().ContainSingle(s => s.GetProperty("ruleCode").GetString() == RuleCode).Subject;

        card!.Value.GetProperty("topSignalRuleCode").GetString().Should().Be(RuleCode);
        card.Value.GetProperty("topSignalId").GetGuid().Should().Be(signal.GetProperty("id").GetGuid());
        foreach (var word in new[] { "titleEn", "titleMr", "descriptionEn", "descriptionMr" })
        {
            card.Value.GetProperty(word).GetString().Should().Be(signal.GetProperty(word).GetString(), $"{word} is the signal's own");
        }

        card.Value.GetProperty("suggestedActionLabelEn").GetString().Should().Be("View compliance signal");
        card.Value.GetProperty("suggestedActionLabelMr").GetString().Should().Be("अनुपालन सिग्नल पहा");
        card.Value.GetProperty("openComplianceSignalCount").GetInt32().Should().Be(1);
        var overdue = card.Value.TryGetProperty("overdueTaskCount", out var count) && count.ValueKind == JsonValueKind.Number
            ? count.GetInt32()
            : 0;
        Output.WriteLine($"[EVIDENCE] card rank={card.Value.GetProperty("rank")} overdueTaskCount={overdue} titleMr={card.Value.GetProperty("titleMr").GetString()}");
    }

    private async Task AssertThePlannedTaskIsPastDueAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.planned_activities WHERE crop_cycle_id = @cycle AND planned_date < CURRENT_DATE";
        cmd.Parameters.AddWithValue("cycle", CycleA);
        Convert.ToInt64(await cmd.ExecuteScalarAsync()).Should().BeGreaterThan(0, "arrange: a plan task past its date is on the plot");
    }

    private async Task LowerTheOpenMixSignalToWatchAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "UPDATE ssf.compliance_signals SET severity = 'Watch' WHERE rule_code = @rule AND acknowledged_at_utc IS NULL AND resolved_at_utc IS NULL";
        cmd.Parameters.AddWithValue("rule", RuleCode);
        (await cmd.ExecuteNonQueryAsync()).Should().Be(1, "arrange: exactly the one open wrong-mix signal is lowered");
    }
}
