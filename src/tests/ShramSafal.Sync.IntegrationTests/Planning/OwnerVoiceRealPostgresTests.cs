// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// The owner of a reference schedule sends a REAL recorded message about one of its works; a follower hears it and decides; nothing changes until the farmer decides. Three kinds only:
// a tip (a clip about one work), a change of plan (before and now: a NEW checked version) and a look (a question with exactly two answers and a follow-up clip after each).
//
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host, the real push handler and the real upload route; the switch row and the arrangement are written as
// superuser. The audio is a GENERATED tone or silence (OwnerVoiceLane.Tone), never a voice. Fake numbers only; no dose from any real schedule.
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
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnerVoiceRealPostgresTests(ITestOutputHelper output) : OwnerVoiceLane(output)
{
    // ---- a message changes nothing by itself --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Message_ChangesNothingByItself()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var before = await UntouchedAsync();
        before.Should().NotBeNullOrEmpty();

        // Sending all three kinds, and hearing them, writes no own work, revision, origin, plan, log or choice of schedule.
        var tip = await SendOkAsync(a.V1, "tip", "t-spray");
        var change = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var look = await SendOkAsync(a.V1, "look", "t-water", first: "दव आहे", second: "दव नाही");
        (await UntouchedAsync()).Should().Be(before, "sending a message writes nothing of the farmer's schedule");

        foreach (var m in new[] { tip, change, look })
        {
            await OkAsync(HeardAsync(Mukadam, a.Plot, m));
        }

        (await UntouchedAsync()).Should().Be(before, "hearing a message writes nothing of the farmer's schedule either");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 0")).Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_messages")).Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_clips")).Should().Be(5, "three messages, and the look has two follow-up clips");
        (await JobAsync(a.JobId!.Value)).Accepted.Should().BeTrue("the mukadam's trail is as it was");
    }

    [Fact]
    public async Task Send_IsPlatformStaffOnly_NoFarmSeatOfAnyRoleSends()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);

        foreach (var who in new[] { Owner, CoOwner, Mukadam, Worker })
        {
            var (status, _) = await SendMessageAsync(who, a.V1, "tip", "t-spray", Tone(1000));
            status.Should().Be(HttpStatusCode.Forbidden, $"{who} holds a farm seat, not the schedule-review seat");
        }

        (await SendMessageAsync(PlatformAnalyst, a.V1, "tip", "t-spray", Tone(1000))).Status.Should().Be(HttpStatusCode.Forbidden, "reading is not writing");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_messages")).Should().Be(0);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_clips")).Should().Be(0);

        (await SendMessageAsync(PlatformEmployee, a.V1, "tip", "t-spray", Tone(1000))).Status.Should().Be(HttpStatusCode.Created, "the positive control: staff with the review seat send");
    }

    [Fact]
    public async Task Send_KindsAndShapes_AreExactlyThreeAndHoldTogether()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);

        (await SendMessageAsync(PlatformOwner, a.V1, "advice", "t-spray", Tone(1000))).Body.Should().Contain("OwnerMessageKind");
        (await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-no-such-work", Tone(1000))).Body.Should().Contain("no work with this key");
        (await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", null)).Body.Should().Contain("OwnerClipMissing");
        // A look has exactly two different answers and a follow-up clip.
        (await SendMessageAsync(PlatformOwner, a.V1, "look", "t-water", Tone(1000), first: "होय", second: "होय", followUp: Tone(500))).Body.Should().Contain("exactly two different answers");
        (await SendMessageAsync(PlatformOwner, a.V1, "look", "t-water", Tone(1000), first: "होय", second: "नाही")).Body.Should().Contain("OwnerMessageShape", "a look needs its follow-up clip");
        // A tip has no answers: a tip that carries them is refused, never silently trimmed.
        var (tipStatus, tipBody) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-water", Tone(1000), first: "होय", second: "नाही");
        tipStatus.Should().Be(HttpStatusCode.BadRequest);
        tipBody.Should().Contain("OwnerMessageShape").And.Contain("A tip is one clip about one work");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_messages")).Should().Be(0, "every refusal above wrote nothing");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_clips")).Should().Be(0);
    }

    // ---- the clip store -----------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task OwnClipStore_NeverRetainedVoice()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        var retainedBefore = await CountAsync("SELECT count(*) FROM ssf.voice_clips_retained");

        var tone = Tone(3000);
        var (status, text) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", tone);
        status.Should().Be(HttpStatusCode.Created, text);
        var clip = Json(text).GetProperty("clips")[0];

        // Its own table, its own storage prefix, the hash of the very bytes sent, a length measured from the file.
        (await CountAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(retainedBefore, "the farmer's retained voice is never used here");
        var row = await ScalarAsync("SELECT storage_key || '|' || mime_type || '|' || size_bytes || '|' || duration_ms || '|' || content_hash FROM ssf.schedule_owner_clips");
        var parts = row.Split('|');
        parts[0].Should().StartWith("schedule-owner-clips/");
        parts[1].Should().Be("audio/wav");
        long.Parse(parts[2]).Should().Be(tone.Length);
        int.Parse(parts[3]).Should().BeInRange(2990, 3010, "the length is measured from the file, not sent");
        parts[4].Should().Be(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(tone)).ToLowerInvariant());
        clip.GetProperty("durationMs").GetInt32().Should().Be(int.Parse(parts[3]));

        // The staff member who sent it can read the bytes back, untouched (no transcoding, no synthesis).
        using var back = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clip.GetProperty("id").GetGuid()}", PlatformOwner);
        back.StatusCode.Should().Be(HttpStatusCode.OK);
        (await back.Content.ReadAsByteArrayAsync()).Should().Equal(tone);
        back.Content.Headers.ContentType!.MediaType.Should().Be("audio/wav");
    }

    [Fact]
    public async Task NonAudioRefused_WithWords()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        var before = await CountAsync("SELECT (SELECT count(*) FROM ssf.schedule_owner_clips) + (SELECT count(*) FROM ssf.schedule_owner_messages)");

        var text = System.Text.Encoding.UTF8.GetBytes("this is not a recording");
        var script = System.Text.Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>");

        // Not audio by its type, not audio by its bytes (whatever its type says), too long, too big, empty.
        var (s1, b1) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", text, "text/plain");
        s1.Should().Be(HttpStatusCode.BadRequest);
        b1.Should().Contain("OwnerClipNotAudio").And.Contain("Only audio is accepted");

        var (s2, b2) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", script, "audio/mp4");
        s2.Should().Be(HttpStatusCode.BadRequest);
        b2.Should().Contain("OwnerClipNotAudio").And.Contain("is not the audio its type says");

        var (s3, b3) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", Tone(91_000), "audio/wav");
        s3.Should().Be(HttpStatusCode.BadRequest);
        b3.Should().Contain("OwnerClipTooLong").And.Contain("at most 90 seconds");
        (await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", Tone(90_000), "audio/wav")).Status.Should().Be(HttpStatusCode.Created, "exactly 90 seconds is allowed");

        var big = new byte[5 * 1024 * 1024 + 1];
        Array.Copy(Tone(1000), big, 44);
        var (s4, b4) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", big, "audio/wav");
        s4.Should().Be(HttpStatusCode.BadRequest);
        b4.Should().Contain("OwnerClipTooBig").And.Contain("at most 5 MB");

        var (s5, b5) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", [], "audio/wav");
        s5.Should().Be(HttpStatusCode.BadRequest);
        b5.Should().Contain("OwnerClip");

        (await CountAsync("SELECT (SELECT count(*) FROM ssf.schedule_owner_clips) + (SELECT count(*) FROM ssf.schedule_owner_messages)")).Should().Be(before + 2, "only the one 90 second message was written, with its clip");
    }

    // ---- a change needs a checked version ------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task ChangeNeedsACheckedVersion()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        const string Rule = "ChangeNeedsACheckedVersion";

        // None named.
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000))).Body.Should().Contain(Rule);

        // A new version nobody checked.
        var unchecked3 = await ImportVersionAsync("४ ग्रॅम प्रति लिटर", a.V2);
        var (_, notChecked) = await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: unchecked3);
        notChecked.Should().Contain(Rule).And.Contain("NotChecked");

        // Returned, then withdrawn: not checked any more.
        (await CheckAsync(PlatformEmployee, unchecked3, "Returned", note: "dose to be rechecked")).Status.Should().Be(HttpStatusCode.OK);
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: unchecked3)).Body.Should().Contain(Rule).And.Contain("Returned");
        await ApproveAsync(unchecked3);
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: unchecked3)).Status.Should().Be(HttpStatusCode.Created, "checked by someone other than its maker");
        (await CheckAsync(PlatformEmployee, unchecked3, "Withdrawn", note: "withdrawn after review")).Status.Should().Be(HttpStatusCode.OK);
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: unchecked3)).Body.Should().Contain(Rule).And.Contain("Withdrawn");

        // A version whose maker is also the one who checked it (written as superuser: the check door refuses to make one).
        var selfChecked = await ImportVersionAsync("५ ग्रॅम प्रति लिटर", a.V2);
        await ApproveAsync(selfChecked);
        await ExecOnSuperuserAsync("UPDATE ssf.schedule_checks SET checker_user_id = (SELECT created_by_user_id FROM ssf.schedule_templates WHERE \"Id\" = @t) WHERE schedule_template_id = @t", ("t", selfChecked));
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: selfChecked)).Body.Should().Contain(Rule).And.Contain("its maker checked it");

        // The same version, an older one, or one of another schedule.
        (await SendMessageAsync(PlatformOwner, a.V2, "change", "t-spray", Tone(1000), newVersion: a.V1)).Body.Should().Contain(Rule);
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: a.V1)).Body.Should().Contain(Rule);
        var other = await ImportVersionAsync(DoseNew);
        await ApproveAsync(other);
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: other)).Body.Should().Contain(Rule, "another schedule's version is not this schedule's change");

        // The positive control.
        (await SendMessageAsync(PlatformOwner, a.V1, "change", "t-spray", Tone(1000), newVersion: a.V2)).Status.Should().Be(HttpStatusCode.Created);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_messages WHERE kind = 1")).Should().Be(2);
    }

    // ---- the farmer decides ---------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Accept_MovesMySchedule_ThenTheJob_ClipTravels()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var item = OwnScheduleItem.IdFor(a.Cycle, "t-spray");
        var originBefore = await ScalarAsync("SELECT row_to_json(o)::text FROM ssf.own_schedule_item_origins o WHERE item_id = @i", ("i", item));
        var jobBefore = await JobAsync(a.JobId!.Value);
        jobBefore.Accepted.Should().BeTrue();
        jobBefore.Title.Should().Be("बुरशीनाशक फवारणी");

        var accepted = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));

        // My schedule first: a new revision of my own work with the new content; the origin row never changes; the revision names the message.
        Data(accepted).GetProperty("itemRevision").GetInt32().Should().Be(2);
        Data(accepted).GetProperty("itemCreated").GetBoolean().Should().BeFalse();
        var content = JsonDocument.Parse(await ScalarAsync("SELECT content::text FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).RootElement;
        content.GetProperty("dose").GetString().Should().Be(DoseNew);
        (await ScalarAsync("SELECT row_to_json(o)::text FROM ssf.own_schedule_item_origins o WHERE item_id = @i", ("i", item))).Should().Be(originBefore, "origin never changes");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(1);
        (await ScalarAsync("SELECT owner_message_id::text FROM ssf.own_schedule_item_revisions WHERE item_id = @i AND revision_number = 2", ("i", item))).Should().Be(message.ToString());
        (await ScalarAsync("SELECT coalesce(owner_message_id::text, '-') FROM ssf.own_schedule_item_revisions WHERE item_id = @i AND revision_number = 1", ("i", item))).Should().Be("-");

        // THEN the job made from it: its words follow the work, its trail restarts (the mukadam sees a changed job), and it was not done.
        Data(accepted).GetProperty("jobChanged").GetBoolean().Should().BeTrue();
        var job = await JobAsync(a.JobId!.Value);
        job.Quantity.Should().Be(DoseNew);
        job.Seen.Should().BeFalse("his trail restarted");
        job.Accepted.Should().BeFalse();
        job.Status.Should().Be("Assigned");
        job.Assignee.Should().Be(Mukadam.ToString());

        // The clip travels with the job: the mukadam's own pull names the job in the accepted state of that message, carries the message and its clip, and he can fetch the bytes.
        using var pull = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", Mukadam);
        var body = await pull.Content.ReadAsStringAsync();
        pull.IsSuccessStatusCode.Should().BeTrue(body);
        var root = JsonDocument.Parse(body).RootElement;
        var state = root.GetProperty("ownerMessageStates").EnumerateArray().Single(s => s.GetProperty("kind").GetString() == "accepted");
        state.GetProperty("jobId").GetGuid().Should().Be(a.JobId!.Value);
        state.GetProperty("messageId").GetGuid().Should().Be(message);
        var messageRow = root.GetProperty("ownerMessages").EnumerateArray().Single(m => m.GetProperty("id").GetGuid() == message);
        messageRow.GetProperty("kind").GetString().Should().Be("change");
        messageRow.GetProperty("newVersionId").GetGuid().Should().Be(a.V2);
        var clipId = messageRow.GetProperty("clipId").GetGuid();
        root.GetProperty("ownerClips").EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == clipId).GetProperty("durationMs").GetInt32().Should().BeInRange(1990, 2010);
        using var clip = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}?farmId={FarmA}", Mukadam);
        clip.StatusCode.Should().Be(HttpStatusCode.OK);
        (await clip.Content.ReadAsByteArrayAsync()).Length.Should().BeGreaterThan(1000);
        root.GetProperty("plannedWork").EnumerateArray().Single(p => p.GetProperty("id").GetGuid() == a.JobId!.Value).GetProperty("quantityText").GetString().Should().Be(DoseNew);

        // A second tap (or a second phone) finds the standing decision and writes nothing.
        var again = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        Data(again).GetProperty("replayed").GetBoolean().Should().BeTrue();
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 1")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(2);
    }

    [Fact]
    public async Task Accept_ForAWorkOnlyFollowed_TakesTheNewOneIn_AndNeverChangesTheFollowedSchedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var subscriptions = await ScalarAsync("SELECT string_agg(row_to_json(s)::text, '|' ORDER BY id) FROM ssf.schedule_subscriptions s");
        var plans = await CountAsync("SELECT count(*) FROM ssf.planned_work");

        var accepted = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));

        Data(accepted).GetProperty("itemCreated").GetBoolean().Should().BeTrue();
        var item = OwnScheduleItem.IdFor(a.Cycle, "t-spray");
        // The NEW one is taken into my schedule with the new version as its origin (slice 9's take), and nothing else: no plan, and the followed schedule is exactly as it was.
        (await ScalarAsync("SELECT source_version_id::text FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(a.V2.ToString());
        (await ScalarAsync("SELECT origin FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be("take:" + a.V2.ToString("N"));
        JsonDocument.Parse(await ScalarAsync("SELECT content::text FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).RootElement.GetProperty("dose").GetString().Should().Be(DoseNew);
        (await ScalarAsync("SELECT string_agg(row_to_json(s)::text, '|' ORDER BY id) FROM ssf.schedule_subscriptions s")).Should().Be(subscriptions, "the schedule the plot follows is never changed");
        (await CountAsync("SELECT count(*) FROM ssf.planned_work")).Should().Be(plans, "taking in plans nothing");

        // Taking it back takes the new one out again; history kept.
        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back"));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_items WHERE id = @i AND state = 1", ("i", item))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_origins WHERE item_id = @i", ("i", item))).Should().Be(1, "the origin row stays");
    }

    [Fact]
    public async Task TakeBack_RestoresBoth()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var item = OwnScheduleItem.IdFor(a.Cycle, "t-spray");
        var hashBefore = await ScalarAsync("SELECT content_hash FROM ssf.own_schedule_items WHERE id = @i", ("i", item));
        var jobBefore = await JobAsync(a.JobId!.Value);

        // Nothing to take back before an accept.
        (await DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back")).ErrorMessage.Should().Contain("OwnerMessageNothingToTakeBack");

        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        (await ScalarAsync("SELECT content_hash FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().NotBe(hashBefore);
        // The mukadam has seen the changed job again.
        await OkAsync(PushAsAsync(Mukadam, "plannedwork.accept", $"accept-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["plannedWorkId"] = a.JobId, ["farmId"] = FarmA }, "1.0.18"));

        var taken = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back"));

        // The revision before, restored: the content is exactly the content it was (same hash), as a NEW revision; the accepted revision stays in the history.
        (await ScalarAsync("SELECT content_hash FROM ssf.own_schedule_items WHERE id = @i", ("i", item))).Should().Be(hashBefore);
        Data(taken).GetProperty("itemRevision").GetInt32().Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(3, "history is kept");
        (await ScalarAsync("SELECT owner_message_id::text FROM ssf.own_schedule_item_revisions WHERE item_id = @i AND revision_number = 3", ("i", item))).Should().Be(message.ToString());

        // The job again: its words as they were, and his trail restarted once more.
        var job = await JobAsync(a.JobId!.Value);
        job.Title.Should().Be(jobBefore.Title);
        job.Quantity.Should().Be(jobBefore.Quantity);
        job.Seen.Should().BeFalse();
        job.Accepted.Should().BeFalse();
        Data(taken).GetProperty("jobChanged").GetBoolean().Should().BeTrue();

        // Append-only: the decisions are three rows, in order, and a replayed take-back writes nothing.
        (await ScalarAsync("SELECT string_agg(kind::text, ',' ORDER BY sequence) FROM ssf.schedule_owner_message_states WHERE kind IN (1, 2, 3)")).Should().Be("1,3");
        (await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back"))).Should().NotBeNull();
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 3")).Should().Be(1);

        // After a take-back the farmer may accept again: a new decision, a new revision.
        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE item_id = @i", ("i", item))).Should().Be(4);
    }

    [Fact]
    public async Task TakeBack_LeavesADoneJobAlone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        await ExecOnSuperuserAsync("UPDATE ssf.planned_work SET status = 'Done', done_at_utc = NOW() WHERE id = @i", ("i", a.JobId!.Value));

        var taken = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back"));

        Data(taken).GetProperty("jobChanged").GetBoolean().Should().BeFalse("a job that is done is history");
        (await JobAsync(a.JobId!.Value)).Quantity.Should().Be(DoseNew);
    }

    [Fact]
    public async Task KeepOld_WritesStateOnly()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var before = await UntouchedAsync();
        var audits = await CountAsync("SELECT count(*) FROM ssf.audit_events");

        var kept = await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "keep_old"));

        Data(kept).GetProperty("decision").GetString().Should().Be("kept_old");
        (await UntouchedAsync()).Should().Be(before, "keeping the old one writes the decision and nothing else");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 2")).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events")).Should().Be(audits + 1);
        (await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "keep_old"))).Should().NotBeNull();
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 2")).Should().Be(1, "a second keep is the same decision");

        // Nothing was accepted, so there is nothing to take back; the farmer may still change his mind and accept (a later decision never edits the earlier one).
        (await DecideAsync(Owner, a.Plot, a.Cycle, message, "take_back")).ErrorMessage.Should().Contain("OwnerMessageNothingToTakeBack");
        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        (await ScalarAsync("SELECT string_agg(kind::text, ',' ORDER BY sequence) FROM ssf.schedule_owner_message_states WHERE kind IN (1, 2, 3)")).Should().Be("2,1");
        (await DecideAsync(Owner, a.Plot, a.Cycle, message, "keep_old")).ErrorMessage.Should().Contain("OwnerMessageAlreadyAccepted");
    }

    [Fact]
    public async Task WorkerCannotDecide()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var before = await UntouchedAsync();

        (await DecideAsync(Worker, a.Plot, a.Cycle, message, "accept")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await DecideAsync(Mukadam, a.Plot, a.Cycle, message, "accept")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await DecideAsync(Mukadam, a.Plot, a.Cycle, message, "accept")).ErrorCode.Should().Be("ShramSafal.Forbidden", "planning permission alone does not write the own schedule");
        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates);
        (await DecideAsync(Mukadam, a.Plot, a.Cycle, message, "keep_old")).ErrorCode.Should().Be("ShramSafal.Forbidden", "the schedule permission alone does not plan");
        (await AnswerAsync(Worker, a.Plot, a.Cycle, message, "first")).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await UntouchedAsync()).Should().Be(before);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states")).Should().Be(0);

        await GrantAsync(Mukadam, FarmAuthority.ScheduleTemplates, FarmAuthority.PlanWork);
        await OkAsync(DecideAsync(Mukadam, a.Plot, a.Cycle, message, "keep_old"));
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 2")).Should().Be(1);
    }

    [Fact]
    public async Task Decide_ThatIsNotACheckedNewVersion_OrNotFollowed_IsRefused_AndSwitchOffRefuses()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        var tip = await SendOkAsync(a.V1, "tip", "t-spray");

        // A tip is heard, never decided.
        (await DecideAsync(Owner, a.Plot, a.Cycle, tip, "accept")).ErrorMessage.Should().Contain("OwnerMessageNotAChange");
        (await DecideAsync(Owner, a.Plot, a.Cycle, Guid.NewGuid(), "accept")).ErrorMessage.Should().Contain("OwnerMessageNotFollowed");
        (await DecideAsync(Owner, a.Plot, a.Cycle, message, "maybe")).ErrorMessage.Should().Contain("OwnerMessageDecision");

        // A new version withdrawn since the message was sent is never taken.
        (await CheckAsync(PlatformEmployee, a.V2, "Withdrawn", note: "withdrawn after the message")).Status.Should().Be(HttpStatusCode.OK);
        var refused = await DecideAsync(Owner, a.Plot, a.Cycle, message, "accept");
        refused.ErrorMessage.Should().Contain("ChangeNeedsACheckedVersion");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states")).Should().Be(0);

        // A work made by hand under the same key is never overwritten by a change.
        var b = await ArrangeAsync(took: false);
        var handMessage = await SendOkAsync(b.V1, "change", "t-prune", newVersion: b.V2);
        await OkAsync(PushAsAsync(Owner, "ownschedule.item.save", $"own-save-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = b.Plot,
            ["cropCycleId"] = b.Cycle,
            ["task"] = new Dictionary<string, object?>
            {
                ["taskKey"] = "t-prune",
                ["name"] = "माझे काम",
                ["kind"] = "work",
                ["basis"] = "experience",
                ["stageIndex"] = 0,
                ["order"] = 5,
                ["timing"] = new Dictionary<string, object?> { ["timer"] = "day", ["fromDay"] = 3, ["toDay"] = null },
            },
        }, "1.0.18"));
        (await DecideAsync(Owner, b.Plot, b.Cycle, handMessage, "accept")).ErrorMessage.Should().Contain("OwnerMessageKeyInUse");

        // Off for the farm: refused whole, before anything looks at it.
        await ExecOnSuperuserAsync("UPDATE ssf.feature_flags SET enabled = FALSE WHERE flag_name = 'schedule_mechanism'");
        (await DecideAsync(Owner, a.Plot, a.Cycle, tip, "keep_old")).ErrorCode.Should().Be(OffCode);
        (await HeardAsync(Owner, a.Plot, tip)).ErrorCode.Should().Be(OffCode);
        (await AnswerAsync(Owner, a.Plot, a.Cycle, tip, "first")).ErrorCode.Should().Be(OffCode);
    }

    // ---- heard is its own count --------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task HeardIsSeparateFromDone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var tip = await SendOkAsync(a.V1, "tip", "t-spray");
        var doneBefore = await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE status = 'Done'");
        var logsBefore = await CountAsync("SELECT count(*) FROM ssf.daily_logs");

        var first = await OkAsync(HeardAsync(Mukadam, a.Plot, tip));
        var second = await OkAsync(HeardAsync(Owner, a.Plot, tip));

        Data(first).GetProperty("replayed").GetBoolean().Should().BeFalse();
        Data(second).GetProperty("replayed").GetBoolean().Should().BeTrue("the first full play stands: a second play writes nothing");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 0 AND message_id = @m", ("m", tip))).Should().Be(1);
        (await ScalarAsync("SELECT by_user_id::text FROM ssf.schedule_owner_message_states WHERE kind = 0")).Should().Be(Mukadam.ToString());
        (await CountAsync("SELECT count(*) FROM ssf.planned_work WHERE status = 'Done'")).Should().Be(doneBefore, "hearing is not doing");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_task_events")).Should().Be(0, "hearing is not the farmer's answer about a sign either");
        (await CountAsync("SELECT count(*) FROM ssf.daily_logs")).Should().Be(logsBefore);

        // Only a seat on the farm hears; a plot that does not follow that schedule hears nothing.
        (await HeardAsync(Guid.NewGuid(), a.Plot, tip)).ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await HeardAsync(OwnerB, PlotB, tip, FarmB)).ErrorCode.Should().Be(OffCode, "the switch is not on for farm B");
        await SwitchOnAsync(FarmA, FarmB);
        (await HeardAsync(OwnerB, PlotB, tip, FarmB)).ErrorMessage.Should().Contain("OwnerMessageNotFollowed");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 0")).Should().Be(1);
    }

    // ---- look and tell --------------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Look_TwoAnswers_FirstAnswerIsKept_AndChangesNothingElse()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var look = await SendOkAsync(a.V1, "look", "t-water", first: "दव आहे", second: "दव नाही");
        var tip = await SendOkAsync(a.V1, "tip", "t-water");
        var before = await UntouchedAsync();

        (await AnswerAsync(Owner, a.Plot, a.Cycle, look, "third")).ErrorMessage.Should().Contain("OwnerMessageAnswer");
        (await AnswerAsync(Owner, a.Plot, a.Cycle, tip, "first")).ErrorMessage.Should().Contain("OwnerMessageNotALook");
        var one = await OkAsync(AnswerAsync(Owner, a.Plot, a.Cycle, look, "second"));
        var two = await OkAsync(AnswerAsync(Owner, a.Plot, a.Cycle, look, "first"));

        Data(one).GetProperty("answer").GetString().Should().Be("second");
        Data(two).GetProperty("replayed").GetBoolean().Should().BeTrue();
        Data(two).GetProperty("answer").GetString().Should().Be("second", "the first answer is kept");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_message_states WHERE kind = 4")).Should().Be(1);
        (await UntouchedAsync()).Should().Be(before);

        // The pull carries the look's words and BOTH follow-up clips, and the answer in the farm's state.
        using var pull = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", Owner);
        var root = JsonDocument.Parse(await pull.Content.ReadAsStringAsync()).RootElement;
        var row = root.GetProperty("ownerMessages").EnumerateArray().Single(m => m.GetProperty("id").GetGuid() == look);
        row.GetProperty("answerFirst").GetString().Should().Be("दव आहे");
        row.GetProperty("answerSecond").GetString().Should().Be("दव नाही");
        row.GetProperty("followUpFirstClipId").GetGuid().Should().NotBe(Guid.Empty);
        row.GetProperty("followUpSecondClipId").GetGuid().Should().NotBe(Guid.Empty);
        root.GetProperty("ownerMessageStates").EnumerateArray().Single(s => s.GetProperty("kind").GetString() == "answered").GetProperty("answer").GetString().Should().Be("second");
    }

    // ---- the pull -------------------------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task NewPhonePull_CarriesTheVoice_AndAnOldPhoneNeverSeesTheKeys_AndAnotherFarmSeesNone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        await SendOkAsync(a.V1, "tip", "t-spray");
        await OkAsync(HeardAsync(Owner, a.Plot, await SendOkAsync(a.V1, "tip", "t-water")));

        using var fresh = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", Owner);
        var body = await fresh.Content.ReadAsStringAsync();
        fresh.IsSuccessStatusCode.Should().BeTrue(body);
        var root = JsonDocument.Parse(body).RootElement;
        root.GetProperty("ownerMessages").GetArrayLength().Should().Be(2);
        root.GetProperty("ownerClips").GetArrayLength().Should().Be(2);
        root.GetProperty("ownerMessageStates").GetArrayLength().Should().Be(1);
        body.Should().NotContain("storageKey", "the bytes and where they live never travel in the pull");

        using var oldPhone = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", Owner);
        var oldBody = await oldPhone.Content.ReadAsStringAsync();
        oldBody.Should().NotContain("ownerMessages").And.NotContain("ownerClips").And.NotContain("ownerMessageStates", "an old phone's pull is byte for byte what it was (P11)");

        // Farm B follows nothing of this schedule and owns no copy from it: it sees no message and cannot fetch a clip.
        await SwitchOnAsync(FarmA, FarmB);
        using var other = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}&scheduleFormat=2", OwnerB);
        var otherRoot = JsonDocument.Parse(await other.Content.ReadAsStringAsync()).RootElement;
        otherRoot.GetProperty("ownerMessages").GetArrayLength().Should().Be(0);
        otherRoot.GetProperty("ownerClips").GetArrayLength().Should().Be(0);
        var clipId = root.GetProperty("ownerClips")[0].GetProperty("id").GetGuid();
        using var theirClip = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}?farmId={FarmB}", OwnerB);
        theirClip.StatusCode.Should().Be(HttpStatusCode.NotFound, "row security hides a clip of a schedule the farm does not follow: the same answer as no such clip");
        using var notMember = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}?farmId={FarmA}", OwnerB);
        notMember.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a farm he is no member of is refused before anything is read");
    }

    // ---- row security, both directions, as the real application role -----------------------------------------------------------------------------

    [Fact]
    public async Task Rls_BothDirections_AsTheAppRole()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync();
        var change = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        await OkAsync(HeardAsync(Owner, a.Plot, change));
        foreach (var table in new[] { "schedule_owner_clips", "schedule_owner_messages", "schedule_owner_message_states" })
        {
            (await CountAsync($"SELECT count(*) FROM pg_class WHERE oid = 'ssf.{table}'::regclass AND relrowsecurity AND relforcerowsecurity")).Should().Be(1, $"{table} is FORCE row security");
        }

        // Reading: the farm that follows the schedule sees its messages and clips and its own state; another farm sees none; the sender sees his own; a bare scope sees none.
        (await AppRowsAsync(FarmA, Owner, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(1);
        (await AppRowsAsync(FarmA, Owner, "SELECT 1 FROM ssf.schedule_owner_clips")).Should().Be(1);
        (await AppRowsAsync(FarmA, Owner, "SELECT 1 FROM ssf.schedule_owner_message_states")).Should().Be(1);
        (await AppRowsAsync(null, Owner, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(1, "a pull reads under the user scope of the farms he belongs to");
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(0);
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_clips")).Should().Be(0);
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_message_states")).Should().Be(0);
        (await AppRowsAsync(null, PlatformOwner, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(1, "the sender sees what he sent");
        (await AppRowsAsync(null, PlatformEmployee, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(0, "a colleague who did not send it, and follows nothing, sees nothing");
        (await AppRowsAsync(null, null, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(0);

        // A farm that owns a COPY from the schedule (an own work with an origin in its chain) sees the messages even if it follows nothing; it is the second arm of the rule.
        await ExecOnSuperuserAsync("""
            CREATE TEMP TABLE o AS SELECT * FROM ssf.own_schedule_item_origins LIMIT 1;
            UPDATE o SET id = gen_random_uuid(), item_id = gen_random_uuid(), farm_id = @fb, plot_id = @pb, crop_cycle_id = @cb, owner_user_id = @ob;
            INSERT INTO ssf.own_schedule_item_origins SELECT * FROM o;
            """, ("fb", FarmB), ("pb", PlotB), ("cb", CycleB), ("ob", OwnerB));
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_messages")).Should().Be(1, "it owns a copy of a work of that schedule");
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_clips")).Should().Be(1);
        (await AppRowsAsync(FarmB, OwnerB, "SELECT 1 FROM ssf.schedule_owner_message_states")).Should().Be(0, "but farm A's state is farm A's");

        // Writing a message or clip: only the sender, and only with NO farm scope (no farm seat of any role writes one). No update, no delete.
        string InsertMessage(Guid sender) => $"""
            INSERT INTO ssf.schedule_owner_messages (id, chain_id, schedule_version_id, task_key, kind, clip_id, sent_by_user_id, sent_at_utc)
            VALUES (gen_random_uuid(), gen_random_uuid(), '{a.V1}'::uuid, 'x-probe', 0, gen_random_uuid(), '{sender}'::uuid, NOW())
            """;
        (await AppTryAsync(FarmA, Owner, InsertMessage(Owner))).Should().Be("42501", "a farm scope never writes an owner message");
        (await AppTryAsync(null, Owner, InsertMessage(PlatformOwner))).Should().Be("42501", "nor does anyone write one in another person's name");
        (await AppTryAsync(null, PlatformOwner, InsertMessage(PlatformOwner))).Should().BeNull("the positive control: the sender, under his own user scope");
        (await AppTryAsync(null, PlatformOwner, "UPDATE ssf.schedule_owner_messages SET task_key = 'x'")).Should().Be("42501");
        (await AppTryAsync(null, PlatformOwner, "DELETE FROM ssf.schedule_owner_messages")).Should().Be("42501");
        (await AppTryAsync(null, PlatformOwner, "UPDATE ssf.schedule_owner_clips SET duration_ms = 1")).Should().Be("42501");
        (await AppTryAsync(null, PlatformOwner, "DELETE FROM ssf.schedule_owner_clips")).Should().Be("42501");

        // Writing a state: the farm's own scope, the farm's owner, a plot and season of that farm; append-only.
        string InsertState(Guid farm, Guid owner, Guid plot, Guid? cycle, short kind = 0) => $"""
            INSERT INTO ssf.schedule_owner_message_states (id, farm_id, plot_id, crop_cycle_id, owner_user_id, message_id, kind, sequence, answer, item_created, by_user_id, at_utc)
            VALUES (gen_random_uuid(), '{farm}'::uuid, '{plot}'::uuid, {(cycle is { } c ? $"'{c}'::uuid" : "NULL")}, '{owner}'::uuid, '{change}'::uuid, {kind}, 0, NULL, false, '{owner}'::uuid, NOW())
            """;
        (await AppTryAsync(FarmB, OwnerB, InsertState(FarmA, Owner, PlotB, null))).Should().Be("42501", "farm B's scope cannot write a row of farm A");
        (await AppTryAsync(FarmA, Owner, InsertState(FarmB, OwnerB, PlotB, null))).Should().Be("42501", "nor farm A's scope one of farm B");
        (await AppTryAsync(FarmA, Owner, InsertState(FarmA, OwnerB, a.Plot, null))).Should().Be("42501", "the owner is the farm's, never a writer's");
        (await AppTryAsync(FarmA, Owner, InsertState(FarmA, Owner, PlotB, null))).Should().Be("42501", "the plot must be the farm's");
        (await AppTryAsync(FarmA, Owner, InsertState(FarmA, Owner, a.Plot, CycleB, kind: 4))).Should().Be("42501", "the season must be that plot's");
        (await AppTryAsync(FarmA, Owner, InsertState(FarmA, Owner, PlotA, null))).Should().BeNull("the positive control: a heard of the farm's own plot (no season)");
        (await AppTryAsync(FarmA, Owner, "UPDATE ssf.schedule_owner_message_states SET kind = 1")).Should().Be("42501");
        (await AppTryAsync(FarmA, Owner, "DELETE FROM ssf.schedule_owner_message_states")).Should().Be("42501");
    }

    [Fact]
    public async Task Down_Refuses_WithItsOwnWords_WhileARowExists_AndRunsCleanWithNone()
    {
        // The refusal must PARSE: a syntax error would also "throw", so the test reads the refusal's own words, and with no row the same text must run clean.
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using (var empty = raw.CreateCommand())
        {
            empty.CommandText = ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleOwnerVoice.DownRefusalSql;
            await empty.ExecuteNonQueryAsync();
        }

        ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleOwnerVoice.DownRefusalSql.Should().NotContain("farmer's", "an apostrophe inside a SQL string literal is a syntax error");
        var a = await ArrangeAsync();
        await SendOkAsync(a.V1, "tip", "t-spray");
        await using var down = raw.CreateCommand();
        down.CommandText = ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleOwnerVoice.DownRefusalSql;
        var refused = async () => await down.ExecuteNonQueryAsync();
        var thrown = (await refused.Should().ThrowAsync<PostgresException>()).Which;
        thrown.MessageText.Should().Contain("Down refused: 1 owner clip(s), 1 owner message(s), 0 owner message state row(s) and 0 own work revision(s) naming a message exist");
        thrown.MessageText.Should().Contain("Nothing changed.");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_owner_messages")).Should().Be(1, "nothing changed");
    }

    [Fact]
    public async Task Down_Refuses_WhileARevisionNamesAMessage()
    {
        var a = await ArrangeAsync();
        var message = await SendOkAsync(a.V1, "change", "t-spray", newVersion: a.V2);
        await OkAsync(DecideAsync(Owner, a.Plot, a.Cycle, message, "accept"));
        await ExecOnSuperuserAsync("DELETE FROM ssf.schedule_owner_message_states");
        await ExecOnSuperuserAsync("DELETE FROM ssf.schedule_owner_messages; DELETE FROM ssf.schedule_owner_clips;");
        (await CountAsync("SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE owner_message_id IS NOT NULL")).Should().Be(1);

        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var down = raw.CreateCommand();
        down.CommandText = ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleOwnerVoice.DownRefusalSql;
        var refused = async () => await down.ExecuteNonQueryAsync();
        (await refused.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("1 own work revision(s) naming a message exist");
    }

    [Fact]
    public async Task Grants_AreAppendOnly_AndTheGuardRunsClean()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync(ShramSafal.Infrastructure.Persistence.Migrations.AddScheduleOwnerVoice.GrantsSql);
        foreach (var table in new[] { "schedule_owner_clips", "schedule_owner_messages", "schedule_owner_message_states" })
        {
            (await ScalarAsync($"SELECT has_table_privilege('agrisync_app', 'ssf.{table}', 'SELECT') AND has_table_privilege('agrisync_app', 'ssf.{table}', 'INSERT')")).Should().Be("True");
            foreach (var priv in new[] { "UPDATE", "DELETE", "TRUNCATE" })
            {
                (await ScalarAsync($"SELECT has_table_privilege('agrisync_app', 'ssf.{table}', '{priv}')")).Should().Be("False", $"{table} {priv}");
            }
        }
    }

    // ---- the follower fetches clips only of what the farm follows -----------------------------------------------------------------------------

    [Fact]
    public async Task ClipRoute_OnlyForAFarmWhoseSchedule_ItFollows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        var (_, text) = await SendMessageAsync(PlatformOwner, a.V1, "tip", "t-spray", Tone(1500));
        var clipId = Json(text).GetProperty("clips")[0].GetProperty("id").GetGuid();

        foreach (var who in new[] { Owner, CoOwner, Mukadam, Worker })
        {
            using var ok = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}?farmId={FarmA}", who);
            ok.StatusCode.Should().Be(HttpStatusCode.OK, $"{who} holds a seat on a farm whose plot follows that schedule");
        }

        // A plot that stops following loses nothing it already has on its phone, but the server no longer serves it: the plot's choice is abandoned.
        await ExecOnSuperuserAsync("UPDATE ssf.schedule_subscriptions SET state = 2 WHERE plot_id = @p", ("p", a.Plot));
        using var gone = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}?farmId={FarmA}", Owner);
        gone.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var anon = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}", Owner);
        anon.StatusCode.Should().Be(HttpStatusCode.NotFound, "without a farm only the sender reads a clip");
        using var sender = await SendAsync(HttpMethod.Get, $"/shramsafal/schedule-owner-clips/{clipId}", PlatformOwner);
        sender.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task StaffList_ShowsWhatTheSenderSent_ToStaffOnly()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var a = await ArrangeAsync(took: false);
        await SendOkAsync(a.V1, "tip", "t-spray");
        await SendOkAsync(a.V1, "look", "t-water", first: "दव आहे", second: "दव नाही");

        var (status, body) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{a.V1}/owner-messages", PlatformOwner, null);
        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("messages").GetArrayLength().Should().Be(2);
        Json(body).GetProperty("clips").GetArrayLength().Should().Be(4);
        (await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{a.V1}/owner-messages", Owner, null)).Status.Should().Be(HttpStatusCode.Forbidden);
    }
}
