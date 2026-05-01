using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using User.Domain.Membership;
using User.Domain.Security;

namespace User.Infrastructure.Persistence;

public sealed class UserDbContext(DbContextOptions<UserDbContext> options) : DbContext(options)
{
    public DbSet<Domain.Identity.User> Users => Set<Domain.Identity.User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AppMembership> Memberships => Set<AppMembership>();
    public DbSet<OtpChallenge> OtpChallenges => Set<OtpChallenge>();

    /// <summary>
    /// T-IGH-03-OUTBOX-WIRING: outbox queue. Maps to the same physical
    /// <c>ssf.outbox_messages</c> table that ShramSafalDbContext owns,
    /// so every writing DbContext drains into a single dispatcher
    /// target. This context does NOT own the table (excluded from
    /// migrations); ShramSafalDbContext's <c>AddOutboxMessages</c>
    /// migration creates and evolves it.
    /// </summary>
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("public");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(UserDbContext).Assembly);

        // T-IGH-03-OUTBOX-WIRING: shared outbox table lives in ssf
        // schema. UserDbContext writes into it but does NOT own it.
        modelBuilder.ApplyConfiguration(new OutboxMessageConfiguration());
        modelBuilder.Entity<OutboxMessage>().ToTable(
            "outbox_messages",
            "ssf",
            t => t.ExcludeFromMigrations());
    }
}
