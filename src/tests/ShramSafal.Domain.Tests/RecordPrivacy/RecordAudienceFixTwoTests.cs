// spec: plr-d10 lane PRV fix pass 2 — the pure halves of the second review:
//   L4  the PUSH gate itself names the record of a lower-case create_attachment and of jobcard.complete (a later
//       refusal by the handler can no longer hide whether the gate saw them);
//   N2  the bill-photo rules (named, and the L7 fail-closed one) never hide a photo from the person who took it.
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.RecordPrivacy;

public sealed class RecordAudienceFixTwoTests
{
    private static readonly Guid Farm = Guid.Parse("7a000000-0000-4000-8000-0000000000f3");
    private static readonly Guid Maker = Guid.Parse("7a000000-0000-4000-8000-000000000022");
    private static readonly Guid Reader = Guid.Parse("7a000000-0000-4000-8000-000000000024");
    private static readonly DateTime At = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private static FarmReadScope Scope() => new(Farm, false, true, true, false, true, true, true, false, null);

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    [Theory]
    [InlineData("dailylog", RecordKinds.DailyLog)]
    [InlineData(" DAILYLOG ", RecordKinds.DailyLog)]
    [InlineData("DailyLog", RecordKinds.DailyLog)]
    [InlineData("costentry", RecordKinds.CostEntry)]
    public void L4_the_push_gate_names_the_record_of_a_create_attachment_whatever_the_case_of_its_kind(string kind, string expected)
    {
        var id = Guid.NewGuid();
        PushSyncBatchHandler.ChangeTarget("create_attachment", Json(new { linkedEntityType = kind, linkedEntityId = id.ToString() }))
            .Should().Be((expected, id), "the gate reads the kind as the handler does, so it refuses before the handler runs");
    }

    [Fact]
    public void L4_the_push_gate_names_the_record_a_job_card_completion_links()
    {
        var log = Guid.NewGuid();
        PushSyncBatchHandler.ChangeTarget("jobcard.complete", Json(new { jobCardId = Guid.NewGuid().ToString(), dailyLogId = log.ToString() }))
            .Should().Be((RecordKinds.DailyLog, log));
        PushSyncBatchHandler.ChangeTarget("create_attachment", Json(new { linkedEntityType = "Farm", linkedEntityId = Farm.ToString() }))
            .Should().BeNull("a farm's own photo names no record");
    }

    [Fact]
    public void N2_the_bill_photo_rules_never_hide_a_photo_from_the_person_who_took_it()
    {
        var hidden = ShramSafal.Domain.Finance.CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), null, null, "fertilizer", "x", 10m, "INR",
            new DateOnly(2026, 10, 30), new UserId(Maker), null, At, clientAttachmentIdsJson: "{not a list");
        hidden.SetAudience(RecordAudience.OnlyMe, At.AddMinutes(1));
        var visibility = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() }, [RestrictedRecord.Of(hidden, [])]);

        var his = Attachment.Create(Guid.NewGuid(), new FarmId(Farm), Farm, "Bill", "his.jpg", "image/jpeg", new UserId(Reader), At);
        visibility.MaySeeAttachment(his).Should().BeTrue("he took it: no money record's rule keeps his own photo from him");
        var someoneElses = Attachment.Create(Guid.NewGuid(), new FarmId(Farm), Farm, "Bill", "b.jpg", "image/jpeg", new UserId(Maker), At);
        visibility.MaySeeAttachment(someoneElses).Should().BeFalse("the L7 fail-closed rule still holds for everyone else's bills");

        var named = ShramSafal.Domain.Finance.CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), null, null, "fertilizer", "x", 10m, "INR",
            new DateOnly(2026, 10, 30), new UserId(Maker), null, At, clientAttachmentIdsJson: JsonSerializer.Serialize(new[] { his.Id }));
        named.SetAudience(RecordAudience.OnlyMe, At.AddMinutes(1));
        RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() }, [RestrictedRecord.Of(named, [])])
            .MaySeeAttachment(his).Should().BeTrue("a money record kept from him that names his photo does not take it from him either");
    }
}
