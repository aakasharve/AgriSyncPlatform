using AgriSync.BuildingBlocks.Results;

namespace AgriSync.BuildingBlocks.Application;

/// <summary>
/// Sub-plan 03 Task 7: explicit, non-reflective handler contract.
/// Application use cases that opt in to the <see cref="HandlerPipeline"/>
/// implement <see cref="IHandler{TCommand, TResult}"/>; everything else
/// keeps its existing concrete <c>HandleAsync</c> signature unchanged.
///
/// <para>
/// Why explicit instead of MediatR-style: the codebase invariants
/// (master plan §6 "No magic") forbid reflection-driven dispatch. Each
/// pipeline composition is wired by hand in the composition root (see
/// <c>HandlerRegistration</c>), so the call graph is greppable.
/// </para>
/// </summary>
public interface IHandler<TCommand, TResult>
{
    Task<Result<TResult>> HandleAsync(TCommand command, CancellationToken ct = default);
}

/// <summary>
/// A pipeline behavior wraps an <see cref="IHandler{TCommand, TResult}"/>.
/// Implementations may short-circuit (return <c>Result.Failure</c> without
/// calling <paramref name="next"/>), pass through, or post-process.
/// Behaviors are composed left-to-right via <see cref="HandlerPipeline.Build"/>.
/// </summary>
public interface IPipelineBehavior<TCommand, TResult>
{
    Task<Result<TResult>> HandleAsync(
        TCommand command,
        IHandler<TCommand, TResult> next,
        CancellationToken ct);
}
