// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT2 (founder D-96).
//
// The wrong-mix alert end to end on a real Postgres as agrisync_app (doctrine E3 first in every fact), through the real host:
// a record whose stored content says calcium nitrate and 19:19:19 shared one drip tank is pushed; the compliance evaluation
// opens a Critical, acknowledge-only signal; the sync pull's attention board carries it on the plot's card with its rule code;
// पाहिलं (compliance.acknowledge) closes it and the same mix does not come back; a new wrong mix opens again; a record revised so
// the products are apart resolves the open signal.
//
// FOUNDER D-96: the two red rules wait for the founder's agronomist to tick them in the rule file, so in production NO alert
// is raised yet. This class registers a TEST-ONLY reviewed rule with the host (EvaluateComplianceHandler's optional
// mixRulesInForce), and never marks the real rules reviewed; the last class proves that an UNREVIEWED rule
// raises nothing for the same record. The merge owner runs this class (it needs the throwaway cluster the other RealPostgres suites use).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Inputs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Compliance;

/// <summary>The host, the records and the evaluation shared by the two classes below.</summary>
public abstract class InputMixAttentionTestsBase(ITestOutputHelper output) : RoleScopedFarm(output)
{
    protected const string RuleCode = "compliance.input-mix.never-together";

    protected static readonly string Today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    protected static readonly string Yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)).ToString("yyyy-MM-dd");

    protected static readonly LocalizedText Words = new("कॅल्शियम आणि फॉस्फेट एकत्र टाकू नका", "do not mix calcium and phosphate");
    protected static readonly RuleSource Source = new("UF/IFAS EDIS HS1202 (test)", "UF/IFAS", "https://example.org/edis", "2026-11-06");

    /// <summary>A calcium x phosphate rule marked reviewed in THIS test host only; the real rule file is untouched.</summary>
    protected static readonly MixRule ReviewedForThisHost = new(
        "T-R1", "never", new RuleSelector("calcium-source", null), new RuleSelector("phosphate-source", null),
        Words, Words, Words, [Source], "it2-test-host", "2026-11-08", [MixVerdict.Fertigation, MixVerdict.Spray]);

    /// <summary>The rules this host puts in force: a test-only reviewed rule by default; <c>null</c> is the real, unreviewed state.</summary>
    protected virtual IReadOnlyList<MixRule>? RulesInForce => [ReviewedForThisHost];

    protected override void AddHostServices(IServiceCollection services)
    {
        if (RulesInForce is { } rules)
        {
            services.AddSingleton<IReadOnlyList<MixRule>>(rules);
        }
    }

    protected static object WrongMix() => new
    {
        schema = 1,
        inputs = new object[]
        {
            new
            {
                id = "e1",
                method = "Drip",
                mix = new object[]
                {
                    new { id = "m0", productName = "calcium nitrate" },
                    new { id = "m1", productName = "19:19:19", npkGrade = "19:19:19" },
                },
            },
        },
    };

    protected static object KeptApart() => new
    {
        schema = 1,
        inputs = new object[]
        {
            new { id = "e1", method = "Drip", mix = new object[] { new { id = "m0", productName = "calcium nitrate" } } },
            new { id = "e2", method = "Drip", mix = new object[] { new { id = "m1", productName = "19:19:19", npkGrade = "19:19:19" } } },
        },
    };

    protected async Task<Guid> RecordAsync(string requestId, object content, string? day = null)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, Owner, Guid.NewGuid(), 2, 100m, 200m, [], null);
        payload["logDate"] = day ?? Today;
        payload["content"] = content;
        await PushAppliedAsync(Owner, "create_daily_log", requestId, payload);
        return logId;
    }

    protected async Task<EvaluateComplianceResult> EvaluateAsync()
    {
        // As the compliance door does: the farm's own scope opened for the caller, one transaction, committed.
        await using var scope = HostServices.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var opened = await scope.ServiceProvider.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, Owner);
        opened.IsSuccess.Should().BeTrue();
        var result = await scope.ServiceProvider.GetRequiredService<EvaluateComplianceHandler>()
            .HandleAsync(new EvaluateComplianceCommand(new FarmId(FarmA)));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Code);
        await transaction.CommitAsync();
        return result.Value!;
    }

    protected async Task<long> OpenMixSignalsAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.compliance_signals WHERE rule_code = @rule AND acknowledged_at_utc IS NULL AND resolved_at_utc IS NULL";
        cmd.Parameters.AddWithValue("rule", RuleCode);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    protected async Task<Guid?> OpenMixSignalIdAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT \"Id\" FROM ssf.compliance_signals WHERE rule_code = @rule AND acknowledged_at_utc IS NULL AND resolved_at_utc IS NULL";
        cmd.Parameters.AddWithValue("rule", RuleCode);
        return await cmd.ExecuteScalarAsync() as Guid?;
    }

    protected static JsonElement? CardOf(JsonElement root, Guid plot) =>
        root.TryGetProperty("attentionBoard", out var board) && board.ValueKind == JsonValueKind.Object
            ? board.GetProperty("cards").EnumerateArray().Where(c => c.GetProperty("plotId").GetGuid() == plot)
                .Cast<JsonElement?>().FirstOrDefault()
            : null;

    protected static bool IsCritical(JsonElement card) =>
        card.GetProperty("rank").ValueKind == JsonValueKind.Number
            ? card.GetProperty("rank").GetInt32() == 0
            : card.GetProperty("rank").GetString() == "Critical";
}

