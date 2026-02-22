using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

public sealed class Farm : Entity<FarmId>
{
    private Farm() : base(FarmId.Empty) { } // EF Core

    private Farm(FarmId id, string name, UserId ownerUserId, DateTime createdAtUtc)
        : base(id)
    {
        Name = name;
        OwnerUserId = ownerUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public string Name { get; private set; } = string.Empty;
    public UserId OwnerUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public static Farm Create(FarmId id, string name, UserId ownerUserId, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Farm name is required.", nameof(name));
        }

        return new Farm(id, name.Trim(), ownerUserId, createdAtUtc);
    }
}
