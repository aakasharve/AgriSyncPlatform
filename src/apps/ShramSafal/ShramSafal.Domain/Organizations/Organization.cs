using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Organizations;

public sealed class Organization : Entity<Guid>
{
    private Organization() : base(Guid.Empty) { }

    private Organization(Guid id, string name, OrganizationType type, DateTime createdAtUtc) : base(id)
    {
        Name = name;
        Type = type;
        CreatedAtUtc = createdAtUtc;
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;
    public OrganizationType Type { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsActive { get; private set; }

    public static Organization Create(Guid id, string name, OrganizationType type, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Organization name cannot be empty", nameof(name));

        var org = new Organization(id, name.Trim(), type, createdAtUtc);
        org.Raise(new OrganizationCreatedEvent(Guid.NewGuid(), createdAtUtc, id, org.Name, type));
        return org;
    }

    public void Deactivate(DateTime occurredAtUtc)
    {
        IsActive = false;
    }
}
