// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract §2.6) - what each door says a record carries, read without a database:
// a create's content buckets, its labour, an older phone's draft, and - with neither - the linked parse (its root buckets, the SAME names the ledger
// derivation reads: ExtractFieldProvenanceJson / LedgerDerivationService); the हजेरी door carries labour only; a revision carries only the kinds of the
// items it ADDS; an older phone's task line is read for its words; observations and reminders carry no kind.
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class WorkKindGateReadingTests
{
    private static CreateDailyLogCommand Create(
        string? content = null, ManualDraftItem? draft = null, IReadOnlyList<LabourItem>? labour = null,
        DailyLogCaptureScope door = DailyLogCaptureScope.WholeDay) =>
        new(
            FarmId: Guid.NewGuid(), PlotId: Guid.NewGuid(), CropCycleId: Guid.NewGuid(), RequestedByUserId: Guid.NewGuid(),
            OperatorUserId: Guid.NewGuid(), LogDate: new DateOnly(2026, 11, 27), Location: null, DeviceId: "d", ClientRequestId: "c",
            Labour: labour, ManualDraft: draft, CaptureScope: door, ContentJson: content);

    private static LabourItem Crew() => new(LabourAssignmentId: Guid.NewGuid(), EngagementType: "hired_daily", WorkerCount: 3);

    [Fact]
    public void A_create_carries_its_non_empty_content_buckets_and_its_labour()
    {
        var kinds = WorkKindGate.KindsOfCreate(
            Create("""{"schema":1,"cropActivities":[{"id":"c"}],"irrigation":[],"observations":[{"id":"o"}],"machinery":[{"id":"m"}]}""", labour: [Crew()]),
            sourceJobNormalizedJson: null);
        Assert.Equal(new[] { WorkKinds.CropActivities, WorkKinds.Labour, WorkKinds.Machinery }.Order(), kinds.Order());
    }

    [Fact]
    public void With_content_the_parse_is_not_what_he_recorded()
    {
        // The new phone takes a closed part out of its content; the parse still holds it, and is NOT counted (its derivation leaves it underived).
        var kinds = WorkKindGate.KindsOfCreate(
            Create("""{"schema":1,"irrigation":[{"id":"w"}]}"""),
            """{"cropActivities":[{"activity":"weeding"}],"irrigation":[{"method":"drip"}]}""");
        Assert.Equal(new[] { WorkKinds.Irrigation }, kinds.ToArray());
    }

    [Fact]
    public void An_older_phones_voice_confirm_is_read_from_its_parse()
    {
        var kinds = WorkKindGate.KindsOfCreate(
            Create(),
            """{"labour":[{"count":4}],"inputs":[{"product":"urea"}],"observations":[{"text":"x"}],"plannedTasks":[{"title":"y"}],"machinery":[]}""");
        Assert.Equal(new[] { WorkKinds.Inputs, WorkKinds.Labour }.Order(), kinds.Order());
    }

    [Fact]
    public void An_older_phones_manual_save_is_read_from_its_draft()
    {
        var draft = new ManualDraftItem(Labour: [new object()], ActivityExpenses: [new object()], Observations: [new object()], Inputs: []);
        var kinds = WorkKindGate.KindsOfCreate(Create(draft: draft), sourceJobNormalizedJson: """{"cropActivities":[{"a":1}]}""");
        Assert.Equal(new[] { WorkKinds.ActivityExpenses, WorkKinds.Labour }.Order(), kinds.Order());
    }

    [Fact]
    public void The_labour_door_carries_labour_only()
    {
        var kinds = WorkKindGate.KindsOfCreate(
            Create("""{"schema":1,"cropActivities":[{"id":"c"}]}""", door: DailyLogCaptureScope.Labour),
            """{"inputs":[{"p":1}]}""");
        Assert.Equal(new[] { WorkKinds.Labour }, kinds.ToArray());
    }

    [Fact]
    public void Observations_and_reminders_alone_carry_no_kind()
    {
        Assert.Empty(WorkKindGate.KindsOfCreate(Create("""{"schema":1,"observations":[{"id":"o"}],"plannedTasks":[{"id":"p"}]}"""), null));
        Assert.Empty(WorkKindGate.KindsOfTaskLine("observation"));
        Assert.Empty(WorkKindGate.KindsOfTaskLine("Reminder"));
        Assert.Empty(WorkKindGate.KindsOfTaskLine("  "));
    }

    [Fact]
    public void A_revision_carries_only_the_kinds_of_the_items_it_adds()
    {
        const string stored = """{"schema":1,"cropActivities":[{"id":"c-1","title":"खुरपणी"}],"irrigation":[{"id":"w-1"}]}""";
        Assert.Empty(WorkKindGate.NewItemKinds(stored, """{"schema":1,"cropActivities":[{"id":"c-1","title":"खुरपणी आणि बांधणी"}]}"""));
        Assert.Equal(
            new[] { WorkKinds.CropActivities },
            WorkKindGate.NewItemKinds(stored, """{"schema":1,"cropActivities":[{"id":"c-1"},{"id":"c-2"}],"irrigation":[{"id":"w-1"}]}""").ToArray());
        Assert.Equal(
            new[] { WorkKinds.Machinery },
            WorkKindGate.NewItemKinds(stored, """{"schema":1,"cropActivities":[{"id":"c-1"}],"machinery":[{"id":"m-1"}],"observations":[{"id":"o-9"}]}""").ToArray());
        Assert.Equal(new[] { WorkKinds.Irrigation }, WorkKindGate.NewItemKinds(null, """{"schema":1,"irrigation":[{"id":"w-1"}]}""").ToArray());
    }

    [Theory]
    [InlineData("पाणी दिले", WorkKinds.Irrigation)]
    [InlineData("फवारणी", WorkKinds.Inputs)]
    [InlineData("खत टाकले", WorkKinds.Inputs)]
    [InlineData("खुरपणी", WorkKinds.CropActivities)]
    [InlineData("zzzz", WorkKinds.CropActivities)]
    public void An_older_phones_task_line_is_read_for_its_kind(string words, string kind)
    {
        Assert.Equal(new[] { kind }, WorkKindGate.KindsOfTaskLine(words).ToArray());
    }
}
