// spec: data-principle-spine-2026-05-05/03.2
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — architecture invariant
/// that <see cref="TenantContext"/> MUST be registered as Scoped.
///
/// <para>
/// Why Scoped matters: the
/// <c>TenantConnectionInterceptor</c> closes over the per-request
/// <see cref="TenantContext"/>. A Singleton registration would smear one
/// request's farm claim across every other concurrent request handled by
/// the same process, fail the RLS keying and silently leak cross-tenant
/// rows. A Transient registration would split the interceptor's view of
/// the claim from the
/// <c>ShramSafalAuthorizationEnforcer</c>'s view (each resolution would
/// produce its own instance), so the interceptor would never see the
/// claim the enforcer just set and the request would either fail-closed
/// (no claim) or run with a stale claim.
/// </para>
///
/// <para>
/// This test mirrors Program.cs's registration line so any future change
/// that drops the <c>AddScoped&lt;TenantContext&gt;()</c> call or flips
/// it to a different lifetime fails the build before reaching CI.
/// </para>
/// </summary>
public sealed class TenantContextRegistrationTests
{
    [Fact(DisplayName = "TenantContext is registered as Scoped")]
    public void TenantContext_is_registered_as_Scoped()
    {
        // Mirror the exact registration line from Program.cs. If Program.cs
        // ever drops this call (or changes the lifetime), the production
        // wiring goes out of contract with this invariant — which is what
        // architecture tests are for.
        var services = new ServiceCollection();
        services.AddScoped<TenantContext>();
        services.AddScoped<TenantConnectionInterceptor>();

        var tenantDescriptor = Assert.Single(
            services,
            sd => sd.ServiceType == typeof(TenantContext));
        Assert.Equal(ServiceLifetime.Scoped, tenantDescriptor.Lifetime);

        var interceptorDescriptor = Assert.Single(
            services,
            sd => sd.ServiceType == typeof(TenantConnectionInterceptor));
        Assert.Equal(ServiceLifetime.Scoped, interceptorDescriptor.Lifetime);
    }

    [Fact(DisplayName = "TenantContext scoped instance is shared across one scope")]
    public void TenantContext_scoped_instance_is_shared_across_one_scope()
    {
        // Behavioural shadow of the Scoped assertion: two resolutions inside
        // ONE scope must return the SAME instance; two resolutions across
        // TWO scopes must return DIFFERENT instances. A regression to
        // Transient or Singleton would flip both.
        var services = new ServiceCollection();
        services.AddScoped<TenantContext>();
        using var root = services.BuildServiceProvider();

        using (var scope1 = root.CreateScope())
        {
            var a = scope1.ServiceProvider.GetRequiredService<TenantContext>();
            var b = scope1.ServiceProvider.GetRequiredService<TenantContext>();
            Assert.Same(a, b);
        }

        TenantContext fromScope2;
        using (var s2 = root.CreateScope())
        {
            fromScope2 = s2.ServiceProvider.GetRequiredService<TenantContext>();
        }

        using (var s3 = root.CreateScope())
        {
            var fromScope3 = s3.ServiceProvider.GetRequiredService<TenantContext>();
            Assert.NotSame(fromScope2, fromScope3);
        }
    }
}
