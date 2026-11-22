// spec: plr-d10 SEC-1 server fixes (D-184), finding F04 - one push may not carry an unbounded number of changes.
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Domain.Tests.Sync;

/// <summary>
/// SEC-1 F04 - the size of one <c>/sync/push</c> batch is capped. The phone never sends more than 50 changes in one push
/// (its background worker reads the pending queue 50 at a time); the cap the server holds is 200. A push of up to 200
/// changes is handled exactly as before; a push of 201 or more is refused WHOLE with
/// <c>ShramSafal.Sync.BatchTooLarge</c> before any change in it is looked at, so nothing in it is written and nothing in
/// it is half-applied.
///
/// <para>
/// They drive the REAL <see cref="PushSyncBatchHandler"/> (not the endpoint), because the handler is also reached by
/// callers other than the HTTP route, and the refusal has to be the handler's own. Every collaborator except the clock and
/// the logger is null on purpose: a refused batch must not reach any of them, so a change that did get looked at would
/// throw here instead of passing while measuring nothing.
/// </para>
///
/// <para>Written from the SEC-1 test spec (F04) alone. The handler's source was not read.</para>
/// </summary>
public sealed class PushSyncBatchSizeCapTests
{
    private const string TooLargeCode = "ShramSafal.Sync.BatchTooLarge";
    private const int Cap = 200;

