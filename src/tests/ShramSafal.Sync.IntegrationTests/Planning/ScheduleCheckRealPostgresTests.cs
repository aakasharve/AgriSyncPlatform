// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A Task 3 ("who may check").
//
// A schedule check is a ShramSafal PLATFORM act (founder D-74, L8-R): an append-only server record of who, when and which
// version. Platform Owner and Platform Employee may check; the Platform Analyst only reads; an FPO owner, a farm's primary
// owner and a farm seat with AppRole.Agronomist hold nothing. The database grants the app role no UPDATE / DELETE on the table
// (E4), and the audit row holds no note and no activity names. Real Postgres as agrisync_app (E3 first), through the real host.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using System.Threading;
using Npgsql;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleCheckRealPostgresTests(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    [Fact]
    public async Task Only_a_platform_seat_that_holds_the_review_module_may_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        var all = ActivityIdsOf(row);

        // Platform Owner 200.
        var owner = await CheckAsync(PlatformOwner, row.Id, "Approved", all);
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);
        Json(owner.Body).GetProperty("state").GetString().Should().Be("Checked");

        // Platform Employee 200.
        var employee = await CheckAsync(PlatformEmployee, row.Id, "Returned", note: "day 41 irrigation looks too early");
        employee.Status.Should().Be(HttpStatusCode.OK, employee.Body);

        // Everyone else 403, and nothing more is written.
        var kept = (await ChecksAsync()).Count;
        kept.Should().Be(2);
        foreach (var (who, name) in new[]
                 {
                     (PlatformAnalyst, "Platform Analyst (reads only)"),
                     (PlatformAuditor, "Platform Auditor"),
                     (FpoOwner, "FPO Owner"),
                     (Owner, "a farm's primary owner"),
                     (CoOwner, "a farm's co-owner"),
                     (AgronomistSeat, "a farm seat with AppRole.Agronomist"),
                     (Worker, "a farm worker"),
                 })
        {
            var refused = await CheckAsync(who, row.Id, "Approved", all);
            refused.Status.Should().Be(HttpStatusCode.Forbidden, $"{name} holds no platform review seat: {refused.Body}");
        }

        // Also with the farm role carried in the token (what a real farm owner's JWT has), and an unknown id is not found.
        var withRole = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{row.Id}/check", Owner,
            new { decision = "Approved", checkedActivityIds = all, checkerDisplayName = DisplayName }, globalRole: "PrimaryOwner");
        withRole.Status.Should().Be(HttpStatusCode.Forbidden);
        var asAgronomist = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{row.Id}/check", AgronomistSeat,
            new { decision = "Approved", checkedActivityIds = all, checkerDisplayName = DisplayName }, globalRole: "Agronomist");
        asAgronomist.Status.Should().Be(HttpStatusCode.Forbidden);
        (await CheckAsync(PlatformOwner, Guid.NewGuid(), "Approved", all)).Status.Should().Be(HttpStatusCode.NotFound);

        (await ChecksAsync()).Count.Should().Be(kept, "a refused check leaves no record");
    }

    [Fact]
    public async Task The_checker_is_the_caller_and_never_a_field_the_client_sends()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();

        // A body that tries to name another checker is simply not read: the record carries the authenticated caller.
        var (status, body) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{row.Id}/check", PlatformEmployee, new
        {
            decision = "Approved",
            checkedActivityIds = ActivityIdsOf(row),
            checkerDisplayName = DisplayName,
            checkerUserId = PlatformOwner,
            checker_user_id = PlatformOwner,
            agronomistApproved = true,
        });
        status.Should().Be(HttpStatusCode.OK, body);

        var kept = (await ChecksAsync(row.Id)).Single();
        kept.Checker.Should().Be(PlatformEmployee);
        kept.Display.Should().Be(DisplayName);
        kept.Version.Should().Be(1);
        kept.Decision.Should().Be("Approved");
        kept.Ticked.OrderBy(i => i).Should().Equal(ActivityIdsOf(row).OrderBy(i => i), "Approve records every row he ticked (R4)");
    }

    [Fact]
    public async Task Approve_needs_every_row_and_Return_and_Withdraw_need_a_reason()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        var all = ActivityIdsOf(row);

        var missing = await CheckAsync(PlatformOwner, row.Id, "Approved", all.Skip(1));
        missing.Status.Should().Be(HttpStatusCode.BadRequest, missing.Body);
        ErrorCode(missing.Body).Should().Be("ShramSafal.ScheduleCheckNotAllRows");

        foreach (var decision in new[] { "Returned", "Withdrawn" })
        {
            var noReason = await CheckAsync(PlatformOwner, row.Id, decision, note: "  ");
            noReason.Status.Should().Be(HttpStatusCode.BadRequest, noReason.Body);
            ErrorCode(noReason.Body).Should().Be("ShramSafal.ScheduleCheckNoteRequired");
        }

        (await CheckAsync(PlatformOwner, row.Id, "Maybe", all)).Status.Should().Be(HttpStatusCode.BadRequest);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", all, display: " ")).Status.Should().Be(HttpStatusCode.BadRequest);
        (await ChecksAsync()).Should().BeEmpty("a refused check leaves no record");

        (await CheckAsync(PlatformOwner, row.Id, "Approved", all)).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, row.Id, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);
        (await ChecksAsync(row.Id)).Select(c => c.Decision).Should().Equal("Approved", "Withdrawn");
    }

    [Fact]
    public async Task A_private_copy_of_a_farmer_is_not_a_library_row_to_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var private_ = await SeedStoredRowAsync("Grapes - a farmer's private", TenantScope.Private, maker: Owner);

        var answer = await CheckAsync(PlatformOwner, private_.Id, "Approved", ActivityIdsOf(private_));

        answer.Status.Should().Be(HttpStatusCode.NotFound, "ShramSafal checks the shared library, not a farmer's own copy");
        (await ChecksAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task The_latest_decision_shows_in_the_farmers_library_and_an_edited_copy_starts_NotChecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);

        var checkedRow = RowOf(await LibraryAsync(Owner), row.Id)!.Value.GetProperty("check");
        checkedRow.GetProperty("state").GetString().Should().Be("Checked");
        checkedRow.GetProperty("checkerDisplayName").GetString().Should().Be(DisplayName);
        checkedRow.GetProperty("checkedAtUtc").ValueKind.Should().Be(JsonValueKind.String);

        // The schedule is edited later (copy-on-write, through the production domain rule): the old row keeps its check,
        // the new row is NotChecked. (The routes' own edit gate is L8b-1's and is not changed here.)
        var edited = Guid.NewGuid();
        await using (var db = NewSuperuserContext())
        {
            var source = await db.ScheduleTemplates.Include(t => t.Activities).Include(t => t.StageRows).SingleAsync(t => t.Id == row.Id);
            db.ScheduleTemplates.Add(source.EditCopyOnWrite(edited, "Grapes - University Schedule (rev 2)", null, new AgriSync.SharedKernel.Contracts.Ids.UserId(PlatformOwner), DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        var library = await LibraryAsync(Owner);
        RowOf(library, row.Id)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        var copy = RowOf(library, edited)!.Value;
        copy.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        copy.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue("the copy carries the stored days");
        copy.GetProperty("rowVersionTag").GetString().Should().Be("v2");

        // Then a Withdrawn decision is the latest word for the first row.
        (await CheckAsync(PlatformEmployee, row.Id, "Withdrawn", note: "the source was revised")).Status.Should().Be(HttpStatusCode.OK);
        RowOf(await LibraryAsync(Owner), row.Id)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Withdrawn");
    }

    [Fact]
    public async Task UPDATE_and_DELETE_on_the_check_table_are_refused_to_the_app_role()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);

        // The effective privileges (has_table_privilege follows role membership, which a REVOKE alone cannot remove).
        await using var app = new NpgsqlConnection(AppConn);
        await app.OpenAsync();
        foreach (var privilege in new[] { "UPDATE", "DELETE", "TRUNCATE" })
        {
            await using var ask = app.CreateCommand();
            ask.CommandText = $"SELECT has_table_privilege('agrisync_app', 'ssf.schedule_checks', '{privilege}')";
            ((bool)(await ask.ExecuteScalarAsync())!).Should().BeFalse($"the app role must not hold {privilege} on the append-only check table");
        }

        foreach (var sql in new[]
                 {
                     "UPDATE ssf.schedule_checks SET decision = 'Withdrawn'",
                     "DELETE FROM ssf.schedule_checks",
                     "TRUNCATE ssf.schedule_checks",
                 })
        {
            await using var cmd = app.CreateCommand();
            cmd.CommandText = sql;
            var attempt = async () => await cmd.ExecuteNonQueryAsync();
            var refused = await attempt.Should().ThrowAsync<PostgresException>(sql);
            refused.Which.SqlState.Should().Be("42501", $"{sql} must be refused for want of privilege");
        }

        (await ChecksAsync(row.Id)).Should().HaveCount(1, "nothing was changed or removed");
        // INSERT and SELECT are what it keeps.
        await using var read = app.CreateCommand();
        read.CommandText = "SELECT count(*) FROM ssf.schedule_checks";
        Convert.ToInt64(await read.ExecuteScalarAsync()).Should().Be(1);
    }

    [Fact]
    public async Task The_audit_payload_holds_the_ids_and_the_decision_and_no_note_and_no_activity_names()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        const string secretNote = "SECRET-NOTE-WORDS-for-the-maker";

        (await CheckAsync(PlatformOwner, row.Id, "Returned", note: secretNote)).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT payload::text, entity_type, entity_id, actor_user_id FROM ssf.audit_events
            WHERE action = 'schedule.checked' ORDER BY occurred_at_utc
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        var payloads = new System.Collections.Generic.List<string>();
        while (await reader.ReadAsync())
        {
            payloads.Add(reader.GetString(0));
            reader.GetString(1).Should().Be("ScheduleTemplate");
            reader.GetGuid(2).Should().Be(row.Id);
            reader.GetGuid(3).Should().Be(PlatformOwner);
        }

        payloads.Should().HaveCount(2);
        foreach (var payload in payloads)
        {
            var names = JsonDocument.Parse(payload).RootElement.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToList();
            names.Should().Equal("decision", "templateId", "templateVersion");
            payload.Should().NotContain(secretNote).And.NotContain(DisplayName);
            foreach (var activity in row.Activities)
            {
                payload.Should().NotContain(activity.ActivityName);
            }
        }

        JsonDocument.Parse(payloads[0]).RootElement.GetProperty("decision").GetString().Should().Be("Returned");
        JsonDocument.Parse(payloads[1]).RootElement.GetProperty("decision").GetString().Should().Be("Approved");
        JsonDocument.Parse(payloads[1]).RootElement.GetProperty("templateVersion").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task Erasing_a_checker_keeps_the_check_and_replaces_only_the_name()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row), display: "श्रमसफल कृषी तज्ज्ञ अनिल")).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformEmployee, row.Id, "Returned", note: "reason kept", display: "श्रमसफल कृषी तज्ज्ञ सीमा")).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, row.Id, "Withdrawn", note: "second by the same checker", display: "श्रमसफल कृषी तज्ज्ञ अनिल")).Status.Should().Be(HttpStatusCode.OK);
        var before = await ChecksAsync(row.Id);
        before.Should().HaveCount(3);
        const string sentinel = "श्रमसफल कृषी तज्ज्ञ";

        // The app role cannot rewrite the table (append-only); the worker's migration-role context can.
        await using var admin = NewSuperuserContext();
        var changed = await ErasureWorker.ScrubScheduleCheckerNamesAsync(admin, PlatformOwner, CancellationToken.None);
        changed.Should().Be(2, "both of the erased checker's rows");

        var after = await ChecksAsync(row.Id);
        after.Should().HaveCount(3, "the checks survive (P6: anonymise the person, never the work)");
        foreach (var (was, now) in before.Zip(after))
        {
            now.Checker.Should().Be(was.Checker, "the opaque checker id stays");
            now.Decision.Should().Be(was.Decision);
            now.Note.Should().Be(was.Note);
            now.Version.Should().Be(was.Version);
            now.Ticked.Should().Equal(was.Ticked);
            if (was.Checker == PlatformOwner)
            {
                now.Display.Should().Be(sentinel);
            }
            else
            {
                now.Display.Should().Be(was.Display, "another checker's name is untouched");
            }
        }

        await using var admin2 = NewSuperuserContext();
        (await ErasureWorker.ScrubScheduleCheckerNamesAsync(admin2, PlatformOwner, CancellationToken.None)).Should().Be(0, "a second run changes nothing");
    }

    [Fact]
    public async Task The_waiting_list_is_for_the_review_seats_and_lists_stored_public_rows_with_no_decision()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var waiting = await SeedStoredRowAsync("Grapes - waiting");
        var done = await SeedStoredRowAsync("Grapes - done");
        var thin = await SeedTemplateRowAsync("Grapes - thin");
        var private_ = await SeedStoredRowAsync("Grapes - private", TenantScope.Private, maker: Owner);
        (await CheckAsync(PlatformOwner, done.Id, "Approved", ActivityIdsOf(done))).Status.Should().Be(HttpStatusCode.OK);

        var seen = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformAnalyst, null);
        seen.Status.Should().Be(HttpStatusCode.OK, "the Analyst reads the queue");
        var ids = Json(seen.Body).EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();
        ids.Should().Equal(waiting.Id);
        ids.Should().NotContain(done.Id).And.NotContain(thin).And.NotContain(private_.Id);

        foreach (var who in new[] { Owner, FpoOwner, AgronomistSeat, Worker })
        {
            (await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", who, null)).Status
                .Should().Be(HttpStatusCode.Forbidden);
        }
    }
}
