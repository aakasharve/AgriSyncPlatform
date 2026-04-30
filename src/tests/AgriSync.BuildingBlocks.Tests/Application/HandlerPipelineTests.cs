using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Application;

/// <summary>
/// Sub-plan 03 Task 7: <see cref="HandlerPipeline.Build"/> wraps the
/// innermost handler with behaviors in declared order — outer
/// behaviors execute first on the way in and last on the way out.
/// </summary>
public sealed class HandlerPipelineTests
{
    private sealed record SampleCommand(string Value);
    private sealed record SampleResult(string Echoed);

    private sealed class EchoHandler : IHandler<SampleCommand, SampleResult>
    {
        public Task<Result<SampleResult>> HandleAsync(SampleCommand cmd, CancellationToken _ = default)
            => Task.FromResult(Result.Success(new SampleResult(cmd.Value)));
    }

    private sealed class TraceBehavior(List<string> trace, string label)
        : IPipelineBehavior<SampleCommand, SampleResult>
    {
        public async Task<Result<SampleResult>> HandleAsync(
            SampleCommand cmd,
            IHandler<SampleCommand, SampleResult> next,
            CancellationToken ct)
        {
            trace.Add($"{label}:before");
            var r = await next.HandleAsync(cmd, ct);
            trace.Add($"{label}:after");
            return r;
        }
    }

    private sealed class ShortCircuitBehavior(string failureCode)
        : IPipelineBehavior<SampleCommand, SampleResult>
    {
        public Task<Result<SampleResult>> HandleAsync(
            SampleCommand cmd,
            IHandler<SampleCommand, SampleResult> next,
            CancellationToken ct)
            => Task.FromResult(Result.Failure<SampleResult>(
                new Error(failureCode, "blocked", ErrorKind.Forbidden)));
    }

    [Fact]
    public async Task Build_with_no_behaviors_returns_innermost_unchanged()
    {
        var pipeline = HandlerPipeline.Build(new EchoHandler());
        var result = await pipeline.HandleAsync(new SampleCommand("hi"));
        Assert.True(result.IsSuccess);
        Assert.Equal("hi", result.Value!.Echoed);
    }

    [Fact]
    public async Task Build_invokes_behaviors_outer_to_inner_then_unwinds()
    {
        var trace = new List<string>();
        var pipeline = HandlerPipeline.Build(
            new EchoHandler(),
            new TraceBehavior(trace, "outer"),
            new TraceBehavior(trace, "inner"));

        var result = await pipeline.HandleAsync(new SampleCommand("hi"));

        Assert.True(result.IsSuccess);
        Assert.Equal("hi", result.Value!.Echoed);
        Assert.Equal(
            new[] { "outer:before", "inner:before", "inner:after", "outer:after" },
            trace);
    }

    [Fact]
    public async Task Build_short_circuit_in_outer_skips_inner_and_handler()
    {
        var trace = new List<string>();
        var pipeline = HandlerPipeline.Build(
            new EchoHandler(),
            new ShortCircuitBehavior("Outer.Blocked"),
            new TraceBehavior(trace, "should-not-run"));

        var result = await pipeline.HandleAsync(new SampleCommand("hi"));

        Assert.False(result.IsSuccess);
        Assert.Equal("Outer.Blocked", result.Error.Code);
        Assert.Empty(trace); // inner behavior + handler never executed
    }

    [Fact]
    public void Build_with_null_innermost_throws()
    {
        Assert.Throws<ArgumentNullException>(() =>
            HandlerPipeline.Build<SampleCommand, SampleResult>(null!));
    }
}
