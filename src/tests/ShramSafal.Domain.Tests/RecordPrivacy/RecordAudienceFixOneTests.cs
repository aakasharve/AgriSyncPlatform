// spec: plr-d10 lane PRV fix pass 1 — the pure halves of the review's findings:
//   M1  the withdrawn list no longer asks when the record was made (the phone may hold rows newer than its cursor);
//   M3  a dispute's age is the dispute's own time, never the record's last stamp (an audience change moves that);
//   L6  a stamp never moves a record's clock backwards;
//   L7  a money record kept from him whose photo list cannot be read hides the farm's bill photos (fail closed).
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.RecordPrivacy;

public sealed class RecordAudienceFixOneTests
{
    private static readonly Guid Farm = Guid.Parse("7a000000-0000-4000-8000-0000000000f2");
    private static readonly Guid Maker = Guid.Parse("7a000000-0000-4000-8000-000000000012");
    private static readonly Guid Reader = Guid.Parse("7a000000-0000-4000-8000-000000000014");
    private static readonly DateTime Cursor = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private static FarmReadScope Scope() => new(Farm, false, true, true, false, true, true, true, false, null);

    private static DailyLog Log(DateTime created) =>
        DailyLog.Create(Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Maker),
            new DateOnly(2026, 10, 30), $"k-{Guid.NewGuid():N}", null, created);

    [Fact]
    public void M1_a_record_made_after_his_held_cursor_is_still_named_when_it_is_withdrawn()
    {
        // A degraded answer delivered the record but held the cursor below it.
        var log = Log(Cursor.AddSeconds(5));
        log.SetAudience(RecordAudience.OnlyMe, Cursor.AddSeconds(10).AddMilliseconds(200));
        var scopes = new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() };
        var pull = new PullAudience(
            RecordVisibility.For(Reader, scopes, [RestrictedRecord.Of(log, [])]),
            new PullReadWindow(scopes, Cursor, Cursor.AddSeconds(20)),
            Cursor,
            Cursor.AddSeconds(20));

        pull.Logs([log]).Should().BeEmpty();
        pull.Withdrawn.Select(w => w.Id).Should().Equal(log.Id);
    }

    [Fact]
    public void M3_a_disputes_age_is_its_own_time_and_an_audience_change_does_not_reset_it()
    {
        var asOf = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var log = Log(asOf.AddDays(-12));
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Mukadam, UserId.New(), asOf.AddDays(-11));
        log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "wrong data", AppRole.PrimaryOwner, UserId.New(), asOf.AddDays(-10));
        log.SetAudience(RecordAudience.OnlyMe, asOf.AddHours(-1));

        var input = new ComplianceEvaluationInput(new FarmId(Farm), asOf, [], [], [log], [], []);
        ComplianceRuleBook.UnresolvedDisputes(input).Should().ContainSingle("disputed ten days ago, whatever moved since");
        var evidence = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.UnresolvedDisputeAgeHigh).Evaluate(input);
        evidence.Should().ContainSingle().Which.DescriptionEn.Should().Contain("2026-10-22", "the dispute's own day, never the stamp's");
    }

    [Fact]
    public void M4_repeated_skips_never_carry_an_activity_from_a_record_kept_from_anyone()
    {
        var asOf = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var hidden = Log(asOf.AddDays(-2));
        var tasks = Enumerable.Range(0, 3)
            .Select(_ => hidden.AddTask(Guid.NewGuid(), "गुप्त-फवारणी", null, asOf.AddDays(-2), ExecutionStatus.Skipped, "x", null))
            .ToList();
        hidden.SetAudience(RecordAudience.OnlyMe, asOf.AddDays(-1));
        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.RepeatedSkipsPerActivity);

        rule.Evaluate(new ComplianceEvaluationInput(new FarmId(Farm), asOf, [], tasks, [hidden], [], []))
            .Should().BeEmpty("the farm-level signal is read by every member; a narrowed record's activity is its content");

        hidden.SetAudience(RecordAudience.Team, asOf.AddHours(-1));
        rule.Evaluate(new ComplianceEvaluationInput(new FarmId(Farm), asOf, [], tasks, [hidden], [], []))
            .Should().ContainSingle("back with the whole team, it counts again");
    }

    [Fact]
    public void M5_an_export_leaves_out_the_ledger_of_money_kept_from_him_and_says_so_in_its_own_language()
    {
        var hidden = ShramSafal.Domain.Finance.CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), null, null, "fertilizer", "x", 4321.09m,
            "INR", new DateOnly(2026, 10, 30), new UserId(Maker), null, Cursor);
        hidden.SetAudience(RecordAudience.OnlyMe, Cursor.AddMinutes(1));
        var shownId = Guid.NewGuid();
        var ledgers = new[]
        {
            ShramSafal.Domain.Finance.DayLedger.Create(Guid.NewGuid(), new FarmId(Farm), hidden.Id, new DateOnly(2026, 10, 30), "equal", new UserId(Maker), [Allocation(4321.09m)], Cursor),
            ShramSafal.Domain.Finance.DayLedger.Create(Guid.NewGuid(), new FarmId(Farm), shownId, new DateOnly(2026, 10, 30), "equal", new UserId(Maker), [Allocation(10m)], Cursor),
        };
        var scopes = new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() };
        static ShramSafal.Domain.Finance.DayLedgerAllocation Allocation(decimal amount) =>
            ShramSafal.Domain.Finance.DayLedgerAllocation.Create(Guid.NewGuid(), Guid.NewGuid(), amount, "INR", Cursor);

        var forHim = ExportVisibility.Of(ledgers, RecordVisibility.For(Reader, scopes, [RestrictedRecord.Of(hidden, [])]));
        forHim.Shown.Select(l => l.SourceCostEntryId).Should().Equal(shownId);
        forHim.RuleNote.Should().Be("By ShramSafal's rules, some records are not counted here.", "W4, in the PDF's own language");

        var forMaker = ExportVisibility.Of(ledgers, RecordVisibility.For(Maker, scopes, [RestrictedRecord.Of(hidden, [])]));
        forMaker.Shown.Should().HaveCount(2);
        forMaker.RuleNote.Should().BeNull("nothing left out, nothing said");
    }

    [Fact]
    public void L6_a_task_stamped_by_a_slow_phone_never_moves_the_records_clock_backwards()
    {
        var log = Log(Cursor);
        log.SetAudience(RecordAudience.OnlyMe, Cursor.AddMinutes(30));
        var stamped = log.ModifiedAtUtc;

        log.AddTask(Guid.NewGuid(), "spray", null, Cursor.AddMinutes(1));

        log.ModifiedAtUtc.Should().BeOnOrAfter(stamped, "a narrowed record never slips back below the cursors it passed");
    }

    [Fact]
    public void L7_an_unreadable_photo_list_on_a_money_record_kept_from_him_hides_the_farms_bill_photos()
    {
        var entry = ShramSafal.Domain.Finance.CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), null, null, "fertilizer", "x", 10m, "INR",
            new DateOnly(2026, 10, 30), new UserId(Maker), null, Cursor, clientAttachmentIdsJson: "{not a list");
        entry.SetAudience(RecordAudience.OnlyMe, Cursor.AddMinutes(1));
        var visibility = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope() },
            [RestrictedRecord.Of(entry, [])]);

        var bill = Attachment.Create(Guid.NewGuid(), new FarmId(Farm), Farm, "Bill", "b.jpg", "image/jpeg", new UserId(Maker), Cursor);
        visibility.MaySeeAttachment(bill).Should().BeFalse("which bills it named cannot be read, so none of the farm's is shown (fail closed)");
        var recordPhoto = Attachment.Create(Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), "DailyLog", "p.jpg", "image/jpeg", new UserId(Maker), Cursor);
        visibility.MaySeeAttachment(recordPhoto).Should().BeTrue("a work record's photo follows its own record");
    }
}
