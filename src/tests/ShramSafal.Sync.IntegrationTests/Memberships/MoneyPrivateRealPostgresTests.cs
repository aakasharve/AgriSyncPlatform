// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S2; founder 27 Nov follow-ups 1 and 2: "पैशांच्या नोंदी फक्त मला दिसू दे",
// a changed setting reaches NEW records only)
//
// The farm's money-private switch, on a real Postgres AS THE RESTRICTED APPLICATION ROLE (E3 first), through the real push door and the real pull:
// only the farm's registrant turns it (a second PrimaryOwner seat, a सहमालक, a मुकादम and another farm's owner are refused, by code and words); while it
// is on every NEW bill is born OnlyMe (the holder and its maker see it; a सहमालक who sees money gets no row, no bill photo, and the day's "not counted by
// rule" note), and every NEW work record keeps its work for the team but its money for the holder and its maker; old records are never moved either
// way; a later widening of a work record never widens its born-private money; and with the switch off an old phone's pull carries none of the new keys.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class MoneyPrivateRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Switch = "farm.money_private.set";
    private const string ForbiddenWords = "User is not allowed to modify this farm.";

    private static readonly Guid PrivateBill = Guid.Parse("3d0e0000-0000-4000-8000-000000000001");
    private static readonly Guid LaterBill = Guid.Parse("3d0e0000-0000-4000-8000-000000000002");
    private static readonly Guid PrivateLog = Guid.Parse("3d0e0000-0000-4000-8000-000000000003");
    private static readonly Guid PrivateCrew = Guid.Parse("3d0e0000-0000-4000-8000-000000000004");
    private static readonly Guid PrivateBillPhoto = Guid.Parse("3d0e0000-0000-4000-8000-000000000005");
    private static readonly Guid LineMoney = MoneyEntryIdentity.ForRecordLine(PrivateLog, MoneyEntryIdentity.Labour, PrivateCrew.ToString("D"));

    private const decimal PrivateBillAmount = 4321.97m;
    private const decimal LaterBillAmount = 2468.13m;
    private const decimal PrivateWage = 377.71m;
    private const decimal PrivateCrewTotal = 2643.97m;
    private const decimal PrivateInputCost = 919.29m;

    private static Dictionary<string, object?> SwitchPayload(Guid farm, bool isPrivate) => new() { ["farmId"] = farm, ["isPrivate"] = isPrivate };

    private async Task<object?> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private async Task<bool> SwitchOfAsync(Guid farm) =>
        (bool)(await ScalarAsync("SELECT money_private_to_holder FROM ssf.farms WHERE \"Id\" = @id", ("id", farm)))!;

    private async Task<long> ChangedRowsAsync(Guid farm) =>
        Convert.ToInt64(await ScalarAsync("SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = 'FarmMoneyPrivateChanged'", ("f", farm)));

    private static JsonElement ScopeOf(JsonElement root, Guid farm) =>
        root.GetProperty("accessScopes").EnumerateArray().Single(s => s.GetProperty("farmId").GetGuid() == farm);

    private static JsonElement One(JsonElement root, string array, Guid id) =>
        ArrayOf(root, array).Single(e => e.GetProperty("id").GetGuid() == id);

    [Fact]
    public async Task Only_the_registrant_turns_money_private_on_and_a_resend_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // OFF for every farm, and an old phone's pull does not carry the word.
        (await SwitchOfAsync(FarmA)).Should().BeFalse();
        var (bodyOff, rootOff) = await PullAsync(Mukadam);
        bodyOff.Should().NotContain("moneyPrivate");
        ScopeOf(rootOff, FarmA).TryGetProperty("moneyPrivate", out _).Should().BeFalse();

        // Nobody but the farm's registrant: not the सहमालक, the मुकादम or a कामगार (by code and words), not another farm's owner.
        foreach (var person in new[] { CoOwner, Mukadam, Worker })
        {
            var notHis = await PushAsync(person, Switch, $"perm-mp-{person:N}", SwitchPayload(FarmA, true));
            notHis.Status.Should().NotBe("applied");
            notHis.ErrorCode.Should().Be("ShramSafal.Forbidden");
            notHis.ErrorMessage.Should().Be(ForbiddenWords);
        }

        var stranger = await PushAsync(OwnerB, Switch, "perm-mp-other-owner", SwitchPayload(FarmA, true));
        stranger.ErrorCode.Should().Be("ShramSafal.Forbidden");
        stranger.ErrorMessage.Should().Be("User is not a member of the target farm.");
        (await SwitchOfAsync(FarmA)).Should().BeFalse();

        // isPrivate must be a real true / false, and the payload carries only its two keys.
        var nullValue = new Dictionary<string, object?> { ["farmId"] = FarmA, ["isPrivate"] = null };
        (await PushAsync(Owner, Switch, "perm-mp-null", nullValue)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        var extra = SwitchPayload(FarmA, true);
        extra["allowed"] = true;
        (await PushAsync(Owner, Switch, "perm-mp-extra", extra)).ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        (await SwitchOfAsync(FarmA)).Should().BeFalse();

        // The registrant turns it ON: one audit row (who, from, to); the same value again writes nothing.
        var on = await PushAppliedAsync(Owner, Switch, "perm-mp-on", SwitchPayload(FarmA, true));
        JsonSerializer.Serialize(on.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Should().Contain("\"isPrivate\":true");
        await PushAppliedAsync(Owner, Switch, "perm-mp-on-again", SwitchPayload(FarmA, true));
        (await SwitchOfAsync(FarmA)).Should().BeTrue();
        (await SwitchOfAsync(FarmB)).Should().BeFalse("farm A's switch is farm A's");
        (await ChangedRowsAsync(FarmA)).Should().Be(1);
        ((string)(await ScalarAsync("SELECT payload::text FROM ssf.audit_events WHERE farm_id = @f AND action = 'FarmMoneyPrivateChanged'", ("f", FarmA)))!)
            .Replace(" ", string.Empty).Should().Contain("\"from\":false").And.Contain("\"to\":true");
        Convert.ToString(await ScalarAsync("SELECT actor_user_id FROM ssf.audit_events WHERE farm_id = @f AND action = 'FarmMoneyPrivateChanged'", ("f", FarmA)))
            .Should().Be(Owner.ToString());

        // Every reader of the farm is told, on the scope the pull already sends in full; farm B is not.
        foreach (var reader in new[] { Owner, CoOwner, Mukadam, Worker })
        {
            var (_, root) = await PullAsync(reader);
            ScopeOf(root, FarmA).GetProperty("moneyPrivate").GetBoolean().Should().BeTrue($"{reader} is told farm A's money is private");
        }

        var (bodyB, _) = await PullAsync(OwnerB);
        bodyB.Should().NotContain("moneyPrivate");

        // OFF again: a second row; the key is gone again.
        await PushAppliedAsync(Owner, Switch, "perm-mp-off", SwitchPayload(FarmA, false));
        (await ChangedRowsAsync(FarmA)).Should().Be(2);
        (await PullAsync(Mukadam)).Body.Should().NotContain("moneyPrivate");
    }

    [Fact]
    public async Task A_second_primary_owner_seat_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A PrimaryOwner SEAT that is not the farm's registrant (legacy rows can hold one): "फक्त मला" is the registrant, so he decides nothing here.
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET role = 'PrimaryOwner', permissions = NULL WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", CoOwner));
        var refused = await PushAsync(CoOwner, Switch, "perm-mp-second-owner", SwitchPayload(FarmA, true));
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        refused.ErrorMessage.Should().Be(ForbiddenWords);
        (await SwitchOfAsync(FarmA)).Should().BeFalse();
        (await ChangedRowsAsync(FarmA)).Should().Be(0);
    }

    [Fact]
    public async Task A_bill_made_while_money_is_private_reaches_the_holder_and_its_maker_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney);
        await PushAppliedAsync(Owner, Switch, "perm-bill-on", SwitchPayload(FarmA, true));

        var bill = CostPayload(PrivateBill, FarmA, PlotA, CycleA, PrivateBillAmount);
        await PushAppliedAsync(Mukadam, "add_cost_entry", "perm-private-bill", bill);
        await PushAppliedAsync(Mukadam, "create_attachment", "perm-private-bill-photo", new Dictionary<string, object?>
        {
            ["attachmentId"] = PrivateBillPhoto,
            ["farmId"] = FarmA,
            ["linkedEntityId"] = PrivateBill,
            ["linkedEntityType"] = "CostEntry",
            ["fileName"] = "bill.jpg",
            ["mimeType"] = "image/jpeg",
        });

        // Stored OnlyMe, in the same save; WHY is recorded (P8) and the money trail reads it as the holder's own choice.
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", PrivateBill)))!).Should().Be("OnlyMe");
        var created = (string)(await ScalarAsync(
            "SELECT payload::text FROM ssf.audit_events WHERE entity_id = @id AND entity_type = 'CostEntry' AND action = 'Created'", ("id", PrivateBill)))!;
        created.Replace(" ", string.Empty).Should().Contain("\"audience\":\"OnlyMe\"").And.Contain("\"audienceBy\":\"farm_money_private\"");
        var trail = (string)(await ScalarAsync(
            "SELECT payload::text FROM ssf.audit_events WHERE entity_id = @id AND entity_type = 'CostEntry' AND action = 'AudienceChanged'", ("id", PrivateBill)))!;
        trail.Replace(" ", string.Empty).Should().Contain("\"from\":\"Team\"").And.Contain("\"to\":\"OnlyMe\"").And.Contain("\"followedRecordId\":null");

        // The सहमालक who sees money: no row, no photo, no amount anywhere, and the day's money is "not counted by rule".
        var (coBody, coRoot) = await PullAsync(CoOwner);
        IdsOf(coRoot, "costEntries").Should().NotContain(PrivateBill);
        IdsOf(coRoot, "costEntries").Should().Contain(Cost, "the bill made before the switch keeps its old audience");
        IdsOf(coRoot, "attachments").Should().NotContain(PrivateBillPhoto);
        coBody.Should().NotContain(PrivateBill.ToString()).And.NotContain("4321.97");
        ScopeOf(coRoot, FarmA).GetProperty("withheldRecordDays").EnumerateArray()
            .Should().Contain(d => d.GetProperty("kind").GetString() == "money" && d.GetProperty("date").GetString() == WorkDay);

        // The holder sees it, with its audience (his lock chip); the maker sees his own submission (D-28).
        var (_, ownerRoot) = await PullAsync(Owner);
        One(ownerRoot, "costEntries", PrivateBill).GetProperty("audience").GetString().Should().Be("OnlyMe");
        IdsOf(ownerRoot, "attachments").Should().Contain(PrivateBillPhoto);
        var (_, makerRoot) = await PullAsync(Mukadam);
        IdsOf(makerRoot, "costEntries").Should().Contain(PrivateBill);
        IdsOf(makerRoot, "attachments").Should().Contain(PrivateBillPhoto);
    }

    [Fact]
    public async Task A_work_record_made_while_money_is_private_reaches_a_coowner_without_its_amounts_or_money_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await PushAppliedAsync(Owner, Switch, "perm-log-on", SwitchPayload(FarmA, true));

        var log = LogPayload(PrivateLog, Mukadam, PrivateCrew, 6, PrivateWage, PrivateCrewTotal, [], PrivateInputCost);
        await PushAppliedAsync(Mukadam, "create_daily_log", "perm-private-log", log);
        ((string)(await ScalarAsync("SELECT money_audience FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", PrivateLog)))!).Should().Be("OnlyMe");

        // The WORK reaches the सहमालक (who sees money and wages) - the crew, its size, the input - but none of its money.
        var (coBody, coRoot) = await PullAsync(CoOwner);
        var coLog = One(coRoot, "dailyLogs", PrivateLog);
        var crew = coLog.GetProperty("labour").EnumerateArray().Single();
        crew.GetProperty("workerCount").GetInt32().Should().Be(6);
        crew.GetProperty("wagePerPerson").ValueKind.Should().Be(JsonValueKind.Null);
        crew.GetProperty("totalCost").ValueKind.Should().Be(JsonValueKind.Null);
        crew.GetProperty("totalCostWithheld").GetBoolean().Should().BeTrue();
        coLog.GetProperty("content").GetProperty("amountsWithheld").GetBoolean().Should().BeTrue();
        coLog.GetProperty("content").GetProperty("document").GetProperty("inputs").EnumerateArray().Single()
            .GetProperty("productName").GetString().Should().Be("युरिया");
        coLog.TryGetProperty("moneyAudience", out _).Should().BeFalse("only the holder and the maker are told the record's money is private");
        coBody.Should().NotContain("377.71").And.NotContain("2643.97").And.NotContain("919.29");

        // Her OLD records keep their money for her (follow-up 1): the owner's record made before the switch still carries its amounts.
        var oldCrew = One(coRoot, "dailyLogs", OwnerLog).GetProperty("labour").EnumerateArray().Single();
        oldCrew.GetProperty("totalCost").GetDecimal().Should().Be(OwnerCrewTotal);

        // The holder and the maker get it whole, told it is private.
        foreach (var reader in new[] { Owner, Mukadam })
        {
            var (body, root) = await PullAsync(reader);
            var whole = One(root, "dailyLogs", PrivateLog);
            whole.GetProperty("moneyAudience").GetString().Should().Be("OnlyMe");
            whole.GetProperty("labour").EnumerateArray().Single().GetProperty("totalCost").GetDecimal().Should().Be(PrivateCrewTotal);
            body.Should().Contain("919.29");
        }
    }

    [Fact]
    public async Task Turning_it_on_leaves_old_bills_visible_and_turning_it_off_leaves_private_bills_private()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney);

        await PushAppliedAsync(Owner, Switch, "perm-old-on", SwitchPayload(FarmA, true));
        IdsOf((await PullAsync(CoOwner)).Root, "costEntries").Should().Contain(Cost, "turning it on never moves a bill already made");
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", Cost)))!).Should().Be("Team");

        await PushAppliedAsync(Owner, "add_cost_entry", "perm-old-private", CostPayload(PrivateBill, FarmA, PlotA, CycleA, PrivateBillAmount));
        await PushAppliedAsync(Owner, Switch, "perm-old-off", SwitchPayload(FarmA, false));
        await PushAppliedAsync(Owner, "add_cost_entry", "perm-old-later", CostPayload(LaterBill, FarmA, PlotA, CycleA, LaterBillAmount));

        var (_, coRoot) = await PullAsync(CoOwner);
        IdsOf(coRoot, "costEntries").Should().NotContain(PrivateBill, "turning it off never opens a bill made while it was on");
        IdsOf(coRoot, "costEntries").Should().Contain([Cost, LaterBill]);
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", PrivateBill)))!).Should().Be("OnlyMe");
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", LaterBill)))!).Should().Be("Team");
    }

    [Fact]
    public async Task Widening_a_work_record_later_never_widens_its_born_private_money()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await PushAppliedAsync(Owner, Switch, "perm-follow-on", SwitchPayload(FarmA, true));

        await PushAppliedAsync(Owner, "create_daily_log", "perm-follow-log",
            LogPayload(PrivateLog, Owner, PrivateCrew, 4, PrivateWage, PrivateCrewTotal, [], null));
        var lineMoney = CostPayload(LineMoney, FarmA, PlotA, CycleA, PrivateCrewTotal);
        lineMoney["categoryId"] = "labour_misc";
        lineMoney["description"] = "मजुरी";
        await PushAppliedAsync(Owner, "add_cost_entry", "perm-follow-money", lineMoney);
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", LineMoney)))!).Should().Be("OnlyMe");

        // The holder narrows the record, then widens it again to the whole team: its born-private money stays his.
        foreach (var (audience, request) in new[] { ("OnlyMe", "perm-follow-narrow"), ("Team", "perm-follow-widen") })
        {
            await PushAppliedAsync(Owner, "set_record_audience", request, new Dictionary<string, object?>
            {
                ["recordKind"] = "DailyLog",
                ["recordId"] = PrivateLog,
                ["audience"] = audience,
                ["selectedUserIds"] = Array.Empty<Guid>(),
                ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
            });
        }

        ((string)(await ScalarAsync("SELECT audience FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", PrivateLog)))!).Should().Be("Team");
        ((string)(await ScalarAsync("SELECT audience FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", LineMoney)))!).Should().Be("OnlyMe");
        var (coBody, coRoot) = await PullAsync(CoOwner);
        IdsOf(coRoot, "dailyLogs").Should().Contain(PrivateLog, "the work is the team's again");
        IdsOf(coRoot, "costEntries").Should().NotContain(LineMoney);
        coBody.Should().NotContain("2643.97");
    }

    [Fact]
    public async Task With_the_switch_off_an_old_phone_pull_is_byte_for_byte_the_same()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Nothing of this lane appears on a farm that uses none of it, for a phone that asks for nothing new: the pull is what it was.
        foreach (var reader in new[] { Owner, CoOwner, Mukadam, Worker })
        {
            var (body, _) = await PullAsync(reader);
            foreach (var key in new[] { "moneyPrivate", "moneyAudience", "workKinds", "seenBy" })
            {
                body.Should().NotContain($"\"{key}\"", $"{reader}'s pull from an old phone never carries {key}");
            }
        }

        // The two pulls of one old phone, before and after the lane's rows exist on ANOTHER farm, are byte-for-byte the same.
        var since = DateTime.UtcNow.AddSeconds(-1);
        var (before, _) = await PullAsync(Mukadam, since);
        await PushAppliedAsync(OwnerB, Switch, "perm-bytes-b-on", SwitchPayload(FarmB, true));
        await PushAppliedAsync(OwnerB, "add_cost_entry", "perm-bytes-b-bill", CostPayload(LaterBill, FarmB, PlotB, CycleB, LaterBillAmount));
        var (after, _) = await PullAsync(Mukadam, since);
        StripClock(after).Should().Be(StripClock(before));
    }

    /// <summary>The two moments a pull names (its own clock and the next cursor) are not content.</summary>
    private static string StripClock(string body)
    {
        var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body)!;
        dict.Remove("serverTimeUtc");
        dict.Remove("nextCursorUtc");
        dict.Remove("attentionBoard");
        return JsonSerializer.Serialize(dict);
    }
}
