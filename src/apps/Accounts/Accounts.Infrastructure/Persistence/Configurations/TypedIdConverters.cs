using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal static class TypedIdConverters
{
    public static readonly ValueConverter<OwnerAccountId, Guid> OwnerAccountId =
        new(id => id.Value, value => new OwnerAccountId(value));

    public static readonly ValueConverter<OwnerAccountMembershipId, Guid> OwnerAccountMembershipId =
        new(id => id.Value, value => new OwnerAccountMembershipId(value));

    public static readonly ValueConverter<SubscriptionId, Guid> SubscriptionId =
        new(id => id.Value, value => new SubscriptionId(value));

    public static readonly ValueConverter<UserId, Guid> UserId =
        new(id => id.Value, value => new UserId(value));
}
