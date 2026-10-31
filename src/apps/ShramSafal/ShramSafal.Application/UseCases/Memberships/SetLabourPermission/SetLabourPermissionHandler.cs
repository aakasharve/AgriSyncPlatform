using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the grant/revoke write path (founder decision O-4:
/// <i>"Owner always; Mukadam by default; others only when explicitly granted,
/// via the existing farm access-management experience"</i>).
///
/// <para><b>Nothing like this existed before.</b> There was no grant, revoke or
/// role-change endpoint anywhere in the product — <c>FarmMembership.ChangeRole</c>
/// has zero production callers to this day — while the "My Farm Team" card
/// already rendered per-member capability switches that were local React state
/// and reached no server. This handler is the server half that makes those
/// switches real.</para>
///
/// <para><b>Farm-scoped, and that is asserted in code, not assumed from the
/// database.</b> A grant on Farm A must do nothing on Farm B. Two independent
/// reasons the database alone will not give us that (doctrine E4): Postgres FK
/// checks bypass RLS entirely, so a valid <c>user_id</c> proves a person exists
/// and never that they belong to this farm; and <c>p_user_select_memberships</c>
/// is a PERMISSIVE <c>FOR SELECT</c> policy OR-ed with the tenant policy that
/// surfaces the CALLER'S OWN membership rows on EVERY farm regardless of the
/// <c>agrisync.farm_id</c> GUC. So the membership is read with the farm in the
/// predicate AND re-asserted afterwards, and a mismatch returns
/// <see cref="ShramSafalErrors.Forbidden"/>.</para>
///
/// <para><b>Forbidden, never NotFound — deliberately.</b> "You are not an
/// owner", "that person is not a member of this farm" and "that user id does not
/// exist" all answer 403 with the same body. A distinct NotFound would turn this
/// endpoint into an oracle for probing which phone numbers belong to which farm.
/// Same posture as <c>AttachFieldOperatorHandler</c>.</para>
///
/// <para><b>Nobody grants themselves.</b> Rejected before anything is read.
/// An owner granting themselves is meaningless (owner-tier is always allowed) and
/// a non-owner never gets this far, so the rule costs nothing — but it is stated
/// absolutely rather than left as an emergent property of the two checks above,
/// because "an emergent property" is exactly what stops being true after the next
/// refactor.</para>
///
/// <para><b>Authorization lives HERE as well as in the pipeline.</b> The route
/// resolves the pipeline-wrapped handler whose
/// <see cref="SetLabourPermissionAuthorizer"/> runs
/// <c>IAuthorizationEnforcer.EnsureIsOwner</c> first — that is also what
/// establishes the tenant claim for this request. The re-check below is the
/// same defense-in-depth posture the labour handlers take: a handler must fail
/// closed on its own, not lean on an outer layer that may not always be there.
/// </para>
///
/// <para><b>No <c>IEntitlementPolicy</c>.</b> That is the billing gate
/// (<c>PaidFeature</c> / <c>SubscriptionExpired</c>). Deciding who on your own
/// farm may correct a headcount is not a paid feature, and the founder has ruled
/// that out twice. Do not add this handler to
/// <c>EntitlementGateTests.GatedHandlerTypeNames</c>.</para>
/// </summary>
public sealed class SetLabourPermissionHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<SetLabourPermissionCommand, LabourPermissionDto>
{
    public async Task<Result<LabourPermissionDto>> HandleAsync(
        SetLabourPermissionCommand command, CancellationToken ct = default)
    {
        // ── 1. Shape ─────────────────────────────────────────────────────────
        if (command.FarmId.IsEmpty || command.TargetUserId.IsEmpty || command.CallerUserId.IsEmpty)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);
        }

        // The wire contract for the expiry is a UTC instant ("...Z"). An ISO
        // string with an offset ("+05:30") or no zone designator deserializes
        // to Kind=Local/Unspecified, which Npgsql refuses on a timestamptz
        // column as an unhandled 500 deep inside SaveChanges (2.2 review, M2).
        // Refuse it here, before it can reach the store — and refuse rather
        // than convert: silently reinterpreting an ambiguous instant could
        // shift a farmer's chosen end-of-day by a timezone's width.
        if (command.LabourGrantExpiresAtUtc is { Kind: not DateTimeKind.Utc })
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 2. Nobody grants themselves ──────────────────────────────────────
        if (command.TargetUserId == command.CallerUserId)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }

        // ── 3. Only the PRIMARY owner may grant or revoke ────────────────────
        // The rule itself lives in the Domain next to the labour predicate it
        // guards, so "who may hand this out" and "what this hands out" cannot
        // drift apart. spec: plr-d10 (I27), founder D-44 §2: the switch also decides
        // who confirms records on the owner's behalf, and "the primary owner" chooses
        // that — a co-owner is refused here with the same uniform Forbidden.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);
        if (!LabourManagementPermission.CanGrantOrRevoke(callerRole))
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }

        // ── 4. The target, TRACKED and farm-scoped ───────────────────────────
        var membership = await repository.GetTrackedFarmMembershipAsync(
            command.FarmId.Value, command.TargetUserId.Value, ct);

        // Both halves matter. The read already filters on farm_id; re-asserting
        // it here is doctrine E4's "assert tenancy on BOTH sides in application
        // code" and it is what a future repository change cannot quietly undo.
        if (membership is null || membership.FarmId != command.FarmId)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }

        // ── 4b. Only a person who has been let in (working or paused) ──────────
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier SEC-MU2-1). The read above returns
        // every seat that has not ended, a WAITING request (PendingApproval / PendingOtpClaim)
        // included. A grant stored on a waiting request used to survive the primary owner's
        // approval as काम सांगणे — and a co-owner (owner tier passes step 3) could store it. Who
        // a waiting person becomes is the primary owner's approval alone (founder D-22), so a
        // waiting seat is refused here, with the same uniform answer as every refusal above.
        if (membership.Status is not (MembershipStatus.Active or MembershipStatus.Suspended))
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }

        // ── 5. A grant that would change nothing is refused, not swallowed ───
        // Only the primary owner carries everything this flag can give (labour edits
        // and confirming) through his role. Storing it for him would leave a switch
        // that did not work — doctrine P5. Tell them instead. spec: plr-d10 (I27): for a
        // co-owner the flag now controls confirming (founder D-44 §2), so it is stored.
        if (LabourManagementPermission.IsRedundantGrantTarget(membership.Role))
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.LabourManagementCarriedByRole);
        }

        // ── 6. Apply ─────────────────────────────────────────────────────────
        var now = clock.UtcNow;
        bool changed;
        try
        {
            // lane 2b (P11) — this route is the one switch every installed phone knows, "हजेरी व
            // पक्कं करणे": it keeps meaning take हजेरी AND confirm records together, same end. The
            // split authorities are set one by one on PUT …/memberships/{userId}/authorities.
            changed = membership.SetLegacyLabourSwitch(
                command.CanManageLabourRecords, command.LabourGrantExpiresAtUtc, now);
        }
        catch (InvalidOperationException)
        {
            // Terminal membership (Revoked / Exited). Unreachable through the
            // repository read above, which excludes both — kept so a future
            // reader that widens that read cannot turn a domain refusal into an
            // unhandled 500.
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }
        catch (ArgumentException)
        {
            // A past expiry grants nothing; refusing keeps the switch honest
            // (P5). Shape error, not an authorisation one.
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 7. History only when something moved ─────────────────────────────
        // A re-sent toggle is not a decision and must not appear in the audit
        // trail as one (P3). It still answers 200 with current truth, which is
        // what makes the endpoint safe for a client retrying on a bad
        // connection.
        if (changed)
        {
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "FarmMembership",
                    entityId: membership.Id,
                    action: command.CanManageLabourRecords
                        ? "LabourManagementGranted"
                        : "LabourManagementRevoked",
                    actorUserId: command.CallerUserId.Value,
                    actorRole: callerRole!.Value.ToString().ToLowerInvariant(),
                    payload: new
                    {
                        farmId = command.FarmId.Value,
                        targetUserId = command.TargetUserId.Value,
                        targetRole = membership.Role.ToString(),
                        canManageLabourRecords = command.CanManageLabourRecords,
                        // A duration IS part of the decision (P3) — "till the
                        // 4th" and "permanently" are different grants. The
                        // STORED value, never the requested one: on a revoke
                        // that carries a date the domain clears the expiry, and
                        // auditing the sent date would put an instant into
                        // history that the store never held (2.2 review, M1).
                        labourGrantExpiresAtUtc = membership.LabourGrantExpiresAtUtc,
                        // lane 2b — the same switch also set confirm records, with the same end.
                        authorities = membership.StoredAuthorities()
                            .Select(a => new { name = a.Key.ToString(), expiresAtUtc = a.Value })
                            .ToList(),
                    },
                    farmId: command.FarmId.Value,
                    clientCommandId: null,
                    appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                        ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                        : command.ClientAppVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);

            await repository.SaveChangesAsync(ct);
        }

        // Only the primary owner reaches here (step 3), so the switch is his to move.
        return Result.Success(LabourPermissionProjection.From(membership, now, callerMayGrant: true));
    }
}
