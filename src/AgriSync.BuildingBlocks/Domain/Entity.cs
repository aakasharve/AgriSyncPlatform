namespace AgriSync.BuildingBlocks.Domain;

public abstract class Entity<TId>
    where TId : notnull
{
    private readonly List<IDomainEvent> _domainEvents = [];

    protected Entity(TId id)
    {
        Id = id;
    }

    public TId Id { get; }

    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    protected void Raise(IDomainEvent domainEvent)
    {
        _domainEvents.Add(domainEvent);
    }

    public void ClearDomainEvents()
    {
        _domainEvents.Clear();
    }

    /// <summary>
    /// Removes the first <paramref name="count"/> events from the queue.
    /// Used by <c>DomainEventToOutboxInterceptor</c> to clear only the
    /// snapshot it persisted to the outbox in a given SaveChanges, so
    /// events raised AFTER the snapshot (e.g. inside another callback
    /// running between SavingChanges and SavedChanges) are preserved
    /// for the next save.
    /// </summary>
    internal void RemoveFirstDomainEvents(int count)
    {
        if (count <= 0)
        {
            return;
        }

        if (count >= _domainEvents.Count)
        {
            _domainEvents.Clear();
            return;
        }

        _domainEvents.RemoveRange(0, count);
    }

    public override bool Equals(object? obj)
    {
        if (obj is not Entity<TId> other)
        {
            return false;
        }

        return EqualityComparer<TId>.Default.Equals(Id, other.Id);
    }

    public override int GetHashCode()
    {
        return HashCode.Combine(Id);
    }
}
