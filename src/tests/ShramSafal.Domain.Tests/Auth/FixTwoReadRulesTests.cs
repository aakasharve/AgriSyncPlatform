// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 fix pass 2 — the re-review's N1, N3, N4 and N5 rules,
// enumerated without a database:
//   N1  which installed phone may be sent a withheld pay (anything not newer than 1.0.17 is answered the old way);
//   N3  a job card's payout id goes with its pay;
//   N4  D-67 — the words of a record that mentions money need see WAGES;
//   N5  a readable farm the phone holds no data for is read from the beginning, once, with no cursor move.
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FixTwoReadRulesTests
{
    private static readonly Guid FarmA = Guid.Parse("a2000000-0000-0000-0000-00000000000a");
    private static readonly Guid FarmB = Guid.Parse("b2000000-0000-0000-0000-00000000000b");
    private static readonly Guid Reader = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid Maker = Guid.Parse("30000000-0000-0000-0000-000000000003");
    private static readonly DateTime Now = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private static FarmReadScope Scope(Guid farm, FarmPermission? bits, DateTime? changed = null) =>
        FarmReadScope.Of(farm, new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, bits, AccessChangedAtUtc: changed), Now)!;

    // ── N1 ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("1.0.18", true)]
    [InlineData("1.0.19", true)]
    [InlineData("1.1", true)]
    [InlineData("2", true)]
    [InlineData(" 1.0.18 ", true)]
    [InlineData("1.0.17", false)]
    [InlineData("1.0.9", false)]
    [InlineData("1.0.17.9", false)]
    [InlineData("unknown", false)]
    [InlineData("1.0.x", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void N1_only_a_phone_newer_than_1_0_17_is_sent_a_withheld_pay(string? version, bool shows) =>
        Assert.Equal(shows, ClientContract.ShowsWithheldPay(version));

    // ── N3 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void N3_the_payout_id_and_money_words_go_with_the_pay_and_nothing_changes_for_a_seat_that_sees_wages()
    {
        var card = new JobCardDto(
            Guid.NewGuid(), FarmA, Guid.NewGuid(), null, Maker, Guid.NewGuid(), "रवी", new DateOnly(2026, 10, 30), "PaidOut",
            [new JobCardLineItemViewDto("spray", 4m, 200m, "INR", "₹200 तासाला ठरले"), new JobCardLineItemViewDto("weed", 2m, 100m, "INR", "सकाळी")],
            1000m, "INR", null, Guid.NewGuid(), null, DateTime.UtcNow, DateTime.UtcNow);

        var withheld = ReadScopeProjection.JobCard(card, Scope(FarmA, FarmPermission.SeeMoney), Reader);
        Assert.Null(withheld.PayoutCostEntryId);
        Assert.Null(withheld.EstimatedTotalAmount);
        Assert.Null(withheld.LineItems[0].Notes);
        Assert.Equal("सकाळी", withheld.LineItems[1].Notes);

        Assert.Same(card, ReadScopeProjection.JobCard(card, Scope(FarmA, FarmPermission.SeeMoney | FarmPermission.SeeWages), Reader));
    }

    // ── N4 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void N4_a_seat_with_see_money_but_not_see_wages_gets_none_of_the_words_of_a_record_stating_a_workers_pay()
    {
        using var doc = JsonDocument.Parse("""{"schema":1,"fullTranscript":"रवीला ५०० रु. दिले","inputs":[{"id":"i1","productName":"युरिया","cost":250}]}""");
        var dto = new DailyLogDto(
            Guid.NewGuid(), FarmA, null, null, Maker, new DateOnly(2026, 10, 30), null, DateTime.UtcNow, DateTime.UtcNow, null, null,
            [new LogTaskDto(Guid.NewGuid(), "Fertilizer युरिया", "Cost: ₹250 • रवीला ५०० रु.", DateTime.UtcNow, "Completed", null, null)],
            [],
            "Farm", [],
            Content: new LogContentDto(1, 1, doc.RootElement.Clone()));

        var sent = ReadScopeProjection.Record(dto, Scope(FarmA, FarmPermission.SeeMoney), Reader);
        Assert.True(sent.WordsWithheldForMoney);
        Assert.False(sent.Content!.Document.TryGetProperty("fullTranscript", out _));
        Assert.Equal(250, sent.Content.Document.GetProperty("inputs")[0].GetProperty("cost").GetInt32());
        Assert.Null(sent.Tasks[0].Notes);

        // A task note whose only amount is the app's own label keeps it for a seat that sees money.
        var labelled = dto with { Tasks = [dto.Tasks[0] with { Notes = "Cost: ₹250" }], Content = null };
        Assert.Equal("Cost: ₹250", ReadScopeProjection.Record(labelled, Scope(FarmA, FarmPermission.SeeMoney), Reader).Tasks[0].Notes);
        Assert.False(MoneyMention.HearsMoneyWords(Scope(FarmA, FarmPermission.SeeMoney)));
        Assert.True(MoneyMention.HearsMoneyWords(Scope(FarmA, FarmPermission.SeeMoney | FarmPermission.SeeWages)));
    }

    // ── N5 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void N5_a_readable_farm_the_phone_holds_no_data_for_is_read_from_the_beginning_without_moving_the_cursor()
    {
        var scopes = new Dictionary<Guid, FarmReadScope>
        {
            [FarmA] = Scope(FarmA, null),
            [FarmB] = Scope(FarmB, null),
        };
        var cursor = Now.AddHours(-1);
        var stranger = Guid.NewGuid();

        var window = new PullReadWindow(scopes, cursor, Now, notHeldFarmIds: [FarmB, stranger]);
        Assert.Equal(DateTime.UnixEpoch, window.SinceFor(FarmB));
        Assert.Equal(cursor, window.SinceFor(FarmA));
        Assert.Equal(new[] { FarmB }, window.NotHeldFarmIds);
        Assert.Null(window.ResetThroughUtc);

        // Once the phone holds it, it is read from the cursor again; a phone that says nothing is never asked about it.
        Assert.Empty(new PullReadWindow(scopes, cursor, Now, notHeldFarmIds: []).ResetFarmIds);
        Assert.Empty(new PullReadWindow(scopes, cursor, Now).ResetFarmIds);
    }
}
