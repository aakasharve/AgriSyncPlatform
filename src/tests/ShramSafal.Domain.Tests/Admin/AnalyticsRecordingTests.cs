// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-N9, N1-C1 code half)
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetOpsErrors;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Application.UseCases.Admin.GetSuffering;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

/// <summary>
/// The server tells "nothing happened" apart from "nothing was recorded" (analytics writes are swallowed by design):
/// the rule itself, and the readers that carry it, so an analytics-backed number is never a 0, an empty list or a
/// frozen date while the store is not recording.
/// </summary>
public sealed class AnalyticsRecordingTests
{
    private static readonly DateTime Now = new(2026, 12, 3, 6, 30, 0, DateTimeKind.Utc);
    private static readonly Guid Reader = Guid.Parse("99999999-0000-0000-0000-0000000000a9");

    // ── the rule ─────────────────────────────────────────────────────────────

    [Fact]
    public void A_missing_month_partition_is_not_recording_from_the_first_of_the_month()
    {
        var state = AnalyticsRecordingRules.Decide(
            currentMonthPartitionExists: false, newestLogCreatedUtc: Now.AddMinutes(-1), newestEntryUtc: Now.AddMinutes(-1), Now);

        state.IsRecording.Should().BeFalse();
        state.NotMeasuredReason.Should().Be("analytics_not_recording");
        state.StoppedAtUtc.Should().Be(new DateTime(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void An_entry_more_than_an_hour_newer_than_the_newest_log_created_is_not_recording()
    {
        var lastLogged = Now.AddMinutes(-70);

        var lagging = AnalyticsRecordingRules.Decide(true, lastLogged, Now.AddMinutes(-5), Now);
        lagging.IsRecording.Should().BeFalse("65 minutes of entries with no log.created written");
        lagging.StoppedAtUtc.Should().Be(lastLogged, "recording stopped at the newest log.created written");

        var neverLogged = AnalyticsRecordingRules.Decide(true, null, Now.AddMinutes(-5), Now);
        neverLogged.IsRecording.Should().BeFalse("entries arrive and no log.created was ever written");
        neverLogged.StoppedAtUtc.Should().BeNull("not known");
    }

    [Fact]
    public void Healthy_or_quiet_is_recording()
    {
        AnalyticsRecordingRules.Decide(true, Now.AddMinutes(-64), Now.AddMinutes(-5), Now)
            .Should().Be(AnalyticsRecording.Recording, "59 minutes behind is within the hour");
        AnalyticsRecordingRules.Decide(true, Now.AddMinutes(-65), Now.AddMinutes(-5), Now)
            .Should().Be(AnalyticsRecording.Recording, "exactly an hour behind is not more than an hour");
        AnalyticsRecordingRules.Decide(true, Now.AddDays(-3), Now.AddHours(-25), Now)
            .Should().Be(AnalyticsRecording.Recording, "no entry in the last 24 hours: nothing to judge, nothing happened");
        AnalyticsRecordingRules.Decide(true, null, null, Now)
            .Should().Be(AnalyticsRecording.Recording, "a platform with no entry yet");
    }

    // ── the readers ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Live_health_does_not_judge_r9_or_show_lists_while_not_recording()
    {
        var stopped = new DateTime(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc);
        var ops = new FixedOps();
        var check = new FixedRecording(new AnalyticsRecording(false, stopped));

        var result = await new GetOpsHealthHandler(ops, check).HandleAsync(new GetOpsHealthQuery(Reader));

        var health = result.Value!;
        health.AlertR9.State.Should().Be(LiveAlertRules.NotJudged, "never 'clear' on a count nothing could record");
        health.AlertR9.Counted.Should().BeNull("never 0 server errors");
        health.AlertR9.Reason.Should().Be("analytics_not_recording");
        health.RecentErrors.Should().BeEmpty();
        health.TopSufferingFarms.Should().BeEmpty();
        health.ApiErrorSpike.Should().BeNull();
        health.AnalyticsNotMeasuredReason.Should().Be("analytics_not_recording", "the empty lists are not 'no events'");
        health.AnalyticsStoppedAtUtc.Should().Be(stopped);
        check.AskedBy.Should().Be(Reader);

        // The control: recording, the snapshot is answered as read.
        var recording = await new GetOpsHealthHandler(ops, new FixedRecording(AnalyticsRecording.Recording)).HandleAsync(new GetOpsHealthQuery(Reader));
        recording.Value!.AlertR9.State.Should().Be(LiveAlertRules.Clear);
        recording.Value.AlertR9.Counted.Should().Be(0);
        recording.Value.AnalyticsNotMeasuredReason.Should().BeNull();
    }

    [Fact]
    public async Task Api_errors_suffering_and_all_farms_say_not_measured_while_not_recording()
    {
        var check = new FixedRecording(new AnalyticsRecording(false, null));

        var errors = await new GetOpsErrorsHandler(new FixedOps(), check)
            .HandleAsync(new GetOpsErrorsQuery(1, 20, null, null, Reader));
        errors.Value!.Meta.AnalyticsNotMeasuredReason.Should().Be("analytics_not_recording", "the 0 errors are not a fact");

        var suffering = await new GetSufferingHandler(new FixedMis(), check).HandleAsync(new GetSufferingQuery(Reader));
        suffering.Value!.Meta.AnalyticsNotMeasuredReason.Should().Be("analytics_not_recording", "the empty list is not 'no farm'");

        var farms = await new GetFarmsListHandler(new FixedMis(), new RecordingControlRoomHistory(), new FixedControlRoomStore(), check)
            .HandleAsync(new GetFarmsListQuery(1, 20, null, null, Reader, MayReadPhones: false, "device", "ip"));
        farms.Value!.Meta.AnalyticsNotMeasuredReason.Should().Be("analytics_not_recording", "each farm's Errors 24h is not measured");

        // The control: recording, nothing is said.
        var recording = await new GetSufferingHandler(new FixedMis(), new FixedRecording(AnalyticsRecording.Recording))
            .HandleAsync(new GetSufferingQuery(Reader));
        recording.Value!.Meta.AnalyticsNotMeasuredReason.Should().BeNull();
        recording.Value.Meta.AnalyticsStoppedAtUtc.Should().BeNull();
    }

    // ── fakes ────────────────────────────────────────────────────────────────

    private sealed class FixedRecording(AnalyticsRecording state) : IAnalyticsRecordingCheck
    {
        public Guid? AskedBy { get; private set; }

        public Task<AnalyticsRecording> CheckAsync(Guid readerUserId, CancellationToken ct)
        {
            AskedBy = readerUserId;
            return Task.FromResult(state);
        }
    }

    /// <summary>What the analytics store reads when nothing was recorded: zeros, empty lists, a clear R9.</summary>
    private sealed class FixedOps : IAdminOpsRepository
    {
        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default) =>
            Task.FromResult(new AdminOpsHealthDto(
                VoiceInvocations24h: 0,
                VoiceFailures24h: 0,
                VoiceFailureRatePct: 0m,
                VoiceAvgLatencyMs: 0m,
                VoiceP95LatencyMs: 0m,
                RecentErrors: [],
                TopSufferingFarms: [],
                AlertR9: LiveAlertRules.ApiErrors(0, Now.AddMinutes(-60), Now),
                ComputedAtUtc: Now,
                ApiErrorSpike: false));

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default) =>
            Task.FromResult(new OpsErrorsPageDto([], 0, page, pageSize));

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default) => throw new NotSupportedException();

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, IReadOnlyCollection<Guid>? excludedUserIds = null, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class FixedMis : IAdminMisRepository
    {
        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<SufferingItemDto>>([]);

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default) =>
            Task.FromResult(new FarmsListDto([], 0, page, pageSize));

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<IReadOnlyList<FarmNameDto>> GetFarmNamesAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, Guid>> GetFarmOwnersAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(
            int page, int pageSize, string? search, bool matchPhone, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
