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
/// brings ALL of a record's money in line with what it states after an edit (fix pass 3: reconcile, not diff); <see cref="FinanceCorrection.NoLongerSpent"/> is the
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

    // ── The plan (fix pass 3, call 2 — reconcile, not diff) ────────────────────────────────────────

    private static RecordMoneyLine Input(string id, decimal amount) => new("input", id, amount, "other", "x", null, null, null);

    private static RecordMoneyLine Crew(string id, decimal total) => new("labour", id, total, "labour_misc", id, null, null, null);

    private static Guid Id(string lineId, string kind = "input") => MoneyEntryIdentity.ForRecordLine(Log, kind, lineId);

    /// <summary>The record states <paramref name="stated"/>; <paramref name="ever"/> are its lines from any version.</summary>
    private static IReadOnlyList<EditMoneyStep> Plan(
        RecordMoneyLine[] stated,
        Dictionary<Guid, FoundMoney>? found = null,
        RecordMoneyLine[]? ever = null,
        Guid[]? missingFirst = null,
        EditMoneyNotFollowed? blocked = null) =>
        EditMoneyPlan.Of(
            Log,
            stated,
            (ever ?? stated).Concat(stated).DistinctBy(l => (l.Kind, l.LineId))
                .ToDictionary(l => Id(l.LineId, l.Kind), l => new RecordLineKey(l.Kind, l.LineId)),
            missingFirst ?? [],
            blocked,
            found ?? []);

    private static FoundMoney Money(string lineId, decimal now, string kind = "input") => new(Id(lineId, kind), now, false, false);

    [Fact]
    public void Money_in_line_with_its_record_is_never_touched()
    {
        Assert.Empty(Plan([Input("in-1", 500)], new() { [Id("in-1")] = Money("in-1", 500m) }));
    }

    [Fact]
    public void Money_that_differs_from_what_its_line_states_is_corrected_to_it_even_when_this_edit_did_not_change_the_line()
    {
        // Reconcile: the money reads ₹600 (another phone, a retry, a correction); the record says ₹500 → ₹500.
        var step = Assert.Single(Plan([Input("in-1", 500)], new() { [Id("in-1")] = Money("in-1", 600m) }));
        Assert.Equal(EditMoneyAction.Correct, step.Action);
        Assert.Equal(500m, step.Amount);
    }

    [Fact]
    public void Money_whose_line_is_gone_is_corrected_to_nothing_and_money_already_at_nothing_is_left_alone()
    {
        var steps = Plan(
            [Input("in-1", 500)],
            new() { [Id("in-1")] = Money("in-1", 500m), [Id("in-2")] = Money("in-2", 200m), [Id("in-3")] = Money("in-3", 0m) },
            ever: [Input("in-1", 500), Input("in-2", 200), Input("in-3", 100)]);

        var step = Assert.Single(steps);
        Assert.Equal(("in-2", EditMoneyAction.Correct, 0m), (step.LineId, step.Action, step.Amount));
    }

    [Fact]
    public void A_priced_line_with_no_money_makes_it_under_its_derived_id_and_an_unpriced_one_makes_none()
    {
        var step = Assert.Single(Plan([Input("in-1", 0), Input("in-2", 300)]));
        Assert.Equal(EditMoneyAction.Create, step.Action);
        Assert.Equal(Id("in-2"), step.MoneyId);
        Assert.Equal(300m, step.Amount);
    }

    [Fact]
    public void A_removed_line_whose_money_was_never_made_needs_nothing()
    {
        Assert.Empty(Plan([], ever: [Input("in-1", 300)]));
    }

    [Fact]
    public void A_re_said_line_corrects_the_old_money_to_nothing_and_makes_the_new_never_1300()
    {
        var steps = Plan([Input("in-9", 800)], new() { [Id("in-1")] = Money("in-1", 500m) }, ever: [Input("in-1", 500)]);

        Assert.Contains(steps, s => s.LineId == "in-1" && s.Action == EditMoneyAction.Correct && s.Amount == 0m);
        Assert.Contains(steps, s => s.LineId == "in-9" && s.Action == EditMoneyAction.Create && s.Amount == 800m);
        Assert.Equal(2, steps.Count);
    }

    [Fact]
    public void A_crews_money_follows_its_stated_total_and_is_never_made_by_an_edit()
    {
        var corrected = Assert.Single(Plan([Crew("c-1", 2800)], new() { [Id("c-1", "labour")] = Money("c-1", 3000m, "labour") }));
        Assert.Equal((EditMoneyAction.Correct, 2800m), (corrected.Action, corrected.Amount));
        // A priced crew is first money: missing, it is rule B's (below) — an edit never makes a crew's money.
        Assert.Empty(Plan([Crew("c-1", 2800)]));
    }

    [Fact]
    public void Fix1_B_when_the_records_first_money_is_not_all_found_nothing_changes_and_each_line_is_said_once()
    {
        // The first money of in-1 was saved the old way: the re-said line (in-1 out, in-9 in) must never be doubled.
        var steps = Plan(
            [Input("in-9", 800), Input("in-2", 250), Crew("c-1", 2800)],
            new() { [Id("in-2")] = Money("in-2", 200m) },
            ever: [Input("in-1", 500), Input("in-2", 200)],
            missingFirst: [Id("in-1"), Id("c-1", "labour")],
            blocked: EditMoneyNotFollowed.NotFound);

        Assert.Equal(["c-1", "in-1", "in-2", "in-9"], steps.Select(s => s.LineId).Order().ToArray());
        Assert.All(steps, s => Assert.Equal(EditMoneyAction.NotFollowed, s.Action));
        Assert.All(steps, s => Assert.Equal(EditMoneyNotFollowed.NotFound, s.Reason));
    }

    [Fact]
    public void Money_shared_out_or_a_job_cards_money_is_not_changed_and_says_why_only_when_it_is_out_of_line()
    {
        var found = new Dictionary<Guid, FoundMoney>
        {
            [Id("in-1")] = new(Id("in-1"), 500m, Shared: true, JobCard: false),
            [Id("in-2")] = new(Id("in-2"), 200m, Shared: false, JobCard: true),
            [Id("in-3")] = new(Id("in-3"), 100m, Shared: true, JobCard: false),
        };
        var steps = Plan([Input("in-1", 900), Input("in-2", 250), Input("in-3", 100)], found);

        Assert.Equal(2, steps.Count);
        Assert.All(steps, s => Assert.Equal(EditMoneyAction.NotFollowed, s.Action));
        Assert.Equal(EditMoneyNotFollowed.Shared, steps.Single(s => s.LineId == "in-1").Reason);
        Assert.Equal(EditMoneyNotFollowed.JobCard, steps.Single(s => s.LineId == "in-2").Reason);
    }

    [Fact]
    public void Without_the_records_create_time_details_no_money_changes_and_only_lines_out_of_line_say_so()
    {
        var steps = Plan([Input("in-1", 800), Input("in-2", 300), Input("in-3", 100)],
            new() { [Id("in-1")] = Money("in-1", 500m), [Id("in-3")] = Money("in-3", 100m) },
            blocked: EditMoneyNotFollowed.DetailsNotHeld);

        Assert.Equal(["in-1", "in-2"], steps.Select(s => s.LineId).Order().ToArray());
        Assert.All(steps, s => Assert.Equal(EditMoneyNotFollowed.DetailsNotHeld, s.Reason));
    }

    [Fact]
    public void Fix4_money_whose_latest_correction_was_made_in_the_money_book_is_not_changed_and_says_so()
    {
        var found = new Dictionary<Guid, FoundMoney>
        {
            [Id("in-1")] = new(Id("in-1"), 450m, Shared: false, JobCard: false, MoneyBook: true),
            [Id("in-2")] = new(Id("in-2"), 450m, Shared: false, JobCard: false, MoneyBook: true),
            [Id("in-3")] = new(Id("in-3"), 100m, Shared: false, JobCard: false, MoneyBook: true),
        };
        var steps = Plan([Input("in-1", 600), Input("in-2", 450)], found, ever: [Input("in-1", 500), Input("in-2", 450), Input("in-3", 100)]);

        // in-1 restated, in-3 removed: neither is changed, both are said; in-2 already reads what its line says.
        Assert.Equal(["in-1", "in-3"], steps.Select(s => s.LineId).Order().ToArray());
        Assert.All(steps, s => Assert.Equal((EditMoneyAction.NotFollowed, EditMoneyNotFollowed.MoneyBook), (s.Action, s.Reason)));
    }

    [Fact]
    public void Fix5_N4_tied_money_of_a_line_that_is_gone_holds_back_every_new_money_of_the_record_and_says_so()
    {
        var found = new Dictionary<Guid, FoundMoney>
        {
            [Id("in-1")] = new(Id("in-1"), 450m, Shared: false, JobCard: false, MoneyBook: true),
            [Id("in-2")] = new(Id("in-2"), 200m, Shared: false, JobCard: false),
        };
        var steps = Plan(
            [Input("in-9", 450), Input("in-2", 250), Input("in-8", 100)],
            found,
            ever: [Input("in-1", 500), Input("in-2", 200)]);

        Assert.Equal(EditMoneyNotFollowed.MoneyBook, steps.Single(s => s.LineId == "in-1").Reason);
        Assert.All(steps.Where(s => s.LineId is "in-9" or "in-8"),
            s => Assert.Equal((EditMoneyAction.NotFollowed, EditMoneyNotFollowed.OldMoneyKept), (s.Action, s.Reason)));
        // It still corrects what it may.
        var corrected = steps.Single(s => s.LineId == "in-2");
        Assert.Equal((EditMoneyAction.Correct, 250m), (corrected.Action, corrected.Amount));
        Assert.Equal(4, steps.Count);

        // The money book's money of a line still stated holds nothing back.
        var stillStated = Plan([Input("in-1", 600), Input("in-8", 100)], found, ever: [Input("in-1", 500)]);
        Assert.Equal(EditMoneyAction.Create, stillStated.Single(s => s.LineId == "in-8").Action);
    }

    [Fact]
    public void Fix5_a_stale_documents_prices_become_the_records_current_ones_and_nothing_else_of_it_changes()
    {
        var current = """
            { "schema": 1,
              "inputs": [ { "id": "in-1", "productName": "युरिया", "quantity": 2, "cost": 800 }, { "id": "in-3", "productName": "DAP", "cost": "70" } ],
              "machinery": [ { "id": "m-1", "type": "tractor", "rentalCost": 1000, "fuelCost": 100 } ] }
            """;
        var stale = """
            { "schema": 1,
              "inputs": [ { "id": "in-1", "productName": "युरिया", "quantity": 3, "cost": 500 }, { "id": "in-2", "productName": "पाणी", "cost": 40 } ],
              "irrigation": [ { "id": "w-1", "method": "Drip" } ] }
            """;
        var carried = RecordMoneyLines.CarryPricesForward(Log, current, stale);

        using var document = JsonDocument.Parse(carried);
        var inputs = document.RootElement.GetProperty("inputs");
        Assert.Equal(3, inputs.GetArrayLength());
        Assert.Equal(800m, inputs[0].GetProperty("cost").GetDecimal());
        Assert.Equal(3m, inputs[0].GetProperty("quantity").GetDecimal()); // his words stay his
        Assert.False(inputs[1].TryGetProperty("cost", out _)); // a line the record never priced takes no price
        Assert.Equal("in-3", inputs[2].GetProperty("id").GetString()); // a priced line he never saw stays
        Assert.Equal("m-1", document.RootElement.GetProperty("machinery")[0].GetProperty("id").GetString());
        Assert.Equal(1, document.RootElement.GetProperty("irrigation").GetArrayLength());
        Assert.Contains("युरिया", carried); // readable, not escaped
        Assert.False(EditMoneyPlan.ChangesPrices(
            RecordMoneyLines.Of(Log, Doc(current)), RecordMoneyLines.Of(Log, Doc(carried))));
    }

    [Fact]
    public void Call1_an_edit_changes_prices_when_a_priced_lines_amount_changes_or_a_priced_line_comes_or_goes()
    {
        RecordMoneyLine[] saved = [Input("in-1", 500), Input("in-2", 0)];
        Assert.False(EditMoneyPlan.ChangesPrices(saved, [Input("in-1", 500), Input("in-2", 0), Input("in-3", 0)]));
        Assert.False(EditMoneyPlan.ChangesPrices(saved, [Input("in-1", 500.001m)]), "a line with no price may go; amounts are read as money is (2 places)");
        Assert.True(EditMoneyPlan.ChangesPrices(saved, [Input("in-1", 800), Input("in-2", 0)]));
        Assert.True(EditMoneyPlan.ChangesPrices(saved, [Input("in-2", 0)]));
        Assert.True(EditMoneyPlan.ChangesPrices(saved, [Input("in-9", 500), Input("in-2", 0)]), "said again under a new id");
        Assert.True(EditMoneyPlan.ChangesPrices(saved, [Input("in-1", 500), Input("in-2", 50)]));
    }

    // ── fix pass 1: the review flag ───────────────────────────────────────────────────────────

    [Fact]
    public void Flagging_money_for_review_moves_its_clock_forward_so_every_phone_pulls_it()
    {
        var created = new DateTime(2026, 11, 1, 6, 0, 0, DateTimeKind.Utc);
        var entry = CostEntry.Create(Guid.NewGuid(), new FarmId(Guid.NewGuid()), null, null, "other", "x", 500m, "INR",
            new DateOnly(2026, 11, 1), new UserId(Guid.NewGuid()), null, created);

        entry.FlagForReview("Its record says ₹800", created.AddHours(1));

        Assert.True(entry.IsFlagged);
        Assert.Equal("Its record says ₹800", entry.FlagReason);
        Assert.Equal(created.AddHours(1), entry.ModifiedAtUtc);
        Assert.Equal(500m, entry.Amount);
        Assert.Equal(25000m, CostEntry.ReviewAmountThreshold);
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
