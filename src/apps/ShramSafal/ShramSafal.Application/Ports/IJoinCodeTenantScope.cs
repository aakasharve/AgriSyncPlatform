namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the tenant scope for a TYPED farm-code join
/// (<c>POST /shramsafal/join/by-code</c>). Sibling of <see cref="IJoinClaimTenantScope"/>: the
/// caller is, by definition, not yet a member of the farm they are asking to join, so
/// <see cref="ICallerFarmTenantScope"/> (which validates membership) cannot serve it. Here the
/// only artifact is the code the person typed, so the scope is staged around it and each stage
/// widens visibility by exactly what the previous stage proved:
/// <list type="number">
/// <item><see cref="BeginCodeLookupAsync"/> - admin-elevates ONLY to silence
/// <c>TenantConnectionInterceptor</c>, then publishes ONE transaction-local GUC,
/// <c>agrisync.join_code</c>. The SELECT-only policy <c>p_join_code_select_farms</c>
/// (migration <c>AddFarmJoinCodeReadPolicy</c>) then makes visible the ONE <c>ssf.farms</c> row
/// whose <c>farm_code</c> equals it, and nothing else: no farm id or user id is set, so no other
/// row of any RLS table is visible, and no write policy is widened.</item>
/// <item><see cref="PublishCodeFarmScopeAsync"/> - called ONLY with the id of the row stage 1
/// found (never a request value). It clears <c>agrisync.join_code</c> and publishes
/// <c>agrisync.farm_id</c> + the validated JWT subject as <c>agrisync.user_id</c>, exactly as the
/// QR claim's stage 2 does, so the membership read and the <c>farm_memberships</c> /
/// <c>audit_events</c> INSERTs pass FORCE-RLS for THAT farm and no other.</item>
/// </list>
/// A wrong or unknown code never reaches stage 2: no farm GUC is ever set for it.
/// </summary>
public interface IJoinCodeTenantScope
{
    /// <summary>
    /// Stage 1. Must run before the first DbCommand of the request.
    /// <paramref name="normalizedFarmCode"/> is the output of <c>FarmCode.Normalize</c>.
    /// </summary>
    Task BeginCodeLookupAsync(string normalizedFarmCode, CancellationToken ct = default);

    /// <summary>
    /// Stage 2. <paramref name="codeFarmId"/> MUST be the id of the farm stage 1 just found by
    /// its code. <paramref name="joinerUserId"/> is the caller's validated JWT subject.
    /// </summary>
    Task PublishCodeFarmScopeAsync(Guid codeFarmId, Guid joinerUserId, CancellationToken ct = default);
}
