// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Linq;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR_PHASE2 Phase 3 — <see cref="DailyLog.MarkLabourCorrected"/>, the one
/// line that makes a labour correction reach a second device.
/// </summary>
/// <remarks>
/// <c>ssf.labour_assignments</c> has no <c>modified_at_utc</c> and corrections
/// mutate the row in place, so the parent log's clock is the only thing
/// <c>/sync/pull</c>'s delta can key on. These tests pin the shape of that
/// mutator: it moves ONE timestamp, only FORWARD, and it is not a back door to
/// the general <c>Update</c> this aggregate deliberately does not have.
/// </remarks>
public sealed class DailyLogLabourCorrectionClockTests
{
    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId AnyUser = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 13, 6, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void A_correction_advances_the_logs_modification_clock()
    {
        var log = MakeLog();
        var correctedAt = CreatedAtUtc.AddHours(3);

        log.MarkLabourCorrected(correctedAt);

        log.ModifiedAtUtc.Should().Be(correctedAt,
            "a delta pull selects logs whose ModifiedAtUtc is past the device's cursor — without this move the " +
            "correction is invisible to every device except the one that made it");
    }

    [Fact]
    public void The_clock_never_moves_backwards()
    {
        var log = MakeLog();
        log.MarkLabourCorrected(CreatedAtUtc.AddHours(5));

        log.MarkLabourCorrected(CreatedAtUtc.AddHours(1));

        log.ModifiedAtUtc.Should().Be(CreatedAtUtc.AddHours(5),
            "a stale or skewed timestamp would drop this log BELOW a device's existing cursor and hide the very " +
            "correction the bump exists to deliver — so an earlier time is ignored, never obeyed");
    }

    [Fact]
    public void It_records_nothing_but_the_clock()
    {
        var log = MakeLog();
        var before = (log.Scope, log.PlotId, log.CropCycleId, log.CreatedAtUtc,
                      Tasks: log.Tasks.Count, Events: log.VerificationEvents.Count,
                      Status: log.CurrentVerificationStatus, Plots: log.PlotIds.ToList());

        log.MarkLabourCorrected(CreatedAtUtc.AddHours(2));

        (log.Scope, log.PlotId, log.CropCycleId, log.CreatedAtUtc,
         Tasks: log.Tasks.Count, Events: log.VerificationEvents.Count,
         Status: log.CurrentVerificationStatus, Plots: log.PlotIds.ToList())
            .Should().BeEquivalentTo(before,
                "this is not a general Update and must never grow into one — it moves the sync clock and asserts " +
                "nothing about labour, verification or context");
    }

    /// <summary>
    /// The mutator surface stays closed. <c>DailyLog</c> has intention-named
    /// mutators and no setter for <c>ModifiedAtUtc</c>; if a later change widens
    /// that setter, this correction path stops being the only way the clock moves
    /// and the reason it exists is lost.
    /// </summary>
    [Fact]
    public void ModifiedAtUtc_has_no_public_setter_to_reach_around_this_method()
    {
        var setter = typeof(DailyLog).GetProperty(nameof(DailyLog.ModifiedAtUtc))!.SetMethod;

        setter.Should().NotBeNull();
        setter!.IsPublic.Should().BeFalse(
            "widening this setter is the shortcut a future implementer will reach for instead of naming the event " +
            "— and then nobody can tell WHY a log's clock moved");
    }

    private static DailyLog MakeLog() => DailyLog.Create(
        Guid.Parse("ffffffff-0000-0000-0000-0000000000f1"),
        AnyFarmId,
        Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a"),
        Guid.Parse("cccccccc-0000-0000-0000-00000000000c"),
        AnyUser,
        new DateOnly(2026, 8, 13),
        idempotencyKey: null,
        location: (LocationSnapshot?)null,
        createdAtUtc: CreatedAtUtc);
}
