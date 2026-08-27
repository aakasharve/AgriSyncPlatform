// spec: 2026-08-25-prod-cutover-waves
using System.Security.Claims;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence;

/// <summary>
/// The two halves of the DPDP consent gate need OPPOSITE database postures, and the
/// middleware is the only place that decides which one a request gets.
///
/// <para><b>accept</b> runs before login. There is no account yet, so its row lands with
/// <c>user_id NULL</c> and it stays on the admin-elevated skip-list. <b>link</b> runs after
/// login and writes a row that NAMES the user — and the RLS policy on both ledgers is
/// <c>WITH CHECK (user_id IS NULL OR user_id = NULLIF(current_setting('agrisync.user_id',
/// true), '')::uuid)</c>.</para>
///
/// <para><b>Why this file exists.</b> An admin-elevated request emits no
/// <c>agrisync.user_id</c> GUC at all. For a row naming a user the WITH CHECK then reduces
/// to <c>user_id = NULL</c>, which is NULL, which is not TRUE, so the server refuses the
/// row with <c>42501</c>. Had <c>link</c> been left on the skip-list, every linking write
/// would have failed in production on every call — and no unit test against a fake
/// repository could have seen it, because a fake repository does not evaluate an RLS
/// policy. That is the failure class that took production down for twenty minutes on
/// 2026-08-26 (<c>42501: permission denied for table correction_events</c>).</para>
///
/// <para>These tests observe posture only — which terminal state
/// <see cref="TenantContext"/> lands in, and whether a tenant transaction was opened. The
/// database half of the same claim is proved for real against Postgres in
/// <c>ShramSafal.Sync.IntegrationTests.Consent.ConsentGateLedgerRlsTests</c>; neither
/// half is sufficient alone.</para>
/// </summary>
public sealed class TenantTransactionMiddlewareConsentGateTests
{
    private static readonly Guid Caller = Guid.Parse("3f5a1c92-4d77-4c1e-9b64-0a2e8f61c7d3");

    private const string LinkPath = "/shramsafal/consent-gate/link";
    private const string AcceptPath = "/shramsafal/consent-gate/accept";

    /// <summary>
    /// The linking write names a user, so the request must carry that user's id into the
    /// session as <c>agrisync.user_id</c> — and inside a transaction, because the GUC is
    /// set with <c>is_local := true</c> and would otherwise be discarded before the INSERT.
    /// </summary>
    [Fact]
    public async Task Consent_gate_link_is_user_scoped_so_its_row_can_name_a_user()
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();
        var nextCalled = false;

        var middleware = new TenantTransactionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var http = new DefaultHttpContext();
        http.Request.Path = LinkPath;
        http.User = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[] { new Claim("sub", Caller.ToString()) },
                authenticationType: "TestAuth"));

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(nextCalled);
        Assert.True(
            tenantContext.IsUserScoped,
            "the linking row names a user, and only user-scoped mode emits agrisync.user_id");
        Assert.Equal(Caller, tenantContext.UserId);
        Assert.False(
            tenantContext.IsAdminCrossTenant,
            "admin elevation emits no GUC, so the WITH CHECK would refuse the row with 42501");
        Assert.Equal(1, registry.Calls);
    }

    /// <summary>
    /// The accepting write happens BEFORE login. There is no <c>sub</c> claim to be had, its
    /// row carries <c>user_id NULL</c>, and the WITH CHECK admits that unconditionally — so
    /// elevation is correct here and narrowing it would break the gate for every new farmer.
    /// </summary>
    [Fact]
    public async Task Consent_gate_accept_stays_admin_elevated_because_its_row_has_no_owner()
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();
        var nextCalled = false;

        var middleware = new TenantTransactionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var http = new DefaultHttpContext();
        http.Request.Path = AcceptPath;

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(nextCalled);
        Assert.True(
            tenantContext.IsAdminCrossTenant,
            "the gate runs before login; there is no user to scope to");
        Assert.False(tenantContext.IsUserScoped);
        Assert.Null(tenantContext.UserId);
        Assert.Equal(0, registry.Calls);
    }

    /// <summary>
    /// A carve-out leaks through prefix matching. <c>/shramsafal/consent-gate/linkage</c>
    /// begins with the link path; <c>/shramsafal/consent-gate</c> is its parent. Neither is
    /// the linking endpoint, and neither may be handed a user GUC by accident — an
    /// unintended user-scoped posture on a path nobody audited is how a tenant boundary
    /// moves without anyone deciding to move it.
    ///
    /// <para>Each case is driven with a VALID authenticated subject on purpose: without one
    /// the middleware could not enter user-scoped mode whatever the path said, and the test
    /// would pass for a reason unrelated to path matching.</para>
    /// </summary>
    [Theory]
    [InlineData("/shramsafal/consent-gate")]
    [InlineData("/shramsafal/consent-gate/linkage")]
    [InlineData("/shramsafal/consent-gate/link-user")]
    [InlineData("/shramsafal/consent-gate/links")]
    public async Task A_near_miss_path_does_not_fall_into_the_user_scoped_carve_out(string path)
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();

        var middleware = new TenantTransactionMiddleware(_ => Task.CompletedTask);

        var http = new DefaultHttpContext();
        http.Request.Path = path;
        http.User = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[] { new Claim("sub", Caller.ToString()) },
                authenticationType: "TestAuth"));

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.False(
            tenantContext.IsUserScoped,
            $"'{path}' is not the linking endpoint; only an exact match may take the carve-out");
    }

    private sealed class RecordingRegistry : ITenantScopedDbContextRegistry
    {
        public int Calls { get; private set; }

        public IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices)
        {
            Calls++;
            return Array.Empty<DbContext>();
        }
    }
}
