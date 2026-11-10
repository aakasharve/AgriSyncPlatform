// spec: plr-d10-redesign-real-integration-2026-10-25 - lane L8b-1F ("adopting follows the check and 3 + 1"; register F114).
//
// Adopting a schedule now follows ShramSafal's check (SCH-A) and the PLOT's farm (E4, R23):
//   - an OUTSIDE schedule (a built-in sample or a Public row) is followed only once Checked; a SAMPLE (a built-in id, or a row
//     without stored days) stays choosable, marked NotChecked, only until THAT crop has a Checked schedule (D-91 = 1);
//   - a carry-over (the phone's one-time upload of a choice it already made) is accepted either way and stamped (R7);
//   - a Team schedule of this plot's farm owner that names no farm is NOT a farm's own schedule (SCH-OWN fix round 1, M001): it answers
//     OwnScheduleNotOpenYet, as before; only a row whose own_farm_id is the plot's farm is followed as Own; anything else a plot may not
//     follow answers exactly like an unknown id and writes nothing;
//   - the library lists each crop's samples until the crop has a checked schedule, and never a row still waiting for its check.
// Real Postgres as agrisync_app (E3 first), through the real host, the real push handler and the real pull.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleAdoptCheckRealPostgresTests(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    private static Dictionary<string, object?> Adopt(Guid farm, Guid plot, Guid cycle, Guid template, bool? carryOver = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = farm,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["scheduleTemplateId"] = template,
            ["actorUserId"] = Owner,
        };
        if (carryOver is { } c)
        {
            payload["carryOver"] = c;
        }

        return payload;
    }

    /// <summary>A stored Grapes schedule, Approved by the platform owner: the first CHECKED schedule for Grapes.</summary>
    private async Task<ScheduleTemplate> CheckedGrapeScheduleAsync()
    {
        await SeedReviewSeatsAsync();
        var row = await SeedStoredRowAsync();
        var approved = await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row));
        approved.Status.Should().Be(HttpStatusCode.OK, approved.Body);
        return row;
    }

    private sealed record Marks(string? Origin, string? CheckStateAtAdopt, string VersionTag, int State);

    private async Task<List<Marks>> MarksAsync(Guid? template = null)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT origin, check_state_at_adopt, schedule_version_tag, state FROM ssf.schedule_subscriptions
            WHERE (@t::uuid IS NULL OR schedule_template_id = @t) ORDER BY adopted_at_utc, id
            """;
        cmd.Parameters.AddWithValue("t", (object?)template ?? DBNull.Value);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Marks>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Marks(
                reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2), reader.GetInt32(3)));
        }

        return rows;
    }

    private Task JoinFarmBAsync(Guid user) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                          permissions, can_manage_labour_records)
        VALUES (gen_random_uuid(), @farm, @user, 'Worker', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
        """, ("farm", FarmB), ("user", user), ("account", AccountB));

    private static bool Listed(IReadOnlyList<JsonElement> library, Guid id) => RowOf(library, id) is not null;

    private async Task<Guid> PomegranateSeasonAsync() => (await SeedSeasonAsync("Pomegranate")).Cycle;

    // ── Task 1: the outside check ──

    [Fact]
    public async Task Adopting_a_checked_schedule_succeeds()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var row = await CheckedGrapeScheduleAsync();

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, row.Id);

        status.Should().Be(HttpStatusCode.OK, body);
        var dto = Json(body);
        dto.GetProperty("checkState").GetString().Should().Be("Checked");
        dto.GetProperty("origin").GetString().Should().Be("Outside");
        var kept = (await MarksAsync()).Should().ContainSingle().Which;
        kept.Origin.Should().Be("Outside");
        kept.CheckStateAtAdopt.Should().Be("Checked");
        kept.VersionTag.Should().Be("v1", "a new adopt keeps the row's own version tag (repo fact 12)");
    }

    [Fact]
    public async Task Old_payload_without_carryOver_still_adopts_a_checked_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var row = await CheckedGrapeScheduleAsync();
        var oldShape = Adopt(FarmA, PlotA, CycleA, row.Id); // exactly 1.0.17's keys: no referenceDate, no carryOver

        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-old-shape", oldShape);

        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        (await MarksAsync()).Should().ContainSingle().Which.CheckStateAtAdopt.Should().Be("Checked");
    }

    [Fact]
    public async Task Carry_over_of_an_unchecked_choice_is_kept_and_marked_NotChecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await CheckedGrapeScheduleAsync(); // a checked schedule exists for the crop: a NEW unchecked choice would be refused

        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-carry", Adopt(FarmA, PlotA, CycleA, BuiltInGrapes, carryOver: true));

        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        var kept = (await SubscriptionsAsync()).Should().ContainSingle("the choice the phone held is kept (P10)").Which;
        kept.Template.Should().Be(BuiltInGrapes);
        var marks = (await MarksAsync()).Single();
        marks.CheckStateAtAdopt.Should().Be("NotChecked");
        marks.Origin.Should().Be("Outside");
    }

    [Fact]
    public async Task A_carry_over_of_a_waiting_or_returned_row_is_refused_ScheduleNotChecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        // Only SAMPLES bridge (D-82: a row waiting for its check is never shown; no phone held a stored-days row before SCH-A).
        var waiting = await SeedStoredRowAsync("Grapes - waiting");
        var returned = await SeedStoredRowAsync("Grapes - sent back");
        (await CheckAsync(PlatformOwner, returned.Id, "Returned", note: "check day 41")).Status.Should().Be(HttpStatusCode.OK);

        foreach (var (row, name) in new[] { (waiting, "waiting"), (returned, "returned") })
        {
            var pushed = await PushAsync(Owner, "adopt_schedule", $"l8b1f-carry-{name}", Adopt(FarmA, PlotA, CycleA, row.Id, carryOver: true));
            pushed.Status.Should().Be("failed", name);
            pushed.ErrorCode.Should().Be("ShramSafal.ScheduleNotChecked", name);
        }

        (await SubscriptionsAsync()).Should().BeEmpty("a refused carry-over writes nothing");

        // Not vacuous: a row whose check was withdrawn DOES bridge (R8), and so does a sample.
        var once = await SeedStoredRowAsync("Grapes - once checked");
        (await CheckAsync(PlatformOwner, once.Id, "Approved", ActivityIdsOf(once))).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, once.Id, "Withdrawn", note: "revised")).Status.Should().Be(HttpStatusCode.OK);
        var bridged = await PushAsync(Owner, "adopt_schedule", "l8b1f-carry-withdrawn", Adopt(FarmA, PlotA, CycleA, once.Id, carryOver: true));
        bridged.Status.Should().Be("applied", $"{bridged.ErrorCode}: {bridged.ErrorMessage}");
        (await MarksAsync(once.Id)).Single().CheckStateAtAdopt.Should().Be("NotChecked");
    }

    [Fact]
    public async Task Carry_over_on_a_plot_that_already_follows_one_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await PushAsync(Owner, "adopt_schedule", "l8b1f-carry-1", Adopt(FarmA, PlotA, CycleA, BuiltInGrapes, carryOver: true));
        first.Status.Should().Be("applied", $"{first.ErrorCode}: {first.ErrorMessage}");

        var second = await PushAsync(Owner, "adopt_schedule", "l8b1f-carry-2", Adopt(FarmA, PlotA, CycleA, BuiltInGrapes, carryOver: true));

        second.Status.Should().Be("failed");
        second.ErrorCode.Should().Be("ShramSafal.ScheduleAlreadyAdopted");
        (await SubscriptionsAsync()).Should().ContainSingle("the second upload added nothing");
    }

    [Fact]
    public async Task Push_and_REST_answer_alike()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var waiting = await SeedStoredRowAsync(); // stored days, no decision yet: not checked, not a sample
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");

        var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, waiting.Id);
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-alike", Adopt(FarmA, plot2, cycle2, waiting.Id));

        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.ScheduleNotChecked");
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleNotChecked");
        (await SubscriptionsAsync()).Should().BeEmpty("neither door wrote anything");
    }

    [Fact]
    public async Task An_adopt_of_a_Team_row_that_names_no_farm_answers_OwnScheduleNotOpenYet()
    {
        // spec: plr-d10 lane SCH-OWN fix round 1 (M001; session A's ruling) - the Own branch is open ONLY for a row whose own_farm_id is the plot's
        // farm. A Team row of the farm owner that names no farm (every row made before the lane, and a plain Team copy) is not one: it answers
        // what x1 answered, and writes nothing (OwnScheduleFollowRealPostgresTests holds the stored-days and plain-copy cases).
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedTemplateRowAsync("Grapes - the farm's own", TenantScope.Team, author: Owner);

        var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, own);
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-own", Adopt(FarmA, PlotA, CycleA, own));

        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.OwnScheduleNotOpenYet");
        pushed.ErrorCode.Should().Be("ShramSafal.OwnScheduleNotOpenYet");
        (await SubscriptionsAsync()).Should().BeEmpty("nothing is lost and nothing is written");
    }

    // ── the D-91 = 1 bridge ──

    [Fact]
    public async Task An_unchecked_sample_is_accepted_and_marked_while_no_checked_schedule_exists_for_the_crop()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);

        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("checkState").GetString().Should().Be("NotChecked");
        var marks = (await MarksAsync()).Should().ContainSingle().Which;
        marks.CheckStateAtAdopt.Should().Be("NotChecked");
        marks.Origin.Should().Be("Outside");
    }

    [Fact]
    public async Task Once_a_checked_schedule_exists_for_the_crop_a_new_unchecked_adopt_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var row = await CheckedGrapeScheduleAsync();
        var thin = await SeedTemplateRowAsync("Grapes - an old thin row");

        foreach (var sample in new[] { BuiltInGrapes, thin })
        {
            var refused = await AdoptAsync(Owner, FarmA, PlotA, CycleA, sample);
            refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
            ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleNotChecked");
        }

        (await SubscriptionsAsync()).Should().BeEmpty();
        // Not vacuous: the checked schedule IS adoptable, and another crop's sample is unaffected.
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, row.Id)).Status.Should().Be(HttpStatusCode.OK);
        var (plotP, cycleP) = await SeedSeasonAsync("Pomegranate");
        (await AdoptAsync(Owner, FarmA, plotP, cycleP, BuiltInPomegranate)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_sample_chosen_before_that_stays_followed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var chosen = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);
        chosen.Status.Should().Be(HttpStatusCode.OK, chosen.Body);

        await CheckedGrapeScheduleAsync(); // the first checked grape schedule arrives later

        var (pulledBody, root) = await PullAsync(Owner);
        KeepP11Body("l8b1f-sample-stays-followed", pulledBody); // the P11 run's input: release 1.0.17 reconciles this exact body
        var followed = ArrayOf(root, "scheduleSubscriptions").Should().ContainSingle().Which;
        followed.GetProperty("state").GetString().Should().Be("Active", "a plot that already follows a sample keeps it (R7)");
        followed.GetProperty("scheduleTemplateId").GetGuid().Should().Be(BuiltInGrapes);
        followed.GetProperty("checkState").GetString().Should().Be("NotChecked");
        Listed(await LibraryAsync(Owner), BuiltInGrapes).Should().BeFalse("the sample is no longer listed for a new choice");
        // ... but the plot that follows it keeps it: the pull still sends that schedule, marked NotChecked, so the phone can read it (P10).
        var followedOnPull = RowOf(ArrayOf(root, "scheduleTemplates"), BuiltInGrapes);
        followedOnPull.Should().NotBeNull("a plot that already follows a sample keeps it");
        followedOnPull!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        (await SubscriptionsAsync()).Should().ContainSingle().Which.State.Should().Be(0);
    }

    [Fact]
    public async Task An_unchecked_non_sample_row_is_refused_ScheduleNotChecked()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var waiting = await SeedStoredRowAsync();
        // No checked grape schedule exists, so the bridge is open - but it is for SAMPLES only.
        var refused = await AdoptAsync(Owner, FarmA, PlotA, CycleA, waiting.Id);
        refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
        ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleNotChecked");

        var returned = await SeedStoredRowAsync("Grapes - sent back");
        (await CheckAsync(PlatformOwner, returned.Id, "Returned", note: "check the day 41 irrigation")).Status.Should().Be(HttpStatusCode.OK);
        var alsoRefused = await AdoptAsync(Owner, FarmA, PlotA, CycleA, returned.Id);
        ErrorCode(alsoRefused.Body).Should().Be("ShramSafal.ScheduleNotChecked");
        (await SubscriptionsAsync()).Should().BeEmpty();
    }

    // ── the per-crop listing (F114) ──

    [Fact]
    public async Task Grape_checked_hides_grape_samples_and_keeps_pomegranate_samples_listed_and_adoptable()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var thinGrape = await SeedTemplateRowAsync("Grapes - an old thin row");
        var before = await LibraryAsync(Owner);
        Listed(before, BuiltInGrapes).Should().BeTrue();
        Listed(before, thinGrape).Should().BeTrue();

        var row = await CheckedGrapeScheduleAsync();

        var library = await LibraryAsync(Owner);
        Listed(library, row.Id).Should().BeTrue();
        RowOf(library, row.Id)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("Checked");
        Listed(library, BuiltInGrapes).Should().BeFalse("grapes now have a checked schedule");
        Listed(library, thinGrape).Should().BeFalse("a thin row is a sample of its crop");
        Listed(library, BuiltInPomegranate).Should().BeTrue();
        Listed(library, BuiltInSugarcane).Should().BeTrue();
        Listed(library, BuiltInOnion).Should().BeTrue();
        var (plotP, cycleP) = await SeedSeasonAsync("Pomegranate");
        (await AdoptAsync(Owner, FarmA, plotP, cycleP, BuiltInPomegranate)).Status.Should().Be(HttpStatusCode.OK);
        RowOf(await LibraryAsync(Owner), BuiltInPomegranate)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
    }

    [Fact]
    public async Task A_person_with_his_own_private_schedule_still_lists_and_adopts_the_samples()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var mine = await SeedTemplateRowAsync("Grapes - my private copy", TenantScope.Private, author: Owner);

        var viaReference = await LibraryAsync(Owner);
        var (_, root) = await PullAsync(Owner);
        var viaPull = ArrayOf(root, "scheduleTemplates");

        foreach (var library in new[] { viaReference, viaPull })
        {
            Listed(library, mine).Should().BeTrue("his own schedule is always listed");
            foreach (var sample in new[] { BuiltInGrapes, BuiltInPomegranate, BuiltInSugarcane, BuiltInOnion })
            {
                Listed(library, sample).Should().BeTrue("his own row never hides a sample (F114)");
            }
        }

        var adopted = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);
        adopted.Status.Should().Be(HttpStatusCode.OK, adopted.Body);
    }

    [Fact]
    public async Task A_carry_over_of_a_delisted_sample_still_adopts_through_FindForCarryOverAsync()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await CheckedGrapeScheduleAsync();
        Listed(await LibraryAsync(Owner), BuiltInGrapes).Should().BeFalse("delisted once grapes have a checked schedule");

        var found = await AsUserAsync(Owner, async sp =>
            await new ScheduleLibrary(sp.GetRequiredService<IShramSafalRepository>()).FindForCarryOverAsync(BuiltInGrapes, Owner));
        var findNew = await AsUserAsync(Owner, async sp =>
            await new ScheduleLibrary(sp.GetRequiredService<IShramSafalRepository>()).FindAsync(BuiltInGrapes, Owner));
        found.Should().NotBeNull("a carry-over keeps a choice the phone already made");
        findNew.Should().BeNull("a NEW choice does not find a delisted sample");

        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-delisted", Adopt(FarmA, PlotA, CycleA, BuiltInGrapes, carryOver: true));
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        (await MarksAsync()).Should().ContainSingle().Which.CheckStateAtAdopt.Should().Be("NotChecked");
    }

    [Fact]
    public async Task A_platform_reviewer_lists_the_waiting_row_with_its_state_and_a_farm_caller_does_not()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var waiting = await SeedStoredRowAsync();

        var reviewer = await LibraryAsync(PlatformOwner);
        var farm = await LibraryAsync(Owner);

        RowOf(reviewer, waiting.Id).Should().NotBeNull("the platform reviewer sees every row with its state");
        RowOf(reviewer, waiting.Id)!.Value.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked");
        Listed(farm, waiting.Id).Should().BeFalse("a row waiting for its check is never listed to a farm caller");
        // The farm caller's pull survives the reviewer question (asked only because a waiting row exists) and also lacks the row.
        var (_, root) = await PullAsync(Owner);
        Listed(ArrayOf(root, "scheduleTemplates"), waiting.Id).Should().BeFalse();
        // And the reviewer's pull answers too.
        var (_, reviewerRoot) = await PullAsync(PlatformOwner);
        ArrayOf(reviewerRoot, "scheduleTemplates").Should().NotBeNull();
    }

    // ── Task 2: Withdrawn and newer versions ──

    [Fact]
    public async Task Withdrawn_check_keeps_the_subscription_and_the_pull_says_why()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var row = await CheckedGrapeScheduleAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, row.Id)).Status.Should().Be(HttpStatusCode.OK);

        var withdrawn = await CheckAsync(PlatformOwner, row.Id, "Withdrawn", note: "week 3 dose is wrong");
        withdrawn.Status.Should().Be(HttpStatusCode.OK, withdrawn.Body);

        var (pulledBody, root) = await PullAsync(Owner);
        KeepP11Body("l8b1f-withdrawn", pulledBody);
        var sub = ArrayOf(root, "scheduleSubscriptions").Should().ContainSingle().Which;
        sub.GetProperty("state").GetString().Should().Be("Active", "R8: a withdrawal never ends a choice");
        sub.GetProperty("checkState").GetString().Should().Be("Withdrawn");
        var listed = RowOf(ArrayOf(root, "scheduleTemplates"), row.Id);
        listed.Should().NotBeNull("a followed schedule stays listed so the phone can say why");
        listed!.Value.GetProperty("check").GetProperty("note").GetString().Should().Be("week 3 dose is wrong");
        (await SubscriptionsAsync()).Should().ContainSingle().Which.State.Should().Be(0);
        (await MarksAsync()).Single().CheckStateAtAdopt.Should().Be("Checked", "what it said when chosen is not rewritten");

        // A NEW choice of the withdrawn schedule is refused.
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var again = await AdoptAsync(Owner, FarmA, plot2, cycle2, row.Id);
        ErrorCode(again.Body).Should().Be("ShramSafal.ScheduleNotChecked");
    }

    private Dictionary<string, object?> Switch(Guid template, Guid? from)
    {
        var payload = new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["newScheduleTemplateId"] = template,
            ["reason"] = "Other",
            ["actorUserId"] = Owner,
        };
        if (from is { } f)
        {
            payload["fromSubscriptionId"] = f;
        }

        return payload;
    }

    private async Task<ScheduleTemplate> NewCheckedVersionAsync(ScheduleTemplate v1)
    {
        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), null, null, new UserId(PlatformOwner), DateTime.UtcNow);
        await using (var db = NewSuperuserContext())
        {
            db.ScheduleTemplates.Add(v2);
            await db.SaveChangesAsync();
        }

        var approved = await CheckAsync(PlatformOwner, v2.Id, "Approved", ActivityIdsOf(v2));
        approved.Status.Should().Be(HttpStatusCode.OK, approved.Body);
        return v2;
    }

    [Fact]
    public async Task Migrate_to_the_newer_checked_version_succeeds()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await CheckedGrapeScheduleAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, v1.Id)).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, v1.Id, "Withdrawn", note: "superseded by version 2")).Status.Should().Be(HttpStatusCode.OK);
        var v2 = await NewCheckedVersionAsync(v1);
        var held = (await SubscriptionsAsync()).Single().Id;

        var switched = await PushAsync(Owner, "migrate_schedule", "l8b1f-newer", Switch(v2.Id, held));

        switched.Status.Should().Be("applied", $"{switched.ErrorCode}: {switched.ErrorMessage}");
        var rows = await SubscriptionsAsync();
        rows.Should().HaveCount(2);
        rows.Single(r => r.State == 0).Template.Should().Be(v2.Id);
        (await MarksAsync(v2.Id)).Single().CheckStateAtAdopt.Should().Be("Checked");

        // A switch to a Withdrawn schedule is refused.
        var back = await PushAsync(Owner, "migrate_schedule", "l8b1f-back", Switch(v1.Id, rows.Single(r => r.State == 0).Id));
        back.ErrorCode.Should().Be("ShramSafal.ScheduleNotChecked");
    }

    [Fact]
    public async Task Edit_of_a_followed_schedule_moves_nobody()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await CheckedGrapeScheduleAsync();
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, v1.Id)).Status.Should().Be(HttpStatusCode.OK);

        var v2 = await NewCheckedVersionAsync(v1); // an edit is a NEW row (copy-on-write)

        var row = (await SubscriptionsAsync()).Should().ContainSingle().Which;
        row.Template.Should().Be(v1.Id, "the plot keeps the version it chose");
        row.State.Should().Be(0);
        var (_, root) = await PullAsync(Owner);
        ArrayOf(root, "scheduleSubscriptions").Single().GetProperty("checkState").GetString().Should().Be("Checked");
        Listed(ArrayOf(root, "scheduleTemplates"), v2.Id).Should().BeTrue("the newer checked version is listed for a switch");
    }

    // ── Task 3: what a plot may follow (E4) ──

    [Fact]
    public async Task A_later_version_made_by_a_delegate_is_still_Own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await SeedTemplateRowAsync("Grapes - the farm's own", TenantScope.Team, author: Owner);
        Guid v2Id;
        await using (var db = NewSuperuserContext())
        {
            var first = await db.ScheduleTemplates.FindAsync(v1);
            var v2 = first!.EditCopyOnWrite(Guid.NewGuid(), null, null, new UserId(CoOwner), DateTime.UtcNow);
            db.ScheduleTemplates.Add(v2);
            await db.SaveChangesAsync();
            v2Id = v2.Id;
        }

        var result = await AdoptAsync(Owner, FarmA, PlotA, CycleA, v2Id);

        // Version 2's MAKER is the delegate; its OWNER (the first version's maker) is the farm owner: recognised as his team's row (not unknown, which
        // would answer 404), and - naming no farm - not followable as Own: OwnScheduleNotOpenYet, as on x1 (SCH-OWN fix round 1, M001).
        ErrorCode(result.Body).Should().Be("ShramSafal.OwnScheduleNotOpenYet", result.Body);
        (await SubscriptionsAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task A_version_this_farms_owner_made_on_another_owners_chain_is_not_Own_here()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinFarmBAsync(Owner); // so farm B's Team chain is visible to him
        var v1 = await SeedTemplateRowAsync("Grapes - farm B's own", TenantScope.Team, author: OwnerB);
        Guid v2Id;
        await using (var db = NewSuperuserContext())
        {
            var first = await db.ScheduleTemplates.FindAsync(v1);
            var v2 = first!.EditCopyOnWrite(Guid.NewGuid(), null, null, new UserId(Owner), DateTime.UtcNow);
            db.ScheduleTemplates.Add(v2);
            await db.SaveChangesAsync();
            v2Id = v2.Id;
        }

        var result = await AdoptAsync(Owner, FarmA, PlotA, CycleA, v2Id);

        // His created_by_user_id on version 2 never makes the schedule his: the chain's owner is farm B's owner.
        result.Status.Should().Be(HttpStatusCode.NotFound, result.Body);
        ErrorCode(result.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await SubscriptionsAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task Farm_B_team_schedule_answers_like_an_unknown_id_on_a_farm_A_plot_even_for_a_person_on_both_farms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinFarmBAsync(Owner);
        var teamB = await SeedTemplateRowAsync("Grapes - farm B team", TenantScope.Team, author: OwnerB);
        // He can SEE it (a seat on two farms sees both owners' Team schedules) ...
        Listed(await LibraryAsync(Owner), teamB).Should().BeTrue();

        // ... but his farm-A plot may not follow it: exactly like a made-up id, nothing written.
        var unknown = await AdoptAsync(Owner, FarmA, PlotA, CycleA, Guid.NewGuid());
        var foreign = await AdoptAsync(Owner, FarmA, PlotA, CycleA, teamB);
        var pushed = await PushAsync(Owner, "adopt_schedule", "l8b1f-farmb", Adopt(FarmA, PlotA, CycleA, teamB));

        foreign.Status.Should().Be(unknown.Status);
        ErrorCode(foreign.Body).Should().Be(ErrorCode(unknown.Body)).And.Be("ShramSafal.ScheduleTemplateNotFound");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await SubscriptionsAsync()).Should().BeEmpty();
        (await ScheduleAuditAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task His_own_private_template_answers_like_an_unknown_id_on_this_plot()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var mine = await SeedTemplateRowAsync("Grapes - my private copy", TenantScope.Private, author: Owner);

        var result = await AdoptAsync(Owner, FarmA, PlotA, CycleA, mine);

        result.Status.Should().Be(HttpStatusCode.NotFound, result.Body);
        ErrorCode(result.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await SubscriptionsAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task Another_accounts_Team_template_answers_like_an_unknown_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var teamB = await SeedTemplateRowAsync("Grapes - farm B team", TenantScope.Team, author: OwnerB); // Owner is NOT on farm B

        var result = await AdoptAsync(Owner, FarmA, PlotA, CycleA, teamB);

        result.Status.Should().Be(HttpStatusCode.NotFound, result.Body);
        ErrorCode(result.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound");
        Listed(await LibraryAsync(Owner), teamB).Should().BeFalse("the library for farm A lists no farm-B team schedule");
        (await SubscriptionsAsync()).Should().BeEmpty();
    }
}
