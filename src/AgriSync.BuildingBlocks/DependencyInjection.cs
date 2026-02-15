using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks;

public static class DependencyInjection
{
    public static IServiceCollection AddBuildingBlocks(this IServiceCollection services)
    {
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IIdGenerator, GuidIdGenerator>();
        services.AddSingleton(TimeProvider.System);

        return services;
    }
}