[Trait("Category", "RequiresPostgres")]
public sealed class InputMixAttentionTests(ITestOutputHelper output) : InputMixAttentionTestsBase(output)
{
    [Fact]
    public async Task WrongMix_PushThenPull_PlotCardIsCritical_WithTopSignalRuleCode()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await RecordAsync("it2-m-wrong", WrongMix());

        var evaluated = await EvaluateAsync();
        evaluated.Opened.Should().Be(1);

        var (body, root) = await PullAsync(Owner);
        Output.WriteLine($"[EVIDENCE] pull after the wrong mix: {body.Length} bytes");
        var card = CardOf(root, PlotA);
        card.Should().NotBeNull("the plot has an open Critical signal");
        IsCritical(card!.Value).Should().BeTrue();
        card.Value.GetProperty("topSignalRuleCode").GetString().Should().Be(RuleCode);
        card.Value.GetProperty("topSignalId").GetGuid().Should().Be((await OpenMixSignalIdAsync())!.Value);
        card.Value.GetProperty("titleMr").GetString().Should().Be("हे मिश्रण चुकीचं आहे");
        ArrayOf(root, "complianceSignals").Should().Contain(s => s.GetProperty("ruleCode").GetString() == RuleCode,
            "the signal itself travels with the pull for पाहिलं to act on");
    }

    [Fact]
    public async Task AcknowledgedMix_DoesNotReopen()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await RecordAsync("it2-a-wrong", WrongMix());
        await EvaluateAsync();
        var signal = (await OpenMixSignalIdAsync())!.Value;

        var acknowledged = await PushAsync(Owner, "compliance.acknowledge", "it2-a-ack", new Dictionary<string, object?> { ["signalId"] = signal });
        acknowledged.Status.Should().Be("applied", "{0}: {1}", acknowledged.ErrorCode, acknowledged.ErrorMessage);

        var again = await EvaluateAsync();

        again.Opened.Should().Be(0, "the same wrong mix, already seen, is not raised twice");
        (await OpenMixSignalsAsync()).Should().Be(0);
        var (_, root) = await PullAsync(Owner);
        (CardOf(root, PlotA) is { } card
            && card.TryGetProperty("topSignalRuleCode", out var code) && code.ValueKind == JsonValueKind.String
            && code.GetString() == RuleCode).Should().BeFalse("no card carries the acknowledged signal");
    }

    [Fact]
    public async Task NewMixAfterAck_Opens()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await RecordAsync("it2-n-first", WrongMix(), Yesterday);
        await EvaluateAsync();
        var first = (await OpenMixSignalIdAsync())!.Value;
        (await PushAsync(Owner, "compliance.acknowledge", "it2-n-ack", new Dictionary<string, object?> { ["signalId"] = first }))
            .Status.Should().Be("applied");

        var second = await RecordAsync("it2-n-second", WrongMix());
        var next = await EvaluateAsync();

        next.Opened.Should().Be(1, "a new record with a wrong mix is a new alert");
        var open = (await OpenMixSignalIdAsync())!.Value;
        open.Should().NotBe(first);
        var (_, root) = await PullAsync(Owner);
        CardOf(root, PlotA)!.Value.GetProperty("topSignalId").GetGuid().Should().Be(open);
        second.Should().NotBeEmpty();
    }

    [Fact]
    public async Task RevisedContentWithoutMix_AutoResolves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync("it2-r-wrong", WrongMix());
        await EvaluateAsync();
        (await OpenMixSignalsAsync()).Should().Be(1);

        // He fixes "एकाच टाकीत" to "वेगळं": the next version of the record keeps the two products apart.
        await PushAppliedAsync(Owner, "revise_log_content", "it2-r-revise", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["content"] = KeptApart(),
            ["reason"] = "दुरुस्ती",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        var next = await EvaluateAsync();

        next.AutoResolved.Should().Be(1);
        (await OpenMixSignalsAsync()).Should().Be(0);
        var (_, root) = await PullAsync(Owner);
        (CardOf(root, PlotA) is { } card
            && card.TryGetProperty("topSignalRuleCode", out var code) && code.ValueKind == JsonValueKind.String
            && code.GetString() == RuleCode).Should().BeFalse("the card no longer carries a mix that is not there");
    }

    [Fact]
    public async Task OldPhonePayload_StillDeserialises()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await RecordAsync("it2-o-wrong", WrongMix());
        await EvaluateAsync();
        var (body, _) = await PullAsync(Owner);

        // The same pull as a phone from before this lane would have it: no topSignalId / topSignalRuleCode on any card, and
        // no inputIdentityAssertions field. It must read exactly as it did (nothing thrown, every card intact).
        var node = System.Text.Json.Nodes.JsonNode.Parse(body)!.AsObject();
        node.Remove("inputIdentityAssertions");
        foreach (var card in node["attentionBoard"]!["cards"]!.AsArray())
        {
            card!.AsObject().Remove("topSignalId");
            card.AsObject().Remove("topSignalRuleCode");
        }

        node.ContainsKey("inputIdentityAssertions").Should().BeFalse();
        var board = JsonSerializer.Deserialize<AttentionBoardDto>(
            node["attentionBoard"]!.ToJsonString(), new JsonSerializerOptions(JsonSerializerDefaults.Web));

        board.Should().NotBeNull();
        board!.Cards.Should().NotBeEmpty();
        board.Cards.Should().OnlyContain(c => c.TopSignalId == null && c.TopSignalRuleCode == null);
        board.Cards.Should().OnlyContain(c => c.OpenComplianceSignalCount >= 1, "every other field of the card read as it did");
    }
}

/// <summary>
/// Founder D-96: a rule nobody has reviewed raises nothing. The host puts an UNREVIEWED copy of the same rule in force (so the
/// proof does not depend on the day the agronomist ticks the real file) and the same record raises no alert.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class InputMixAttentionUnreviewedRulesTests(ITestOutputHelper output) : InputMixAttentionTestsBase(output)
{
    protected override IReadOnlyList<MixRule>? RulesInForce => [ReviewedForThisHost with { ReviewedBy = null, ReviewedOn = null }];

    [Fact]
    public async Task WithAnUnreviewedRule_TheSameWrongMix_RaisesNothing_AndTheCardCarriesNoSignal()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await RecordAsync("it2-u-wrong", WrongMix());

        var evaluated = await EvaluateAsync();

        evaluated.Opened.Should().Be(0);
        (await OpenMixSignalsAsync()).Should().Be(0);
        var (_, root) = await PullAsync(Owner);
        (ArrayOf(root, "complianceSignals").Any(s => s.GetProperty("ruleCode").GetString() == "compliance.input-mix.never-together"))
            .Should().BeFalse("the rule is not reviewed, so no alert is raised (D-96)");
    }
}
