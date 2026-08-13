using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.ExitMembership;

/// <summary>
/// The caller exits their own membership on a given farm. Enforces
/// invariant I3 — if the caller is the last active PrimaryOwner, the
/// exit is denied (they must transfer ownership first, which is a
/// future spec).
///
/// Self-exit only: the endpoint does not accept a target-user id. An
/// owner revoking someone else's membership is a different use case
/// (<c>RevokeMembershipHandler</c>, deferred).
///
/// <para><b>Two silent-failure modes this handler exists to NOT have.</b>
/// Both were live before 2026-08-13 and neither raised anything:</para>
/// <list type="number">
/// <item>The membership was read through
/// <c>IShramSafalRepository.GetFarmMembershipAsync</c>, which is
/// <c>AsNoTracking()</c>. <c>Exit()</c> therefore mutated a DETACHED object and
/// <c>SaveChangesAsync</c> wrote nothing — while the audit row recording
/// <c>MemberExited</c> and the <c>MembershipRevoked</c> analytics event were
/// written anyway. The person kept their access AND history claimed they had
/// gone (<c>P3</c> inverted: the record was falsified while the truth stood).
/// The read is now <c>GetTrackedFarmMembershipIncludingTerminalAsync</c> —
/// tracked, so the status change is real.</item>
/// <item>Nothing established the request's farm tenant scope. The endpoint
/// resolves this handler directly (no pipeline authorizer, and the route is not
/// on <c>TenantTransactionMiddleware</c>'s skip list), so <c>TenantContext</c>
/// stayed empty and <c>TenantConnectionInterceptor</c> fail-closed on the very
/// first command. Now <see cref="ICallerFarmTenantScope"/> — the prod-proven
/// helper the farm/labour/compliance endpoints already use — admin-elevates
/// (so the interceptor stops prepending <c>SET LOCAL</c> to the UPDATE and
/// EF's rows-affected accounting stays honest) and sets the GUCs that
/// <c>p_tenant_farm_memberships</c> keys on.</item>
/// </list>
///
/// <para><b>The write and the history commit together or not at all.</b> The
/// audit row is only STAGED here; the single <c>SaveChangesAsync</c> commits the
/// status change and the audit row in one unit of work, and the analytics event
/// is emitted only after it returns. If the write cannot land, the caller gets a
/// failure — never a 200 over an unchanged row.</para>
/// </summary>
public sealed class ExitMembershipHandler(
    IShramSafalRepository repository,
    IClock clock,
    IAnalyticsWriter analytics,
    ICallerFarmTenantScope callerFarmScope)
{
    public async Task<Result<ExitMembershipResult>> HandleAsync(
        FarmId farmId,
        UserId callerUserId,
        CancellationToken ct = default,
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
        // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
        // endpoint; sentinel defaults keep existing test callers green.
        string clientAppVersion = "unknown",
        string auditDeviceId = "unknown",
        string auditIpHash = "sha256:unknown")
    {
        if (farmId.IsEmpty || callerUserId.IsEmpty)
        {
            return Result.Failure<ExitMembershipResult>(Error.Validation("exit.invalid", "Missing farm or user id."));
        }

        // Establish this request's farm tenant scope. A FAILURE here is not an
        // error yet: it means the caller holds no LIVE membership on this farm,
        // which is either "already left" (an idempotent success, answered two
        // reads below) or "never belonged" (404). Deciding at this point would
        // turn a retried exit into a 403. The scope sets the caller's own
        // agrisync.user_id either way, which is what makes the read below legal
        // under p_user_select_memberships; the WRITE needs agrisync.farm_id,
        // which only a SUCCESSFUL scope sets — so a write can never happen off
        // the back of a refused scope. The verdict is re-consulted before any
        // mutation, below.
        var scoped = await callerFarmScope.EstablishForCallerAsync(farmId.Value, callerUserId.Value, ct);

        // TRACKED and status-blind. Tracked because Exit() below must actually
        // persist; status-blind because the IsTerminal branch is the idempotent
        // answer and every other read in the port filters terminal rows out.
        var membership = await repository.GetTrackedFarmMembershipIncludingTerminalAsync(
            farmId.Value, callerUserId.Value, ct);
        if (membership is null)
        {
            return Result.Failure<ExitMembershipResult>(Error.NotFound(
                "exit.no_membership",
                "You are not a member of this farm."));
        }

        if (membership.IsTerminal)
        {
            // Already gone. No mutation, no audit row, no analytics event — a
            // re-send is not a second decision and must not appear in history
            // as one (P3).
            return Result.Success(new ExitMembershipResult(membership.Id, AlreadyExited: true));
        }

        // A live membership the request could not scope to. Unreachable while
        // the scope helper and this read agree on what "a member" means — and
        // that is exactly why it is here: if they ever stop agreeing, the write
        // below would be attempted with no agrisync.farm_id, RLS would match
        // zero rows, and the interesting question becomes what we told the
        // farmer. Refuse, so the answer can never be a 200 over an unchanged
        // row with a MemberExited line written under it.
        if (scoped.IsFailure)
        {
            return Result.Failure<ExitMembershipResult>(Error.Forbidden(
                "exit.forbidden",
                "You cannot leave this farm from this session."));
        }

        // Invariant I3 guard: if the caller is a PrimaryOwner, they can
        // only exit if another active PrimaryOwner remains.
        bool isLastActivePrimaryOwner = false;
        if (membership.Role == AppRole.PrimaryOwner)
        {
            var activePrimaryOwnerCount = await repository.CountActivePrimaryOwnersAsync(farmId.Value, ct);
            isLastActivePrimaryOwner = activePrimaryOwnerCount <= 1;
        }

        var exitAtUtc = clock.UtcNow;
        try
        {
            membership.Exit(exitAtUtc, isLastActivePrimaryOwner);
        }
        catch (LastPrimaryOwnerRevocationException)
        {
            return Result.Failure<ExitMembershipResult>(Error.Conflict(
                "exit.last_primary_owner",
                "You are the only primary owner of this farm. Promote someone else first."));
        }

        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with X-Device-Id /
        // IP hash / X-App-Version sourced from the endpoint's AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "FarmMembership",
                entityId: membership.Id,
                action: "MemberExited",
                actorUserId: callerUserId.Value,
                actorRole: membership.Role.ToString().ToLowerInvariant(),
                payload: new { farmId = farmId.Value, userId = callerUserId.Value, role = membership.Role.ToString() },
                farmId: farmId.Value,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(clientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : clientAppVersion,
                deviceId: auditDeviceId,
                ipHash: auditIpHash,
                sourceAiJobId: null), ct);
        await repository.SaveChangesAsync(ct);

        await analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.MembershipRevoked,
            OccurredAtUtc: exitAtUtc,
            ActorUserId: callerUserId,
            FarmId: farmId,
            OwnerAccountId: null,
            ActorRole: membership.Role.ToString().ToLowerInvariant(),
            Trigger: "manual",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = farmId.Value,
                exitedByUserId = callerUserId.Value,
                role = membership.Role.ToString().ToLowerInvariant()
            })
        ), ct);

        return Result.Success(new ExitMembershipResult(membership.Id, AlreadyExited: false));
    }
}
