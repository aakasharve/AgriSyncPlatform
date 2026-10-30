// spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B002)
using System;
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// A PULLED record must still say which door saved it. The हजेरी door (B002) saves labour only, and lane F1's
/// <c>revise_log_content</c> refuses a details edit of such a record. The phone kept that fact only on its own write
/// (<c>captureScope</c> did not survive a pull), so after any pull it queued an edit the server then refused. The
/// pull DTO now carries <c>daily_logs.capture_scope</c> verbatim — additive and optional, so an older phone ignores it.
/// </summary>
public sealed class DailyLogDtoCaptureScopeTests
{
    private static readonly JsonSerializerOptions WireOptions = new(JsonSerializerDefaults.Web);

    private static DailyLog MakeLog() => DailyLog.Create(
        Guid.Parse("ffffffff-0000-0000-0000-0000000000a1"),
        new FarmId(Guid.Parse("11111111-1111-1111-1111-111111111111")),
        Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a"),
        Guid.Parse("dddddddd-0000-0000-0000-00000000000d"),
        new UserId(Guid.Parse("22222222-2222-2222-2222-222222222222")),
        new DateOnly(2026, 10, 30),
        idempotencyKey: null,
        location: null,
        createdAtUtc: new DateTime(2026, 10, 30, 6, 0, 0, DateTimeKind.Utc));

    [Fact]
    public void A_record_saved_at_the_labour_door_says_so_on_the_wire()
    {
        var log = MakeLog();
        log.MarkCapturedAtLabourDoor();

        var dto = log.ToDto();

        dto.CaptureScope.Should().Be("labour");
        JsonSerializer.Serialize(dto, WireOptions).Should().Contain("\"captureScope\":\"labour\"");
    }

    [Fact]
    public void Any_other_record_states_no_door_null_never_a_guessed_value()
    {
        var dto = MakeLog().ToDto();

        dto.CaptureScope.Should().BeNull();
        JsonSerializer.Serialize(dto, WireOptions).Should().Contain("\"captureScope\":null");
    }
}
