using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal static class TypedIdConverters
{
    public static readonly ValueConverter<FarmId, Guid> FarmId =
        new(id => id.Value, value => new FarmId(value));

    public static readonly ValueConverter<UserId, Guid> UserId =
        new(id => id.Value, value => new UserId(value));
}
