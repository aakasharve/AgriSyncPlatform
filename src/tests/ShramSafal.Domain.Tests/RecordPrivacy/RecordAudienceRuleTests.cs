// spec: plr-d10 lane PRV (founder D-26) — the pure halves of "who may see this record": the rule, the stamp an audience
// change leaves on a record, the pull's withdrawn-list rule at whole-second grain, and what follows a hidden record.
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.RecordPrivacy;

public sealed class RecordAudienceRuleTests
{
    private static readonly Guid Farm = Guid.Parse("7a000000-0000-4000-8000-0000000000f1");
    private static readonly Guid Holder = Guid.Parse("7a000000-0000-4000-8000-000000000001");
    private static readonly Guid Maker = Guid.Parse("7a000000-0000-4000-8000-000000000002");
    private static readonly Guid Chosen = Guid.Parse("7a000000-0000-4000-8000-000000000003");
    private static readonly Guid Other = Guid.Parse("7a000000-0000-4000-8000-000000000004");

    private static FarmReadScope Scope(bool primary = false, bool ownOnly = false, bool money = true) =>
        new(Farm, ownOnly, money, money, false, true, true, !ownOnly, primary, null) { IsRecordHolder = primary };

    // ── The rule ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Team_is_todays_behaviour_for_every_working_seat_and_nothing_without_a_seat()
    {
        RecordAudienceRule.MaySee(Scope(), Other, RecordAudience.Team, Maker, []).Should().BeTrue();
        RecordAudienceRule.MaySee(null, Other, RecordAudience.Team, Maker, []).Should().BeFalse("no seat, nothing");
    }

    [Fact]
    public void Only_me_is_the_primary_account_holder_and_the_person_who_made_it()
    {
        RecordAudienceRule.MaySee(Scope(primary: true), Holder, RecordAudience.OnlyMe, Maker, []).Should().BeTrue();
        RecordAudienceRule.MaySee(Scope(), Maker, RecordAudience.OnlyMe, Maker, []).Should().BeTrue("the maker always stays");
        RecordAudienceRule.MaySee(Scope(), Other, RecordAudience.OnlyMe, Maker, []).Should().BeFalse("a co-owner who sees money is still left out");
        RecordAudienceRule.MaySee(Scope(), Chosen, RecordAudience.OnlyMe, Maker, [Chosen]).Should().BeFalse("a stale choice never widens 'only me'");
    }

    [Fact]
    public void Selected_is_the_holder_the_maker_and_the_chosen_people_only()
    {
        RecordAudienceRule.MaySee(Scope(primary: true), Holder, RecordAudience.Selected, Maker, [Chosen]).Should().BeTrue();
        RecordAudienceRule.MaySee(Scope(), Maker, RecordAudience.Selected, Maker, [Chosen]).Should().BeTrue();
        RecordAudienceRule.MaySee(Scope(), Chosen, RecordAudience.Selected, Maker, [Chosen]).Should().BeTrue();
        RecordAudienceRule.MaySee(Scope(), Other, RecordAudience.Selected, Maker, [Chosen]).Should().BeFalse();
        RecordAudienceRule.MaySee(null, Chosen, RecordAudience.Selected, Maker, [Chosen]).Should().BeFalse("chosen, but no working seat now");
        RecordAudienceRule.MaySee(Scope(), Guid.Empty, RecordAudience.Selected, Guid.Empty, [Guid.Empty]).Should().BeFalse();
    }

    // ── The stamp ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void An_audience_change_moves_the_record_strictly_forward_in_whole_microseconds_never_on_a_whole_second()
    {
        var current = new DateTime(2026, 11, 1, 10, 0, 0, 500, DateTimeKind.Utc).AddTicks(3);
        AudienceStamp.NextModified(current, current.AddSeconds(-5)).Should().BeAfter(current, "a clock behind the record still moves it forward");
        var onTheSecond = new DateTime(2026, 11, 1, 10, 0, 1, DateTimeKind.Utc);
        var next = AudienceStamp.NextModified(current, onTheSecond);
        (next.Ticks % TimeSpan.TicksPerSecond).Should().NotBe(0, "a cursor equal to a whole second would pass it unread");
        (next.Ticks % 10).Should().Be(0, "Postgres keeps whole microseconds");
        next.Should().BeAfter(current);
        AudienceStamp.NextModified(current, current.AddTicks(4)).Should().BeAfter(current);
    }

