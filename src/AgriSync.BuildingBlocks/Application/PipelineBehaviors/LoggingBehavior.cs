using System.Diagnostics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Application.PipelineBehaviors;

/// <summary>
/// Sub-plan 03 Task 7: emits structured logs for handler enter / leave
/// with elapsed milliseconds and the resulting <see cref="Error.Code"/>
/// + <see cref="ErrorKind"/> on failure. Re-throws unhandled exceptions
/// after logging — the architecture test (Task 4) guarantees app
/// handlers don't throw business outcomes, so any caught exception
/// here is a genuine programming error worth surfacing loudly.
/// </summary>
public sealed class LoggingBehavior<TCommand, TResult> : IPipelineBehavior<TCommand, TResult>
{
    private readonly ILogger _logger;

    public LoggingBehavior(ILogger<LoggingBehavior<TCommand, TResult>> logger)
    {
        _logger = logger;
    }

    public async Task<Result<TResult>> HandleAsync(
        TCommand command,
        IHandler<TCommand, TResult> next,
        CancellationToken ct)
    {
        var commandName = typeof(TCommand).Name;
        var sw = Stopwatch.StartNew();
        try
        {
            var result = await next.HandleAsync(command, ct);
            sw.Stop();

            if (result.IsSuccess)
            {
                _logger.LogInformation(
                    "Handler {Command} succeeded in {ElapsedMs}ms",
                    commandName, sw.ElapsedMilliseconds);
            }
            else
            {
                _logger.LogWarning(
                    "Handler {Command} returned failure {ErrorCode} ({Kind}) in {ElapsedMs}ms — {Description}",
                    commandName, result.Error.Code, result.Error.Kind, sw.ElapsedMilliseconds, result.Error.Description);
            }
            return result;
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logger.LogError(ex,
                "Handler {Command} threw {ExceptionType} after {ElapsedMs}ms",
                commandName, ex.GetType().Name, sw.ElapsedMilliseconds);
            throw;
        }
    }
}

public sealed class LoggingBehavior<TCommand> : IPipelineBehavior<TCommand>
{
    private readonly ILogger _logger;

    public LoggingBehavior(ILogger<LoggingBehavior<TCommand>> logger)
    {
        _logger = logger;
    }

    public async Task<Result> HandleAsync(
        TCommand command,
        IHandler<TCommand> next,
        CancellationToken ct)
    {
        var commandName = typeof(TCommand).Name;
        var sw = Stopwatch.StartNew();
        try
        {
            var result = await next.HandleAsync(command, ct);
            sw.Stop();

            if (result.IsSuccess)
            {
                _logger.LogInformation(
                    "Handler {Command} succeeded in {ElapsedMs}ms",
                    commandName, sw.ElapsedMilliseconds);
            }
            else
            {
                _logger.LogWarning(
                    "Handler {Command} returned failure {ErrorCode} ({Kind}) in {ElapsedMs}ms — {Description}",
                    commandName, result.Error.Code, result.Error.Kind, sw.ElapsedMilliseconds, result.Error.Description);
            }
            return result;
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logger.LogError(ex,
                "Handler {Command} threw {ExceptionType} after {ElapsedMs}ms",
                commandName, ex.GetType().Name, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
