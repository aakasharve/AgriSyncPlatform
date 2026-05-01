using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING + T-IGH-03-OUTBOX-PUBLISHER-IMPL: polls the
/// outbox table on a 5-second cycle and dispatches each pending message
/// to its registered handlers via <see cref="IOutboxPublisher"/>.
///
/// <para>
/// Retry budget: each failed publish increments
/// <see cref="OutboxMessage.AttemptCount"/>. Once the count reaches
/// <see cref="MaxAttempts"/> (default 5; constructor-injectable for
/// tests), the row is dead-lettered (<see cref="OutboxMessage.MarkDeadLettered"/>)
/// and skipped on subsequent cycles. Dead-letter transitions log at
/// <c>LogLevel.Error</c> so an alerting pipeline can page ops.
/// </para>
///
/// <para>
/// Cycle isolation: each cycle runs in its own DI scope. A failure
/// inside the cycle (DbContext throw, publisher throw not caught
/// per-message) is logged and the dispatcher continues — the loop
/// stays alive until <paramref name="stoppingToken"/> cancels.
/// </para>
/// </summary>
public sealed class OutboxDispatcher : BackgroundService
{
    public const int DefaultMaxAttempts = 5;

    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);
    private const int CycleBatchSize = 50;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OutboxDispatcher> _logger;
    private readonly TimeProvider _timeProvider;
    private readonly int _maxAttempts;

    public OutboxDispatcher(
        IServiceScopeFactory scopeFactory,
        ILogger<OutboxDispatcher> logger,
        TimeProvider timeProvider)
        : this(scopeFactory, logger, timeProvider, DefaultMaxAttempts)
    {
    }

    public OutboxDispatcher(
        IServiceScopeFactory scopeFactory,
        ILogger<OutboxDispatcher> logger,
        TimeProvider timeProvider,
        int maxAttempts)
    {
        if (maxAttempts < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maxAttempts),
                maxAttempts,
                "maxAttempts must be at least 1.");
        }
        _scopeFactory = scopeFactory;
        _logger = logger;
        _timeProvider = timeProvider;
        _maxAttempts = maxAttempts;
    }

    /// <summary>
    /// Maximum number of publish attempts before a message is moved to
    /// the dead-letter queue. Fixed at construction; not reloadable at
    /// runtime so the budget semantics stay deterministic across the
    /// process lifetime.
    /// </summary>
    public int MaxAttempts => _maxAttempts;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<OutboxDbContext>();
                var publisher = scope.ServiceProvider.GetRequiredService<IOutboxPublisher>();

                await RunCycleAsync(dbContext, publisher, _timeProvider, _logger, _maxAttempts, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Outbox dispatcher cycle failed.");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    /// <summary>
    /// Runs a single dispatch cycle. Public so tests can drive the
    /// retry/DLQ behaviour deterministically without standing up the
    /// hosted background service. Returns the number of pending rows
    /// that were processed (incl. failures and DLQ transitions) — useful
    /// as a "did anything happen" signal in tests.
    /// </summary>
    public static async Task<int> RunCycleAsync(
        OutboxDbContext dbContext,
        IOutboxPublisher publisher,
        TimeProvider timeProvider,
        ILogger logger,
        int maxAttempts,
        CancellationToken cancellationToken)
    {
        var pendingMessages = await dbContext.OutboxMessages
            .Where(message => message.ProcessedOnUtc == null && message.DeadLetteredAt == null)
            .OrderBy(message => message.OccurredOnUtc)
            .Take(CycleBatchSize)
            .ToListAsync(cancellationToken);

        foreach (var message in pendingMessages)
        {
            try
            {
                await publisher.PublishAsync(message, cancellationToken);
                message.MarkProcessed(timeProvider.GetUtcNow().UtcDateTime);
            }
            catch (Exception ex)
            {
                message.MarkAttemptFailed(ex.Message);

                if (message.AttemptCount >= maxAttempts)
                {
                    message.MarkDeadLettered(timeProvider.GetUtcNow().UtcDateTime);
                    logger.LogError(
                        ex,
                        "Outbox message {OutboxMessageId} exceeded retry budget ({MaxAttempts} attempts) and was moved to the dead-letter queue.",
                        message.Id, maxAttempts);
                }
                else
                {
                    logger.LogWarning(
                        ex,
                        "Outbox message {OutboxMessageId} failed to publish (attempt {AttemptCount}/{MaxAttempts}); will retry on next cycle.",
                        message.Id, message.AttemptCount, maxAttempts);
                }
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return pendingMessages.Count;
    }
}
