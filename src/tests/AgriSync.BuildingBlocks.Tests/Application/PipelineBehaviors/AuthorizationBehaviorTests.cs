using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Application.PipelineBehaviors;

public sealed class AuthorizationBehaviorTests
{
    private sealed record Cmd(string CallerId);
    private sealed record Res(bool Authorized);

    private sealed class Echo : IHandler<Cmd, Res>
    {
        public int Calls { get; private set; }
        public Task<Result<Res>> HandleAsync(Cmd cmd, CancellationToken _ = default)
        {
            Calls++;
            return Task.FromResult(Result.Success(new Res(true)));
        }
    }

    private sealed class AllowOwner(string ownerId) : IAuthorizationCheck<Cmd>
    {
        public Task<Result> AuthorizeAsync(Cmd cmd, CancellationToken ct)
            => Task.FromResult(cmd.CallerId == ownerId
                ? Result.Success()
                : Result.Failure(Error.Forbidden("Auth.NotOwner", "Caller is not the owner.")));
    }

    [Fact]
    public async Task Happy_path_passes_when_all_checks_authorize()
    {
        var inner = new Echo();
        var pipeline = HandlerPipeline.Build(
            inner,
            new AuthorizationBehavior<Cmd, Res>(new IAuthorizationCheck<Cmd>[] { new AllowOwner("u1") }));

        var result = await pipeline.HandleAsync(new Cmd("u1"));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, inner.Calls);
    }

    [Fact]
    public async Task Unhappy_path_short_circuits_when_any_check_fails()
    {
        var inner = new Echo();
        var pipeline = HandlerPipeline.Build(
            inner,
            new AuthorizationBehavior<Cmd, Res>(new IAuthorizationCheck<Cmd>[] { new AllowOwner("u1") }));

        var result = await pipeline.HandleAsync(new Cmd("intruder"));

        Assert.False(result.IsSuccess);
        Assert.Equal("Auth.NotOwner", result.Error.Code);
        Assert.Equal(ErrorKind.Forbidden, result.Error.Kind);
        Assert.Equal(0, inner.Calls);
    }
}
