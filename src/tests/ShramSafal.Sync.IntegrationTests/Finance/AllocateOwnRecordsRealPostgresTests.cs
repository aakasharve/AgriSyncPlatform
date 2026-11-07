// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 add-on (re-review 2, N1). The same own-records gap H1 closed
// for approving and correcting a bill, in the door that SPLITS a whole-farm bill over the plots (allocate_global_expense and
// POST /shramsafal/finance/allocate): a स्वतःचं काम or कामगार seat holding see money + review money may split only money it may
// see — another person's bill is not found, on push and REST, and the answer carries none of its amounts (not even the day
// ledger an earlier split left, which the door used to hand back as it stood).
// On a real Postgres as agrisync_app (doctrine E3 first). Speaks only the wire and the database, so it compiles on fcc39eda.
using System;
using System.Collections.Generic;
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
public sealed class AllocateOwnRecordsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Allocate = "allocate_global_expense";
    private const string NotFound = "ShramSafal.CostEntryNotFound";

    private static readonly Guid OwnersWholeFarmBill = Guid.Parse("b1130000-0000-4000-8000-000000000001");
    private static readonly Guid OwnWholeFarmBill = Guid.Parse("b1130000-0000-4000-8000-000000000002");
    private const decimal OwnersAmount = 13579.24m;
    private const string OwnersAmountText = "13579.24";
    private const decimal OwnAmount = 2468.42m;

    [Theory]
    [InlineData("own-work")]
    [InlineData("worker-label")]
    public async Task An_own_records_reviewer_may_split_only_his_own_whole_farm_bill(string seat)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var reviewer = seat == "own-work" ? Mukadam : Worker;
        await SetAuthoritiesAsync(FarmA, reviewer, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        if (seat == "own-work")
        {
            using var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                new { plotScope = "OwnWork", plotIds = (Guid[]?)null });
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        await PushAppliedAsync(Owner, "add_cost_entry", $"bill1-addon-owners-{seat}", WholeFarm(OwnersWholeFarmBill, OwnersAmount));
        await PushAppliedAsync(reviewer, "add_cost_entry", $"bill1-addon-own-{seat}", WholeFarm(OwnWholeFarmBill, OwnAmount));

        // Another person's whole-farm bill (never sent to him): not there — push and REST, no amount in the answer.
        var pushed = await PushAsync(reviewer, Allocate, $"bill1-addon-{seat}-push", Split(OwnersWholeFarmBill));
        Output.WriteLine($"[EVIDENCE] {seat} splits the owner's whole-farm bill -> {pushed.Status} {pushed.ErrorCode}");
        pushed.Status.Should().NotBe("applied");
        pushed.ErrorCode.Should().Be(NotFound);
        JsonSerializer.Serialize(pushed).Should().NotContain(OwnersAmountText);

        var (rest, restBody) = await PostAsync(reviewer, "/shramsafal/finance/allocate",
            new { costEntryId = OwnersWholeFarmBill, allocationBasis = "equal", allocations = Array.Empty<object>() });
        rest.Should().Be(HttpStatusCode.NotFound, restBody);
        restBody.Should().NotContain(OwnersAmountText);
        (await CountAsync("SELECT count(*) FROM ssf.day_ledgers WHERE source_cost_entry_id = @id", OwnersWholeFarmBill)).Should().Be(0);

        // The split someone else already made of a bill he may not see is not handed back to him either.
        await PushAppliedAsync(Owner, Allocate, $"bill1-addon-owner-split-{seat}", Split(OwnersWholeFarmBill));
        var replay = await PushAsync(reviewer, Allocate, $"bill1-addon-{seat}-replay", Split(OwnersWholeFarmBill));
        replay.ErrorCode.Should().Be(NotFound, "an existing split of a bill he may not see is not his to read");
        JsonSerializer.Serialize(replay).Should().NotContain(OwnersAmountText);
        var (restReplay, restReplayBody) = await PostAsync(reviewer, "/shramsafal/finance/allocate",
            new { costEntryId = OwnersWholeFarmBill, allocationBasis = "equal", allocations = Array.Empty<object>() });
        restReplay.Should().Be(HttpStatusCode.NotFound, restReplayBody);
        restReplayBody.Should().NotContain(OwnersAmountText);

        // His own whole-farm bill stays his to split.
        var own = await PushAsync(reviewer, Allocate, $"bill1-addon-{seat}-own", Split(OwnWholeFarmBill));
        own.Status.Should().Be("applied", "{0}: {1}", own.ErrorCode, own.ErrorMessage);
    }

    private static Dictionary<string, object?> WholeFarm(Guid id, decimal amount) => new()
    {
        ["costEntryId"] = id,
        ["farmId"] = FarmA,
        ["categoryId"] = "fertilizer",
        ["description"] = "सगळ्या शेतासाठी",
        ["amount"] = amount,
        ["currencyCode"] = "INR",
        ["entryDate"] = WorkDay,
        ["direction"] = "Expense",
    };

    private static Dictionary<string, object?> Split(Guid bill) => new()
    {
        ["dayLedgerId"] = Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["allocationBasis"] = "equal",
        ["allocations"] = Array.Empty<object>(),
    };

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REST] POST {url} by {user} -> {(int)response.StatusCode} {text}");
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
}
