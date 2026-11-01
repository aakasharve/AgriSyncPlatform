// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — a record's STATED
// money reaches only a reader who sees the farm's money; an edit by someone who was sent it without
// its amounts never deletes them.
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.Content;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class LogContentMoneyTests
{
    /// <summary>
    /// The amounts written out by hand from <c>log.types.ts</c> (an input's cost, a machine's rent and
    /// fuel, an expense's total, an expense item's unit price and total) — never read from
    /// <see cref="LogContentDocument.MoneyKeys"/>, so the test cannot merely agree with the list.
    /// </summary>
    private const string Priced = """
        {"schema":1,
         "inputs":[{"id":"in-1","productName":"युरिया","dose":2,"unit":"kg","cost":740,
                    "numbers":{"cost":{"certainty":"reported","spokenText":"सातशे चाळीस"},"dose":{"certainty":"reported"}}}],
         "machinery":[{"id":"m-1","type":"tractor","ownership":"rented","hoursUsed":3,"rentalCost":1500,"fuelCost":600}],
         "activityExpenses":[{"id":"e-1","reason":"बियाणे","vendor":"कृषी केंद्र","totalAmount":2200,
                              "items":[{"id":"i-1","name":"बियाणे","qty":2,"unit":"kg","unitPrice":1100,"total":2200}]}],
         "irrigation":[{"id":"irr-1","method":"Flood","durationHours":2}]}
        """;

    private static readonly string[] Amounts = ["740", "1500", "600", "2200", "1100", "सातशे चाळीस"];

    [Fact]
    public void StripMoney_removes_every_stated_amount_and_keeps_every_other_value()
    {
        var stripped = LogContentDocument.StripMoney(Priced);

        foreach (var amount in Amounts)
        {
            stripped.Should().NotContain(amount, "a reader without see money is never sent the amount");
        }

        using var doc = JsonDocument.Parse(stripped);
        var root = doc.RootElement;
        var input = root.GetProperty("inputs")[0];
        input.GetProperty("productName").GetString().Should().Be("युरिया");
        input.GetProperty("dose").GetInt32().Should().Be(2);
        input.TryGetProperty("cost", out _).Should().BeFalse();
        input.GetProperty("numbers").TryGetProperty("cost", out _).Should().BeFalse("the fact behind the amount goes with it");
        input.GetProperty("numbers").TryGetProperty("dose", out _).Should().BeTrue();
        var machine = root.GetProperty("machinery")[0];
        machine.GetProperty("hoursUsed").GetInt32().Should().Be(3);
        machine.TryGetProperty("rentalCost", out _).Should().BeFalse();
        machine.TryGetProperty("fuelCost", out _).Should().BeFalse();
        var expense = root.GetProperty("activityExpenses")[0];
        expense.GetProperty("vendor").GetString().Should().Be("कृषी केंद्र");
        expense.TryGetProperty("totalAmount", out _).Should().BeFalse();
        expense.GetProperty("items")[0].GetProperty("qty").GetInt32().Should().Be(2);
        expense.GetProperty("items")[0].TryGetProperty("unitPrice", out _).Should().BeFalse();
        root.GetProperty("irrigation")[0].GetProperty("durationHours").GetInt32().Should().Be(2);
        LogContentDocument.Validate(root).Should().BeNull("the stripped document is still a valid document");
    }

    [Fact]
    public void CarryMoneyForward_puts_every_amount_back_onto_an_edit_made_without_them()
    {
        // His phone was sent the stripped document; he changed the dose and removed nothing.
        var seen = JsonDocument.Parse(LogContentDocument.StripMoney(Priced)).RootElement;
        var edit = seen.GetRawText().Replace("\"dose\":2", "\"dose\":3", StringComparison.Ordinal);

        var merged = LogContentDocument.CarryMoneyForward(Priced, edit);

        using var doc = JsonDocument.Parse(merged);
        var root = doc.RootElement;
        root.GetProperty("inputs")[0].GetProperty("dose").GetInt32().Should().Be(3, "his edit stands");
        root.GetProperty("inputs")[0].GetProperty("cost").GetInt32().Should().Be(740);
        root.GetProperty("inputs")[0].GetProperty("numbers").GetProperty("cost").GetProperty("spokenText").GetString()
            .Should().Be("सातशे चाळीस");
        root.GetProperty("machinery")[0].GetProperty("rentalCost").GetInt32().Should().Be(1500);
        root.GetProperty("machinery")[0].GetProperty("fuelCost").GetInt32().Should().Be(600);
        root.GetProperty("activityExpenses")[0].GetProperty("totalAmount").GetInt32().Should().Be(2200);
        root.GetProperty("activityExpenses")[0].GetProperty("items")[0].GetProperty("unitPrice").GetInt32().Should().Be(1100);
    }

    [Theory]
    [InlineData("Qty: 2 kg • Cost: ₹777.73", "Qty: 2 kg")]
    [InlineData("1.5 hrs • Rent: ₹1500 • Fuel: ₹600 • ट्रॅक्टर उशिरा आला", "1.5 hrs • ट्रॅक्टर उशिरा आला")]
    [InlineData("Workers: 6 • Cost: ₹3000", "Workers: 6")]
    [InlineData("Cost: ₹500", null)]
    [InlineData("फक्त पाणी दिलं", "फक्त पाणी दिलं")]
    [InlineData(null, null)]
    public void A_task_lines_notes_lose_every_amount_and_keep_everything_else(string? notes, string? expected) =>
        LogTaskProjection.NotesWithoutMoney(notes).Should().Be(expected);

    [Fact]
    public void An_item_he_removed_takes_its_amount_with_it()
    {
        var seen = JsonDocument.Parse(LogContentDocument.StripMoney(Priced)).RootElement;
        var withoutMachine = JsonSerializer.Serialize(new
        {
            schema = 1,
            inputs = JsonSerializer.Deserialize<JsonElement>(seen.GetProperty("inputs").GetRawText()),
        });

        var merged = LogContentDocument.CarryMoneyForward(Priced, withoutMachine);

        merged.Should().NotContain("1500").And.NotContain("rentalCost");
        merged.Should().Contain("740");
    }
}
