using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Application.PipelineBehaviors;

public sealed class IdempotencyBehaviorTests
{
    private sealed record Cmd(string IdempotencyKey, string Value) : IIdempotent;
    private sealed record Res(string V);

    private sealed class Echo : IHandler<Cmd, Res>
    {
        public int Calls { get; private set; }
        public Task<Result<Res>> HandleAsync(Cmd cmd, CancellationToken _ = default)
        {
            Calls++;
            return Task.FromResult(Result.Success(new Res(cmd.Value)));
        }
    }

    private sealed class InMemoryStore : IIdempotencyStore
    {
        private readonly Dictionary<string, Result> _store = new();
        public Task<Result?> TryGetCachedAsync(string key, CancellationToken ct)
            => Task.FromResult(_store.TryGetValue(key, out var r) ? r : null);
        public Task PutAsync(string key, Result result, CancellationToken ct)
        {
            _store[key] = result;
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task Fresh_key_invokes_handler_once_and_caches_outcome()
    {
        var inner = new Echo();
        var store = new InMemoryStore();
        var pipeline = HandlerPipeline.Build(
            inner,
            new IdempotencyBehavior<Cmd, Res>(store));

        var result = await pipeline.HandleAsync(new Cmd("k-1", "hello"));

        Assert.True(result.IsSuccess);
        Assert.Equal("hello", result.Value!.V);
        Assert.Equal(1, inner.Calls);

        var cached = await store.TryGetCachedAsync("k-1", default);
        Assert.NotNull(cached);
        Assert.True(cached!.IsSuccess);
    }

    [Fact]
    public async Task Replayed_key_returns_Conflict_and_does_not_invoke_handler()
    {
        var inner = new Echo();
        var store = new InMemoryStore();
        var pipeline = HandlerPipeline.Build(
            inner,
            new IdempotencyBehavior<Cmd, Res>(store));

        var first = await pipeline.HandleAsync(new Cmd("k-2", "first"));
        var replay = await pipeline.HandleAsync(new Cmd("k-2", "second"));

        Assert.True(first.IsSuccess);
        Assert.False(replay.IsSuccess);
        Assert.Equal("Idempotency.Replayed", replay.Error.Code);
        Assert.Equal(ErrorKind.Conflict, replay.Error.Kind);
        Assert.Equal(1, inner.Calls); // never invoked on the replay
    }
}
