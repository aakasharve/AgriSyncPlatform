using AgriSync.BuildingBlocks.Results;

namespace AgriSync.BuildingBlocks.Application.PipelineBehaviors;

/// <summary>
/// Sub-plan 03 Task 7: opt-in idempotency via a per-command
/// <see cref="IIdempotent.IdempotencyKey"/>. If the key was previously
/// processed, the cached envelope is returned and the inner handler is
/// never invoked again. Otherwise the inner handler runs and its
/// outcome is cached for replay.
///
/// <para>
/// Note: <c>ISyncMutationStore</c> already does row-level idempotency
/// for sync push (clientRequestId per device). This generic behavior
/// is for handlers OUTSIDE the sync pipeline that want the same
/// guarantee (e.g. external webhook receivers).
/// </para>
/// </summary>
public interface IIdempotent
{
    string IdempotencyKey { get; }
}

public interface IIdempotencyStore
{
    Task<Result?> TryGetCachedAsync(string key, CancellationToken ct);
    Task PutAsync(string key, Result result, CancellationToken ct);
}

public sealed class IdempotencyBehavior<TCommand, TResult> : IPipelineBehavior<TCommand, TResult>
    where TCommand : IIdempotent
{
    private readonly IIdempotencyStore _store;

    public IdempotencyBehavior(IIdempotencyStore store)
    {
        _store = store;
    }

    public async Task<Result<TResult>> HandleAsync(
        TCommand command,
        IHandler<TCommand, TResult> next,
        CancellationToken ct)
    {
        var cached = await _store.TryGetCachedAsync(command.IdempotencyKey, ct);
        if (cached is not null)
        {
            // Replayed command — surface as Conflict so callers can detect
            // the duplicate. Cached envelopes never carry the original
            // typed Value (TResult could be anything), so we return a
            // typed failure rather than reconstruct the success.
            return Result.Failure<TResult>(new Error(
                "Idempotency.Replayed",
                "This command was already processed; returning cached envelope.",
                ErrorKind.Conflict));
        }

        var fresh = await next.HandleAsync(command, ct);

        // Cache the success/failure shape (without typed Value) so a
        // replay returns the same kind of envelope.
        await _store.PutAsync(
            command.IdempotencyKey,
            fresh.IsSuccess ? Result.Success() : Result.Failure(fresh.Error),
            ct);

        return fresh;
    }
}
