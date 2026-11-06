// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
//
// Each farm's own price and rate list, on a real Postgres as agrisync_app (doctrine E3 first in every fact), through the
// real host: the sync push (set_farm_rate), the REST doors (/finance/farm-rates) and the sync pull (farmRates).
//   A  the primary account holder sets and changes a rate (push and REST); every version is kept, the newest is current;
//      the app role can neither rewrite nor delete a stored version (append-only by privilege);
//   B  any other seat is refused, visibly, on push and on REST — even one holding see money and see wages;
//   C  input prices need see money; work / service rates ALSO need see wages; a seat with neither gets none (never ₹0);
//   D  another farm's rates are invisible both ways, and a write naming a foreign farm or a foreign rate line is refused;
//   E  old money, bills and wages are byte-identical after rate changes (the rate list never rewrites them);
//   F  the shared ShramSafal list stays admin-only (F99 answers unchanged) and reaches a farm only as a suggestion that he
//      confirms into his own list — never another farmer's legacy row;
//   G  a sequence of pulls with whole-second cursors (as every phone sends them) delivers every new rate, never skips one,
//      and the cursor advances.
// Every fact speaks only the WIRE (mutation names, routes, JSON fields), so it compiles on the base and fails there.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Finance;

[Trait("Category", "RequiresPostgres")]
public sealed class FarmRatesRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Mutation = "set_farm_rate";
    private const string Route = "/shramsafal/finance/farm-rates";

    private static readonly Guid UreaLine = Guid.Parse("3d072000-0000-4000-8000-000000000001");
    private static readonly Guid SprayLine = Guid.Parse("3d072000-0000-4000-8000-000000000002");
    private static readonly Guid FarmBLine = Guid.Parse("3d072000-0000-4000-8000-000000000003");
    private static readonly Guid SuggestedLine = Guid.Parse("3d072000-0000-4000-8000-000000000004");
    private static readonly Guid LaterLine = Guid.Parse("3d072000-0000-4000-8000-000000000005");
    private static readonly Guid PlatformAdmin = Guid.Parse("3d072000-0000-4000-8000-0000000000ad");
    private static readonly Guid PlatformOrg = Guid.Parse("3d072000-0000-4000-8000-0000000000a0");
    private static readonly Guid LegacyFarmerRow = Guid.Parse("3d072000-0000-4000-8000-0000000000c1");

    // Amounts chosen so none can occur by accident in a JSON body.
    private const decimal UreaFirst = 1357.91m;
    private const decimal UreaSecond = 1468.02m;
    private const decimal SprayWage = 642.13m;
    private const decimal FarmBRate = 2468.13m;

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_the_primary_holder_sets_and_changes_a_rate_and_every_version_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var pushed = await PushAsync(Owner, Mutation, "rate1-a-1", Input(UreaLine, UreaFirst));
        pushed.Status.Should().Be("applied", "{0}: {1}", pushed.ErrorCode, pushed.ErrorMessage);

        var (changed, changedBody) = await PostAsync(Owner, Route, Input(UreaLine, UreaSecond, effectiveFrom: "2026-11-05"));
        changed.Should().Be(HttpStatusCode.OK, changedBody);
        Json(changedBody).GetProperty("version").GetInt32().Should().Be(2, "the server numbers the versions, never the phone");

        var (listed, listBody) = await GetAsync(Owner, $"{Route}?farmId={FarmA}");
        listed.Should().Be(HttpStatusCode.OK, listBody);
        var versions = ArrayOf(Json(listBody), "rates").Where(r => r.GetProperty("rateLineId").GetGuid() == UreaLine).ToList();
        versions.Select(v => v.GetProperty("version").GetInt32()).Should().BeEquivalentTo([1, 2]);
        versions.Single(v => v.GetProperty("version").GetInt32() == 1).GetProperty("amount").GetDecimal().Should().Be(UreaFirst, "the old version stays readable");
        versions.Single(v => v.GetProperty("version").GetInt32() == 2).GetProperty("amount").GetDecimal().Should().Be(UreaSecond);
        versions.Should().OnlyContain(v => v.GetProperty("createdByUserId").GetGuid() == Owner, "who set it, by id");
        Json(listBody).GetProperty("mayWrite").GetBoolean().Should().BeTrue();

        // Remove = a retired version (who and when), never a deletion.
        var retired = await PushAsync(Owner, Mutation, "rate1-a-retire", new Dictionary<string, object?>
        {
            ["farmRateId"] = Guid.NewGuid(),
            ["rateLineId"] = UreaLine,
            ["farmId"] = FarmA,
            ["change"] = "retire",
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        retired.Status.Should().Be("applied", "{0}: {1}", retired.ErrorCode, retired.ErrorMessage);
        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE rate_line_id = @id", UreaLine)).Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE rate_line_id = @id AND retired AND version = 3", UreaLine)).Should().Be(1);

        // Append-only by privilege: the app role can neither rewrite nor delete a stored version.
        foreach (var sql in new[]
                 {
                     "UPDATE ssf.farm_rates SET amount = 1 WHERE rate_line_id = @id",
                     "DELETE FROM ssf.farm_rates WHERE rate_line_id = @id",
                 })
        {
            var refused = await AppRoleRefusesAsync(sql, UreaLine);
            refused.Should().Be("42501", $"{sql} must be refused by privilege");
        }
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task B_a_seat_that_is_not_the_primary_holder_is_refused_on_push_and_REST()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Even a सहमालक holding see money AND see wages may not set the farm's rates in part A.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);

        foreach (var who in new[] { CoOwner, Mukadam, Worker })
        {
            var pushed = await PushAsync(who, Mutation, $"rate1-b-{who:N}", Input(Guid.NewGuid(), UreaFirst));
            pushed.Status.Should().NotBe("applied");
            pushed.ErrorCode.Should().Be("ShramSafal.FarmRate.Forbidden", "a visible refusal every phone parks ('.Forbidden')");

            var (rest, restBody) = await PostAsync(who, Route, Input(Guid.NewGuid(), UreaFirst));
            rest.Should().Be(HttpStatusCode.Forbidden, restBody);
            Json(restBody).GetProperty("error").GetString().Should().Be("ShramSafal.FarmRate.Forbidden");
            Json(restBody).GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

            var (_, listBody) = await GetAsync(who, $"{Route}?farmId={FarmA}");
            Json(listBody).GetProperty("mayWrite").GetBoolean().Should().BeFalse("the phone hides the write controls by the same gate");
        }

        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE farm_id = @id", FarmA)).Should().Be(0, "nothing was written");
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task C_input_prices_need_see_money_and_work_rates_also_need_see_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PushAsync(Owner, Mutation, "rate1-c-input", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");
        (await PushAsync(Owner, Mutation, "rate1-c-work", Work(SprayLine, SprayWage))).Status.Should().Be("applied");

        // The owner reads both.
        var (ownerBody, owner) = await PullAsync(Owner);
        RateLines(owner).Should().BeEquivalentTo([UreaLine, SprayLine]);
        Keep("owner-pull", ownerBody);

        // A seat with neither (the कामगार; the सहमालक with money switched off): no rate at all, no amount in the body.
        foreach (var who in new[] { Worker, CoOwner, Mukadam })
        {
            var (body, pulled) = await PullAsync(who);
            RateLines(pulled).Should().BeEmpty($"{who} holds no see money");
            body.Should().NotContain("1357.91").And.NotContain("642.13");
            var (status, restBody) = await GetAsync(who, $"{Route}?farmId={FarmA}");
            status.Should().Be(HttpStatusCode.OK, restBody);
            ArrayOf(Json(restBody), "rates").Should().BeEmpty();
            Json(restBody).GetProperty("seeInputPrices").GetBoolean().Should().BeFalse("the phone shows '—', never ₹0");
            restBody.Should().NotContain("1357.91").And.NotContain("642.13");
        }

        // See money only: input prices, not wage rates.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney);
        await Task.Delay(1150);
        var (moneyBody, money) = await PullAsync(CoOwner);
        Keep("see-money-pull", moneyBody);
        RateLines(money).Should().BeEquivalentTo([UreaLine], "see money reads input prices");
        moneyBody.Should().NotContain("642.13", "a wage rate is pay: it needs see wages");
        var (_, moneyRest) = await GetAsync(CoOwner, $"{Route}?farmId={FarmA}");
        ArrayOf(Json(moneyRest), "rates").Select(r => r.GetProperty("rateLineId").GetGuid()).Should().BeEquivalentTo([UreaLine]);
        Json(moneyRest).GetProperty("seeWorkRates").GetBoolean().Should().BeFalse();

        // See money AND see wages: both.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await Task.Delay(1150);
        var (_, wages) = await PullAsync(CoOwner);
        RateLines(wages).Should().BeEquivalentTo([UreaLine, SprayLine]);
        var (_, wagesRest) = await GetAsync(CoOwner, $"{Route}?farmId={FarmA}");
        ArrayOf(Json(wagesRest), "rates").Select(r => r.GetProperty("rateLineId").GetGuid()).Should().BeEquivalentTo([UreaLine, SprayLine]);
    }

    // ── D ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task D_another_farms_rates_are_invisible_both_ways_and_foreign_writes_are_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PushAsync(Owner, Mutation, "rate1-d-a", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");
        (await PushAsync(OwnerB, Mutation, "rate1-d-b", Input(FarmBLine, FarmBRate, farm: FarmB))).Status.Should().Be("applied");

        // Reads, both directions: pull and REST.
        var (ownerBody, owner) = await PullAsync(Owner);
        RateLines(owner).Should().BeEquivalentTo([UreaLine]);
        ownerBody.Should().NotContain("2468.13");
        var (ownerBBody, ownerB) = await PullAsync(OwnerB);
        RateLines(ownerB).Should().BeEquivalentTo([FarmBLine]);
        ownerBBody.Should().NotContain("1357.91");
        (await GetAsync(Owner, $"{Route}?farmId={FarmB}")).Status.Should().NotBe(HttpStatusCode.OK, "a farm he is not on");
        (await GetAsync(OwnerB, $"{Route}?farmId={FarmA}")).Status.Should().NotBe(HttpStatusCode.OK);

        // A write naming a FOREIGN farm: refused on push and REST; nothing reaches farm B.
        var foreignFarm = await PushAsync(Owner, Mutation, "rate1-d-foreign-farm", Input(Guid.NewGuid(), UreaFirst, farm: FarmB));
        foreignFarm.Status.Should().NotBe("applied");
        foreignFarm.ErrorCode.Should().EndWith("Forbidden");
        (await PostAsync(Owner, Route, Input(Guid.NewGuid(), UreaFirst, farm: FarmB))).Status.Should().NotBe(HttpStatusCode.OK);

        // A write to HIS farm naming farm B's rate LINE (the foreign parent): never applied, farm B's line untouched.
        var foreignLine = await PushAsync(Owner, Mutation, "rate1-d-foreign-line", Input(FarmBLine, UreaSecond));
        foreignLine.Status.Should().NotBe("applied", "a line of another farm is never continued from this one");
        (await PostAsync(Owner, Route, Input(FarmBLine, UreaSecond))).Status.Should().NotBe(HttpStatusCode.OK);

        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE farm_id = @id", FarmB)).Should().Be(1, "farm B holds only its own rate");
        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE rate_line_id = @id", FarmBLine)).Should().Be(1, "its line was not continued");
        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE farm_id = @id", FarmA)).Should().Be(1);
    }

    // ── E ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task E_old_money_bills_and_wages_are_byte_identical_after_rate_changes()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var tables = new[]
        {
            "cost_entries", "finance_corrections", "day_ledgers", "labour_assignments", "job_cards", "attendance_marks",
            "daily_logs", "daily_log_contents", "price_configs",
        };
        var before = await SnapshotAsync(tables);
        var (_, pullBefore) = await PullAsync(Owner);

        (await PushAsync(Owner, Mutation, "rate1-e-1", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");
        (await PushAsync(Owner, Mutation, "rate1-e-2", Work(SprayLine, SprayWage))).Status.Should().Be("applied");
        (await PostAsync(Owner, Route, Input(UreaLine, UreaSecond))).Status.Should().Be(HttpStatusCode.OK);
        (await PostAsync(Owner, Route, Work(SprayLine, SprayWage + 10m))).Status.Should().Be(HttpStatusCode.OK);

        var after = await SnapshotAsync(tables);
        after.Should().BeEquivalentTo(before, "the rate list never rewrites a bill, a cost or a wage, and computes no wage");
        var (_, pullAfter) = await PullAsync(Owner);
        foreach (var array in new[] { "costEntries", "dailyLogs", "dayLedgers", "jobCards", "financeCorrections", "attendanceMarks" })
        {
            Raw(pullAfter, array).Should().Be(Raw(pullBefore, array), $"{array} reach his phone unchanged");
        }
    }

    // ── F ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F_the_shared_list_stays_admin_only_and_is_offered_only_as_a_suggestion()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedPlatformOwnerAsync(PlatformAdmin, PlatformOrg);
        object Price(string item) => new { itemName = item, unitPrice = 1111.11m, currencyCode = "INR", effectiveFrom = "2026-11-01", version = 1 };

        // F99, unchanged: a farmer is refused on REST and push with the same code; the admin writes; may-write answers each.
        var (farmer, farmerBody) = await PostAsync(Owner, "/shramsafal/finance/price-config", Price("rate1-farmer"));
        farmer.Should().Be(HttpStatusCode.Forbidden, farmerBody);
        Json(farmerBody).GetProperty("error").GetString().Should().Be("ShramSafal.PriceList.Forbidden");
        var farmerPush = await PushAsync(Owner, "set_price_config", "rate1-f-farmer", new Dictionary<string, object?>
        {
            ["itemName"] = "rate1-farmer-push",
            ["unitPrice"] = 1111.11m,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = "2026-11-01",
            ["version"] = 1,
        });
        farmerPush.ErrorCode.Should().Be("ShramSafal.PriceList.Forbidden");
        var (admin, adminBody) = await PostAsync(PlatformAdmin, "/shramsafal/finance/price-config", Price("डीएपी"));
        admin.Should().Be(HttpStatusCode.OK, adminBody);
        var adminRowId = Json(adminBody).GetProperty("id").GetGuid();
        Json((await GetAsync(Owner, "/shramsafal/finance/price-config/may-write")).Body).GetProperty("mayWrite").GetBoolean().Should().BeFalse();
        Json((await GetAsync(PlatformAdmin, "/shramsafal/finance/price-config/may-write")).Body).GetProperty("mayWrite").GetBoolean().Should().BeTrue();

        // A row a farmer wrote into the shared list before F99 (one existed wherever a phone could push it).
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.price_configs ("Id", item_name, unit_price, currency_code, effective_from, version, created_by_user_id, created_at_utc, modified_at_utc)
            VALUES (@id, 'जुना-शेतकरी-दर', 9191.91, 'INR', DATE '2026-10-01', 1, @owner, NOW(), NOW());
            """, ("id", LegacyFarmerRow), ("owner", Owner));

        // The suggestion door: ShramSafal's own rows only — another farmer's legacy row never reaches a stranger.
        var (suggested, suggestedBody) = await GetAsync(OwnerB, $"{Route}/suggestions");
        suggested.Should().Be(HttpStatusCode.OK, suggestedBody);
        var suggestions = ArrayOf(Json(suggestedBody), "suggestions");
        suggestions.Select(s => s.GetProperty("id").GetGuid()).Should().Contain(adminRowId);
        suggestedBody.Should().NotContain("9191.91").And.NotContain(LegacyFarmerRow.ToString());

        // The pull's priceConfigs stays the F99 answer exactly: his own rows only (1.0.17 reads it).
        var (_, ownerPull) = await PullAsync(Owner);
        IdsOf(ownerPull, "priceConfigs").Should().BeEquivalentTo([LegacyFarmerRow]);
        var (_, ownerBPull) = await PullAsync(OwnerB);
        IdsOf(ownerBPull, "priceConfigs").Should().BeEmpty();

        // He confirms the suggestion into HIS list: a normal row, authored by him, noting where it came from. The shared list
        // is not touched.
        var sharedBefore = await CountAsync("SELECT count(*) FROM ssf.price_configs WHERE \"Id\" <> @id", Guid.Empty);
        var confirmed = await PushAsync(OwnerB, Mutation, "rate1-f-confirm",
            Input(SuggestedLine, 1111.11m, farm: FarmB, item: "डीएपी", suggestionId: adminRowId));
        confirmed.Status.Should().Be("applied", "{0}: {1}", confirmed.ErrorCode, confirmed.ErrorMessage);
        var (_, ownRest) = await GetAsync(OwnerB, $"{Route}?farmId={FarmB}");
        var own = ArrayOf(Json(ownRest), "rates").Single(r => r.GetProperty("rateLineId").GetGuid() == SuggestedLine);
        own.GetProperty("suggestionId").GetGuid().Should().Be(adminRowId);
        own.GetProperty("createdByUserId").GetGuid().Should().Be(OwnerB);
        (await CountAsync("SELECT count(*) FROM ssf.price_configs WHERE \"Id\" <> @id", Guid.Empty)).Should().Be(sharedBefore);

        // A made-up or farmer-written "suggestion" is never recorded as ShramSafal's.
        var forged = await PushAsync(OwnerB, Mutation, "rate1-f-forged",
            Input(Guid.NewGuid(), 9191.91m, farm: FarmB, suggestionId: LegacyFarmerRow));
        forged.Status.Should().NotBe("applied");
    }

    // ── G ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task G_whole_second_pulls_deliver_every_new_rate_and_the_cursor_advances()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, first) = await PullAsync(Owner);
        RateLines(first).Should().BeEmpty();
        var cursor = Cursor(first);

        (await PushAsync(Owner, Mutation, "rate1-g-1", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");
        await NextWholeSecondAsync();
        var (_, second) = await PullAsync(Owner, cursor);
        RateLines(second).Should().BeEquivalentTo([UreaLine], "a new rate arrives in the first pull after it is written");
        var next = Cursor(second);
        next.Should().BeAfter(cursor, "the cursor advances");
        var ureaAt = ArrayOf(second, "farmRates").Single().GetProperty("createdAtUtc").GetDateTime();
        next.Should().BeOnOrAfter(ureaAt);
        cursor = next;

        await NextWholeSecondAsync();
        (await PushAsync(Owner, Mutation, "rate1-g-2", Input(LaterLine, UreaSecond))).Status.Should().Be("applied");
        await NextWholeSecondAsync();

        var delivered = new Dictionary<Guid, int> { [UreaLine] = 1, [LaterLine] = 0 };
        for (var i = 0; i < 4; i++)
        {
            var (_, answer) = await PullAsync(Owner, cursor);
            foreach (var line in RateLines(answer))
            {
                delivered[line]++;
            }

            var answered = Cursor(answer);
            answered.Should().BeOnOrAfter(cursor, "the cursor never moves back");
            Output.WriteLine($"[EVIDENCE] pull {i + 2}: sent {PhoneCursor(cursor)} -> {string.Join(",", RateLines(answer))}; next {answered:O}");
            cursor = answered;
            await Task.Delay(300);
        }

        delivered[LaterLine].Should().BeGreaterThan(0, "never skipped");
        // The sync protocol's whole-second property (every kind): the newest row of the cursor's own second is read again
        // until a newer one moves the cursor; the phone merges by id. A rate whose second the cursor has passed is never
        // sent again.
        delivered[UreaLine].Should().BeLessThanOrEqualTo(2, "once its second is passed it is not re-sent");
    }

    // ── H (fix round 1, review F1) ───────────────────────────────────────────────────────

    /// <summary>
    /// An own-records-only seat — by label (कामगार) or by scope (स्वतःचं काम) — reads NO rate of the farm, even holding see
    /// money and see wages: the server's own permission card tells the owner those two are "लागू नाही" for such a seat
    /// (LabourPermissionProjection), RecordVisibility §11.7 and MU G1 keep other people's money and pay from it.
    /// </summary>
    [Fact]
    public async Task H_an_own_records_seat_reads_no_rate_even_with_see_money_and_see_wages()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PushAsync(Owner, Mutation, "rate1-h-input", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");
        (await PushAsync(Owner, Mutation, "rate1-h-work", Work(SprayLine, SprayWage))).Status.Should().Be("applied");

        // A कामगार (own records by LABEL) the owner gave see money + see wages.
        await SetAuthoritiesAsync(FarmA, Worker, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        // A सहमालक with see money + see wages whose scope the owner set to स्वतःचं काम (own records by SCOPE).
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{CoOwner}/plot-scope", Owner,
                   new { plotScope = "OwnWork", plotIds = (Guid[]?)null }))
        {
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        await Task.Delay(1150);
        foreach (var who in new[] { Worker, CoOwner })
        {
            var (body, pulled) = await PullAsync(who);
            RateLines(pulled).Should().BeEmpty($"{who} reads only his own records: the farm's rates are not his");
            body.Should().NotContain("1357.91").And.NotContain("642.13");

            var (status, restBody) = await GetAsync(who, $"{Route}?farmId={FarmA}");
            status.Should().Be(HttpStatusCode.OK, restBody);
            ArrayOf(Json(restBody), "rates").Should().BeEmpty();
            Json(restBody).GetProperty("seeInputPrices").GetBoolean().Should().BeFalse();
            Json(restBody).GetProperty("seeWorkRates").GetBoolean().Should().BeFalse();
            restBody.Should().NotContain("1357.91").And.NotContain("642.13");
        }

        // The owner still reads both.
        var (_, owner) = await PullAsync(Owner);
        RateLines(owner).Should().BeEquivalentTo([UreaLine, SprayLine]);
    }

    // ── I (fix round 1, review F2) ───────────────────────────────────────────────────────

    /// <summary>A rate line keeps one kind for life: a change of kind on an existing line is refused (parked for good).</summary>
    [Fact]
    public async Task I_a_rate_line_keeps_one_kind_for_life()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PushAsync(Owner, Mutation, "rate1-i-input", Input(UreaLine, UreaFirst))).Status.Should().Be("applied");

        var asWork = Work(UreaLine, SprayWage);
        var pushed = await PushAsync(Owner, Mutation, "rate1-i-to-work", asWork);
        pushed.Status.Should().NotBe("applied");
        pushed.ErrorCode.Should().Be("ShramSafal.FarmRate.KindChangeNotAllowed");

        var (rest, restBody) = await PostAsync(Owner, Route, Work(UreaLine, SprayWage));
        rest.Should().Be(HttpStatusCode.BadRequest, restBody);
        Json(restBody).GetProperty("error").GetString().Should().Be("ShramSafal.FarmRate.KindChangeNotAllowed");

        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE rate_line_id = @id", UreaLine)).Should().Be(1, "the line was not changed");
        (await CountAsync("SELECT count(*) FROM ssf.farm_rates WHERE rate_line_id = @id AND kind = 'Input'", UreaLine)).Should().Be(1);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> Input(
        Guid line, decimal amount, Guid? farm = null, string item = "युरिया", string effectiveFrom = "2026-11-01", Guid? suggestionId = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmRateId"] = Guid.NewGuid(),
            ["rateLineId"] = line,
            ["farmId"] = farm ?? FarmA,
            ["change"] = "set",
            ["kind"] = "Input",
            ["itemName"] = item,
            ["unit"] = "पोते",
            ["basis"] = "PerUnit",
            ["amount"] = amount,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = effectiveFrom,
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        if (suggestionId is { } s)
        {
            payload["suggestionId"] = s;
        }

        return payload;
    }

    private static Dictionary<string, object?> Work(Guid line, decimal amount) => new()
    {
        ["farmRateId"] = Guid.NewGuid(),
        ["rateLineId"] = line,
        ["farmId"] = FarmA,
        ["change"] = "set",
        ["kind"] = "Work",
        ["itemName"] = "फवारणी",
        ["basis"] = "PerDay",
        ["workerCategory"] = "बाई मजूर",
        ["amount"] = amount,
        ["currencyCode"] = "INR",
        ["effectiveFrom"] = "2026-11-01",
        ["season"] = "खरीप",
        ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
    };

    private static IReadOnlyList<Guid> RateLines(JsonElement root) =>
        ArrayOf(root, "farmRates").Select(r => r.GetProperty("rateLineId").GetGuid()).Distinct().ToList();

    private static DateTime Cursor(JsonElement root) => root.GetProperty("nextCursorUtc").GetDateTime();

    private static string Raw(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) ? value.GetRawText() : "<absent>";

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    /// <summary>
    /// The P11 run's input: when <c>RATE1_P11_BODIES</c> names a folder, the real bodies this server sent are kept there, so
    /// the 1.0.17 phone's own code (release b3d28967) can be fed exactly them.
    /// </summary>
    private static void Keep(string who, string body)
    {
        var folder = Environment.GetEnvironmentVariable("RATE1_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, $"{who}.json"), body);
        }
    }

    private static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 20));
    }

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} POST {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>The statement as agrisync_app with the farm's scope set; the SQLSTATE it is refused with (or "none").</summary>
    private async Task<string> AppRoleRefusesAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = $"SELECT set_config('agrisync.farm_id', '{FarmA}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("id", id);
            await cmd.ExecuteNonQueryAsync();
            return "none";
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    private async Task<Dictionary<string, string>> SnapshotAsync(IEnumerable<string> tables)
    {
        var snapshot = new Dictionary<string, string>();
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        foreach (var table in tables)
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '') FROM ssf.{table} t";
            snapshot[table] = (string)(await cmd.ExecuteScalarAsync())!;
        }

        return snapshot;
    }
}
