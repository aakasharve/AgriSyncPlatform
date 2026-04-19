using Microsoft.Extensions.DependencyInjection;

namespace Accounts.Application;

public static class DependencyInjection
{
    /// <summary>
    /// Registers Accounts.Application services. Currently a shell —
    /// handlers will register here as Phase 3+ brings use cases online.
    /// </summary>
    public static IServiceCollection AddAccountsApplication(this IServiceCollection services)
    {
        return services;
    }
}