    private static readonly Guid ActorUserId = Guid.Parse("5ec10004-0000-4000-8000-000000000001");

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(50)]
    [InlineData(51)]
    [InlineData(Cap)]
    public async Task A_batch_up_to_the_cap_is_handled_change_by_change_and_never_refused_whole(int count)
    {
        var logger = new CountingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        // Blank mutation types: each change is answered on its own (rejected as an invalid command) before any
        // collaborator is touched, so a batch at the cap runs through the whole loop with the null-filled graph.
        var response = await handler.HandleAsync(Batch(count, mutationType: "   "));

        response.IsSuccess.Should().BeTrue($"{count} change(s) is within the cap of {Cap}; the batch call itself succeeds");
        response.Value.Should().NotBeNull();
        response.Value!.Results.Should().HaveCount(count, "every change in a batch within the cap is answered, one result each");
        response.Value.Results.Should().OnlyContain(r => r.Status == PushSyncBatchHandler.RejectedStatus,
            "these changes are rejected one by one, which proves the loop ran for all of them");
    }

    [Theory]
    [InlineData(Cap + 1)]
    [InlineData(Cap + 2)]
    [InlineData(1_000)]
    [InlineData(5_000)]
    public async Task A_batch_over_the_cap_is_refused_whole_with_BatchTooLarge(int count)
    {
        var logger = new CountingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        var response = await handler.HandleAsync(Batch(count, mutationType: "   "));

        response.IsFailure.Should().BeTrue($"{count} changes is over the cap of {Cap}: the whole push is refused");
        response.Error.Code.Should().Be(TooLargeCode);
        response.Error.Description.Should().NotBeNullOrWhiteSpace("the phone and the operator are told why");
        response.Value.Should().BeNull("a refused batch carries no per-change results: none of its changes were looked at");
        logger.Entries.Should().NotContain(e => e.Contains("SyncMutationRejected"),
            "no change in a refused batch was looked at, so none was logged as a rejected change");
    }

    [Fact]
    public async Task The_cap_counts_changes_not_distinct_request_ids()
    {
        var handler = BuildHandler(new CountingLogger<PushSyncBatchHandler>());

        // 201 changes that all carry the SAME clientRequestId: still 201 changes. Duplicates must not slip under the cap.
        var batch = Batch(Cap + 1, mutationType: "   ", clientRequestId: _ => "same-request-id");

        var response = await handler.HandleAsync(batch);

        response.IsFailure.Should().BeTrue();
        response.Error.Code.Should().Be(TooLargeCode);
    }

    [Fact]
    public async Task A_refused_batch_of_real_changes_touches_no_collaborator_so_nothing_is_written()
    {
        // 201 changes of a REAL type (create_farm). Processed, each would need the repository, the id generator, the
        // audit writer and the rest - all null here. Refused whole, none is reached: the answer is a clean failure, not
        // a NullReferenceException and not 201 per-change results.
        var logger = new CountingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        var response = await handler.HandleAsync(Batch(Cap + 1, mutationType: "create_farm", withFarmPayload: true));

        response.IsFailure.Should().BeTrue();
        response.Error.Code.Should().Be(TooLargeCode);
        logger.Entries.Should().NotContain(e => e.Contains("SyncMutationRejected"),
            "no change of the refused batch was processed, so none was logged as a rejected change");
    }

    [Fact]
    public async Task The_refusal_is_the_handlers_own_so_every_caller_of_the_handler_gets_it()
    {
        // The same command, reached the way a non-HTTP caller reaches it (no endpoint in between): the same failure.
        var handler = BuildHandler(new CountingLogger<PushSyncBatchHandler>());
        var command = new PushSyncBatchCommand(
            DeviceId: "device-cap-other-caller",
            AuthenticatedUserId: ActorUserId,
            ActorRole: null,
            Mutations: Mutations(Cap + 1, "   ", _ => Guid.NewGuid().ToString("N"), withFarmPayload: false),
            AppVersion: null);

        var response = await handler.HandleAsync(command);

        response.IsFailure.Should().BeTrue();
        response.Error.Code.Should().Be(TooLargeCode);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private static PushSyncBatchCommand Batch(
        int count, string mutationType, Func<int, string>? clientRequestId = null, bool withFarmPayload = false) =>
        new(
            DeviceId: "device-cap",
            AuthenticatedUserId: ActorUserId,
            ActorRole: "Owner",
            Mutations: Mutations(count, mutationType, clientRequestId ?? (i => $"req-cap-{i}"), withFarmPayload),
            AppVersion: "1.0.7");

    private static List<PushSyncMutationCommand> Mutations(
        int count, string mutationType, Func<int, string> clientRequestId, bool withFarmPayload)
    {
        var list = new List<PushSyncMutationCommand>(count);
        for (var i = 0; i < count; i++)
        {
            using var document = JsonDocument.Parse(withFarmPayload
                ? $$"""{"farmId":"{{Guid.NewGuid()}}","name":"Cap Farm {{i}}"}"""
                : "{}");
            list.Add(new PushSyncMutationCommand(clientRequestId(i), mutationType, document.RootElement.Clone()));
        }

        return list;
    }

    /// <summary>
    /// The real handler with only the clock and the logger supplied (same technique as
    /// <c>PushSyncBatchRejectionObservabilityTests</c>): reflection over the single constructor, so an unrelated new
    /// dependency does not break this test, and every other collaborator is null so any use of one fails loudly.
    /// </summary>
    private static PushSyncBatchHandler BuildHandler(ILogger<PushSyncBatchHandler> logger)
    {
        var constructor = typeof(PushSyncBatchHandler).GetConstructors().Single();
        var arguments = constructor.GetParameters()
            .Select(parameter => parameter.ParameterType switch
            {
                var t when t == typeof(IClock) => (object?)new FrozenClock(),
                var t when t == typeof(ILogger<PushSyncBatchHandler>) => logger,
                _ => null
            })
            .ToArray();

        return (PushSyncBatchHandler)constructor.Invoke(arguments);
    }

    private sealed class FrozenClock : IClock
    {
        public DateTime UtcNow { get; } = new(2026, 11, 22, 9, 0, 0, DateTimeKind.Utc);
    }

    /// <summary>Records what was logged (any level), one line per entry.</summary>
    private sealed class CountingLogger<T> : ILogger<T>
    {
        private readonly List<string> _entries = [];

        public IReadOnlyList<string> Entries => _entries;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            _entries.Add($"{logLevel}: {formatter(state, exception)}");
    }
}