    [Fact]
    public void Setting_an_audience_changes_who_sees_the_record_and_nothing_it_says()
    {
        var created = new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc);
        var log = DailyLog.Create(Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Maker),
            new DateOnly(2026, 10, 30), "k", null, created);
        log.Audience.Should().Be(RecordAudience.Team, "every record starts with the normal team; capture never asks (P9)");
        var version = log.ContentVersion;

        log.SetAudience(RecordAudience.OnlyMe, created.AddMinutes(5));

        log.Audience.Should().Be(RecordAudience.OnlyMe);
        log.ModifiedAtUtc.Should().BeAfter(created, "it moves past every phone's cursor");
        log.AudienceChangedAtUtc.Should().Be(log.ModifiedAtUtc);
        log.ContentVersion.Should().Be(version, "what the record says is untouched (P3)");
        log.VerificationEvents.Should().BeEmpty();
        var unknown = (RecordAudience)7;
        var act = () => log.SetAudience(unknown, created);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    // ── The withdrawn list, at whole-second grain ────────────────────────────────────────

    private static readonly DateTime Cursor = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private static PullAudience Pull(DateTime since, DateTime now, params RestrictedRecord[] restricted)
    {
        var scopes = new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() };
        return new PullAudience(
            RecordVisibility.For(Other, scopes, restricted),
            new PullReadWindow(scopes, since, now),
            since,
            now);
    }

    private static (DailyLog Log, RestrictedRecord Record) Hidden(DateTime created, DateTime changedAt)
    {
        var log = DailyLog.Create(Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Maker),
            new DateOnly(2026, 10, 30), $"k-{Guid.NewGuid():N}", null, created);
        log.SetAudience(RecordAudience.OnlyMe, changedAt);
        return (log, RestrictedRecord.Of(log, []));
    }

    [Fact]
    public void A_record_he_held_whose_audience_changed_after_his_cursor_is_withdrawn_and_the_cursor_passes_that_second()
    {
        var (log, record) = Hidden(Cursor.AddMinutes(-10), Cursor.AddSeconds(2).AddMilliseconds(300));
        var pull = Pull(Cursor, Cursor.AddSeconds(5), record);

        pull.Logs([log]).Should().BeEmpty("never sent");
        pull.Withdrawn.Should().Equal(new WithdrawnRecordDto(RecordKinds.DailyLog, log.Id));
        pull.DeliveredThroughUtc.Should().Be(Cursor.AddSeconds(3), "the next whole-second cursor is past the change: never twice");
        pull.PendingCapUtc.Should().BeNull();

        var again = Pull(Cursor.AddSeconds(3), Cursor.AddSeconds(6), record);
        again.Logs([log]);
        again.Withdrawn.Should().BeEmpty("told once");
    }

    [Fact]
    public void A_change_whose_second_is_still_running_is_not_named_yet_and_holds_the_cursor_below_it()
    {
        var changed = Cursor.AddSeconds(4).AddMilliseconds(100);
        var (log, record) = Hidden(Cursor.AddMinutes(-10), changed);
        var pull = Pull(Cursor, Cursor.AddSeconds(4).AddMilliseconds(600), record);

        pull.Logs([log]);
        pull.Withdrawn.Should().BeEmpty("its second is not over");
        pull.PendingCapUtc.Should().Be(Cursor.AddSeconds(4), "the next pull's cursor cannot pass this young change");

        var next = Pull(Cursor.AddSeconds(4), Cursor.AddSeconds(5).AddMilliseconds(200), record);
        next.Logs([log]);
        next.Withdrawn.Should().ContainSingle("the next pull names it");
    }

    [Fact]
    public void Nothing_is_named_on_a_pull_from_the_beginning_or_for_a_change_he_was_already_told()
    {
        var (old, oldRecord) = Hidden(Cursor.AddMinutes(-10), Cursor.AddSeconds(2).AddMilliseconds(5));
        var zero = Pull(DateTime.UnixEpoch, Cursor.AddSeconds(9), oldRecord);
        zero.Logs([old]);
        zero.Withdrawn.Should().BeEmpty("a pull from the beginning names no restricted record");

        var before = Pull(Cursor.AddSeconds(3), Cursor.AddSeconds(9), oldRecord);
        before.Logs([old]);
        before.Withdrawn.Should().BeEmpty("a change older than his cursor was told already");
    }

    [Fact]
    public void A_restricted_records_photos_bills_and_parse_follow_it_and_a_text_naming_it_is_his_no_more()
    {
        var (log, record) = Hidden(Cursor.AddMinutes(-10), Cursor);
        var withJob = record with { SourceAiJobId = Guid.NewGuid() };
        var bill = Guid.NewGuid();
        var money = RestrictedRecord.Of(
            ShramSafal.Domain.Finance.CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), null, null, "fertilizer", "x", 10m, "INR",
                new DateOnly(2026, 10, 30), new UserId(Maker), null, Cursor, clientAttachmentIdsJson: $"[\"{bill}\"]"),
            []) with
        { Audience = RecordAudience.OnlyMe };
        var visibility = RecordVisibility.For(Other, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() }, [withJob, money]);

        visibility.MaySeeLog(log.Id).Should().BeFalse();
        visibility.MaySeeCost(money.Id).Should().BeFalse();
        visibility.HiddenAiJobIds.Should().Contain(withJob.SourceAiJobId!.Value);
        visibility.MaySeeAttachment(Attachment.Create(Guid.NewGuid(), new FarmId(Farm), log.Id, "DailyLog", "a.jpg", "image/jpeg", new UserId(Maker), Cursor))
            .Should().BeFalse("a photo of a record kept from him");
        visibility.MaySeeAttachment(Attachment.Create(bill, new FarmId(Farm), Farm, "Bill", "b.jpg", "image/jpeg", new UserId(Maker), Cursor))
            .Should().BeFalse("a bill the money record names");
        visibility.MentionsHidden($"{{\"dailyLogId\":\"{log.Id.ToString().ToUpperInvariant()}\"}}").Should().BeTrue();
        visibility.MentionsHidden("{\"missed\":3}").Should().BeFalse();
        visibility.AnyHiddenOn(Farm).Should().BeTrue();
    }
}
