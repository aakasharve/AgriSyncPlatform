using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING: read-only DbContext used by
/// <see cref="OutboxDispatcher"/> to poll pending outbox messages.
///
/// <para>
/// The physical <c>ssf.outbox_messages</c> table is OWNED by
/// <c>ShramSafalDbContext</c> (created and evolved by its
/// <c>AddOutboxMessages</c> EF migration). Three writing DbContexts
/// CURRENTLY persist into the same physical table:
/// <list type="bullet">
/// <item><c>ShramSafalDbContext</c> — owner; events from
/// <c>DailyLog</c>, <c>VerificationEvent</c>, etc.</item>
/// <item><c>UserDbContext</c> — events from <c>User</c> aggregate
/// (UserRegistered, MembershipChanged); maps via
/// <c>ToTable("outbox_messages","ssf").ExcludeFromMigrations()</c>.</item>
/// <item><c>AccountsDbContext</c> — events from <c>OwnerAccount</c> /
/// <c>Subscription</c>; same cross-schema-write pattern.</item>
/// </list>
/// </para>
///
/// <para>
/// This dispatcher-side context maps to the same physical table via
/// the schema declared at registration time so it can read pending
/// rows and update <c>ProcessedOnUtc</c> / <c>Error</c> columns. It
/// does NOT participate in migrations.
/// </para>
///
/// <para>
/// <b>Hard deployment invariant:</b> all three writing DbContexts
/// AND this dispatcher-side context MUST point at the same physical
/// Postgres database. If a future deploy splits them onto separate
/// databases, the dispatcher would only see ShramSafal's writes and
/// User+Accounts events would queue but never publish. The
/// bootstrapper logs a warning at startup if the dispatcher's
/// connection string doesn't share host+port+database with the
/// ShramSafal writing context.
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
