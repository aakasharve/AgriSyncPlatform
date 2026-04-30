using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Application.PipelineBehaviors;

public sealed class LoggingBehaviorTests
{
    private sealed record Cmd(bool ShouldFail);
    private sealed record Res(string V);

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        IDisposable? ILogger.BeginScope<TState>(TState state) => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Entries.Add((logLevel, formatter(state, exception)));
        }
    }

    private sealed class FailableHandler : IHandler<Cmd, Res>
    {
        public Task<Result<Res>> HandleAsync(Cmd cmd, CancellationToken _ = default)
            => Task.FromResult(cmd.ShouldFail
                ? Result.Failure<Res>(Error.NotFound("Sample.Missing", "not found"))
                : Result.Success(new Res("ok")));
    }

    [Fact]
    public async Task Logs_Information_on_success()
    {
        var logger = new CapturingLogger<LoggingBehavior<Cmd, Res>>();
        var pipeline = HandlerPipeline.Build(
            new FailableHandler(),
            new LoggingBehavior<Cmd, Res>(logger));

        var result = await pipeline.HandleAsync(new Cmd(false));

        Assert.True(result.IsSuccess);
        Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Information, logger.Entries[0].Level);
        Assert.Contains("Cmd", logger.Entries[0].Message);
    }

    [Fact]
    public async Task Logs_Warning_with_ErrorCode_and_Kind_on_failure()
    {
        var logger = new CapturingLogger<LoggingBehavior<Cmd, Res>>();
        var pipeline = HandlerPipeline.Build(
            new FailableHandler(),
            new LoggingBehavior<Cmd, Res>(logger));

        var result = await pipeline.HandleAsync(new Cmd(true));

        Assert.False(result.IsSuccess);
        Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, logger.Entries[0].Level);
        Assert.Contains("Sample.Missing", logger.Entries[0].Message);
        Assert.Contains("NotFound", logger.Entries[0].Message);
    }

    [Fact]
    public async Task Logs_Error_and_rethrows_when_inner_handler_throws()
    {
        var logger = new CapturingLogger<LoggingBehavior<Cmd, Res>>();
        var throwing = new ThrowingHandler();
        var pipeline = HandlerPipeline.Build<Cmd, Res>(
            throwing,
            new LoggingBehavior<Cmd, Res>(logger));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => pipeline.HandleAsync(new Cmd(false)));

        Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, logger.Entries[0].Level);
    }

    private sealed class ThrowingHandler : IHandler<Cmd, Res>
    {
        public Task<Result<Res>> HandleAsync(Cmd cmd, CancellationToken _ = default)
            => throw new InvalidOperationException("boom");
    }
}
