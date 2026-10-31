// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M — money follows the record)
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// Lane OF-M (F89). <see cref="RecordMoneyLines"/> reads a record's priced lines exactly as the phone's save makes money
/// from them (<c>LogCommandService.captureMoneyEventsFromLog</c>: amount, category, description); <see cref="EditMoneyPlan"/>
/// decides, per line an edit changed, what happens to its money; <see cref="FinanceCorrection.NoLongerSpent"/> is the
/// "corrected to nothing" a removed line needs (the trail kept; <c>correct_cost_entry</c> still refuses ₹0).
/// </summary>
public sealed class RecordMoneyTests
{
    private static readonly Guid Log = Guid.Parse("0f5e7000-0000-4000-8000-000000000001");

    private static JsonElement Doc(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void Lines_are_read_with_the_phones_amount_category_and_description()
    {
        var lines = RecordMoneyLines.Of(Log, Doc("""
            {
              "schema": 1,
              "inputs": [
                { "id": "in-1", "productName": "युरिया", "quantity": 2, "unit": "bag", "cost": 300 },
                { "id": "in-2", "mix": [ { "productName": "इथरेल" }, { "productName": "बोरॉन" } ], "cost": "450" },
                { "id": "in-3", "productName": "पाणी" },
                { "productName": "no id, never money", "cost": 99 },
                "not an object"
              ],
              "machinery": [ { "id": "mach-1", "type": "tractor", "hoursUsed": 2, "rentalCost": 1000, "fuelCost": 200 } ],
              "activityExpenses": [ { "id": "exp-1", "reason": "वाहतूक", "category": "Transport", "vendor": "राजू", "totalAmount": 150 } ]
            }
            """));

        Assert.Equal(5, lines.Count);
        var in1 = lines.Single(l => l.LineId == "in-1");
        Assert.Equal(new RecordMoneyLine("input", "in-1", 300m, "other", "युरिया", 2m, "bag", null), in1);
        Assert.Equal("इथरेल, बोरॉन", lines.Single(l => l.LineId == "in-2").Description);
        Assert.Equal(450m, lines.Single(l => l.LineId == "in-2").Amount);
        Assert.Equal(0m, lines.Single(l => l.LineId == "in-3").Amount);
        Assert.Equal(new RecordMoneyLine("machinery", "mach-1", 1200m, "machinery_rent", "tractor", 2m, "hour", null),
            lines.Single(l => l.Kind == "machinery"));
        Assert.Equal(new RecordMoneyLine("activity-expense", "exp-1", 150m, "transport", "वाहतूक", null, null, "राजू"),
            lines.Single(l => l.Kind == "activity-expense"));
    }

    [Fact]
    public void A_line_with_nothing_to_name_it_is_described_by_its_source_key_as_the_phone_does()
    {
        var line = Assert.Single(RecordMoneyLines.Of(Log, Doc("""{ "machinery": [ { "id": "m", "rentalCost": 10 } ] }""")));
        Assert.Equal($"{Log:D}:machinery:m", line.Description);
    }

    [Theory]
    [InlineData("Labour", "labour_misc")]
    [InlineData("fuel", "fuel")]
    [InlineData("Transport", "transport")]
    [InlineData("Machinery", "machinery_rent")]
    [InlineData("Repair", "equipment")]
    [InlineData("Electricity", "electricity")]
    [InlineData("Fertilizer", "other")]
    [InlineData("Pesticide", "other")]
    [InlineData("Input", "other")]
    [InlineData("anything else", "other")]
    [InlineData(null, "other")]
    public void An_expense_category_maps_as_the_phone_maps_it(string? said, string expected) =>
        Assert.Equal(expected, RecordMoneyLines.ExpenseCategoryOf(said));

    // ── The plan ──────────────────────────────────────────────────────────────────────────────

    private static RecordMoneyLine Input(string id, decimal amount) => new("input", id, amount, "other", "x", null, null, null);

    private static Guid Id(string lineId) => MoneyEntryIdentity.ForRecordLine(Log, "input", lineId);

    private static IReadOnlyList<EditMoneyStep> Plan(
        RecordMoneyLine[] before, RecordMoneyLine[] after, Dictionary<Guid, FoundMoney>? found = null,
        bool heldFromCreate = true, HashSet<Guid>? pricedBefore = null) =>
        EditMoneyPlan.Of(Log, before, after, heldFromCreate,
            pricedBefore ?? before.Where(l => l.Amount > 0).Select(l => MoneyEntryIdentity.ForRecordLine(Log, l.Kind, l.LineId)).ToHashSet(),
            found ?? []);

    [Fact]
    public void An_unchanged_line_is_never_touched_even_when_its_money_reads_otherwise()
    {
        // The owner corrected the money in the money book to ₹600; an edit elsewhere must not put ₹500 back.
        var steps = Plan([Input("in-1", 500)], [Input("in-1", 500)], new() { [Id("in-1")] = new FoundMoney(Id("in-1"), 600m, false, false) });
        Assert.Empty(steps);
    }

    [Fact]
    public void A_changed_amount_with_money_found_is_a_correction_and_a_removed_line_a_correction_to_nothing()
    {
        var found = new Dictionary<Guid, FoundMoney>
        {
            [Id("in-1")] = new(Id("in-1"), 500m, false, false),
            [Id("in-2")] = new(Id("in-2"), 200m, false, false),
        };
        var steps = Plan([Input("in-1", 500), Input("in-2", 200)], [Input("in-1", 800)], found);

        Assert.Contains(steps, s => s.LineId == "in-1" && s.Action == EditMoneyAction.Correct && s.Amount == 800m);
        Assert.Contains(steps, s => s.LineId == "in-2" && s.Action == EditMoneyAction.Correct && s.Amount == 0m);
        Assert.Equal(2, steps.Count);
    }

    [Fact]
    public void A_line_priced_for_the_first_time_makes_money_under_its_derived_id()
    {
        var step = Assert.Single(Plan([Input("in-1", 0)], [Input("in-1", 0), Input("in-2", 300)]));
        Assert.Equal(EditMoneyAction.Create, step.Action);
        Assert.Equal(Id("in-2"), step.MoneyId);
        Assert.Equal(300m, step.Amount);
    }

    [Fact]
    public void Money_already_at_the_new_amount_is_left_alone()
    {
        var found = new Dictionary<Guid, FoundMoney> { [Id("in-1")] = new(Id("in-1"), 800m, false, false) };
        Assert.Empty(Plan([Input("in-1", 500)], [Input("in-1", 800)], found));
    }

    [Fact]
    public void A_line_that_had_money_but_whose_money_is_not_found_is_never_guessed_at()
    {
        // Saved the old way (a random id), held on the phone, or not arrived: changed, removed or priced again.
        Assert.Equal(EditMoneyNotFollowed.NotFound, Assert.Single(Plan([Input("in-1", 500)], [Input("in-1", 800)])).Reason);
        Assert.Equal(EditMoneyNotFollowed.NotFound, Assert.Single(Plan([Input("in-1", 500)], [])).Reason);
        var again = Plan([Input("in-1", 0)], [Input("in-1", 700)], pricedBefore: [Id("in-1")]);
        Assert.Equal(EditMoneyNotFollowed.NotFound, Assert.Single(again).Reason);
    }

    [Fact]
    public void Money_shared_out_or_a_job_cards_money_is_not_changed_and_says_why()
    {
        var found = new Dictionary<Guid, FoundMoney>
        {
            [Id("in-1")] = new(Id("in-1"), 500m, Shared: true, JobCard: false),
            [Id("in-2")] = new(Id("in-2"), 200m, Shared: false, JobCard: true),
        };
        var steps = Plan([Input("in-1", 500), Input("in-2", 200)], [Input("in-1", 900), Input("in-2", 250)], found);

        Assert.All(steps, s => Assert.Equal(EditMoneyAction.NotFollowed, s.Action));
        Assert.Equal(EditMoneyNotFollowed.Shared, steps.Single(s => s.LineId == "in-1").Reason);
        Assert.Equal(EditMoneyNotFollowed.JobCard, steps.Single(s => s.LineId == "in-2").Reason);
    }

    [Fact]
    public void Without_the_records_create_time_details_no_money_changes_and_every_changed_line_says_so()
    {
        var found = new Dictionary<Guid, FoundMoney> { [Id("in-1")] = new(Id("in-1"), 500m, false, false) };
        var steps = Plan([Input("in-1", 500)], [Input("in-1", 800), Input("in-2", 300)], found, heldFromCreate: false);

        Assert.Equal(2, steps.Count);
        Assert.All(steps, s => Assert.Equal(EditMoneyNotFollowed.DetailsNotHeld, s.Reason));
    }

    // ── "Corrected to nothing" ────────────────────────────────────────────────────────────────

    [Fact]
    public void A_removed_lines_money_is_corrected_to_nothing_keeping_the_original_and_the_reason()
    {
        var by = new UserId(Guid.NewGuid());
        var at = new DateTime(2026, 11, 1, 6, 0, 0, DateTimeKind.Utc);
        var correction = FinanceCorrection.NoLongerSpent(Guid.NewGuid(), Guid.NewGuid(), 500m, "inr", " line removed ", by, at);

        Assert.Equal(0m, correction.CorrectedAmount);
        Assert.Equal(500m, correction.OriginalAmount);
        Assert.Equal("INR", correction.CurrencyCode);
        Assert.Equal("line removed", correction.Reason);
        Assert.Equal(by, correction.CorrectedByUserId);
        Assert.Throws<ArgumentException>(() => FinanceCorrection.NoLongerSpent(Guid.NewGuid(), Guid.NewGuid(), 500m, "INR", " ", by, at));
        // The released correction path is unchanged: it still refuses ₹0.
        Assert.Throws<ArgumentException>(() => FinanceCorrection.Create(Guid.NewGuid(), Guid.NewGuid(), 500m, 0m, "INR", "x", by, at));
    }
}
