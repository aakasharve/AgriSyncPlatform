using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence.Repositories;

public abstract class EfCoreRepositoryBase<TEntity, TId>(DbContext dbContext)
    : IEfCoreRepository<TEntity, TId>
    where TEntity : class
{
    protected DbSet<TEntity> Set => dbContext.Set<TEntity>();

    public virtual async Task<TEntity?> GetByIdAsync(TId id, CancellationToken cancellationToken = default)
    {
        return await Set.FindAsync([id], cancellationToken);
    }

    public virtual async Task<IReadOnlyList<TEntity>> ListAsync(CancellationToken cancellationToken = default)
    {
        return await Set.ToListAsync(cancellationToken);
    }

    public virtual async Task AddAsync(TEntity entity, CancellationToken cancellationToken = default)
    {
        await Set.AddAsync(entity, cancellationToken);
    }

    public virtual void Update(TEntity entity)
    {
        Set.Update(entity);
    }

    public virtual void Remove(TEntity entity)
    {
        Set.Remove(entity);
    }
}
