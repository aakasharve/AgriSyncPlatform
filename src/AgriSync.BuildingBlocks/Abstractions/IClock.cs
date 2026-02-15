namespace AgriSync.BuildingBlocks.Abstractions;

public interface IClock
{
    DateTime UtcNow { get; }
}
