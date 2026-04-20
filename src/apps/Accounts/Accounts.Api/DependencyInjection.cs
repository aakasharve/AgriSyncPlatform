using Accounts.Application;
using Accounts.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Accounts.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddAccountsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddAccountsApplication();
        services.AddAccountsInfrastructure(configuration);
        return services;
    }
}
