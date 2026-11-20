// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A4, D1)
using Microsoft.AspNetCore.OutputCaching;

namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// The admin output-cache policies, registered in one place so <c>Program.cs</c> and the cache test use the same
/// registration, not a copy. A cached admin answer is keyed per authenticated request (the output cache never
/// stores a response to an authorized request unless a policy says so, and these policies do not), so one seat's
/// answer, phones included, is never replayed to another.
/// </summary>
public static class AdminOutputCacheConfig
{
    public static void AddAdminOutputCachePolicies(this OutputCacheOptions opts)
    {
        opts.AddPolicy("AdminLive", p => p.Expire(TimeSpan.FromSeconds(30)));
        opts.AddPolicy("AdminMaterialized", p => p.Expire(TimeSpan.FromMinutes(5)));
    }
}
