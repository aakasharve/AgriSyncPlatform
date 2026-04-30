using AgriSync.BuildingBlocks.Results;

namespace AgriSync.BuildingBlocks.Application;

/// <summary>
/// Sub-plan 03 Task 7: explicit decorator chain over an
/// <see cref="IHandler{TCommand, TResult}"/>. Outer behaviors execute
/// first on the way in and last on the way out — i.e. given
/// <c>Build(handler, A, B)</c> the call order is
/// <c>A:before -&gt; B:before -&gt; handler -&gt; B:after -&gt; A:after</c>.
///
/// <para>
/// No reflection, no service-locator. Composition root code wires the
/// pipeline once per handler at registration time.
/// </para>
/// </summary>
public static class HandlerPipeline
{
    /// <summary>
    /// Wraps <paramref name="innermost"/> with the supplied behaviors. The
    /// first behavior in the array is the OUTERMOST (executes first /
    /// finishes last); the last is the INNERMOST (closest to the
    /// handler). Empty array returns the innermost handler unchanged.
    /// </summary>
    public static IHandler<TCommand, TResult> Build<TCommand, TResult>(
        IHandler<TCommand, TResult> innermost,
        params IPipelineBehavior<TCommand, TResult>[] behaviors)
    {
        ArgumentNullException.ThrowIfNull(innermost);
        ArgumentNullException.ThrowIfNull(behaviors);

        IHandler<TCommand, TResult> current = innermost;
        for (var i = behaviors.Length - 1; i >= 0; i--)
        {
            current = new BehaviorAdapter<TCommand, TResult>(behaviors[i], current);
        }
        return current;
    }

    private sealed class BehaviorAdapter<TCommand, TResult>(
        IPipelineBehavior<TCommand, TResult> behavior,
        IHandler<TCommand, TResult> next) : IHandler<TCommand, TResult>
    {
        public Task<Result<TResult>> HandleAsync(TCommand command, CancellationToken ct = default)
            => behavior.HandleAsync(command, next, ct);
    }
}
