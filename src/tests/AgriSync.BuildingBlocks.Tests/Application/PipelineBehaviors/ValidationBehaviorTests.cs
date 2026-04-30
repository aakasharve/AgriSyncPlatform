using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Application.PipelineBehaviors;

public sealed class ValidationBehaviorTests
{
    private sealed record Cmd(string Field);
    private sealed record Res(string V);

    private sealed class Echo : IHandler<Cmd, Res>
    {
        public int Calls { get; private set; }
        public Task<Result<Res>> HandleAsync(Cmd cmd, CancellationToken _ = default)
        {
            Calls++;
            return Task.FromResult(Result.Success(new Res(cmd.Field)));
        }
    }

    private sealed class FieldRequired : IValidator<Cmd>
    {
        public IEnumerable<Error> Validate(Cmd cmd)
        {
            if (string.IsNullOrWhiteSpace(cmd.Field))
            {
                yield return Error.Validation("Cmd.FieldRequired", "Field is required.");
            }
        }
    }

    private sealed class FieldMaxLength : IValidator<Cmd>
    {
        public IEnumerable<Error> Validate(Cmd cmd)
        {
            if (cmd.Field?.Length > 5)
            {
                yield return Error.Validation("Cmd.FieldTooLong", "Field must be ≤ 5 chars.");
            }
        }
    }

    [Fact]
    public async Task Happy_path_passes_through_when_no_validation_errors()
    {
        var inner = new Echo();
        var pipeline = HandlerPipeline.Build(
            inner,
            new ValidationBehavior<Cmd, Res>(new IValidator<Cmd>[] { new FieldRequired(), new FieldMaxLength() }));

        var result = await pipeline.HandleAsync(new Cmd("ok"));

        Assert.True(result.IsSuccess);
        Assert.Equal("ok", result.Value!.V);
        Assert.Equal(1, inner.Calls);
    }

    [Fact]
    public async Task Unhappy_path_short_circuits_and_inner_handler_never_runs()
    {
        var inner = new Echo();
        var pipeline = HandlerPipeline.Build(
            inner,
            new ValidationBehavior<Cmd, Res>(new IValidator<Cmd>[] { new FieldRequired(), new FieldMaxLength() }));

        var result = await pipeline.HandleAsync(new Cmd("toolong"));

        Assert.False(result.IsSuccess);
        Assert.Equal("Cmd.FieldTooLong", result.Error.Code);
        Assert.Equal(ErrorKind.Validation, result.Error.Kind);
        Assert.Equal(0, inner.Calls);
    }

    [Fact]
    public async Task Multiple_errors_aggregate_into_combined_description()
    {
        var inner = new Echo();
        var pipeline = HandlerPipeline.Build(
            inner,
            new ValidationBehavior<Cmd, Res>(new IValidator<Cmd>[] { new FieldRequired(), new FieldMaxLength() }));

        // Empty AND too-long is impossible with one field; force both errors
        // by using a long blank-padded string.
        var result = await pipeline.HandleAsync(new Cmd("       "));

        Assert.False(result.IsSuccess);
        Assert.Contains("Cmd.FieldRequired", result.Error.Description);
        Assert.Contains("Cmd.FieldTooLong", result.Error.Description);
    }
}
