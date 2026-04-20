using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Microsoft.EntityFrameworkCore;

namespace Accounts.Infrastructure.Persistence;

public sealed class AccountsDbContext(DbContextOptions<AccountsDbContext> options) : DbContext(options)
{
    public const string SchemaName = "accounts";

    public DbSet<OwnerAccount> OwnerAccounts => Set<OwnerAccount>();
    public DbSet<OwnerAccountMembership> OwnerAccountMemberships => Set<OwnerAccountMembership>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<SubscriptionWebhookEvent> SubscriptionWebhookEvents => Set<SubscriptionWebhookEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(SchemaName);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AccountsDbContext).Assembly);
    }
}
