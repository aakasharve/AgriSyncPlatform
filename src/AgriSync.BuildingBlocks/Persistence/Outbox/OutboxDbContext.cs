using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING: read-only DbContext used by
/// <see cref="OutboxDispatcher"/> to poll pending outbox messages.
///
/// <para>
/// The actual <c>outbox_messages</c> table is owned by the writing
/// DbContext that produced the message (e.g. <c>ShramSafalDbContext</c>
/// owns <c>ssf.outbox_messages</c>). This dispatcher-side context maps
/// to the same physical table via the schema declared at registration
/// time so it can read pending rows and update <c>ProcessedOnUtc</c> /
/// <c>Error</c> columns. It does NOT participate in migrations.
/// </para>
///
/// <para>
/// Today only ShramSafal writes outbox messages, so the dispatcher
/// reads from <c>ssf.outbox_messages</c>. Adding a second writing
/// DbContext means either expanding the dispatcher to poll multiple
/// tables (preferred long-term) or moving the outbox table to a
/// shared schema. Tracked under the same PIPELINE-ROLLOUT continuation.
/// </para>
/// </summary>
public sealed class OutboxDbContext : DbContext
{
    public const string DefaultSchemaName = "ssf";

    public OutboxDbContext(DbContextOptions<OutboxDbContext> options)
        : base(options)
    {
    }

    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(DefaultSchemaName);
        modelBuilder.ApplyConfiguration(new OutboxMessageConfiguration());

        // Migrations live with ShramSafalDbContext; this context is
        // read-only over the same physical table.
        modelBuilder.Entity<OutboxMessage>().ToTable(
            "outbox_messages",
            DefaultSchemaName,
            t => t.ExcludeFromMigrations());
    }
}
