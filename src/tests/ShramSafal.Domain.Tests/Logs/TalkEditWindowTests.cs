// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 B5; founder 28 Nov: "If there is any change, you can do it within 24 hours")
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.MoveDailyLog;
using ShramSafal.Application.UseCases.Logs.ReviseLogContent;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// <b>"बदल करता येतो · २४ तास"</b> — a TALK (a record saved straight from what he told Sathi) may be changed by its own
/// speaker for 24 hours from when the SERVER first stored it; after that his change of what he said is refused with a
/// typed reason. Nobody else is ever locked, and a record that is not a talk has no window (P11: every record a released
/// phone can make). The times here are fixed instants, so the edge (23:59:59 open, 24:00:00 closed) is exact.
/// </summary>
public sealed class TalkEditWindowTests
{
    private static readonly Guid Farm = Guid.Parse("b5000000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("b5000000-0000-0000-0000-000000000002");
    private static readonly Guid Speaker = Guid.Parse("b5000000-0000-0000-0000-000000000003");
    private static readonly Guid Stranger = Guid.Parse("b5000000-0000-0000-0000-000000000004");
    private static readonly DateOnly WorkDay = new(2026, 12, 8);

    /// <summary>When the server first stored the talk (its own clock at the create).</summary>
    private static readonly DateTime Stored = new(2026, 12, 8, 6, 30, 0, DateTimeKind.Utc);

    private static readonly JsonSerializerOptions WireOptions = new(JsonSerializerDefaults.Web);

    // ── The rule itself ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_talk_can_be_changed_until_24_hours_after_the_server_stored_it()
    {
        var talk = Talk(Speaker);

        talk.EditableUntilUtc.Should().Be(new DateTime(2026, 12, 9, 6, 30, 0, DateTimeKind.Utc));
        talk.EditableUntilUtc!.Value.Kind.Should().Be(DateTimeKind.Utc);
        TalkEditWindow.Length.Should().Be(TimeSpan.FromHours(24));
    }

    [Fact]
    public void The_speakers_change_is_open_one_second_before_the_instant_and_closed_at_it()
    {
        var talk = Talk(Speaker);

        talk.IsEditWindowClosedFor(Speaker, Stored.AddHours(24).AddSeconds(-1)).Should().BeFalse();
        talk.IsEditWindowClosedFor(Speaker, Stored.AddHours(24)).Should().BeTrue();
        talk.IsEditWindowClosedFor(Speaker, Stored.AddDays(9)).Should().BeTrue();
    }

    [Fact]
    public void The_window_binds_only_the_speaker_never_another_person()
    {
        var talk = Talk(Speaker);

        talk.IsEditWindowClosedFor(Owner, Stored.AddDays(3)).Should().BeFalse("the owner's change is never locked by it");
        talk.IsEditWindowClosedFor(Stranger, Stored.AddDays(3)).Should().BeFalse(
            "the window is not a permission: whether anyone else may change it at all is the edit rule's question");
    }

    [Fact]
    public void A_record_that_is_not_a_talk_has_no_window_so_an_older_phones_records_keep_working_as_before()
    {
        // A typed / reviewed save, and every record a 1.0.17 phone makes: no auto-save marker.
        var typed = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Speaker),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Stored);

