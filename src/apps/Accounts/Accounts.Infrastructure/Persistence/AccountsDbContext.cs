using Accounts.Domain.Affiliation;
using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;

namespace Accounts.Infrastructure.Persistence;

public sealed class AccountsDbContext(DbContextOptions<AccountsDbContext> options) : DbContext(options)
{
    public const string SchemaName = "accounts";

    public DbSet<OwnerAccount> OwnerAccounts => Set<OwnerAccount>();
    public DbSet<OwnerAccountMembership> OwnerAccountMemberships => Set<OwnerAccountMembership>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<SubscriptionWebhookEvent> SubscriptionWebhookEvents => Set<SubscriptionWebhookEvent>();
    public DbSet<ReferralCode> ReferralCodes => Set<ReferralCode>();
    public DbSet<ReferralRelationship> ReferralRelationships => Set<ReferralRelationship>();
    public DbSet<GrowthEvent> GrowthEvents => Set<GrowthEvent>();
    public DbSet<BenefitLedgerEntry> BenefitLedgerEntries => Set<BenefitLedgerEntry>();

    /// <summary>
    /// T-IGH-03-OUTBOX-WIRING: outbox queue. Maps to the same physical
    /// <c>ssf.outbox_messages</c> table that ShramSafalDbContext owns.
    /// AccountsDbContext writes into it but does NOT own it (excluded
    /// from migrations).
    /// </summary>
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(SchemaName);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AccountsDbContext).Assembly);

        // T-IGH-03-OUTBOX-WIRING: shared outbox table lives in ssf
        // schema (owned by ShramSafalDbContext). AccountsDbContext
        // writes into it but does NOT own it.
        modelBuilder.ApplyConfiguration(new OutboxMessageConfiguration());
        modelBuilder.Entity<OutboxMessage>().ToTable(
            "outbox_messages",
            "ssf",
            t => t.ExcludeFromMigrations());
    }
}
