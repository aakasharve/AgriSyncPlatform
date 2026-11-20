// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 1)
//
// Handler tests for GetCompanyMisHandler, written by the test-writer from the
// spec and the plan only. Expected values come from the plan's contract:
//   - both dates absent: to = today in India time, from = to - 29
//   - a range is at most 180 days; only one date, from > to, to after today: refused
//   - the previous period has the same length and ends the day before `from`
//   - the reader is asked from the start of the previous period minus 30 days
//   - countedAtUtc = the clock; it is the answer's CountedAtUtc and meta.LastRefreshedUtc
//   - a non-platform caller is refused before the reader is touched
//   - a failing reader escapes (never an empty answer)
// A fake reader and a fixed clock; no database.

using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class GetCompanyMisHandlerTests
{
    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-00000000c2a1");
    private static readonly Guid FakeTestAccount = Guid.Parse("eeeeeeee-0000-0000-0000-00000000c2a1");

    /// <summary>06:30 UTC on 14 Nov 2026 = 12:00 India time on 14 Nov.</summary>
    private static readonly DateTime Noon14NovIst = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_non_platform_caller_is_forbidden_and_the_reader_is_not_called()
    {
        var reader = new RecordingReader();
        var handler = Handler(reader, Noon14NovIst);

        var result = await handler.HandleAsync(new GetCompanyMisQuery(null, null, AdminUser, IsPlatformSeat: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden);
        result.Error.Code.Should().Be("admin.platform_only");
        reader.Calls.Should().Be(0, "nothing is read, and no cross-farm audit row is written, for a refused caller");

        // Even a malformed range is not looked at first: the gate comes before the range rules.
        var alsoBadRange = await handler.HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 1), AdminUser, IsPlatformSeat: false));
        alsoBadRange.Error.Kind.Should().Be(ErrorKind.Forbidden);
        reader.Calls.Should().Be(0);
    }

    [Fact]
    public async Task No_dates_means_the_last_30_india_days_ending_today()
    {
        var reader = new RecordingReader();
        var result = await Handler(reader, Noon14NovIst)
            .HandleAsync(new GetCompanyMisQuery(null, null, AdminUser, IsPlatformSeat: true));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!.Data;
        data.Range.Should().Be(new MisRangeDto(new DateOnly(2026, 10, 16), new DateOnly(2026, 11, 14), 30));
        result.Value.Meta.Window.Should().Be("2026-10-16..2026-11-14");
        result.Value.Meta.Source.Should().Be("live");
        result.Value.Meta.TtlSeconds.Should().Be(0);
        data.TimeZone.Should().Be("Asia/Kolkata");
        reader.Calls.Should().Be(1);
    }

    [Fact]
    public async Task The_previous_period_has_the_same_length_and_ends_the_day_before()
    {
        var result = await Handler(new RecordingReader(), Noon14NovIst).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 7), AdminUser, IsPlatformSeat: true));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Data.Range.Should().Be(new MisRangeDto(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 7), 7));
        result.Value.Data.PreviousRange.Should().Be(
            new MisRangeDto(new DateOnly(2026, 10, 25), new DateOnly(2026, 10, 31), 7));

        // One day: the previous period is the day before.
        var oneDay = await Handler(new RecordingReader(), Noon14NovIst).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 14), new DateOnly(2026, 11, 14), AdminUser, IsPlatformSeat: true));
        oneDay.Value!.Data.PreviousRange.Should().Be(
            new MisRangeDto(new DateOnly(2026, 11, 13), new DateOnly(2026, 11, 13), 1));
    }

    [Fact]
    public async Task A_range_over_180_days_is_refused()
    {
        var to = new DateOnly(2026, 11, 14);

        var tooLong = await Handler(new RecordingReader(), Noon14NovIst).HandleAsync(new GetCompanyMisQuery(
            to.AddDays(-180), to, AdminUser, IsPlatformSeat: true)); // 181 days
        tooLong.IsSuccess.Should().BeFalse();
        tooLong.Error.Kind.Should().Be(ErrorKind.Validation);
        tooLong.Error.Code.Should().Be("admin.mis_range_invalid");

        var reader = new RecordingReader();
        var longest = await Handler(reader, Noon14NovIst).HandleAsync(new GetCompanyMisQuery(
            to.AddDays(-179), to, AdminUser, IsPlatformSeat: true)); // 180 days
        longest.IsSuccess.Should().BeTrue("180 days is the longest range allowed");
        longest.Value!.Data.Range.Days.Should().Be(180);
        longest.Value.Data.PreviousRange.Days.Should().Be(180);
        reader.Calls.Should().Be(1);
    }

    [Fact]
    public async Task A_range_ending_after_today_or_reversed_or_half_given_is_refused()
    {
        var cases = new (DateOnly? From, DateOnly? To, string Why)[]
        {
            (new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 15), "to is after today in India time"),
            (new DateOnly(2026, 11, 10), new DateOnly(2026, 11, 9), "from is after to"),
            (new DateOnly(2026, 11, 10), null, "only from is given"),
            (null, new DateOnly(2026, 11, 10), "only to is given"),
        };

        foreach (var c in cases)
        {
            var reader = new RecordingReader();
            var result = await Handler(reader, Noon14NovIst)
                .HandleAsync(new GetCompanyMisQuery(c.From, c.To, AdminUser, IsPlatformSeat: true));

            result.IsSuccess.Should().BeFalse(c.Why);
            result.Error.Kind.Should().Be(ErrorKind.Validation, c.Why);
            result.Error.Code.Should().Be("admin.mis_range_invalid", c.Why);
            reader.Calls.Should().Be(0, "nothing is read for a refused range ({0})", c.Why);
        }
    }

    [Fact]
    public async Task Today_follows_india_time_not_utc()
    {
        // 19:00 UTC on 14 Nov is 00:30 on 15 Nov in India.
        var clock = new DateTime(2026, 11, 14, 19, 0, 0, DateTimeKind.Utc);

        var noDates = await Handler(new RecordingReader(), clock)
            .HandleAsync(new GetCompanyMisQuery(null, null, AdminUser, IsPlatformSeat: true));
        noDates.Value!.Data.Range.To.Should().Be(new DateOnly(2026, 11, 15));
        noDates.Value.Data.Range.From.Should().Be(new DateOnly(2026, 10, 17));

        var endingToday = await Handler(new RecordingReader(), clock).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 15), new DateOnly(2026, 11, 15), AdminUser, IsPlatformSeat: true));
        endingToday.IsSuccess.Should().BeTrue("15 Nov is already today in India although it is still 14 Nov in UTC");

        var endingTomorrow = await Handler(new RecordingReader(), clock).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 16), AdminUser, IsPlatformSeat: true));
        endingTomorrow.Error.Kind.Should().Be(ErrorKind.Validation);

        // And the other side: 18:00 UTC on 14 Nov is 23:30 on 14 Nov in India; 15 Nov is still tomorrow.
        var lateEvening = new DateTime(2026, 11, 14, 18, 0, 0, DateTimeKind.Utc);
        var notYet = await Handler(new RecordingReader(), lateEvening).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 15), new DateOnly(2026, 11, 15), AdminUser, IsPlatformSeat: true));
        notYet.Error.Kind.Should().Be(ErrorKind.Validation);
    }

    [Fact]
    public async Task The_reader_is_asked_from_30_days_before_the_previous_period()
    {
        var reader = new RecordingReader();
        await Handler(reader, Noon14NovIst, new HashSet<Guid> { FakeTestAccount }).HandleAsync(new GetCompanyMisQuery(
            new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 7), AdminUser, IsPlatformSeat: true));

        // Previous period starts 25 Oct; minus 30 days = 25 Sep; 00:00 India time = 24 Sep 18:30 UTC.
        reader.SinceUtc.Should().Be(new DateTime(2026, 9, 24, 18, 30, 0, DateTimeKind.Utc));
        reader.CountedAtUtc.Should().Be(Noon14NovIst);
        reader.AdminUserId.Should().Be(AdminUser, "the admin is named in the cross-farm audit row");
        reader.ExcludedUserIds.Should().BeEquivalentTo(new[] { FakeTestAccount },
            "amendment A5: the reader gets the test accounts for the first- and last-entry aggregates");
    }

    [Fact]
    public async Task The_answer_says_when_it_was_counted()
    {
        var result = await Handler(new RecordingReader(), Noon14NovIst)
            .HandleAsync(new GetCompanyMisQuery(null, null, AdminUser, IsPlatformSeat: true));

        result.Value!.Data.CountedAtUtc.Should().Be(Noon14NovIst);
        result.Value.Meta.LastRefreshedUtc.Should().Be(Noon14NovIst);
    }

    [Fact]
    public async Task A_failing_reader_is_never_an_empty_answer()
    {
        var handler = Handler(new ThrowingReader(), Noon14NovIst);

        var act = () => handler.HandleAsync(new GetCompanyMisQuery(null, null, AdminUser, IsPlatformSeat: true));

        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*fake read failure*");
    }

    // ------------------------------------------------------------------

    private static GetCompanyMisHandler Handler(
        ICompanyMisReader reader, DateTime nowUtc, IReadOnlySet<Guid>? excluded = null) =>
        new(reader, new NoAppSeenOpsRepository(), new CompanyMisExclusions(excluded ?? new HashSet<Guid>()), new FixedClock(nowUtc));

    /// <summary>
    /// Compile-only (plan CR-2c, E9): the handler asks when app.seen rows began; here none were ever written.
    /// No other member is used by the Company MIS handler.
    /// </summary>
    private sealed class NoAppSeenOpsRepository : IAdminOpsRepository
    {
        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default) => Task.FromResult<DateTime?>(null);

        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default) => throw new NotSupportedException();

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
            IReadOnlyCollection<Guid> personIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    private sealed class RecordingReader : ICompanyMisReader
    {
        public int Calls { get; private set; }
        public Guid AdminUserId { get; private set; }
        public DateTime SinceUtc { get; private set; }
        public DateTime CountedAtUtc { get; private set; }
        public IReadOnlySet<Guid>? ExcludedUserIds { get; private set; }

        // Compile-only (plan CR-2c, E3): the Company MIS method reads as ReadAsync here.
        public Task<CompanyMisRows> ReadForCompanyMisAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
            IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default) =>
            ReadAsync(adminUserId, sinceUtc, countedAtUtc, excludedUserIds, ct);

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            Calls++;
            AdminUserId = adminUserId;
            SinceUtc = sinceUtc;
            CountedAtUtc = countedAtUtc;
            ExcludedUserIds = excludedUserIds;
            return Task.FromResult(new CompanyMisRows(
                0, 0,
                Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(), Array.Empty<MisMembershipRow>(),
                Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(), Array.Empty<MisUserRow>(),
                Array.Empty<MisFpoScopeRow>()));
        }
    }

    private sealed class ThrowingReader : ICompanyMisReader
    {
        // Compile-only (plan CR-2c, E3): the Company MIS method reads as ReadAsync here.
        public Task<CompanyMisRows> ReadForCompanyMisAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime additionsSinceUtc, DateTime countedAtUtc,
            IReadOnlySet<Guid> excludedUserIds, CancellationToken ct = default) =>
            ReadAsync(adminUserId, sinceUtc, countedAtUtc, excludedUserIds, ct);

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default) =>
            throw new InvalidOperationException("fake read failure");
    }
}
