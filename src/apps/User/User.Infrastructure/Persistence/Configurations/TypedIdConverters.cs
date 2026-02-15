using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace User.Infrastructure.Persistence.Configurations;

internal static class TypedIdConverters
{
    public static readonly ValueConverter<UserId, Guid> UserId =
        new(id => id.Value, value => new UserId(value));
}
