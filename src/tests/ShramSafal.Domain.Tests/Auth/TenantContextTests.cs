// spec: data-principle-spine-2026-05-05/03.2
using AgriSync.BuildingBlocks.Persistence;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2 — invariants for the
/// per-request <see cref="TenantContext"/> claim holder. These rules are
/// the only thing standing between a multi-tenant API and a cross-tenant
/// data leak once Phase 03.3 RLS policies start trusting
/// <c>agrisync.farm_id</c> / <c>agrisync.owner_account_id</c>:
/// <list type="number">
/// <item><c>SetTenant</c> with the SAME farmId is idempotent — handlers
/// that traverse multiple owner / member checks for the same farm in
/// one request must not throw.</item>
/// <item><c>SetTenant</c> with a DIFFERENT farmId throws — catches
/// cross-tenant data smuggling at the handler-boundary level.</item>
/// <item><c>ElevateToAdminCrossTenant</c> after <c>SetTenant</c> throws —
/// admin elevation must never silently widen a request that already
/// committed to a single farm.</item>
/// <item><c>SetTenant</c> after <c>ElevateToAdminCrossTenant</c> throws —
/// admin scope is one-way; downgrading to single-farm would leak the
/// admin's cross-tenant reads through a single-farm response.</item>
/// </list>
/// </summary>
public sealed class TenantContextTests
{
    private static readonly Guid FarmA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid OwnerA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact(DisplayName = "SetTenant with same farmId is idempotent")]
    public void SetTenant_with_same_farmId_is_idempotent()
    {
        var ctx = new TenantContext();
        ctx.SetTenant(FarmA, OwnerA);

        var second = Record.Exception(() => ctx.SetTenant(FarmA, OwnerA));
        Assert.Null(second);
        Assert.Equal(FarmA, ctx.FarmId);
        Assert.Equal(OwnerA, ctx.OwnerAccountId);
        Assert.False(ctx.IsAdminCrossTenant);
    }

    [Fact(DisplayName = "SetTenant with different farmId throws")]
    public void SetTenant_with_different_farmId_throws()
    {
        var ctx = new TenantContext();
        ctx.SetTenant(FarmA, OwnerA);

        var ex = Assert.Throws<InvalidOperationException>(() => ctx.SetTenant(FarmB, OwnerB));
        Assert.Contains(FarmA.ToString(), ex.Message);
        Assert.Contains(FarmB.ToString(), ex.Message);
        // State must NOT have changed.
        Assert.Equal(FarmA, ctx.FarmId);
        Assert.Equal(OwnerA, ctx.OwnerAccountId);
    }

    [Fact(DisplayName = "ElevateToAdminCrossTenant after SetTenant throws")]
    public void ElevateToAdminCrossTenant_after_SetTenant_throws()
    {
        var ctx = new TenantContext();
        ctx.SetTenant(FarmA, OwnerA);

        Assert.Throws<InvalidOperationException>(() => ctx.ElevateToAdminCrossTenant());
        // State must NOT have flipped.
        Assert.False(ctx.IsAdminCrossTenant);
        Assert.Equal(FarmA, ctx.FarmId);
    }

    [Fact(DisplayName = "SetTenant after ElevateToAdminCrossTenant throws")]
    public void SetTenant_after_ElevateToAdminCrossTenant_throws()
    {
        var ctx = new TenantContext();
        ctx.ElevateToAdminCrossTenant();

        Assert.Throws<InvalidOperationException>(() => ctx.SetTenant(FarmA, OwnerA));
        // State must remain in admin scope; FarmId must still be null.
        Assert.True(ctx.IsAdminCrossTenant);
        Assert.Null(ctx.FarmId);
        Assert.Null(ctx.OwnerAccountId);
    }
}
