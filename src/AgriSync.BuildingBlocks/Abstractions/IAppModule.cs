using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks.Abstractions;

public interface IAppModule
{
    IServiceCollection Register(IServiceCollection services);
}
