// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and
// when").
//
// A bill's मंजूर, on a real Postgres as agrisync_app (doctrine E3 first in every fact), through the real host: the sync push
// (approve_cost_entry), the REST door (POST /shramsafal/finance/cost-entry/{id}/approve) and the sync pull (each cost entry's
// billVersion / needsReview / reviewReason / approval).
//   A  a ReviewMoney seat approves; the stamp records who, when and which version; the stamp is append-only by privilege;
//      an incremental pull with a whole-second cursor brings it; the same person approving the same version twice is one stamp;
//   B  a seat without ReviewMoney is refused, visibly, on push and REST — and sees the stamp only where it may see the bill;
//   C  a seat outside the bill's plots is refused (MU-4);
//   D  another farm's bill is invisible and unapprovable, both ways (E4);
//   E  approving a stale version is refused (the L4b code) and the new version is approvable;
//   F  a correction after approval makes the stamp read as "for an older version" (never carried to the new numbers);
//   G  the review flag clears only for the approved version;
//   H  P11 — the pull's bill row keeps every field 1.0.17 reads, unchanged, and still carries no isFlagged / flagReason;
//   I  the race (the L6 S7 lesson): a correction holding the bill finishes first, and the approval then sees its version.
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
public sealed class BillApprovalRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Mutation = "approve_cost_entry";
    private const string VersionConflict = "ShramSafal.LogVersion.Conflict";

    private static readonly Guid PlotTwo = Guid.Parse("b1110000-0000-4000-8000-0000000000c1");
    private static readonly Guid CycleTwo = Guid.Parse("b1110000-0000-4000-8000-0000000000c2");
    private static readonly Guid BigBill = Guid.Parse("b1110000-0000-4000-8000-000000000001");
    private static readonly Guid PlotTwoBill = Guid.Parse("b1110000-0000-4000-8000-000000000002");
    private static readonly Guid WorkerBill = Guid.Parse("b1110000-0000-4000-8000-000000000003");
    private static readonly Guid WholeFarmBill = Guid.Parse("b1110000-0000-4000-8000-000000000004");

    // Amounts chosen so none can occur by accident in a JSON body.
    private const decimal BigAmount = 31234.56m;
    private const decimal BigCorrected = 32109.87m;
    private const decimal CostCorrected = 8765.43m;
    private const decimal PlotTwoAmount = 4321.09m;
    private const decimal WorkerAmount = 678.91m;

    private static string Route(Guid id) => $"/shramsafal/finance/cost-entry/{id}/approve";

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_a_review_money_seat_approves_and_the_stamp_records_who_when_and_which_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await Task.Delay(1150);

        var (_, first) = await PullAsync(Owner);
        var before = Bill(first, Cost);
        before.GetProperty("billVersion").GetInt32().Should().Be(1, "a bill as first saved is version 1");
        (before.TryGetProperty("approval", out var none) && none.ValueKind != JsonValueKind.Null)
            .Should().BeFalse("nobody approved it yet: no stamp is sent");
        before.GetProperty("needsReview").GetBoolean().Should().BeFalse("a bill under ₹25,000 is not set aside");
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();
        await Task.Delay(1150);

        var startedAt = DateTime.UtcNow.AddSeconds(-1);
        var approvalId = Guid.NewGuid();
        var pushed = await PushAsync(Mukadam, Mutation, "bill1-a-approve", Approve(Cost, FarmA, 1, approvalId));
        pushed.Status.Should().Be("applied", "{0}: {1}", pushed.ErrorCode, pushed.ErrorMessage);
        var endedAt = DateTime.UtcNow.AddSeconds(1);

        // The stamp itself: who, when, which version — a separate row, never a column flipped on the bill.
        var stamps = await StampsAsync(Cost);
        stamps.Should().ContainSingle();
        var stamp = stamps[0];
        Output.WriteLine($"[EVIDENCE] stamp id={stamp.Id} by={stamp.By} at={stamp.At:O} version={stamp.Version}");
        stamp.Id.Should().Be(approvalId, "the phone's own id: a re-sent approval is the same stamp");
        stamp.By.Should().Be(Mukadam);
        stamp.Version.Should().Be(1);
        stamp.At.Should().BeOnOrAfter(startedAt).And.BeOnOrBefore(endedAt);

        // The pull, from the phone's own whole-second cursor: the bill comes again, now with its stamp.
        var (body, later) = await PullAsync(Owner, cursor);
        Keep("owner-pull-after-approval", body);
        var row = Bill(later, Cost);
        row.GetProperty("billVersion").GetInt32().Should().Be(1);
        var approval = row.GetProperty("approval");
        approval.GetProperty("approvedByUserId").GetGuid().Should().Be(Mukadam);
        approval.GetProperty("approvedByName").GetString().Should().Be(MukadamName, "the stamp says who, by name");
        approval.GetProperty("approvedAtUtc").GetDateTime().ToUniversalTime().Should().BeCloseTo(stamp.At, TimeSpan.FromSeconds(1));
        approval.GetProperty("billVersion").GetInt32().Should().Be(1, "which version he saw");

        // The same person approving the same version again (a retry from another door) is still ONE stamp.
        (await PostAsync(Mukadam, Route(Cost), new { billVersion = 1 })).Status.Should().Be(HttpStatusCode.OK);
        (await StampsAsync(Cost)).Should().ContainSingle("one person, one version, one stamp");

        // The primary account holder approves too (REST): a second stamp, his own — "which bills you personally checked".
        var (rest, restBody) = await PostAsync(Owner, Route(Cost), new { billVersion = 1 });
        rest.Should().Be(HttpStatusCode.OK, restBody);
        Json(restBody).GetProperty("approval").GetProperty("approvedByUserId").GetGuid().Should().Be(Owner);
        (await StampsAsync(Cost)).Select(s => s.By).Should().BeEquivalentTo([Mukadam, Owner]);

        // Append-only by privilege: the app role can neither rewrite nor delete a stamp.
        foreach (var sql in new[]
                 {
                     "UPDATE ssf.cost_entry_approvals SET bill_version = 9 WHERE cost_entry_id = @id",
                     "DELETE FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id",
                 })
        {
            (await AppRoleRefusesAsync(sql, Cost)).Should().Be("42501", $"{sql} must be refused by privilege");
        }
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task B_a_seat_without_review_money_is_refused_and_sees_the_stamp_only_where_it_may_see_the_bill()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The मुकादम SEES money but may not review it; the सहमालक's money is switched off; the कामगार reads his own.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney);
        await PushAppliedAsync(Worker, "add_cost_entry", "bill1-b-worker-bill", CostPayload(WorkerBill, FarmA, PlotA, CycleA, WorkerAmount));
        await Task.Delay(1150);

        foreach (var who in new[] { Mukadam, CoOwner, Worker })
        {
            var pushed = await PushAsync(who, Mutation, $"bill1-b-{who:N}", Approve(Cost, FarmA, 1));
            pushed.Status.Should().NotBe("applied");
            // fix round 1 (review H1): the कामगार's seat reads only his own money, so another person's bill is not there for
            // him (not found, as a bill of another farm); the others see it and lack the authority (a visible refusal).
            var mayNotSeeIt = who == Worker;
            pushed.ErrorCode.Should().Be(mayNotSeeIt ? "ShramSafal.CostEntryNotFound" : "ShramSafal.Forbidden");

            var (rest, restBody) = await PostAsync(who, Route(Cost), new { billVersion = 1 });
            rest.Should().Be(mayNotSeeIt ? HttpStatusCode.NotFound : HttpStatusCode.Forbidden, restBody);
            restBody.Should().NotContain("9876.54");

            // Not even his own bill: approving is the review-money authority, never the maker's.
            (await PushAsync(who, Mutation, $"bill1-b-own-{who:N}", Approve(WorkerBill, FarmA, 1))).Status.Should().NotBe("applied");
        }

        (await PushAsync(Mukadam, Mutation, "bill1-b-mukadam-code", Approve(Cost, FarmA, 1))).ErrorCode
            .Should().Be("ShramSafal.Forbidden", "he sees the bill; only the authority is missing");
        (await StampsAsync(Cost)).Should().BeEmpty("nothing was written");
        (await StampsAsync(WorkerBill)).Should().BeEmpty();

        // The owner approves both bills.
        await PushAppliedAsync(Owner, Mutation, "bill1-b-owner-cost", Approve(Cost, FarmA, 1));
        await PushAppliedAsync(Owner, Mutation, "bill1-b-owner-worker", Approve(WorkerBill, FarmA, 1));
        await Task.Delay(1150);

        // The कामगार sees the stamp on HIS bill (D-28: his submission and its review status) — and no other bill at all.
        var (workerBody, worker) = await PullAsync(Worker);
        Keep("worker-pull", workerBody);
        var mine = Bill(worker, WorkerBill);
        mine.GetProperty("approval").GetProperty("approvedByUserId").GetGuid().Should().Be(Owner);
        mine.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(1);
        IdsOf(worker, "costEntries").Should().NotContain(Cost, "another person's money never reaches an own-records seat");

        // The सहमालक without money receives no bill, so no stamp either.
        var (coOwnerBody, coOwner) = await PullAsync(CoOwner);
        IdsOf(coOwner, "costEntries").Should().NotContain([Cost, WorkerBill]);
        coOwnerBody.Should().NotContain("9876.54").And.NotContain("678.91");

        // The मुकादम who sees money sees the stamp, and may still not give one.
        var (_, mukadam) = await PullAsync(Mukadam);
        Bill(mukadam, Cost).GetProperty("approval").GetProperty("approvedByUserId").GetGuid().Should().Be(Owner);
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task C_a_reviewer_outside_the_bills_plots_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AddSecondPlotAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await PushAppliedAsync(Owner, "add_cost_entry", "bill1-c-plot-two", CostPayload(PlotTwoBill, FarmA, PlotTwo, CycleTwo, PlotTwoAmount));
        await PushAppliedAsync(Owner, "add_cost_entry", "bill1-c-whole-farm", WholeFarmPayload(WholeFarmBill, PlotTwoAmount + 1));
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { PlotA } }))
        {
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        await Task.Delay(1150);

        // A bill on a plot he does not cover, and the farm's shared bill someone else made: his pull never sends them, so to
        // this door they are not there (fix round 1, review H1: not found, exactly as a bill of another farm), push and REST.
        foreach (var bill in new[] { PlotTwoBill, WholeFarmBill })
        {
            var pushed = await PushAsync(Mukadam, Mutation, $"bill1-c-{bill:N}", Approve(bill, FarmA, 1));
            Output.WriteLine($"[EVIDENCE] chosen-plots reviewer approves {bill} -> {pushed.Status} {pushed.ErrorCode}");
            pushed.Status.Should().NotBe("applied");
            // The push's own place gate (MU-4, every kind of change) answers a chosen-plots seat first, with the plot rule's
            // code; the door itself answers "not found" (REST below). Neither carries a figure or a version.
            pushed.ErrorCode.Should().Be("ShramSafal.PlotScope.Forbidden");
            JsonSerializer.Serialize(pushed).Should().NotContain("4321.09");
            var (rest, restBody) = await PostAsync(Mukadam, Route(bill), new { billVersion = 1 });
            rest.Should().Be(HttpStatusCode.NotFound, restBody);
            restBody.Should().NotContain("4321.09").And.NotContain("billVersion");
            (await StampsAsync(bill)).Should().BeEmpty();
        }

        // His OWN bill on a plot he does not cover: he sees it (D-28), and the write rule refuses its approval.
        var ownElsewhere = Guid.Parse("b1110000-0000-4000-8000-000000000005");
        await PushAppliedAsync(Owner, "add_cost_entry", "bill1-c-own-elsewhere-seed", CostPayload(ownElsewhere, FarmA, PlotTwo, CycleTwo, 777.12m));
        await ExecOnSuperuserAsync("""UPDATE ssf.cost_entries SET created_by_user_id = @m WHERE "Id" = @id""", ("m", Mukadam), ("id", ownElsewhere));
        var own = await PushAsync(Mukadam, Mutation, "bill1-c-own-elsewhere", Approve(ownElsewhere, FarmA, 1));
        own.ErrorCode.Should().Be("ShramSafal.PlotScope.Forbidden");
        (await PostAsync(Mukadam, Route(ownElsewhere), new { billVersion = 1 })).Status.Should().Be(HttpStatusCode.Forbidden);

        // A bill on his plot: his to approve.
        await PushAppliedAsync(Mukadam, Mutation, "bill1-c-plot-a", Approve(Cost, FarmA, 1));
        (await StampsAsync(Cost)).Should().ContainSingle();
    }

    // ── D ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task D_another_farms_bill_is_invisible_and_unapprovable_both_ways()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, Mutation, "bill1-d-a", Approve(Cost, FarmA, 1));
        await PushAppliedAsync(OwnerB, Mutation, "bill1-d-b", Approve(CostB, FarmB, 1));

        // Writes, both directions, through push and REST, and with the payload naming either farm.
        foreach (var (who, bill, farm) in new[]
                 {
                     (OwnerB, Cost, FarmA), (OwnerB, Cost, FarmB), (Owner, CostB, FarmB), (Owner, CostB, FarmA),
                 })
        {
            var pushed = await PushAsync(who, Mutation, $"bill1-d-{who:N}-{bill:N}-{farm:N}", Approve(bill, farm, 1));
            pushed.Status.Should().NotBe("applied", "{0} may not approve {1}", who, bill);
            ((pushed.ErrorCode ?? string.Empty).EndsWith("NotFound", StringComparison.Ordinal) || (pushed.ErrorCode ?? string.Empty).EndsWith("Forbidden", StringComparison.Ordinal))
                .Should().BeTrue("a foreign bill is not found or forbidden, never applied: {0}", pushed.ErrorCode);
            (await PostAsync(who, Route(bill), new { billVersion = 1 })).Status.Should().NotBe(HttpStatusCode.OK);
        }

        (await StampsAsync(Cost)).Select(s => s.By).Should().Equal([Owner], "farm B's owner wrote nothing on farm A");
        (await StampsAsync(CostB)).Select(s => s.By).Should().Equal([OwnerB], "and the other way round");

        // Reads, both directions.
        var (ownerBody, owner) = await PullAsync(Owner);
        IdsOf(owner, "costEntries").Should().NotContain(CostB);
        ownerBody.Should().NotContain(CostB.ToString()).And.NotContain("5555.67");
        var (ownerBBody, ownerB) = await PullAsync(OwnerB);
        IdsOf(ownerB, "costEntries").Should().NotContain(Cost);
        ownerBBody.Should().NotContain(Cost.ToString()).And.NotContain(OwnerName, "farm A's approver is never named to farm B");
        Bill(ownerB, CostB).GetProperty("approval").GetProperty("approvedByUserId").GetGuid().Should().Be(OwnerB);
    }

    // ── E ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task E_approving_a_stale_version_is_refused_and_the_new_version_is_approvable()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);

        // The owner corrects the bill while the मुकादम still looks at version 1.
        await PushAppliedAsync(Owner, "correct_cost_entry", "bill1-e-correct", Correct(Cost, CostCorrected));

        var stale = await PushAsync(Mukadam, Mutation, "bill1-e-stale", Approve(Cost, FarmA, 1));
        Output.WriteLine($"[EVIDENCE] approval of version 1 after a correction -> {stale.Status} {stale.ErrorCode}");
        stale.Status.Should().NotBe("applied");
        stale.ErrorCode.Should().Be(VersionConflict, "the L4b exact-version code: the phone shows the new version");
        var (rest, restBody) = await PostAsync(Mukadam, Route(Cost), new { billVersion = 1 });
        rest.Should().Be(HttpStatusCode.Conflict, restBody);
        Json(restBody).GetProperty("error").GetString().Should().Be(VersionConflict);
        Json(restBody).GetProperty("billVersion").GetInt32().Should().Be(2, "the answer names the version to look at");
        (await StampsAsync(Cost)).Should().BeEmpty("a stale approval leaves no stamp");

        // The new version reaches his phone, and that one is approvable.
        await Task.Delay(1150);
        var (_, pulled) = await PullAsync(Mukadam);
        Bill(pulled, Cost).GetProperty("billVersion").GetInt32().Should().Be(2);
        await PushAppliedAsync(Mukadam, Mutation, "bill1-e-fresh", Approve(Cost, FarmA, 2));
        (await StampsAsync(Cost)).Select(s => s.Version).Should().Equal([2]);

        // A missing or nonsensical version is the command's shape: refused, never read as "the current one".
        foreach (var version in new object?[] { null, 0, -1 })
        {
            var payload = Approve(Cost, FarmA, 1);
            payload["billVersion"] = version;
            (await PushAsync(Mukadam, Mutation, $"bill1-e-bad-{version ?? "null"}", payload)).Status.Should().NotBe("applied");
        }
    }

    // ── F ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task F_a_correction_after_approval_makes_the_stamp_read_as_for_an_older_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Owner, Mutation, "bill1-f-approve", Approve(Cost, FarmA, 1));
        await PushAppliedAsync(Owner, "correct_cost_entry", "bill1-f-correct", Correct(Cost, CostCorrected));
        await Task.Delay(1150);

        var (body, pulled) = await PullAsync(Owner);
        Keep("owner-pull-after-correction", body);
        var row = Bill(pulled, Cost);
        row.GetProperty("billVersion").GetInt32().Should().Be(2, "the correction made a new version");
        row.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(1, "the stamp names the version it was for");
        row.GetProperty("amount").GetDecimal().Should().Be(CostAmount, "the bill's first figure is kept (P3)");
        ArrayOf(pulled, "financeCorrections").Should().Contain(c => c.GetProperty("costEntryId").GetGuid() == Cost
            && c.GetProperty("correctedAmount").GetDecimal() == CostCorrected);

        // Nothing was carried to the new numbers: still the one stamp, still version 1.
        (await StampsAsync(Cost)).Select(s => s.Version).Should().Equal([1]);
    }

    // ── G ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task G_the_review_flag_clears_only_for_the_approved_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // ₹25,000 or more is set aside for review on its first save.
        await PushAppliedAsync(Mukadam, "add_cost_entry", "bill1-g-big", CostPayload(BigBill, FarmA, PlotA, CycleA, BigAmount));
        await Task.Delay(1150);

        var (_, flagged) = await PullAsync(Owner);
        var row = Bill(flagged, BigBill);
        row.GetProperty("needsReview").GetBoolean().Should().BeTrue("तपासायचे");
        row.GetProperty("reviewReason").GetString().Should().Contain("25000");

        var (approved, approvedBody) = await PostAsync(Owner, Route(BigBill), new { billVersion = 1 });
        approved.Should().Be(HttpStatusCode.OK, approvedBody);
        Json(approvedBody).GetProperty("needsReview").GetBoolean().Should().BeFalse("approving clears तपासायचे for that version");
        await Task.Delay(1150);
        Bill((await PullAsync(Owner)).Root, BigBill).GetProperty("needsReview").GetBoolean().Should().BeFalse();

        // A correction makes version 2: the approval was for version 1, so the bill is तपासायचे again.
        await PushAppliedAsync(Owner, "correct_cost_entry", "bill1-g-correct", Correct(BigBill, BigCorrected));
        await Task.Delay(1150);
        var again = Bill((await PullAsync(Owner)).Root, BigBill);
        again.GetProperty("billVersion").GetInt32().Should().Be(2);
        again.GetProperty("needsReview").GetBoolean().Should().BeTrue("the flag clears only for the approved version");
        again.GetProperty("approval").GetProperty("billVersion").GetInt32().Should().Be(1);

        await PushAppliedAsync(Owner, Mutation, "bill1-g-approve-2", Approve(BigBill, FarmA, 2));
        await Task.Delay(1150);
        Bill((await PullAsync(Owner)).Root, BigBill).GetProperty("needsReview").GetBoolean().Should().BeFalse();

        // The server's flag itself is history, never erased (P3): the stamp is what cleared it.
        (await CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id AND is_flagged", BigBill)).Should().Be(1);
    }

    // ── H ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H_the_bill_row_keeps_every_field_1_0_17_reads_and_no_flag_field_it_would_act_on()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PushAppliedAsync(Mukadam, "add_cost_entry", "bill1-h-big", CostPayload(BigBill, FarmA, PlotA, CycleA, BigAmount));
        await PushAppliedAsync(Owner, Mutation, "bill1-h-approve", Approve(Cost, FarmA, 1));

        // The pull as 1.0.17 asks for it (its own version header).
        using var response = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", Owner,
            body: null, appVersion: "1.0.17");
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        var root = Json(body);
        foreach (var id in new[] { Cost, BigBill })
        {
            var row = Bill(root, id);
            // 1.0.17's financeService reads these: present and unchanged.
            row.GetProperty("id").GetGuid().Should().Be(id);
            row.GetProperty("farmId").GetGuid().Should().Be(FarmA);
            row.GetProperty("categoryId").GetString().Should().Be("fertilizer");
            row.GetProperty("isCorrected").GetBoolean().Should().BeFalse();
            // N2 (OF-M re-check 1): a flag 1.0.17 can read would show its Approve button, which can only fail. The new
            // fields have names it does not read.
            row.TryGetProperty("isFlagged", out _).Should().BeFalse();
            row.TryGetProperty("flagReason", out _).Should().BeFalse();
        }

        Bill(root, Cost).GetProperty("amount").GetDecimal().Should().Be(CostAmount);
        Bill(root, BigBill).GetProperty("amount").GetDecimal().Should().Be(BigAmount);
    }

    // ── I ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task I_a_correction_in_flight_finishes_first_and_the_approval_then_sees_its_new_version()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Writer 1: a correction of the bill, holding its row and moving its version to 2, not yet committed.
        await using var correction = new NpgsqlConnection(SuperuserConn);
        await correction.OpenAsync();
        await using var tx = await correction.BeginTransactionAsync();
        await using (var hold = correction.CreateCommand())
        {
            hold.Transaction = tx;
            hold.CommandText = """
                SELECT 1 FROM ssf.cost_entries WHERE "Id" = @id FOR UPDATE;
                UPDATE ssf.cost_entries SET content_version = content_version + 1, modified_at_utc = now() WHERE "Id" = @id;
                """;
            hold.Parameters.AddWithValue("id", Cost);
            await hold.ExecuteNonQueryAsync();
        }

        // Writer 2: the owner's approval of version 1, sent while writer 1 is in flight.
        var approve = Task.Run(() => PushAsync(Owner, Mutation, "bill1-i-race", Approve(Cost, FarmA, 1)));
        var finishedEarly = await Task.WhenAny(approve, Task.Delay(TimeSpan.FromSeconds(2))) == approve;
        Output.WriteLine($"[EVIDENCE] approval finished while the correction held the bill: {finishedEarly}");

        await tx.CommitAsync();
        var result = await approve;
        Output.WriteLine($"[EVIDENCE] approval -> {result.Status} {result.ErrorCode}");

        finishedEarly.Should().BeFalse("the approval waits for the correction holding the bill");
        result.ErrorCode.Should().Be(VersionConflict, "it then reads version 2, not the version 1 it was sent for");
        (await StampsAsync(Cost)).Should().BeEmpty("no stamp stands on an older version than the one it was checked against");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> Approve(Guid bill, Guid farm, int version, Guid? approvalId = null) => new()
    {
        ["approvalId"] = approvalId ?? Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["farmId"] = farm,
        ["billVersion"] = version,
    };

    private static Dictionary<string, object?> Correct(Guid bill, decimal amount) => new()
    {
        ["financeCorrectionId"] = Guid.NewGuid(),
        ["costEntryId"] = bill,
        ["correctedAmount"] = amount,
        ["currencyCode"] = "INR",
        ["reason"] = "बिल पुन्हा पाहिलं",
    };

    private static Dictionary<string, object?> WholeFarmPayload(Guid id, decimal amount) => new()
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

    private static JsonElement Bill(JsonElement root, Guid id)
    {
        var rows = ArrayOf(root, "costEntries").Where(e => e.GetProperty("id").GetGuid() == id).ToList();
        rows.Should().ContainSingle($"the pull carries bill {id}");
        return rows[0];
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REST] POST {url} by {user} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private void Keep(string name, string body) =>
        Output.WriteLine($"[EVIDENCE] {name}: {body.Length} bytes");

    private async Task AddSecondPlotAsync() =>
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot, @farm, 'प्लॉट दोन', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """, ("plot", PlotTwo), ("cycle", CycleTwo), ("farm", FarmA));

    private sealed record Stamp(Guid Id, Guid By, DateTime At, int Version);

    /// <summary>Every stamp on one bill, oldest first — read as superuser (what is stored, not what a reader may see).</summary>
    private async Task<List<Stamp>> StampsAsync(Guid bill)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var exists = db.CreateCommand();
        exists.CommandText = "SELECT to_regclass('ssf.cost_entry_approvals') IS NOT NULL";
        if (!(bool)(await exists.ExecuteScalarAsync())!)
        {
            return [];
        }

        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", approved_by_user_id, approved_at_utc, bill_version
            FROM ssf.cost_entry_approvals WHERE cost_entry_id = @id ORDER BY approved_at_utc, "Id"
            """;
        cmd.Parameters.AddWithValue("id", bill);
        var stamps = new List<Stamp>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            stamps.Add(new Stamp(reader.GetGuid(0), reader.GetGuid(1), DateTime.SpecifyKind(reader.GetDateTime(2), DateTimeKind.Utc), reader.GetInt32(3)));
        }

        return stamps;
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
    }
}
