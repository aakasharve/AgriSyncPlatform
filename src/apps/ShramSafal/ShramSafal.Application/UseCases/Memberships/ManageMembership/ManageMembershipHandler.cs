using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Memberships.PersonalInvitations;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.ManageMembership;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2) — the owner approves / declines / pauses /
/// restores / removes a person, or changes their role and permissions. Until this existed a typed
/// farm code made a PendingApproval seat that nothing could ever answer.
///
/// <para><b>The guards, in order (each refusal is <see cref="ShramSafalErrors.Forbidden"/>, never
/// NotFound, so the route is no oracle for which phone belongs to which farm):</b></para>
/// <list type="number">
/// <item>Nobody decides about themselves.</item>
/// <item>Only the PRIMARY owner decides (founder D-22, answered 26 Oct 2026: "The primary owner
/// decides who may see information, assign work, confirm records…"; a co-owner, family or मुकादम
/// label grants no say over people, and no delegated power passes that authority onward). For now
/// the primary owner is the farm's registrant (<c>farms.owner_user_id</c>): the caller must answer
/// <see cref="AppRole.PrimaryOwner"/> from <c>GetUserRoleForFarmAsync</c> AND be that registrant
/// (a PrimaryOwner seat that is not the registrant decides nothing). The pipeline's
/// <see cref="ManageMembershipAuthorizer"/> (owner tier, which also publishes the farm's tenant
/// claim) ran first; a co-owner passes it and is refused here.</item>
/// <item>Never the farm's registrant (<c>farms.owner_user_id</c>): he cannot be paused, removed or
/// changed in M1 (plan §4). Kept as its own check although "only the registrant decides" and
/// "nobody decides about himself" already imply it.</item>
/// <item>The person's live seat must be on THIS farm (read with the farm in the predicate and
/// re-asserted — doctrine E4, as <c>SetLabourPermissionHandler</c>).</item>
/// <item>The last Active primary owner stays (invariant I3) →
/// <see cref="ShramSafalErrors.MembershipLastOwner"/> (409).</item>
/// </list>
/// <para><b>Only two choices are given in step 2</b> (<see cref="GivableRoles"/>): काम सांगणे
/// (Worker) and काम + हजेरी (Mukadam + the existing labour grant). A co-owner / family seat is not
/// offered until step 2b, where its powers are visible switches (D-22 §1, alignment M-2); asking for
/// it is <see cref="ShramSafalErrors.InvalidCommand"/> (400).</para>
/// A decision re-sent after it already landed (approve as the same choice, pause of a paused seat,
/// restore of a working seat) answers 200 with the current truth and writes nothing. A decision the
/// seat's status does not allow (restore a waiting request, approve someone let in as another role)
/// is <see cref="ShramSafalErrors.MembershipWrongStatus"/> (409).
///
/// <para><b>One audit row per real change</b> (as <c>SetLabourPermissionHandler.cs:158</c>): who,
/// what, from → to, the reason. A re-sent request that changes nothing writes no history and
/// answers 200 with the current truth; a re-sent decline / removal of a seat that has already ended
/// answers the same way.</para>
///
/// <para><b>No IEntitlementPolicy</b> — deciding who is on your own farm is access control, not a
/// paid feature (same ruling as the labour grant).</para>
/// </summary>
public sealed class ManageMembershipHandler(
    IShramSafalRepository repository,
    IClock clock,
    // spec: plr-d10 lane MU-2 fix round 1 (review M-1) — optional so existing direct constructions keep compiling; the
    // composition root supplies both, and then an approval ends the person's waiting named invitations on this farm.
    IPersonalInvitationRepository? invitations = null,
    IUserDirectory? users = null)
    : IHandler<ManageMembershipCommand, LabourPermissionDto>
{
    /// <summary>The roles the primary owner may give in step 2: काम सांगणे and काम + हजेरी.
    /// Ownership is never handed out here; a co-owner / family seat waits for step 2b's visible
    /// switches (D-22); experts wait for step 6.</summary>
    private static readonly AppRole[] GivableRoles = [AppRole.Worker, AppRole.Mukadam];

    public async Task<Result<LabourPermissionDto>> HandleAsync(
        ManageMembershipCommand command, CancellationToken ct = default)
    {
        // ── 1. Shape ─────────────────────────────────────────────────────────
        if (command.FarmId.IsEmpty || command.TargetUserId.IsEmpty || command.CallerUserId.IsEmpty
            || !Enum.IsDefined(command.Decision))
        {
            return Invalid();
        }

        if (!TryReadRole(command, out var requestedRole)
            || !TryReadPermissions(command, out var requestedPermissions)
            || !TryReadReason(command.Reason, out var reason))
        {
            return Invalid();
        }

        if (command.LabourGrant is not null && command.Decision != MembershipDecision.SetAccess)
        {
            return Invalid();
        }

        // lane 2b — the authority set belongs to its own decision, and that decision needs one.
        if (!TryReadAuthorities(command, out var requestedAuthorities))
        {
            return Invalid();
        }

        // lane MU-4 — the plot scope belongs to its own decision (required there) and to an approval (optional).
        if (!TryReadPlotScope(command, out var requestedPlotScope))
        {
            return Invalid();
        }

        if (command.Decision == MembershipDecision.SetAccess
            && requestedRole is null && command.Permissions is null && !command.ResetPermissions
            && command.LabourGrant is null)
        {
            return Invalid();
        }

        // ── 2. Nobody decides about themselves ───────────────────────────────
        if (command.TargetUserId == command.CallerUserId)
        {
            return Forbidden();
        }

        // ── 3. The primary owner only (D-22) ─────────────────────────────────
        var callerRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);
        if (callerRole != AppRole.PrimaryOwner)
        {
            return Forbidden();
        }

        // ── 4. …and that primary owner is the farm's registrant; never the registrant as target ──
        // Founder override (26 Oct): "primary owner" = farms.owner_user_id for now. A PrimaryOwner
        // SEAT that is not the registrant (no path makes one today, ALIGN §4D, but legacy rows and
        // test fixtures can) answers PrimaryOwner from the role read above and must still decide
        // nothing (verifier SEC-MU2-6). The farm row is read only after the role check, so a
        // stranger learns nothing from this step.
        var farm = await repository.GetFarmByIdAsync(command.FarmId.Value, ct);
        if (farm is null
            || farm.OwnerUserId != command.CallerUserId
            || farm.OwnerUserId == command.TargetUserId)
        {
            return Forbidden();
        }

        // ── 5. The person's live seat on THIS farm, locked for the decision ──
        var seat = await repository.GetTrackedFarmMembershipForUpdateAsync(
            command.FarmId.Value, command.TargetUserId.Value, ct);
        var now = clock.UtcNow;
        if (seat is null || seat.FarmId != command.FarmId)
        {
            return await AnswerEndedSeatAsync(command, now, ct);
        }

        // ── 5b. spec: plr-d10 lane MU-2 — a request claimed from a personal invitation is let in with EXACTLY that
        //        invitation's grant, by its own one-tap route (POST …/personal-invitations/{id}/approve). The general
        //        approval would choose a role and authorities afresh, so it refuses that seat (409); नको stays here.
        if (command.Decision == MembershipDecision.Approve && seat.PersonalInvitationId is not null)
        {
            // Fix round 1 (review Q2): its own code, so a screen can say why (the one-tap route lets him in).
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipClaimedFromInvitation);
        }

        // ── 6. The last Active primary owner stays (I3) ──────────────────────
        var isLastActivePrimaryOwner = false;
        if (seat.Role == AppRole.PrimaryOwner && seat.Status == MembershipStatus.Active)
        {
            isLastActivePrimaryOwner =
                await repository.CountActivePrimaryOwnersAsync(command.FarmId.Value, ct) <= 1;
            var leavesOwnerTier = command.Decision is MembershipDecision.Suspend or MembershipDecision.Remove
                || (command.Decision == MembershipDecision.SetAccess
                    && requestedRole is { } newRole && newRole != AppRole.PrimaryOwner);
            if (isLastActivePrimaryOwner && leavesOwnerTier)
            {
                return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipLastOwner);
            }
        }

        // ── 6b. lane 2b — authorities are set on a person who was let in (working or paused) and
        //        who does not hold everything by label. A waiting request is answered by approval.
        if (command.Decision == MembershipDecision.SetAuthorities)
        {
            if (seat.Status is not (MembershipStatus.Active or MembershipStatus.Suspended))
            {
                return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipWrongStatus);
            }

            if (LabourManagementPermission.IsRedundantGrantTarget(seat.Role))
            {
                return Result.Failure<LabourPermissionDto>(ShramSafalErrors.LabourManagementCarriedByRole);
            }
        }

        // ── 6c. lane MU-4 — plots are chosen for a person who was let in (working or paused) or is being let in now, never
        //        for the primary owner's label (he covers every plot), and only plots of THIS farm (E4, both ways: a plot
        //        id of another farm, or one that does not exist, is refused — never silently dropped).
        if (requestedPlotScope is { } plotChoice)
        {
            if (command.Decision == MembershipDecision.SetPlotScope
                && seat.Status is not (MembershipStatus.Active or MembershipStatus.Suspended))
            {
                return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipWrongStatus);
            }

            if (seat.Role == AppRole.PrimaryOwner)
            {
                return Result.Failure<LabourPermissionDto>(ShramSafalErrors.LabourManagementCarriedByRole);
            }

            if (plotChoice.PlotIds.Count > 0)
            {
                var farmPlots = (await repository.GetPlotsByFarmIdAsync(command.FarmId.Value, ct))
                    .Where(p => p.FarmId == command.FarmId)
                    .Select(p => p.Id)
                    .ToHashSet();
                if (!plotChoice.PlotIds.All(farmPlots.Contains))
                {
                    return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipPlotNotOnFarm);
                }
            }
        }

        // ── 7. What the seat becomes (approve / change). Only the primary owner gets here, and he
        //       holds every power, so nothing he gives is a power he lacks (no re-delegation exists).
        var target = ResolveAccess(command, seat, requestedRole, requestedPermissions);

        // ── 8. A decision re-sent after it landed: the current truth, no second history row ──
        if (AlreadyDone(command, seat, target, requestedPlotScope))
        {
            return Result.Success(await ProjectAsync(seat, now, ct));
        }

        // ── 9. Apply ─────────────────────────────────────────────────────────
        var before = new SeatSnapshot(
            seat.Status, seat.Role, seat.EffectivePermissions, seat.CanManageLabourRecords, AuthorityList(seat),
            seat.PlotScope, seat.ScopePlotIds.Order().ToList());
        bool changed;
        try
        {
            changed = Apply(command, seat, target, reason, requestedAuthorities, isLastActivePrimaryOwner, now);
            // lane MU-4 — an approval may choose the plots in the same tap (the preset's default, कामगार → स्वतःचं काम).
            if (requestedPlotScope is { } plots
                && command.Decision is MembershipDecision.Approve or MembershipDecision.SetPlotScope)
            {
                changed |= seat.SetPlotScope(plots.Scope, plots.PlotIds, now);
            }
        }
        catch (LastPrimaryOwnerRevocationException)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipLastOwner);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipWrongStatus);
        }
        catch (ArgumentException)
        {
            // A shape the parsers above already refuse (unknown permission bits, a reason over 500).
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);
        }

        // ── 10. History only when something moved ────────────────────────────
        if (changed)
        {
            await repository.AddAuditEventAsync(BuildAudit(command, AppRole.PrimaryOwner, seat, before), ct);
            // Fix round 1 (review M-1): he is in now — a named invitation still waiting for his number must not outlive a
            // later decision of the owner's. Ended in the same unit of work, each with its own audit row.
            if (command.Decision == MembershipDecision.Approve && invitations is not null && users is not null)
            {
                await NamedInvitations.EndForPersonLetInAsync(
                    invitations, repository, users, command.FarmId.Value, command.TargetUserId.Value, exceptInvitationId: null,
                    command.CallerUserId, now, command.ClientAppVersion, command.AuditDeviceId, command.AuditIpHash, ct);
            }

            await repository.SaveChangesAsync(ct);
        }

        return Result.Success(await ProjectAsync(seat, now, ct));
    }

    /// <summary>
    /// What an approve or an access change makes of the seat: role, stored permissions (<c>null</c>
    /// = the role's defaults) and the हजेरी व पक्कं grant (<c>null</c> = leave it). <c>null</c> for
    /// the other decisions.
    ///
    /// <para><b>A new role starts from ITS defaults</b> (stored permissions AND the labour grant)
    /// unless the same request names them. Keeping the old stored set across a role change let a
    /// person moved to काम सांगणे keep the powers the owner had stored for his old role while his
    /// card said कामगार; keeping the grant let a मुकादम moved to काम सांगणे keep हजेरी व पक्कं.</para>
    ///
    /// <para><b>An approval sets the grant to EXACTLY the chosen preset</b> — on for काम + हजेरी,
    /// off otherwise — never "leave it". A grant already stored on the waiting seat (written
    /// before SetLabourPermission refused waiting seats, or by a co-owner's PUT labour-permissions)
    /// must not survive into a seat the primary owner let in as काम सांगणे (verifier SEC-MU2-1).</para>
    /// </summary>
    private static AccessTarget? ResolveAccess(
        ManageMembershipCommand command,
        FarmMembership seat,
        AppRole? requestedRole,
        FarmPermission? requestedPermissions)
    {
        switch (command.Decision)
        {
            case MembershipDecision.Approve:
                {
                    var role = requestedRole!.Value;
                    // The owner tier carries the grant by role: the stored flag stays off there.
                    var grant = !LabourManagementPermission.IsCarriedByRole(role) && command.GrantLabour;
                    return new AccessTarget(role, requestedPermissions, grant);
                }

            case MembershipDecision.SetAccess:
                {
                    var role = requestedRole ?? seat.Role;
                    var roleChanges = role != seat.Role;
                    var permissions = command.ResetPermissions ? null
                        : command.Permissions is not null ? requestedPermissions
                        : roleChanges ? null
                        // spec: plr-d10 lane CMP-D1 fix round 1 (review N002) - the stored choice is re-sent UNCHANGED, but a bit the
                        // label can never hold ("तुलना पाहणे" on a Worker row an older build or a hand left behind) is dropped
                        // here instead of failing the owner's unrelated change; an EXPLICIT grant of it still refuses (above).
                        : seat.Permissions is { } kept ? kept & ~FarmPermissionDefaults.BarredFor(role)
                        : null;
                    // The owner tier carries the grant by role: the stored flag stays off there.
                    var grant = LabourManagementPermission.IsCarriedByRole(role)
                        ? (roleChanges ? false : null)
                        : command.LabourGrant ?? (roleChanges ? false : null);
                    return new AccessTarget(role, permissions, grant);
                }

            default:
                return null;
        }
    }

    /// <summary>
    /// The decision already holds (a retry on a bad line after the first try landed): approve of a
    /// seat the owner already let in as exactly this choice, pause of a paused seat, restore of a
    /// working seat. Decline / remove of an ended seat are answered by <see cref="AnswerEndedSeatAsync"/>.
    /// </summary>
    private static bool AlreadyDone(
        ManageMembershipCommand command, FarmMembership seat, AccessTarget? target, PlotChoice? plots) =>
        command.Decision switch
        {
            MembershipDecision.Approve =>
                (plots is null || plots.IsStoredOn(seat))
                && seat.Status == MembershipStatus.Active
                && seat.ApprovedByUserId is not null
                && target is not null
                && seat.Role == target.Role
                // lane 2b: the "काम + हजेरी" switch also stores confirm records, so the landed
                // decision holds the chosen bits plus that one when the switch was on.
                && (seat.Permissions ?? FarmPermission.None)
                    == ((target.Permissions ?? FarmPermission.None)
                        | (target.LabourGrant == true ? FarmPermission.ConfirmRecords : FarmPermission.None))
                && (target.LabourGrant is not { } grant || seat.CanManageLabourRecords == grant),
            MembershipDecision.Suspend => seat.Status == MembershipStatus.Suspended,
            MembershipDecision.Restore => seat.Status == MembershipStatus.Active,
            _ => false,
        };

    private static bool Apply(
        ManageMembershipCommand command,
        FarmMembership seat,
        AccessTarget? target,
        string? reason,
        IReadOnlyDictionary<FarmAuthority, DateTime?>? authorities,
        bool isLastActivePrimaryOwner,
        DateTime now)
    {
        switch (command.Decision)
        {
            case MembershipDecision.Approve:
                seat.Approve(command.CallerUserId, target!.Role, target.Permissions, now);
                if (target.LabourGrant is { } approvedGrant)
                {
                    // Desired state, both ways: a grant left on the waiting seat is turned OFF here.
                    // lane 2b (P11): the "काम + हजेरी" choice is the one switch every installed phone
                    // knows — take हजेरी AND confirm records, as it meant until 2b.
                    seat.SetLegacyLabourSwitch(approvedGrant, expiresAtUtc: null, now);
                }

                return true;

            case MembershipDecision.Decline:
                seat.Decline(command.CallerUserId, reason, now);
                return true;

            case MembershipDecision.Suspend:
                seat.Suspend(command.CallerUserId, reason, now);
                return true;

            case MembershipDecision.Restore:
                seat.Restore(command.CallerUserId, now);
                return true;

            case MembershipDecision.Remove:
                seat.Remove(command.CallerUserId, reason, now, isLastActivePrimaryOwner);
                return true;

            case MembershipDecision.SetAccess:
                // Both writes, always (no short-circuit): either may be the only real change.
                var accessMoved = seat.SetAccess(target!.Role, target.Permissions, command.CallerUserId, now);
                // lane 2b (P11): the legacy switch keeps meaning take हजेरी AND confirm records.
                var grantMoved = target.LabourGrant is { } grant
                    && seat.SetLegacyLabourSwitch(grant, expiresAtUtc: null, now);
                return accessMoved | grantMoved;

            case MembershipDecision.SetAuthorities:
                return seat.SetAuthorities(authorities!, now);

            case MembershipDecision.SetPlotScope:
                // lane MU-4 — applied by the caller with the parsed choice (it also rides an approval).
                return false;

            default:
                // Unreachable: HandleAsync refuses an undefined decision first.
                return false;
        }
    }

    /// <summary>
    /// No live seat. A decline or removal asks for "this person is not on the farm", and that is
    /// already true when his newest seat on THIS farm has ended — whether the owner ended it (a
    /// retry on a bad line after the first try landed: Revoked) or the person left or withdrew
    /// his request on his own meanwhile (Exited). Answer that truth: 200 with the ENDED row as it
    /// is (its real status and when it changed — nothing claims a fresh decision), no second
    /// history row; the phone adopts the row and the person drops off the list. Answering 403 for
    /// a person who already left told the owner "हे तुम्हाला करता येत नाही" — untrue (verifier
    /// MU2-V6).
    ///
    /// <para>Which decision ended the seat is not matched (verifier SEC-MU2-7): the row cannot tell
    /// a declined request from a removed farm-QR seat (both are Revoked with no approver), and both
    /// answers state the same end. The caller is the farm's registrant (steps 3-4), so the row is
    /// his own farm's history and nothing leaks. Anything else is the uniform refusal.</para>
    /// </summary>
    private async Task<Result<LabourPermissionDto>> AnswerEndedSeatAsync(
        ManageMembershipCommand command, DateTime now, CancellationToken ct)
    {
        if (command.Decision is MembershipDecision.Decline or MembershipDecision.Remove)
        {
            var ended = await repository.GetLatestEndedFarmMembershipAsync(
                command.FarmId.Value, command.TargetUserId.Value, ct);
            if (ended is not null
                && ended.FarmId == command.FarmId
                && ended.IsTerminal)
            {
                return Result.Success(await ProjectAsync(ended, now, ct));
            }
        }

        return Forbidden();
    }

    private AuditEvent BuildAudit(
        ManageMembershipCommand command, AppRole callerRole, FarmMembership seat, SeatSnapshot before) =>
        AuditEventFactory.Create(
            entityType: "FarmMembership",
            entityId: seat.Id,
            action: command.Decision switch
            {
                MembershipDecision.Approve => "MemberApproved",
                MembershipDecision.Decline => "MemberDeclined",
                MembershipDecision.Suspend => "MemberSuspended",
                MembershipDecision.Restore => "MemberRestored",
                MembershipDecision.Remove => "MemberRemoved",
                MembershipDecision.SetAuthorities => "MemberAuthoritiesChanged",
                MembershipDecision.SetPlotScope => "MemberPlotScopeChanged",
                _ => "MemberAccessChanged",
            },
            actorUserId: command.CallerUserId.Value,
            actorRole: callerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                farmId = command.FarmId.Value,
                targetUserId = command.TargetUserId.Value,
                fromStatus = before.Status.ToString(),
                toStatus = seat.Status.ToString(),
                fromRole = before.Role.ToString(),
                toRole = seat.Role.ToString(),
                fromPermissions = FarmPermissionDefaults.Names(before.Permissions),
                // What the seat may do NOW (effective), and what the owner stored (null = role
                // defaults) — both, because "defaults" and "chose exactly the defaults" are
                // different decisions (P3).
                permissions = FarmPermissionDefaults.Names(seat.EffectivePermissions),
                storedPermissions = seat.Permissions is { } stored ? FarmPermissionDefaults.Names(stored) : null,
                labourGrantBefore = before.LabourGrant,
                labourGrant = seat.CanManageLabourRecords,
                // lane 2b — every stored authority with its end, before and after (P3: "until the
                // 4th" and "permanently" are different decisions).
                authoritiesBefore = before.Authorities,
                authorities = AuthorityList(seat),
                // lane MU-4 — which plots, before and after (P3: who, when, from and to).
                plotScopeBefore = before.PlotScope.ToString(),
                plotIdsBefore = before.PlotIds,
                plotScope = seat.PlotScope.ToString(),
                plotIds = seat.ScopePlotIds.Order().ToList(),
                reason = seat.StatusReason,
            },
            farmId: command.FarmId.Value,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

    /// <summary>The person's roster row as the owner's team screen reads it: the server's own
    /// projection, with the directory name and (M-7) the last four phone digits. Never the
    /// registrant (refused at step 4), so <c>isRegistrant</c> is false.</summary>
    private async Task<LabourPermissionDto> ProjectAsync(FarmMembership seat, DateTime now, CancellationToken ct)
    {
        var userId = seat.UserId.Value;
        var directory = await repository.GetOperatorsByIdsAsync([userId], ct);
        var name = directory.FirstOrDefault(o => o.UserId == userId)?.DisplayName;
        var tails = await repository.GetPhoneLast4ByIdsAsync([userId], ct);
        // Every decision here is the primary owner's alone (founder D-22, step 3 above), so the
        // confirming switch on a co-owner's row is his to move (spec: plr-d10 I27, D-44 §2).
        return LabourPermissionProjection.From(
            seat,
            now,
            string.IsNullOrWhiteSpace(name) ? null : name,
            isRegistrant: false,
            phoneLast4: tails.TryGetValue(userId, out var tail) ? tail : null,
            callerMayGrant: true);
    }

    private static bool TryReadRole(ManageMembershipCommand command, out AppRole? role)
    {
        role = null;
        var raw = command.Role?.Trim();
        var needsRole = command.Decision == MembershipDecision.Approve;
        if (string.IsNullOrEmpty(raw))
        {
            return !needsRole;
        }

        if (command.Decision is not (MembershipDecision.Approve or MembershipDecision.SetAccess)
            || int.TryParse(raw, out _)
            || !Enum.TryParse<AppRole>(raw, ignoreCase: true, out var parsed)
            || !GivableRoles.Contains(parsed))
        {
            return false;
        }

        role = parsed;
        return true;
    }

    private static bool TryReadPermissions(ManageMembershipCommand command, out FarmPermission? permissions)
    {
        permissions = null;
        if (command.Permissions is null)
        {
            return true;
        }

        if (command.Decision is not (MembershipDecision.Approve or MembershipDecision.SetAccess)
            || !FarmPermissionDefaults.TryParse(command.Permissions, out var parsed))
        {
            return false;
        }

        // lane 2b — a stored see wages / review money brings see money (it means nothing without it).
        permissions = FarmAuthorities.WithWhatTheyNeed(parsed);
        return true;
    }

    /// <summary>The same rule as <see cref="FarmMembership.NormalizeReason"/>: trimmed, blank = none,
    /// longer than the column = refused (never silently cut).</summary>
    private static bool TryReadReason(string? raw, out string? reason)
    {
        var trimmed = raw?.Trim();
        reason = string.IsNullOrEmpty(trimmed) ? null : trimmed;
        return reason is null || reason.Length <= FarmMembership.MaxStatusReasonLength;
    }

    /// <summary>
    /// lane 2b — reads the requested authority set: only on <see cref="MembershipDecision.SetAuthorities"/>
    /// (required there), every name known, no name twice, every end a UTC instant (an ISO string with
    /// an offset or no zone is refused, never reinterpreted — the labour route's rule). Ends in the
    /// past and "wages / review money without see money" are refused by the domain.
    /// </summary>
    private static bool TryReadAuthorities(
        ManageMembershipCommand command, out IReadOnlyDictionary<FarmAuthority, DateTime?>? authorities)
    {
        authorities = null;
        if (command.Decision != MembershipDecision.SetAuthorities)
        {
            return command.Authorities is null;
        }

        if (command.Authorities is null)
        {
            return false;
        }

        var parsed = new Dictionary<FarmAuthority, DateTime?>();
        foreach (var item in command.Authorities)
        {
            if (item is null
                || !FarmAuthorities.TryParse(item.Name, out var authority)
                || parsed.ContainsKey(authority)
                || item.ExpiresAtUtc is { Kind: not DateTimeKind.Utc })
            {
                return false;
            }

            parsed[authority] = item.ExpiresAtUtc;
        }

        authorities = parsed;
        return true;
    }

    /// <summary>
    /// lane MU-4 — reads the requested plot scope: required on <see cref="MembershipDecision.SetPlotScope"/>, optional on
    /// <see cref="MembershipDecision.Approve"/>, refused everywhere else. A known NAME (never a number), chosen plots with
    /// one or more plot ids, every other scope with none (<see cref="FarmMembership.NormalizePlotScope"/>).
    /// </summary>
    private static bool TryReadPlotScope(ManageMembershipCommand command, out PlotChoice? choice)
    {
        choice = null;
        var raw = command.PlotScope?.Trim();
        if (command.Decision is not (MembershipDecision.SetPlotScope or MembershipDecision.Approve))
        {
            return string.IsNullOrEmpty(raw) && command.PlotIds is null;
        }

        if (string.IsNullOrEmpty(raw))
        {
            return command.Decision == MembershipDecision.Approve && command.PlotIds is null;
        }

        if (int.TryParse(raw, out _) || !Enum.TryParse<MembershipPlotScope>(raw, ignoreCase: false, out var scope)
            || !Enum.IsDefined(scope))
        {
            return false;
        }

        try
        {
            choice = new PlotChoice(scope, FarmMembership.NormalizePlotScope(scope, command.PlotIds));
            return true;
        }
        catch (ArgumentException)
        {
            // A shape the domain refuses (chosen plots with none, plots named for another scope): Invalid, never trimmed.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("membership.plot_scope.refused_shape"));
            return false;
        }
    }

    private static IReadOnlyList<object> AuthorityList(FarmMembership seat) =>
        seat.StoredAuthorities()
            .Select(a => (object)new { name = FarmAuthorities.NameOf(a.Key), expiresAtUtc = a.Value })
            .ToList();

    private static Result<LabourPermissionDto> Invalid() =>
        Result.Failure<LabourPermissionDto>(ShramSafalErrors.InvalidCommand);

    private static Result<LabourPermissionDto> Forbidden() =>
        Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);

    private sealed record SeatSnapshot(
        MembershipStatus Status,
        AppRole Role,
        FarmPermission Permissions,
        bool LabourGrant,
        IReadOnlyList<object> Authorities,
        MembershipPlotScope PlotScope,
        IReadOnlyList<Guid> PlotIds);

    /// <summary>lane MU-4 — one parsed plot choice: the scope and its plots (empty unless chosen plots).</summary>
    private sealed record PlotChoice(MembershipPlotScope Scope, IReadOnlySet<Guid> PlotIds)
    {
        public bool IsStoredOn(FarmMembership seat) =>
            seat.PlotScope == Scope && seat.ScopePlotIds.Count == PlotIds.Count && seat.ScopePlotIds.All(PlotIds.Contains);
    }

    private sealed record AccessTarget(AppRole Role, FarmPermission? Permissions, bool? LabourGrant);
}