        typed.EditableUntilUtc.Should().BeNull();
        typed.IsEditWindowClosedFor(Speaker, Stored.AddDays(30)).Should().BeFalse();
    }

    [Fact]
    public void Later_events_never_move_the_window_it_hangs_on_the_first_store_only()
    {
        var talk = Talk(Speaker);

        // An owner's confirmation two days later, a move (which stamps the clock forward), and a content note: none of
        // them is "when the server first stored the talk".
        talk.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, new UserId(Owner),
            Stored.AddDays(2), targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());
        talk.MarkContentRevised(Stored.AddDays(2).AddHours(1));
        talk.NoteContentChanged();

        talk.EditableUntilUtc.Should().Be(Stored.AddHours(24));
        talk.WasAutoSavedFromVoice.Should().BeTrue("the capture marker stays the earliest event");
    }

    [Fact]
    public void The_refusal_is_typed_a_stable_code_a_conflict_kind_and_the_reason_key_at_the_end()
    {
        var refusal = ShramSafalErrors.LogEditWindowClosed;

        refusal.Code.Should().Be("ShramSafal.LogEditWindow.Conflict");
        refusal.Kind.Should().Be(ErrorKind.Conflict, "409 on the online route; tail CONFLICT parks it on every phone");
        refusal.Description.Should().EndWith("[reason:editWindowClosed]");
        TalkEditWindow.ReasonKey.Should().Be("editWindowClosed");
    }

    // ── The wire ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_record_the_phone_receives_carries_the_window_as_the_server_states_it()
    {
        var dto = Talk(Speaker).ToDto();

        dto.EditableUntilUtc.Should().Be(Stored.AddHours(24));
        JsonSerializer.Serialize(dto, WireOptions).Should().Contain("\"editableUntilUtc\":\"2026-12-09T06:30:00Z\"");
    }

    [Fact]
    public void A_record_with_no_window_sends_no_key_at_all_so_an_older_phones_bytes_are_unchanged()
    {
        var typed = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Speaker),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Stored);

        var json = JsonSerializer.Serialize(typed.ToDto(), WireOptions);

        json.Should().NotContain("editableUntil");
    }

    [Fact]
    public void A_readers_projection_keeps_the_window_on_the_record()
    {
        var dto = Talk(Speaker).ToDto();

        ReadScopeProjection.Record(dto, scope: null, readerUserId: Owner).EditableUntilUtc.Should().Be(Stored.AddHours(24));
        ReadScopeProjection.Record(dto, scope: null, readerUserId: Speaker).EditableUntilUtc.Should().Be(Stored.AddHours(24));
    }

    // ── The one edit rule (revise_log_content and move_daily_log ask it) ──────────────────────────────

    [Fact]
    public async Task The_edit_rule_lets_the_speaker_change_his_talk_inside_its_24_hours()
    {
        var (talk, repo) = TalkOnFarm(Speaker);

        (await LogEditGate.CheckAsync(repo, new AllowAll(), talk, Speaker, Stored.AddHours(23).AddMinutes(59), default))
            .Should().BeNull();
    }

    [Fact]
    public async Task The_edit_rule_refuses_the_speaker_after_24_hours_with_the_typed_reason()
    {
        var (talk, repo) = TalkOnFarm(Speaker);

        var refusal = await LogEditGate.CheckAsync(repo, new AllowAll(), talk, Speaker, Stored.AddHours(25), default);

        refusal.Should().Be(ShramSafalErrors.LogEditWindowClosed);
    }

    [Fact]
    public async Task The_edit_rule_never_locks_the_owner_out_of_someone_elses_talk()
    {
        var (talk, repo) = TalkOnFarm(Speaker);

        (await LogEditGate.CheckAsync(repo, new AllowAll(), talk, Owner, Stored.AddDays(5), default)).Should().BeNull();
    }

    [Fact]
    public async Task The_window_never_opens_a_door_the_edit_rule_keeps_shut()
    {
        var (talk, repo) = TalkOnFarm(Speaker);
        repo.SetMembership(Farm, Stranger, AppRole.Worker);

        // Inside the window, a worker who did not record it and holds no grant is still Forbidden, as before.
        (await LogEditGate.CheckAsync(repo, new AllowAll(), talk, Stranger, Stored.AddHours(1), default))
            .Should().Be(ShramSafalErrors.Forbidden);
    }

    [Fact]
    public async Task A_typed_record_of_the_speaker_stays_open_to_him_days_later()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, Speaker, AppRole.Mukadam);
        var typed = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Speaker),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Stored);
        repo.AddLog(typed);

        (await LogEditGate.CheckAsync(repo, new AllowAll(), typed, Speaker, Stored.AddDays(10), default)).Should().BeNull();
    }

    // ── The handlers: refused BEFORE anything is staged ──────────────────────────────────────────────

    [Fact]
    public async Task A_content_revision_by_the_speaker_after_24_hours_is_refused_and_nothing_is_written()
    {
        var (talk, repo) = TalkOnFarm(Speaker);
        var versionBefore = talk.ContentVersion;
        var eventsBefore = talk.VerificationEvents.Count;

        var result = await ReviseHandler(repo, Stored.AddHours(24)).HandleAsync(Revision(talk.Id, Speaker));

        result.IsFailure.Should().BeTrue();
        result.Error.Should().Be(ShramSafalErrors.LogEditWindowClosed);
        talk.ContentVersion.Should().Be(versionBefore, "nothing was staged: no new version");
        talk.VerificationEvents.Should().HaveCount(eventsBefore, "no re-open, no mark");
        repo.AuditEvents.Should().BeEmpty("no ContentRevised row for a change that did not happen");
    }

    [Fact]
    public async Task A_content_revision_by_the_speaker_inside_24_hours_is_applied()
    {
        var (talk, repo) = TalkOnFarm(Speaker);

        var result = await ReviseHandler(repo, Stored.AddHours(23)).HandleAsync(Revision(talk.Id, Speaker));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
        talk.ContentVersion.Should().Be(2);
    }

    [Fact]
    public async Task The_phones_clock_is_never_asked_only_the_servers()
    {
        // The command carries no time of his at all: whatever his phone believed, the server's now decides (P10).
        var (talk, repo) = TalkOnFarm(Speaker);

        var late = await ReviseHandler(repo, Stored.AddHours(30)).HandleAsync(Revision(talk.Id, Speaker));

        late.Error.Should().Be(ShramSafalErrors.LogEditWindowClosed);
    }

    [Fact]
    public async Task A_move_by_the_speaker_after_24_hours_is_refused_and_the_record_stays_where_it_was()
    {
        var (talk, repo) = TalkOnFarm(Speaker);
        var dayBefore = talk.LogDate;

        var handler = new MoveDailyLogHandler(
            repo, new Ids(), new FixedClock(Stored.AddDays(2)), new AllowAll(), NullLogger<MoveDailyLogHandler>.Instance);
        var result = await handler.HandleAsync(new MoveDailyLogCommand(
            talk.Id, BaseVersion: 1, NewPlotIds: null, WholeFarm: false, NewLogDate: WorkDay.AddDays(-1),
            Reason: null, RevisedAtUtc: Stored.AddHours(1), ActorUserId: Speaker));

        result.Error.Should().Be(ShramSafalErrors.LogEditWindowClosed,
            "his phone said he moved it an hour after saving; the server's clock says two days");
        talk.LogDate.Should().Be(dayBefore);
        talk.ContentVersion.Should().Be(1);
    }

    [Fact]
    public async Task A_headcount_correction_by_the_speaker_after_24_hours_is_refused_and_the_count_stands()
    {
        var (talk, assignment, repo) = TalkWithEightWorkers(Speaker);

        var result = await LabourHandler(repo, Stored.AddHours(26)).HandleAsync(Count(assignment.Id, Speaker, 6));

        result.Error.Should().Be(ShramSafalErrors.LogEditWindowClosed);
        assignment.WorkerCount.Should().Be(8, "a refused correction stages nothing");
        talk.ContentVersion.Should().Be(1);
        repo.Corrections.Should().BeEmpty();
    }

    [Fact]
    public async Task An_hours_correction_by_the_speaker_after_24_hours_is_refused_too()
    {
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker);

        var result = await LabourHandler(repo, Stored.AddHours(26)).HandleAsync(new CorrectLabourCommand(
            new FarmId(Farm), assignment.Id, new UserId(Speaker), "device-1", "req-hours", null,
            Quantity: null, DurationHours: 4m, AttributionAdds: null, AttributionRemovals: null));

        result.Error.Should().Be(ShramSafalErrors.LogEditWindowClosed);
    }

    [Fact]
    public async Task A_headcount_correction_by_the_speaker_inside_24_hours_is_applied()
    {
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker);

        var result = await LabourHandler(repo, Stored.AddHours(2)).HandleAsync(Count(assignment.Id, Speaker, 6));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
        assignment.WorkerCount.Should().Be(6);
    }

    [Fact]
    public async Task The_owners_headcount_correction_of_the_speakers_talk_stays_open_days_later()
    {
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker);

        var result = await LabourHandler(repo, Stored.AddDays(4)).HandleAsync(Count(assignment.Id, Owner, 6));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
        assignment.WorkerCount.Should().Be(6);
    }

    [Fact]
    public async Task Naming_people_on_the_work_is_an_overlay_and_stays_open_to_the_speaker_after_24_hours()
    {
        // P7 — naming never changes the reported number, so the window does not touch it. (Removing someone who was
        // never named is a no-op: it proves the window did not refuse an attribution-only action.)
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker);

        var result = await LabourHandler(repo, Stored.AddDays(4)).HandleAsync(new CorrectLabourCommand(
            new FarmId(Farm), assignment.Id, new UserId(Speaker), "device-1", "req-names", null,
            Quantity: null, DurationHours: null, AttributionAdds: null, AttributionRemovals: [Guid.NewGuid()]));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
        assignment.WorkerCount.Should().Be(8);
    }

    [Fact]
    public async Task A_correction_applied_inside_the_window_still_answers_as_applied_when_resent_after_it()
    {
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker);
        var store = new MutationStore();

        var first = await LabourHandler(repo, Stored.AddHours(23), store).HandleAsync(Count(assignment.Id, Speaker, 6));
        var resent = await LabourHandler(repo, Stored.AddHours(30), store).HandleAsync(Count(assignment.Id, Speaker, 6));

        first.IsSuccess.Should().BeTrue();
        resent.IsSuccess.Should().BeTrue("a replay answers from the stored result, never from the window");
        resent.Value.AlreadyApplied.Should().BeTrue();
    }

    [Fact]
    public async Task A_record_that_is_not_a_talk_takes_the_speakers_headcount_correction_days_later_exactly_as_before()
    {
        var (_, assignment, repo) = TalkWithEightWorkers(Speaker, talk: false);

        var result = await LabourHandler(repo, Stored.AddDays(10)).HandleAsync(Count(assignment.Id, Speaker, 6));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);
        assignment.WorkerCount.Should().Be(6);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A talk: saved straight from a voice parse, the capture marker written in the same create.</summary>
    private static DailyLog Talk(Guid speaker, bool talk = true)
    {
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(speaker),
            WorkDay, idempotencyKey: null, location: (LocationSnapshot?)null, createdAtUtc: Stored);
        if (talk)
        {
            log.MarkAutoSavedFromVoice(Guid.NewGuid(), Stored);
        }

        return log;
    }

    private static (DailyLog Talk, InMemoryShramSafalRepository Repo) TalkOnFarm(Guid speaker)
    {
        var talk = Talk(speaker);
        var repo = new InMemoryShramSafalRepository();
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, speaker, AppRole.Mukadam);
        repo.AddLog(talk);
        return (talk, repo);
    }

    private static ReviseLogContentCommand Revision(Guid logId, Guid actor) => new(
        logId, BaseVersion: 1,
        ContentJson: $$"""{"schema":{{LogContentDocument.SchemaVersion}},"cropActivities":[{"id":"a1","title":"फवारणी"}]}""",
        Reason: "दुरुस्ती", ActorUserId: actor);

    private static ReviseLogContentHandler ReviseHandler(InMemoryShramSafalRepository repo, DateTime now) =>
        new(repo, new Ids(), new FixedClock(now), new AllowAll(), new Unscheduled(),
            NullLogger<ReviseLogContentHandler>.Instance, new NoRichness());

    private static (DailyLog Talk, LabourAssignment Assignment, LabourRepo Repo) TalkWithEightWorkers(Guid speaker, bool talk = true)
    {
        var log = Talk(speaker, talk);
        var assignment = LabourAssignment.Create(
            Guid.NewGuid(), log.Id, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: 8, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null,
            linkedActivityId: null, createdAtUtc: Stored, time: LabourTime.ServerAssumed());

        var repo = new LabourRepo();
        repo.SetRole(Farm, Owner, AppRole.PrimaryOwner);
        // The speaker is a मुकादम the owner gave हजेरी (the labour permission), so the window is the only thing that
        // can refuse him.
        repo.SetRole(Farm, speaker, AppRole.Mukadam);
        repo.Grant(Farm, speaker);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        return (log, assignment, repo);
    }

    private static CorrectLabourCommand Count(Guid assignmentId, Guid caller, int workers) => new(
        new FarmId(Farm), assignmentId, new UserId(caller), "device-1", $"req-count-{caller:N}-{workers}", "मोजून पाहिलं",
        new LabourQuantityCorrection(workers, null, null), DurationHours: null, AttributionAdds: null, AttributionRemovals: null);

    private static CorrectLabourHandler LabourHandler(LabourRepo repo, DateTime now, MutationStore? store = null) =>
        new(repo, store ?? new MutationStore(), new Ids(), new FixedClock(now), NullLogger<CorrectLabourHandler>.Instance,
            new NoRichness());

    private sealed class Ids : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class AllowAll : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class Unscheduled : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }

    private sealed class NoRichness : IDailyRichnessDerivationService
    {
        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) => Task.CompletedTask;
    }

    /// <summary>The sync store's contract: true the first time a (device, request) pair is stored, false after.</summary>
    private sealed class MutationStore : ISyncMutationStore
    {
        private readonly Dictionary<(string, string), StoredSyncMutation> _stored = [];

        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
            => Task.FromResult(_stored.TryGetValue((deviceId, clientRequestId), out var m) ? m : null);

        public Task<bool> TryStoreSuccessAsync(
            string deviceId, string clientRequestId, string mutationType,
            string responsePayloadJson, DateTime processedAtUtc, CancellationToken ct = default)
        {
            if (_stored.ContainsKey((deviceId, clientRequestId)))
            {
                return Task.FromResult(false);
            }

            _stored[(deviceId, clientRequestId)] = new StoredSyncMutation(
                deviceId, clientRequestId, mutationType, responsePayloadJson, processedAtUtc);
            return Task.FromResult(true);
        }
    }

    private sealed class LabourRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<Guid, LabourAssignment> _assignments = new();
        private readonly Dictionary<(Guid FarmId, Guid UserId), AppRole> _roles = new();
        private readonly HashSet<(Guid FarmId, Guid UserId)> _grants = [];

        public List<LabourCorrection> Corrections { get; } = [];

        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SeedAssignment(LabourAssignment a) => _assignments[a.Id] = a;
        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void Grant(Guid farmId, Guid userId) => _grants.Add((farmId, userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
            => Task.FromResult(_grants.Contains((farmId, userId)));

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_assignments.TryGetValue(id, out var a) ? a : null);

        public override Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
            Guid labourAssignmentId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);

        public override Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default)
        {
            Corrections.Add(c);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
