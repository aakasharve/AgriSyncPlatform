using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Analytics;

public sealed class AnalyticsDbContext(DbContextOptions<AnalyticsDbContext> options) : DbContext(options)
{
    public const string SchemaName = "analytics";

    public DbSet<AnalyticsEvent> Events => Set<AnalyticsEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(SchemaName);
        // Only apply configurations declared in the Analytics folder — avoid
        // sweeping in unrelated BuildingBlocks types (e.g. outbox) that belong
        // to other DbContexts.
        modelBuilder.ApplyConfiguration(new AnalyticsEventConfiguration());
    }
}
