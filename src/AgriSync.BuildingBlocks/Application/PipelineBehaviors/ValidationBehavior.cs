using AgriSync.BuildingBlocks.Results;

namespace AgriSync.BuildingBlocks.Application.PipelineBehaviors;

/// <summary>
/// Sub-plan 03 Task 7: collects all validation errors from registered
/// <see cref="IValidator{TCommand}"/> instances and short-circuits with
/// a <see cref="Result.Failure"/> if any are produced. Inner handler is
/// never invoked when validation fails.
/// </summary>
public interface IValidator<in TCommand>
{
    IEnumerable<Error> Validate(TCommand command);
}

public sealed class ValidationBehavior<TCommand, TResult> : IPipelineBehavior<TCommand, TResult>
{
    private readonly IEnumerable<IValidator<TCommand>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TCommand>> validators)
    {
        _validators = validators;
    }

    public Task<Result<TResult>> HandleAsync(
        TCommand command,
        IHandler<TCommand, TResult> next,
        CancellationToken ct)
    {
        var errors = _validators.SelectMany(v => v.Validate(command)).ToList();
        if (errors.Count == 0)
        {
            return next.HandleAsync(command, ct);
        }

        // Aggregate: keep the FIRST error's code + kind for HTTP mapping;
        // join descriptions so callers can see every issue.
        var first = errors[0];
        var detail = string.Join("; ", errors.Select(e => $"{e.Code}: {e.Description}"));
        var combined = new Error(first.Code, detail, first.Kind);
        return Task.FromResult(Result.Failure<TResult>(combined));
    }
}

public sealed class ValidationBehavior<TCommand> : IPipelineBehavior<TCommand>
{
    private readonly IEnumerable<IValidator<TCommand>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TCommand>> validators)
    {
        _validators = validators;
    }

    public Task<Result> HandleAsync(
        TCommand command,
        IHandler<TCommand> next,
        CancellationToken ct)
    {
        var errors = _validators.SelectMany(v => v.Validate(command)).ToList();
        if (errors.Count == 0)
        {
            return next.HandleAsync(command, ct);
        }

        var first = errors[0];
        var detail = string.Join("; ", errors.Select(e => $"{e.Code}: {e.Description}"));
        var combined = new Error(first.Code, detail, first.Kind);
        return Task.FromResult(Result.Failure(combined));
    }
}
