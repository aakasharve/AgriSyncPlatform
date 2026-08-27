// spec: 2026-08-25-prod-cutover-waves
using System.Security.Claims;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence;

/// <summary>
/// Both halves of the DPDP consent gate take the admin skip-list, and the reason is NOT
/// that they need the same thing from the database. They need opposite things and arrive at
/// the same middleware posture from opposite directions, which is exactly the kind of
/// coincidence that invites somebody to "simplify" one of them later.
///
/// <para><b>accept</b> runs before login. There is no account yet, its row lands with
/// <c>user_id NULL</c>, and the RLS <c>WITH CHECK</c> admits an ownerless row
/// unconditionally. Elevation is all it needs, and it needs elevation because the
/// interceptor otherwise fail-closes on a request carrying no tenant claim at all.</para>
///
/// <para><b>link</b> runs after login and writes rows that NAME the user, so the same policy
/// (<c>user_id IS NULL OR user_id = NULLIF(current_setting('agrisync.user_id', true),
/// '')::uuid</c>) demands the GUC be set or it refuses the row with 42501. It is elevated
/// here anyway — because elevation is what SILENCES
/// <see cref="TenantConnectionInterceptor"/>'s per-command <c>SET LOCAL</c> prepend, and
/// that prepend is what killed the endpoint. The identity it genuinely needs is established
/// INSIDE the endpoint by <c>ICallerUserTenantScope.RunForCallerAsync</c>, which issues
/// <c>set_config</c> as its own command inside its own transaction.</para>
///
/// <para><b>Why this file changed on 2026-08-27.</b> It used to assert the opposite: that
/// <c>link</c> took a user-scoped carve-out ahead of the skip-list. That posture was
/// inferred from <c>/sync/pull</c> — and <c>/sync/pull</c> is a READ. Measured against real
/// Postgres, the linking endpoint could not write a single row on it:
/// <c>DbUpdateConcurrencyException: expected to affect 1 row(s), but actually affected 0
/// row(s)</c>, because the interceptor's prepend desyncs EF's rows-affected accounting on
/// an INSERT batch. Every layer was green and the endpoint was dead. These posture
/// assertions were part of how: they observe which branch the middleware takes and cannot
/// observe whether a write survives it.</para>
///
/// <para>So this file is now deliberately the SMALLER half of the claim. The half that
/// matters — that the write lands, on a real interceptor against a real FORCE-RLS database
/// — lives in <c>ShramSafal.Sync.IntegrationTests.Consent.ConsentGateLinkEndpointTenancyTests</c>,
/// with the policy itself proved in <c>ConsentGateLedgerRlsTests</c>. Neither half is
/// sufficient alone, and this half is the one that has already been wrong once.</para>
/// </summary>
public sealed class TenantTransactionMiddlewareConsentGateTests
{
    private static readonly Guid Caller = Guid.Parse("3f5a1c92-4d77-4c1e-9b64-0a2e8f61c7d3");

    private const string LinkPath = "/shramsafal/consent-gate/link";
    private const string AcceptPath = "/shramsafal/consent-gate/accept";

    /// <summary>
    /// The linking route must reach the endpoint ADMIN-ELEVATED and with NO tenant
    /// transaction opened around it — not user-scoped, whatever the row it goes on to write
    /// looks like. Elevation silences the interceptor's prepend (which is fatal to an EF
    /// INSERT batch), and owning no transaction here is what lets
    /// <c>RlsIdentityScope</c> open the one its <c>set_config(..., is_local := true)</c> is
    /// scoped to.
    ///
    /// <para>Driven with a VALID authenticated subject on purpose: with none, the middleware
    /// could not enter user-scoped mode whatever the path said, and the assertion below
    /// would hold for a reason unrelated to routing.</para>
    /// </summary>
    [Fact]
    public async Task Consent_gate_link_is_admin_elevated_because_elevation_silences_the_prepend()
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
            tenantContext.IsAdminCrossTenant,
            "elevation is not an identity here — it is what stops TenantConnectionInterceptor " +
            "prepending SET LOCAL onto the INSERT's own command text");
        Assert.False(
            tenantContext.IsUserScoped,
            "user-scoped mode is a READ posture; on this WRITE it produced " +
            "'expected to affect 1 row(s), but actually affected 0 row(s)' against real Postgres");
        Assert.Equal(0, registry.Calls);
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
    /// NOTHING under the consent-gate prefix enters user-scoped mode. The routes here, their
    /// near-misses (<c>/linkage</c>, <c>/links</c>, <c>/link-user</c> — a prefix match on the
    /// old carve-out claimed all three, measured) and the bare prefix itself all take the
    /// same elevated posture.
    ///
    /// <para>Pinned as a THEORY rather than folded into the case above because the failure it
    /// guards is a re-introduction: the next person to hit a 42501 on a user-named row will
    /// reach for the user-scoped branch, exactly as this route's author did. If that happens
    /// this test fails and points at the measurement instead of at a preference.</para>
    ///
    /// <para>Each case is driven with a VALID authenticated subject on purpose: without one
    /// the middleware could not enter user-scoped mode whatever the path said.</para>
    /// </summary>
    [Theory]
    [InlineData("/shramsafal/consent-gate")]
    [InlineData("/shramsafal/consent-gate/link")]
    [InlineData("/shramsafal/consent-gate/accept")]
    [InlineData("/shramsafal/consent-gate/linkage")]
    [InlineData("/shramsafal/consent-gate/link-user")]
    [InlineData("/shramsafal/consent-gate/links")]
    public async Task No_consent_gate_path_enters_user_scoped_mode(string path)
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
            $"'{path}' must not be handed the interceptor's SET LOCAL prepend — it is a write " +
            "surface, and the prepend desyncs EF's rows-affected accounting on an INSERT");
        Assert.True(tenantContext.IsAdminCrossTenant, $"'{path}' belongs to the consent-gate skip entry");
    }

    /// <summary>
    /// Removing the consent-gate carve-out must not have removed the MODE. <c>GET
    /// /sync/pull</c> is a genuine user-scoped READ (ADR 0019) and still enters it, inside a
    /// tenant transaction, from the validated JWT subject. Without this, a later "the
    /// user-scoped branch is unused, delete it" would be a defensible-looking mistake.
    /// </summary>
    [Fact]
    public async Task The_user_scoped_mode_still_serves_the_read_surface_it_was_built_for()
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();

        var middleware = new TenantTransactionMiddleware(_ => Task.CompletedTask);

        var http = new DefaultHttpContext();
        http.Request.Method = HttpMethods.Get;
        http.Request.Path = "/sync/pull";
        http.User = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[] { new Claim("sub", Caller.ToString()) },
                authenticationType: "TestAuth"));

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(tenantContext.IsUserScoped, "GET /sync/pull is the read surface ADR 0019 built the mode for");
        Assert.Equal(Caller, tenantContext.UserId);
        Assert.False(tenantContext.IsAdminCrossTenant);
        Assert.Equal(1, registry.Calls);
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
