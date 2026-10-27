using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.ManageMembership;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the six decisions the PRIMARY owner takes about
/// one person on one farm (founder D-22). Each is its own route
/// (<c>farms/{farmId}/memberships/{userId}/…</c>) and one handler applies them, so the guards
/// (primary owner only, never self, never the registrant, the last owner stays, one audit row per
/// real change) are written once and cannot drift between six copies.
/// </summary>
public enum MembershipDecision
{
    /// <summary>Let a waiting person in, choosing the role (and permissions / labour grant).</summary>
    Approve,

    /// <summary>"नको" — the waiting request ends, with a reason.</summary>
    Decline,

    /// <summary>"काम थांबवा" — pause an Active person, with a reason.</summary>
    Suspend,

    /// <summary>"पुन्हा सुरू करा" — let a paused person work again.</summary>
    Restore,

    /// <summary>"शेतातून काढा" — end an Active or paused seat, with a reason.</summary>
    Remove,

    /// <summary>Change the role and / or the stored permission choice of a let-in person.</summary>
    SetAccess,
}

/// <param name="FarmId">The farm.</param>
/// <param name="TargetUserId">The person the owner decides about (a user id, not a membership id).</param>
/// <param name="CallerUserId">The acting owner — from the validated JWT subject, never the body.</param>
/// <param name="Decision">Which decision.</param>
/// <param name="Role">Approve: required (<c>Worker</c> / <c>Mukadam</c>; a co-owner / family seat
/// waits for step 2b). SetAccess: optional (absent = keep).</param>
/// <param name="Permissions">Permission NAMES to store. Absent (<c>null</c>) = the role's defaults
/// on Approve; on SetAccess absent = keep the stored choice on an unchanged role, and the NEW
/// role's defaults on a role change (a demotion never carries the old role's powers), or the
/// defaults whenever <see cref="ResetPermissions"/>.</param>
/// <param name="ResetPermissions">SetAccess only: go back to the role's defaults (store <c>null</c>).</param>
/// <param name="GrantLabour">Approve only: the हजेरी व पक्कं switch (the existing labour grant, no end
/// date) as DESIRED state — <c>true</c> for the "काम + हजेरी" choice, <c>false</c> = off, even when a
/// grant was left on the waiting request.</param>
/// <param name="LabourGrant">SetAccess only: the हजेरी व पक्कं switch as DESIRED state (no end
/// date). Absent = keep on an unchanged role, OFF on a role change (the new role's default).</param>
/// <param name="Reason">Decline / Suspend / Remove: the owner's words, at most 500 characters.</param>
public sealed record ManageMembershipCommand(
    FarmId FarmId,
    UserId TargetUserId,
    UserId CallerUserId,
    MembershipDecision Decision,
    string? Role = null,
    IReadOnlyList<string>? Permissions = null,
    bool ResetPermissions = false,
    bool GrantLabour = false,
    bool? LabourGrant = null,
    string? Reason = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
