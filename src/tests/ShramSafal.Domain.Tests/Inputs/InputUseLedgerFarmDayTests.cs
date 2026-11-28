// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (input-use ledger, found by the combined x1 server gates 28 Nov)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Inputs.InputUseLedger;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The ledger's default window ends on the farm's India day, the day every record is dated on. From 00:00 to 05:30 IST the UTC date is
/// still the day before, and a window ending on it left out every use the farmer recorded that day.
/// </summary>
public sealed class InputUseLedgerFarmDayTests
{
    private static readonly Guid Farm = Guid.Parse("1f1d0000-0000-4000-8000-0000000000f1");
    private static readonly Guid Owner = Guid.Parse("1f1d0000-0000-4000-8000-000000000011");

    [Theory]
    [InlineData("2026-11-27T21:00:00Z", "2026-11-28")] // 02:30 IST on 28 Nov: the UTC date is still 27 Nov
    [InlineData("2026-11-27T18:29:59Z", "2026-11-27")] // 23:59:59 IST on 27 Nov
    [InlineData("2026-11-27T18:30:00Z", "2026-11-28")] // 00:00 IST on 28 Nov
    [InlineData("2026-11-28T10:00:00Z", "2026-11-28")] // 15:30 IST, both dates agree
    public async Task With_no_dates_asked_the_window_ends_on_the_farms_India_day(string nowUtc, string expectedLastDay)
    {
        var store = new AskedRange();
        var handler = new GetInputUseLedgerHandler(store, new OwnerSeat(), new FixedClock(DateTime.Parse(nowUtc).ToUniversalTime()));

        var result = await handler.HandleAsync(Farm, Owner, from: null, to: null);

        result.IsSuccess.Should().BeTrue(result.Error.ToString());
        var last = DateOnly.Parse(expectedLastDay);
        store.To.Should().Be(last, "the uses he recorded today are dated on the farm's India day");
        store.From.Should().Be(last.AddYears(-1));
        result.Value.To.Should().Be(last);
    }

    [Fact]
    public async Task Dates_he_asks_for_are_used_as_asked()
    {
        var store = new AskedRange();
        var handler = new GetInputUseLedgerHandler(store, new OwnerSeat(), new FixedClock(new DateTime(2026, 11, 27, 21, 0, 0, DateTimeKind.Utc)));

        var result = await handler.HandleAsync(Farm, Owner, new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 30));

        result.IsSuccess.Should().BeTrue();
        store.From.Should().Be(new DateOnly(2026, 6, 1));
        store.To.Should().Be(new DateOnly(2026, 6, 30));
    }

    private sealed class AskedRange : IInputUseStore
    {
        public DateOnly? From { get; private set; }
        public DateOnly? To { get; private set; }

        public Task<IReadOnlyList<UsedInput>> ReadCurrentUsesAsync(
            Guid farmId, Guid? sourceDailyLogId, DateOnly? from, DateOnly? to, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task ReplaceAsync(
            Guid farmId, IReadOnlyCollection<Guid> inputItemIds,
            IReadOnlyList<InputUseFact> facts, IReadOnlyList<InputUseIngredient> ingredients, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<InputUseLedgerRow>> ReadLedgerAsync(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default)
        {
            From = from;
            To = to;
            return Task.FromResult<IReadOnlyList<InputUseLedgerRow>>([]);
        }
    }

    private sealed class OwnerSeat : Work.Handlers.StubShramSafalRepository
    {
        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(farmId == Farm && userId == Owner
                ? new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null)
                : null);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }
}
