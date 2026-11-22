// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C); go-live fix 2026-11-23 (trusted-control-room-2026-11-20 release)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Inputs.InputUseLedger;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The ledger's "today" is the farmer's day in India, not the UTC date: between 00:00 and 05:30 IST the UTC date is
/// still yesterday, and the farmer's entries of that morning were left out of his own ledger.
/// </summary>
public sealed class InputUseLedgerTodayTests
{
    private static readonly Guid Farm = Guid.Parse("10000000-0000-0000-0000-000000000031");
    private static readonly Guid Owner = Guid.Parse("20000000-0000-0000-0000-000000000032");

    [Theory]
    [InlineData(18, 29, 22)] // 23:59 IST
    [InlineData(18, 30, 23)] // 00:00 IST
    [InlineData(19, 25, 23)] // 00:55 IST
    [InlineData(23, 59, 23)] // 05:29 IST
    public async Task With_no_end_date_the_ledger_ends_on_the_farmers_day(int utcHour, int utcMinute, int expectedDay)
    {
        var store = new RecordingStore();
        var clock = new ClockAt(new DateTime(2026, 11, 22, utcHour, utcMinute, 0, DateTimeKind.Utc));
        var handler = new GetInputUseLedgerHandler(store, new OwnerOfTheFarm(), clock);

        var result = await handler.HandleAsync(Farm, Owner, from: null, to: null);

        result.IsSuccess.Should().BeTrue();
        var today = new DateOnly(2026, 11, expectedDay);
        result.Value!.To.Should().Be(today);
        store.ReadTo.Should().Be(today, "the records of his morning are read, not only labelled");
        result.Value!.From.Should().Be(today.AddYears(-1));
    }

    private sealed class ClockAt(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }

    private sealed class OwnerOfTheFarm : FakeShramSafalRepository
    {
        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<AppRole?>(AppRole.PrimaryOwner);
    }

    private sealed class RecordingStore : IInputUseStore
    {
        public DateOnly? ReadTo { get; private set; }

        public Task<IReadOnlyList<InputUseLedgerRow>> ReadLedgerAsync(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default)
        {
            ReadTo = to;
            return Task.FromResult<IReadOnlyList<InputUseLedgerRow>>([]);
        }

        public Task<IReadOnlyList<UsedInput>> ReadCurrentUsesAsync(
            Guid farmId, Guid? sourceDailyLogId, DateOnly? from, DateOnly? to, CancellationToken ct = default) =>
            throw new NotSupportedException("The ledger never reads the uses on their own.");

        public Task ReplaceAsync(
            Guid farmId, IReadOnlyCollection<Guid> inputItemIds,
            IReadOnlyList<InputUseFact> facts, IReadOnlyList<InputUseIngredient> ingredients, CancellationToken ct = default) =>
            throw new NotSupportedException("The ledger writes nothing.");
    }
}
