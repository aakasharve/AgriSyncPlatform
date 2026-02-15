namespace AgriSync.BuildingBlocks.Abstractions;

public sealed class GuidIdGenerator : IIdGenerator
{
    public Guid New() => Guid.NewGuid();
}
