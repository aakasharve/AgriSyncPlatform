using AgriSync.BuildingBlocks.Results;

namespace AgriSync.BuildingBlocks.Application.PipelineBehaviors;

/// <summary>
/// Sub-plan 03 Task 7: runs every registered authorization check. The
/// first check that returns a failed <see cref="Result"/> short-circuits
/// the pipeline; the inner handler is never invoked.
///
/// <para>
/// <c>IAuthorizationEnforcer</c> is now Result-based
/// (<c>T-IGH-03-AUTHZ-RESULT</c>), so command-specific
/// <see cref="IAuthorizationCheck{TCommand}"/> implementations should
/// delegate to it and return the Result directly.
/// </para>
/// </summary>
public interface IAuthorizationCheck<in TCommand>
{
    Task<Result> AuthorizeAsync(TCommand command, CancellationToken ct);
}

public sealed class AuthorizationBehavior<TCommand, TResult> : IPipelineBehavior<TCommand, TResult>
{
    private readonly IEnumerable<IAuthorizationCheck<TCommand>> _checks;

    public AuthorizationBehavior(IEnumerable<IAuthorizationCheck<TCommand>> checks)
    {
        _checks = checks;
    }

    public async Task<Result<TResult>> HandleAsync(
        TCommand command,
        IHandler<TCommand, TResult> next,
        CancellationToken ct)
    {
        foreach (var check in _checks)
        {
            var r = await check.AuthorizeAsync(command, ct);
            if (!r.IsSuccess)
            {
                return Result.Failure<TResult>(r.Error);
            }
        }
        return await next.HandleAsync(command, ct);
    }
}

public sealed class AuthorizationBehavior<TCommand> : IPipelineBehavior<TCommand>
{
    private readonly IEnumerable<IAuthorizationCheck<TCommand>> _checks;

    public AuthorizationBehavior(IEnumerable<IAuthorizationCheck<TCommand>> checks)
    {
        _checks = checks;
    }

    public async Task<Result> HandleAsync(
        TCommand command,
        IHandler<TCommand> next,
        CancellationToken ct)
    {
        foreach (var check in _checks)
        {
            var r = await check.AuthorizeAsync(command, ct);
            if (!r.IsSuccess)
            {
                return Result.Failure(r.Error);
            }
        }
        return await next.HandleAsync(command, ct);
    }
}
