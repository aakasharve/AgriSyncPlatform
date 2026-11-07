// spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (the team screens' server items + MU-2's leftover findings N-2..N-6)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Adapters;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d10 lane MU-1 - the same real pipeline as the rest of this class (real tenant scopes and policies, as
/// <c>agrisync_app</c>, E3 first), for: the owner's kept-work read (E4 both ways), F95 (a job card's rate), the plot scope
/// and chosen-plot names on <c>/me/context</c>, PRV REVIEW-4 N-4's window, and MU-2's findings N-2 (lock order), N-3
/// (the clear refusal), N-4 (an erasure's word), N-5 (an assertion that can fail).
/// </summary>
public sealed partial class PersonalInvitationRealPostgresTests
{
    // ── the owner's kept-work card ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task MuOne_kept_work_is_read_by_the_primary_holder_alone_and_one_farm_never_reads_anothers()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAuditRowAsync(FarmA, "WorkKeptForOwner", "RefusedSyncMutation", MukadamA, daysAgo: 1,
            """{"mutationType":"add_cost_entry","refusal":"ShramSafal.Forbidden","mutation":{"amount":98765.5,"note":"TOP-SECRET-NOTE"}}""");
        await SeedAuditRowAsync(FarmA, "AcceptedAfterResponsibilityEnded", "AttendanceMark", MukadamA, daysAgo: 2,
            """{"authority":"TakeAttendance","authorityEndedAtUtc":"2026-11-05T10:00:00Z"}""");
        await SeedAuditRowAsync(FarmA, "WorkKeptForOwner", "RefusedSyncMutation", MukadamA, daysAgo: 90,
            """{"mutationType":"older_than_the_window","refusal":"x"}""");
        await SeedAuditRowAsync(FarmB, "WorkKeptForOwner", "RefusedSyncMutation", OwnerB, daysAgo: 1,
            """{"mutationType":"farm_b_only","refusal":"y"}""");
        await SeedAuditRowAsync(FarmA, "SomeOtherAction", "X", MukadamA, daysAgo: 1, "{}");

        // The primary holder: this farm's two kept items, newest first, in words the phone can draw - no body of the work.
        using var mine = await GetAsync($"/shramsafal/farms/{FarmA}/kept-work", OwnerA);
        var text = await mine.Content.ReadAsStringAsync();
        mine.StatusCode.Should().Be(HttpStatusCode.OK, text);
        var items = JsonDocument.Parse(text).RootElement.EnumerateArray().ToList();
        items.Select(i => i.GetProperty("kind").GetString()).Should().Equal("refused", "arrived_late");
        items[0].GetProperty("what").GetString().Should().Be("add_cost_entry");
        items[0].GetProperty("why").GetString().Should().Be("ShramSafal.Forbidden");
        items[0].GetProperty("whoName").GetString().Should().Be("Gopal");
        items[1].GetProperty("why").GetString().Should().Be("TakeAttendance");
        text.Should().NotContain("TOP-SECRET-NOTE").And.NotContain("98765").And.NotContain("farm_b_only")
            .And.NotContain("older_than_the_window");

        // E4, the other way: nobody else reads it - a सहमालक, a मुकादम, a worker, a person on no seat, and the OTHER farm's owner.
        foreach (var other in new[] { CoOwnerA, MukadamA, OldWorkerA, Stranger, OwnerB })
        {
            using var refused = await GetAsync($"/shramsafal/farms/{FarmA}/kept-work", other);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{other} is not this farm's primary holder");
            (await refused.Content.ReadAsStringAsync()).Should().NotContain("add_cost_entry");
        }

        // E4, the first way: farm B's owner reads farm B's own, and farm A's owner reads nothing of farm B.
        using var farmB = await GetAsync($"/shramsafal/farms/{FarmB}/kept-work", OwnerB);
        farmB.StatusCode.Should().Be(HttpStatusCode.OK);
        var bText = await farmB.Content.ReadAsStringAsync();
        bText.Should().Contain("farm_b_only").And.NotContain("add_cost_entry");
        using var aOnB = await GetAsync($"/shramsafal/farms/{FarmB}/kept-work", OwnerA);
        aOnB.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── F95: a job card names a rate ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task MuOne_F95_a_job_card_is_written_only_by_a_seat_that_holds_review_money_never_by_a_label()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var card = new
        {
            farmId = FarmA,
            plotId = PlotA1,
            plannedDate = "2026-11-10",
            lineItems = new[] { new { activityType = "spray", expectedHours = 4m, ratePerHourAmount = 50m, ratePerHourCurrencyCode = "INR", notes = (string?)null } },
        };

        // A मुकादम and a सहमालक by LABEL alone write no rate.
        foreach (var label in new[] { MukadamA, CoOwnerA })
        {
            using var refused = await PostAsync("/shramsafal/job-cards", label, card);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a label grants nothing (F95)");
        }

        // Review money WITHOUT see money (a bit stored alone) is not held either: it needs money.
        await ExecSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = @p WHERE farm_id = @f AND user_id = @u",
            ("p", 1 << 10), ("f", FarmA), ("u", MukadamA));
        using (var alone = await PostAsync("/shramsafal/job-cards", MukadamA, card))
        {
            alone.StatusCode.Should().Be(HttpStatusCode.Forbidden, "review money needs see money");
        }

        // With both stored, the same मुकादम may; so may the primary holder with nothing stored.
        await ExecSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = @p WHERE farm_id = @f AND user_id = @u",
            ("p", (1 << 10) | 1), ("f", FarmA), ("u", MukadamA));
        using (var allowed = await PostAsync("/shramsafal/job-cards", MukadamA, card))
        {
            allowed.StatusCode.Should().Be(HttpStatusCode.Created, await allowed.Content.ReadAsStringAsync());
        }

        using var owner = await PostAsync("/shramsafal/job-cards", OwnerA, card);
        owner.StatusCode.Should().Be(HttpStatusCode.Created, await owner.Content.ReadAsStringAsync());

        // A कामगार seat never writes one even with the bits stored: they do nothing on a seat that reads only its own work.
        await ExecSuperuserAsync("UPDATE ssf.farm_memberships SET permissions = @p WHERE farm_id = @f AND user_id = @u",
            ("p", (1 << 10) | 1), ("f", FarmA), ("u", OldWorkerA));
        using var worker = await PostAsync("/shramsafal/job-cards", OldWorkerA, card);
        worker.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── /me/context: plot scope and chosen plot names ────────────────────────────────────────────

    [Fact]
    public async Task MuOne_me_context_carries_each_seats_plot_scope_and_the_names_of_its_chosen_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecSuperuserAsync("""
            UPDATE ssf.farm_memberships SET plot_scope = 'ChosenPlots', scope_plot_ids = ARRAY[@p1, @p2]::uuid[]
             WHERE farm_id = @f AND user_id = @u;
            UPDATE ssf.farm_memberships SET plot_scope = 'OwnWork' WHERE farm_id = @f AND user_id = @w;
            """, ("p1", PlotA2), ("p2", PlotA1), ("f", FarmA), ("u", MukadamA), ("w", OldWorkerA));

        async Task<global::User.Application.Ports.FarmMembershipSnapshot> SeatOf(Guid who)
        {
            await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
            await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(_superuserConn).Options);
            var farms = await new FarmMembershipSnapshotReader(ssf, accounts, new SystemClockForTests()).GetForUserAsync(new UserId(who));
            return farms.Single(f => f.FarmId == new FarmId(FarmA));
        }

        var chosen = await SeatOf(MukadamA);
        chosen.PlotScope.Should().Be("ChosenPlots");
        chosen.PlotNames.Should().BeEquivalentTo(["प्लॉट 1", "प्लॉट 2"], "the names, read inside his own user scope");
        (await SeatOf(OldWorkerA)).PlotScope.Should().Be("OwnWork");
        (await SeatOf(OldWorkerA)).PlotNames.Should().BeEmpty();
        var owner = await SeatOf(OwnerA);
        owner.PlotScope.Should().Be("AllPlots", "the primary account holder always covers every plot");
        owner.PlotNames.Should().BeEmpty();
        (await SeatOf(CoOwnerA)).PlotScope.Should().Be("AllPlots");
    }

    // ── PRV REVIEW-4 N-4: the days to rule are read inside a window ─────────────────────────────

    [Fact]
    public async Task MuOne_N4_a_bounded_read_of_the_farms_notes_takes_only_the_window_newest_first_and_at_most_the_limit()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAuditRowAsync(FarmA, "AttendanceRestrictedDisagreement", "AttendanceMark", OwnerA, daysAgo: 400, "{}");
        await SeedAuditRowAsync(FarmA, "AttendanceRestrictedDisagreement", "AttendanceMark", OwnerA, daysAgo: 3, """{"n":3}""");
        await SeedAuditRowAsync(FarmA, "AttendanceRestrictedDisagreement", "AttendanceMark", OwnerA, daysAgo: 1, """{"n":1}""");
        await SeedAuditRowAsync(FarmB, "AttendanceRestrictedDisagreement", "AttendanceMark", OwnerB, daysAgo: 1, """{"n":"farm b"}""");

        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
        var repository = new ShramSafalRepository(db);
        var windowed = await RlsIdentityScope.RunAsFarmAsync(db, FarmA, AccountA, OwnerA,
            token => repository.GetAuditEventsForFarmByActionsAsync(
                FarmA, ["AttendanceRestrictedDisagreement"], DateTime.UtcNow.AddDays(-90), 10, token));
        windowed.Should().HaveCount(2, "the 400-day-old note is outside a 90-day window; farm B's is another farm's");
        windowed.Select(r => r.OccurredAtUtc).Should().BeInDescendingOrder();
        windowed.Should().OnlyContain(r => r.FarmId == FarmA);

        var limited = await RlsIdentityScope.RunAsFarmAsync(db, FarmA, AccountA, OwnerA,
            token => repository.GetAuditEventsForFarmByActionsAsync(
                FarmA, ["AttendanceRestrictedDisagreement"], DateTime.UtcNow.AddDays(-90), 1, token));
        limited.Should().ContainSingle().Which.Payload.Should().Contain("\"n\":1", "the newest one");
    }

    // ── N-2: one lock order ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MuOne_N2_accepting_an_invitation_locks_the_seat_before_the_invitation_the_owners_approve_order()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invitationId = await MakeWaitingRequestAndInvitationAsync();

        // Hold the seat's row lock from outside, as the owner's approve does between its two writes.
        await using var holder = new NpgsqlConnection(_superuserConn);
        await holder.OpenAsync();
        await using var holderTx = await holder.BeginTransactionAsync();
        await ExecAsync(holder, "SELECT 1 FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u FOR UPDATE",
            ("f", FarmA), ("u", Joiner));

        var accept = PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId });
        try
        {
            // The accept must reach the seat lock and WAIT there.
            var waiting = false;
            for (var i = 0; i < 100 && !waiting; i++)
            {
                await Task.Delay(50);
                waiting = await ScalarSuperuserAsync<long>(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()") > 0;
            }

            waiting.Should().BeTrue("the accept waits for the seat");

            // The invitation's row is NOT locked by it yet: the old order (invitation first, seat second) fails right here.
            await using var probe = new NpgsqlConnection(_superuserConn);
            await probe.OpenAsync();
            await using var probeTx = await probe.BeginTransactionAsync();
            var probing = async () => await ExecAsync(probe,
                "SELECT 1 FROM ssf.farm_personal_invitations WHERE id = @id FOR UPDATE NOWAIT", ("id", invitationId));
            await probing.Should().NotThrowAsync("one lock order with the owner's approve: seat first, invitation second (MU-2 review N-2)");
            await probeTx.RollbackAsync();
        }
        finally
        {
            await holderTx.RollbackAsync();
        }

        using var answered = await accept;
        answered.StatusCode.Should().Be(HttpStatusCode.OK, await answered.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task MuOne_N2_an_approve_and_an_accept_in_the_same_moment_never_answer_a_server_error()
    {
        await AssertAppRoleIsNotVacuousAsync();
        for (var round = 0; round < 6; round++)
        {
            var invitationId = await MakeWaitingRequestAndInvitationAsync();
            var start = new TaskCompletionSource();
            async Task<HttpStatusCode> Run(Func<Task<HttpResponseMessage>> call)
            {
                await start.Task;
                using var response = await call();
                return response.StatusCode;
            }

            var approve = Run(() => PostAsync($"/shramsafal/farms/{FarmA}/memberships/{Joiner}/approve", OwnerA, new { role = "Worker" }));
            var accept = Run(() => PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId }));
            start.SetResult();
            var codes = await Task.WhenAll(approve, accept);
            codes.Should().OnlyContain(c => (int)c < 500, $"round {round}: no deadlock may reach the person as a 500");

            // The person ends up let in exactly once, whichever came first.
            (await ScalarSuperuserAsync<long>(
                "SELECT count(*) FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u AND status = 3",
                ("f", FarmA), ("u", Joiner))).Should().Be(1);
            await ExecSuperuserAsync("""
                DELETE FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u;
                DELETE FROM ssf.farm_personal_invitations WHERE farm_id = @f;
                """, ("f", FarmA), ("u", Joiner));
        }
    }

    // ── N-3 ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MuOne_N3_review_money_on_a_worker_invitation_is_refused_with_its_own_clear_code()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var body = new
        {
            label = "Worker",
            plotScope = "OwnWork",
            authorities = new object[] { new { name = "ReviewMoney" }, new { name = "SeeMoney" } },
        };
        using var refused = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, body);
        var text = await refused.Content.ReadAsStringAsync();
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
        JsonDocument.Parse(text).RootElement.GetProperty("error").GetString().Should().Be("invitation.authority_does_nothing");

        // Review money alone (its need stripped by the phone) is refused for the same reason, not as "needs see money".
        using var alone = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, new
        {
            label = "Worker",
            plotScope = "OwnWork",
            authorities = new object[] { new { name = "ReviewMoney" } },
        });
        JsonDocument.Parse(await alone.Content.ReadAsStringAsync()).RootElement.GetProperty("error").GetString()
            .Should().Be("invitation.authority_does_nothing");

        // Control: a सहमालक on every plot may be given both.
        await CreateAsync(OwnerA, FarmA, new
        {
            label = "CoOwner",
            plotScope = "AllPlots",
            authorities = new object[] { new { name = "SeeMoney" }, new { name = "ReviewMoney" } },
        });
        (await CountInvitationsAsync(FarmA)).Should().Be(1);
    }

    // ── N-4 ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MuOne_N4_an_invitation_ended_by_an_erasure_says_so_and_one_the_owner_took_back_does_not()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var forErased = await SeedInvitationAsync(FarmA, "Waiting", JoinerPhone, createdDaysAgo: 1, endedDaysAgo: null);
        var takenBack = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        using (var withdrawn = await PostAsync(
            $"/shramsafal/farms/{FarmA}/personal-invitations/{takenBack.GetProperty("id").GetGuid()}/withdraw", OwnerA, new { }))
        {
            withdrawn.StatusCode.Should().Be(HttpStatusCode.OK, await withdrawn.Content.ReadAsStringAsync());
        }

        await ExecSuperuserAsync("""
            INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
            VALUES (@id, @u, NULL, 0, NOW() - INTERVAL '31 days');
            """, ("id", Guid.NewGuid()), ("u", Joiner));
        await RunErasurePassAsync();

        (await SentRowAsync(OwnerA, FarmA, forErased)).GetProperty("personErased").GetBoolean().Should().BeTrue();
        var owners = await SentRowAsync(OwnerA, FarmA, takenBack.GetProperty("id").GetGuid());
        owners.GetProperty("status").GetString().Should().Be("Withdrawn");
        owners.GetProperty("personErased").GetBoolean().Should().BeFalse("the owner took that one back himself");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>A QR request waiting for the owner AND a named invitation for the same person, as MU-2's M-1 sets them.</summary>
    private async Task<Guid> MakeWaitingRequestAndInvitationAsync()
    {
        var made = await CreateAsync(OwnerA, FarmA, Grant("CoOwner", JoinerPhone));
        using var issued = await PostAsync($"/shramsafal/farms/{FarmA}/invite-qr", OwnerA, new { });
        using var invite = JsonDocument.Parse(await issued.Content.ReadAsStringAsync());
        using var scan = await PostAsync("/shramsafal/join/claim", Joiner, new
        {
            token = invite.RootElement.GetProperty("token").GetString(),
            farmCode = invite.RootElement.GetProperty("farmCode").GetString(),
            acceptsJoinRequest = true,
        });
        scan.StatusCode.Should().Be(HttpStatusCode.OK, await scan.Content.ReadAsStringAsync());
        return made.GetProperty("id").GetGuid();
    }

    private Task SeedAuditRowAsync(Guid farm, string action, string entityType, Guid actor, int daysAgo, string payloadJson)
        => ExecSuperuserAsync("""
            INSERT INTO ssf.audit_events
                ("Id", entity_type, entity_id, action, actor_user_id, actor_role, payload,
                 farm_id, occurred_at_utc, app_version, device_id, ip_hash)
            VALUES (@id, @type, @entity, @action, @actor, 'worker', @payload,
                    @farm, NOW() - make_interval(days => @days::int), 'test', 'device-test', 'sha256:test');
            """,
            ("id", Guid.NewGuid()), ("type", entityType), ("entity", Guid.NewGuid()), ("action", action), ("actor", actor),
            ("payload", payloadJson), ("farm", farm), ("days", daysAgo));

    private sealed class SystemClockForTests : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }
}
