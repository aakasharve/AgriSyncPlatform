using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Identity;

namespace ShramSafal.Application.UseCases.Memberships.PersonalInvitations;

/// <summary>Forensic provenance of the audit rows, from the endpoint (<c>HttpContext.AuditClaims()</c>, <c>X-App-Version</c>).</summary>
public sealed record InvitationAuditContext(string AppVersion = "unknown", string DeviceId = "unknown", string IpHash = "sha256:unknown");

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6, §11.3; founder D-22, D-26, D-8).
/// One service, one rule set, for the personal invitation: the owner makes it, lists it, withdraws it and answers a claim
/// with one tap; the invited person sees his card, accepts or declines.
/// </summary>
/// <remarks>
/// <para><b>Who may.</b> People and permissions are the PRIMARY account holder's alone (D-26): the caller must be the
/// farm's registrant on a PrimaryOwner seat (the same rule as <c>ManageMembershipHandler</c>). A सहमालक, कुटुंब, मुकादम or
/// कामगार is refused with the same 403, whatever he holds.</para>
/// <para><b>What activates.</b> The ruling (orchestrator, 2026-11-05): an invitation that named a mobile, claimed by the
/// person whose PROVEN number it is (<see cref="IUserDirectory.GetVerifiedPhoneAsync"/> — the server's record of an OTP,
/// never the request or the token), is the owner's approval given in advance, so स्वीकारा activates EXACTLY the grant
/// (label, plots, authorities and their ends). Every other claim — no number named, a different number, an unproven one —
/// makes a waiting request that grants nothing until the owner's one tap (<see cref="ApproveClaimAsync"/>), which applies
/// that same grant. So D-22 "every join waits for the owner" holds: in the first case he acted before the claim.</para>
/// <para><b>The worker link (lane WID, P6).</b> "This is रमेश from your हजेरी list" links that farm record to the login
/// only on a verified-number claim — the owner's explicit choice plus the worker's own proven phone, WID's R1 — and only
/// under WID's R3 (a proven number belongs to one person): never when another identity holds that number proven, never
/// when the worker's own proven number is a different one. No new linking path: the record keeps all its work (R2, P7).</para>
/// <para><b>Tenancy, both ways (E4).</b> The owner's routes open the caller's farm scope first; every read here names the
/// farm as well. A plot or a worker record of another farm is refused on creation; another farm's invitation is
/// NotFound through this farm's path. The invitee never reaches a farm's data: a waiting claim is no farm in his list.</para>
/// </remarks>
public sealed class PersonalInvitationService(
    IShramSafalRepository repository,
    IPersonalInvitationRepository invitations,
    IPersonalInvitationTenantScope inviteeScope,
    IUserDirectory users,
    WorkerIdentityService workerIdentity,
    IIdGenerator ids,
    IClock clock)
{
    /// <summary>Invitations one farm may make in 24 hours (my call): a big gang in a day, never a code-spraying loop.</summary>
    public const int InvitationsPerFarmPerDay = 20;

    /// <summary>How far back the owner's list reaches (my call): a week's invitations and the week before.</summary>
    public static readonly TimeSpan OwnerListWindow = TimeSpan.FromDays(30);

    public static readonly Error DailyCap = Error.Conflict(
        "invitation.daily_cap", "This farm has made today's invitations. Try again tomorrow.");

    public static readonly Error Unknown = Error.NotFound("invitation.unknown", "No such invitation.");
    public static readonly Error Expired = Error.Conflict("invitation.expired", "This invitation has expired.");
    public static readonly Error Used = Error.Conflict("invitation.used", "This invitation has already been used.");
    public static readonly Error Declined = Error.Conflict("invitation.declined", "This invitation was declined.");
    public static readonly Error Withdrawn = Error.Conflict("invitation.withdrawn", "The farm owner withdrew this invitation.");
    public static readonly Error AlreadyMember = Error.Conflict("invitation.already_member", "You are already on this farm.");

    private const int CodeAttempts = 4;

    // ── the owner ───────────────────────────────────────────────────────────────────────────────

    public async Task<Result<PersonalInvitationView>> CreateAsync(
        Guid farmId, Guid callerUserId, CreatePersonalInvitationInput input, InvitationAuditContext audit, CancellationToken ct)
    {
        var farm = await PrimaryFarmAsync(farmId, callerUserId, ct);
        if (farm is null)
        {
            return Result.Failure<PersonalInvitationView>(ShramSafalErrors.Forbidden);
        }

        var now = clock.UtcNow;
        var label = RelationshipLabels.Parse(input.Label);
        if (label is null
            || !Enum.TryParse<MembershipPlotScope>(input.PlotScope ?? string.Empty, ignoreCase: false, out var plotScope)
            || !Enum.IsDefined(plotScope)
            || int.TryParse(input.PlotScope, out _))
        {
            return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
        }

        string? phone = null;
        if (!string.IsNullOrWhiteSpace(input.InvitedPhone))
        {
            phone = IndianMobile.Normalize(input.InvitedPhone);
            if (phone is null)
            {
                return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
            }
        }

        // E4 — the foreign child: every chosen plot is THIS farm's, the worker record is THIS farm's.
        var plotIds = (input.PlotIds ?? []).ToList();
        var plotNames = new List<string>();
        if (plotIds.Count > 0)
        {
            var farmPlots = (await repository.GetPlotsByFarmIdAsync(farmId, ct)).ToDictionary(p => p.Id, p => p.Name);
            foreach (var plotId in plotIds.Distinct())
            {
                if (!farmPlots.TryGetValue(plotId, out var plotName))
                {
                    return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
                }

                plotNames.Add(plotName);
            }
        }

        if (input.FieldOperatorId is { } recordId)
        {
            var record = await repository.GetFieldOperatorByIdAsync(recordId, ct);
            if (record is null || record.OriginatingFarmId.Value != farmId || !record.IsActive)
            {
                return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
            }
        }

        if (!TryReadAuthorities(input.Authorities, out var authorities))
        {
            return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
        }

        if (await invitations.CountCreatedSinceAsync(farmId, now - TimeSpan.FromDays(1), ct) >= InvitationsPerFarmPerDay)
        {
            return Result.Failure<PersonalInvitationView>(DailyCap);
        }

        var newId = ids.New();
        PersonalInvitation invitation;
        try
        {
            invitation = PersonalInvitation.Create(
                newId, farm.Id, farm.Name, new UserId(callerUserId), label.Value, input.Name, phone, input.FieldOperatorId,
                plotScope, plotIds.Distinct().ToList(), plotNames, authorities, PersonalInvitationCode.New(), now);
        }
        catch (ArgumentException)
        {
            return Result.Failure<PersonalInvitationView>(ShramSafalErrors.InvalidCommand);
        }

        // The ruling: one waiting invitation per (farm, mobile). A new one for the same number withdraws the old one.
        if (phone is not null)
        {
            foreach (var older in await invitations.GetWaitingForPhoneAsync(farmId, phone, ct))
            {
                if (older.Withdraw(new UserId(callerUserId), now, replacedBy: newId))
                {
                    await repository.AddAuditEventAsync(Audit(
                        "PersonalInvitationWithdrawn", older.Id, farmId, callerUserId, "primaryowner",
                        new { invitationId = older.Id, reason = "Replaced", replacedBy = newId }, audit), ct);
                }
            }
        }

        await repository.AddAuditEventAsync(Audit(
            "PersonalInvitationCreated", newId, farmId, callerUserId, "primaryowner",
            new
            {
                invitationId = newId,
                label = invitation.Label.ToString(),
                plotScope = invitation.PlotScope.ToString(),
                plotIds = invitation.ScopePlotIds,
                authorities = PersonalInvitationProjection.AuthorityList(invitation),
                namesAMobile = phone is not null,
                fieldOperatorId = invitation.FieldOperatorId,
                expiresAtUtc = invitation.ExpiresAtUtc,
            }, audit), ct);

        for (var attempt = 1; ; attempt++)
        {
            if (await invitations.TrySaveNewAsync(invitation, ct))
            {
                return Result.Success(PersonalInvitationProjection.View(invitation, now));
            }

            if (attempt == CodeAttempts)
            {
                return Result.Failure<PersonalInvitationView>(Error.Conflict(
                    "invitation.code_unavailable", "Could not make a code. Please try again."));
            }

            // A clash on the eight digits: the same invitation, a fresh code.
            invitation = PersonalInvitation.Create(
                newId, farm.Id, farm.Name, new UserId(callerUserId), label.Value, input.Name, phone, input.FieldOperatorId,
                plotScope, plotIds.Distinct().ToList(), plotNames, authorities, PersonalInvitationCode.New(), now);
        }
    }

    public async Task<Result<IReadOnlyList<PersonalInvitationView>>> ListAsync(Guid farmId, Guid callerUserId, CancellationToken ct)
    {
        if (await PrimaryFarmAsync(farmId, callerUserId, ct) is null)
        {
            return Result.Failure<IReadOnlyList<PersonalInvitationView>>(ShramSafalErrors.Forbidden);
        }

        var now = clock.UtcNow;
        var rows = await invitations.ListForFarmAsync(farmId, now - OwnerListWindow, ct);
        // A claim still waits for his tap only while its seat is still a waiting claim of that invitation (the owner may
        // have said नको through the general decline, or the person withdrew it).
        var waitingClaims = (await repository.GetFarmMembershipsAsync(new FarmId(farmId), ct))
            .Where(m => m.Status == MembershipStatus.PendingApproval && m.PersonalInvitationId is not null)
            .Select(m => m.PersonalInvitationId!.Value)
            .ToHashSet();
        return Result.Success<IReadOnlyList<PersonalInvitationView>>(rows
            .Where(r => r.FarmId.Value == farmId)
            .Select(r => PersonalInvitationProjection.View(r, now) with { WaitsForOwner = r.WaitsForOwner && waitingClaims.Contains(r.Id) })
            .ToList());
    }

    public async Task<Result<PersonalInvitationView>> WithdrawAsync(
        Guid farmId, Guid callerUserId, Guid invitationId, InvitationAuditContext audit, CancellationToken ct)
    {
        if (await PrimaryFarmAsync(farmId, callerUserId, ct) is null)
        {
            return Result.Failure<PersonalInvitationView>(ShramSafalErrors.Forbidden);
        }

        var invitation = await invitations.GetForFarmForUpdateAsync(farmId, invitationId, ct);
        if (invitation is null || invitation.FarmId.Value != farmId)
        {
            return Result.Failure<PersonalInvitationView>(Unknown);
        }

        var now = clock.UtcNow;
        if (invitation.Withdraw(new UserId(callerUserId), now))
        {
            await repository.AddAuditEventAsync(Audit(
                "PersonalInvitationWithdrawn", invitation.Id, farmId, callerUserId, "primaryowner",
                new { invitationId = invitation.Id, reason = "ByOwner" }, audit), ct);
            await invitations.SaveChangesAsync(ct);
        }

        return Result.Success(PersonalInvitationProjection.View(invitation, now));
    }

    /// <summary>The owner's one tap on a claim that waits for him: the claimant is let in with EXACTLY the invitation's grant.</summary>
    public async Task<Result<LabourPermissionDto>> ApproveClaimAsync(
        Guid farmId, Guid callerUserId, Guid invitationId, InvitationAuditContext audit, CancellationToken ct)
    {
        if (await PrimaryFarmAsync(farmId, callerUserId, ct) is null)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.Forbidden);
        }

        var invitation = await invitations.GetForFarmForUpdateAsync(farmId, invitationId, ct);
        if (invitation is null || invitation.FarmId.Value != farmId)
        {
            return Result.Failure<LabourPermissionDto>(Unknown);
        }

        if (invitation.Status != PersonalInvitationStatus.Accepted || !invitation.WaitsForOwner
            || invitation.ClaimedByUserId is not { } claimant)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipWrongStatus);
        }

        var seat = await repository.GetTrackedFarmMembershipForUpdateAsync(farmId, claimant.Value, ct);
        if (seat is null || seat.FarmId.Value != farmId || seat.Status != MembershipStatus.PendingApproval
            || seat.PersonalInvitationId != invitation.Id)
        {
            return Result.Failure<LabourPermissionDto>(ShramSafalErrors.MembershipWrongStatus);
        }

        var now = clock.UtcNow;
        seat.ActivateFromPersonalInvitation(new UserId(callerUserId), invitation, now);
        invitation.RecordOwnerApproval(now);
        await repository.AddAuditEventAsync(Audit(
            "MemberApproved", seat.Id, farmId, callerUserId, "primaryowner",
            new
            {
                farmId,
                targetUserId = claimant.Value,
                viaPersonalInvitation = invitation.Id,
                label = invitation.Label.ToString(),
                toRole = seat.Role.ToString(),
                plotScope = seat.PlotScope.ToString(),
                plotIds = seat.ScopePlotIds.Order().ToList(),
                authorities = PersonalInvitationProjection.AuthorityList(invitation),
            }, audit), ct);
        await repository.SaveChangesAsync(ct);

        var names = await users.GetDisplayNamesAsync([claimant.Value], ct);
        return Result.Success(LabourPermissionProjection.From(
            seat, now, names.GetValueOrDefault(claimant.Value), isRegistrant: false, phoneLast4: null, callerMayGrant: true));
    }

    // ── the invited person ──────────────────────────────────────────────────────────────────────

    /// <summary>After sign-in: every waiting invitation that named his proven number (the card, स्वीकारा / नको).</summary>
    public async Task<Result<IReadOnlyList<InvitationCardView>>> MineAsync(Guid callerUserId, CancellationToken ct)
    {
        var phone = await ProvenPhoneAsync(callerUserId, ct);
        if (phone is null)
        {
            return Result.Success<IReadOnlyList<InvitationCardView>>([]);
        }

        await inviteeScope.OpenInviteeDoorAsync(phone, code: null, ct);
        var now = clock.UtcNow;
        var waiting = (await invitations.ListVisibleAsync(ct))
            .Where(i => i.Names(phone) && i.StatusAt(now) == PersonalInvitationStatus.Waiting)
            .OrderByDescending(i => i.CreatedAtUtc)
            .ToList();
        var names = await users.GetDisplayNamesAsync(waiting.Select(i => i.InvitedByUserId.Value), ct);
        return Result.Success<IReadOnlyList<InvitationCardView>>(waiting
            .Select(i => PersonalInvitationProjection.Card(i, now, phone, names.GetValueOrDefault(i.InvitedByUserId.Value)))
            .ToList());
    }

    /// <summary>He typed (or scanned) a code: the card, whatever it stands at, so an ended one says why.</summary>
    public async Task<Result<InvitationCardView>> FindAsync(Guid callerUserId, string? typedCode, CancellationToken ct)
    {
        var code = PersonalInvitationCode.Normalize(typedCode);
        if (code is null)
        {
            return Result.Failure<InvitationCardView>(Unknown);
        }

        var phone = await ProvenPhoneAsync(callerUserId, ct);
        await inviteeScope.OpenInviteeDoorAsync(phone, code, ct);
        var invitation = await invitations.FindVisibleByCodeAsync(code, ct);
        if (invitation is null || invitation.Code != code)
        {
            return Result.Failure<InvitationCardView>(Unknown);
        }

        var names = await users.GetDisplayNamesAsync([invitation.InvitedByUserId.Value], ct);
        return Result.Success(PersonalInvitationProjection.Card(
            invitation, clock.UtcNow, phone, names.GetValueOrDefault(invitation.InvitedByUserId.Value)));
    }

    /// <summary>स्वीकारा — by the card listed for his number (<paramref name="invitationId"/>) or by a code he holds.</summary>
    public async Task<Result<InvitationAcceptView>> AcceptAsync(
        Guid callerUserId, Guid? invitationId, string? typedCode, InvitationAuditContext audit, CancellationToken ct)
    {
        var (found, phone, refused) = await LocateAsync(callerUserId, invitationId, typedCode, ct);
        if (found is null)
        {
            return Result.Failure<InvitationAcceptView>(refused!);
        }

        await inviteeScope.PublishInvitationFarmScopeAsync(found.FarmId.Value, callerUserId, ct);
        var invitation = await invitations.GetForFarmForUpdateAsync(found.FarmId.Value, found.Id, ct);
        if (invitation is null)
        {
            return Result.Failure<InvitationAcceptView>(Unknown);
        }

        var now = clock.UtcNow;
        if (RefusalFor(invitation.StatusAt(now)) is { } ended)
        {
            return Result.Failure<InvitationAcceptView>(ended);
        }

        var farmId = invitation.FarmId.Value;
        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        if (farm is null)
        {
            return Result.Failure<InvitationAcceptView>(Unknown);
        }

        if (farm.OwnerUserId.Value == callerUserId || invitation.InvitedByUserId.Value == callerUserId)
        {
            return Result.Failure<InvitationAcceptView>(AlreadyMember);
        }

        var caller = new UserId(callerUserId);
        var seat = await repository.GetTrackedFarmMembershipForUpdateAsync(farmId, callerUserId, ct);
        var isNewSeat = seat is null;
        if (seat is not null)
        {
            if (seat.FarmId.Value != farmId || !seat.IsGenericJoinRequest)
            {
                // Working, paused, or already a claim: the invitation stays waiting, untouched.
                return Result.Failure<InvitationAcceptView>(AlreadyMember);
            }

            // His earlier "may I join?" is answered by the invitation the owner made for him.
            seat.AttachPersonalInvitation(invitation, now);
        }
        else
        {
            seat = FarmMembership.CreateFromPersonalInvitation(ids.New(), invitation, caller, now);
            await repository.AddFarmMembershipAsync(seat, ct);
        }

        // The ruling: the number it named, proven by this person's own one-time code = the owner's advance approval.
        var approvedInAdvance = invitation.Names(phone);
        var workerLinked = false;
        if (approvedInAdvance)
        {
            seat.ActivateFromPersonalInvitation(invitation.InvitedByUserId, invitation, now);
            if (invitation.FieldOperatorId is { } recordId)
            {
                workerLinked = await TryLinkWorkerAsync(farmId, seat, recordId, phone!, callerUserId, ct);
                if (workerLinked)
                {
                    invitation.RecordWorkerLinked();
                }
            }
        }

        invitation.Accept(caller, seat.Id, waitsForOwner: !approvedInAdvance, now);
        await repository.AddAuditEventAsync(Audit(
            approvedInAdvance ? "MemberJoined" : "MemberJoinRequested", seat.Id, farmId, callerUserId,
            approvedInAdvance ? seat.Role.ToString().ToLowerInvariant() : "joiner",
            new
            {
                farmId,
                userId = callerUserId,
                viaPersonalInvitation = invitation.Id,
                label = invitation.Label.ToString(),
                status = seat.Status.ToString(),
                approvedInAdvanceBy = approvedInAdvance ? invitation.InvitedByUserId.Value : (Guid?)null,
                namedNumberMatched = approvedInAdvance,
                workerLinked,
                answeredJoinRequest = !isNewSeat,
            }, audit), ct);

        // The identity rows a link changed are written in this same unit of work, while the identity door is still open
        // (WID's phone table answers only inside it); the door is closed once they are saved.
        var saved = true;
        if (isNewSeat)
        {
            saved = await repository.TrySaveNewMembershipAsync(ct);
        }
        else
        {
            await repository.SaveChangesAsync(ct);
        }

        if (invitation.FieldOperatorId is not null)
        {
            await workerIdentity.CloseIdentityDoorAsync(ct);
        }

        if (!saved)
        {
            return Result.Failure<InvitationAcceptView>(Error.Conflict(
                "join.concurrent_claim_unresolved", "Could not complete joining. Please try again."));
        }

        return Result.Success(new InvitationAcceptView(farmId, invitation.FarmName, seat.Status.ToString(), seat.Id, workerLinked));
    }

    /// <summary>नको — it ends; nothing is made. An invitation that named a number is declined only by that proven number.</summary>
    public async Task<Result<string>> DeclineAsync(
        Guid callerUserId, Guid? invitationId, string? typedCode, InvitationAuditContext audit, CancellationToken ct)
    {
        var (found, phone, refused) = await LocateAsync(callerUserId, invitationId, typedCode, ct);
        if (found is null)
        {
            return Result.Failure<string>(refused!);
        }

        if (found.InvitedPhoneE164 is not null && !found.Names(phone))
        {
            // Someone the link reached who is not the person it named cannot end it for him.
            return Result.Failure<string>(Unknown);
        }

        await inviteeScope.PublishInvitationFarmScopeAsync(found.FarmId.Value, callerUserId, ct);
        var invitation = await invitations.GetForFarmForUpdateAsync(found.FarmId.Value, found.Id, ct);
        if (invitation is null)
        {
            return Result.Failure<string>(Unknown);
        }

        var now = clock.UtcNow;
        if (RefusalFor(invitation.StatusAt(now)) is { } ended)
        {
            return Result.Failure<string>(ended);
        }

        invitation.Decline(new UserId(callerUserId), now);
        await repository.AddAuditEventAsync(Audit(
            "PersonalInvitationDeclined", invitation.Id, invitation.FarmId.Value, callerUserId, "joiner",
            new { invitationId = invitation.Id }, audit), ct);
        await invitations.SaveChangesAsync(ct);
        return Result.Success(nameof(PersonalInvitationStatus.Declined));
    }

    // ── the rules ───────────────────────────────────────────────────────────────────────────────

    /// <summary>The farm, when the caller is its PRIMARY account holder (registrant on a PrimaryOwner seat); else null.</summary>
    private async Task<Farm?> PrimaryFarmAsync(Guid farmId, Guid callerUserId, CancellationToken ct)
    {
        if (farmId == Guid.Empty || callerUserId == Guid.Empty)
        {
            return null;
        }

        if (await repository.GetUserRoleForFarmAsync(farmId, callerUserId, ct) != AppRole.PrimaryOwner)
        {
            return null;
        }

        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        return farm is not null && farm.Id.Value == farmId && farm.OwnerUserId.Value == callerUserId ? farm : null;
    }

    /// <summary>The caller's number as <c>+91…</c>, only when an OTP proved it (the server's record).</summary>
    private async Task<string?> ProvenPhoneAsync(Guid callerUserId, CancellationToken ct)
    {
        // The invitee routes carry no farm claim: the interceptor is silenced before the directory read.
        await inviteeScope.BeginInviteeLookupAsync(ct);
        return IndianMobile.Normalize(await users.GetVerifiedPhoneAsync(callerUserId, ct));
    }

    /// <summary>
    /// Finds the invitation the caller means, through the invitee door only: by the card listed for HIS proven number, or
    /// by the code he holds. Anything else — no proven number for an id, a code that is not eight digits, an id and a code
    /// that disagree — is the one answer <see cref="Unknown"/>.
    /// </summary>
    private async Task<(PersonalInvitation? Found, string? Phone, Error? Refused)> LocateAsync(
        Guid callerUserId, Guid? invitationId, string? typedCode, CancellationToken ct)
    {
        string? code = null;
        if (!string.IsNullOrWhiteSpace(typedCode))
        {
            code = PersonalInvitationCode.Normalize(typedCode);
            if (code is null)
            {
                return (null, null, Unknown);
            }
        }

        if (code is null && invitationId is null)
        {
            return (null, null, ShramSafalErrors.InvalidCommand);
        }

        var phone = await ProvenPhoneAsync(callerUserId, ct);
        await inviteeScope.OpenInviteeDoorAsync(phone, code, ct);

        PersonalInvitation? found;
        if (code is not null)
        {
            found = await invitations.FindVisibleByCodeAsync(code, ct);
            if (found is null || found.Code != code || (invitationId is { } id && found.Id != id))
            {
                return (null, phone, Unknown);
            }
        }
        else
        {
            // By id: only an invitation naming his proven number (the door shows no other; re-asserted here, E4).
            found = phone is null
                ? null
                : (await invitations.ListVisibleAsync(ct)).FirstOrDefault(i => i.Id == invitationId && i.Names(phone));
            if (found is null)
            {
                return (null, phone, Unknown);
            }
        }

        return (found, phone, null);
    }

    private static Error? RefusalFor(PersonalInvitationStatus status) => status switch
    {
        PersonalInvitationStatus.Waiting => null,
        PersonalInvitationStatus.Expired => Expired,
        PersonalInvitationStatus.Accepted => Used,
        PersonalInvitationStatus.Declined => Declined,
        PersonalInvitationStatus.Withdrawn => Withdrawn,
        _ => Unknown,
    };

    /// <summary>
    /// lane WID — the invitation's worker record becomes this login's, through WID's own link rules
    /// (<see cref="WorkerIdentityService.RecordLoginLinkAsync"/>: this farm's working record, no other identity holding the
    /// number proven, his own proven number not a different one). Here only the seat's side: no other live seat of the
    /// farm is already that worker. Returns false — and links nothing — when any rule says no; the seat stays Active.
    /// </summary>
    private async Task<bool> TryLinkWorkerAsync(
        Guid farmId, FarmMembership seat, Guid recordId, string phoneE164, Guid claimantUserId, CancellationToken ct)
    {
        var seats = await repository.GetFarmMembershipsAsync(new FarmId(farmId), ct);
        if (seats.Any(s => s.Id != seat.Id && !s.IsTerminal && s.FieldOperatorId == recordId))
        {
            return false;
        }

        if (!await workerIdentity.RecordLoginLinkAsync(farmId, recordId, phoneE164, claimantUserId, ct))
        {
            return false;
        }

        seat.LinkWorkerRecord(recordId);
        return true;
    }

    private static bool TryReadAuthorities(
        IReadOnlyList<AuthorityGrantDto>? items, out IReadOnlyDictionary<FarmAuthority, DateTime?> authorities)
    {
        var result = new Dictionary<FarmAuthority, DateTime?>();
        authorities = result;
        foreach (var item in items ?? [])
        {
            if (item is null || string.IsNullOrWhiteSpace(item.Name) || int.TryParse(item.Name, out _)
                || !Enum.TryParse<FarmAuthority>(item.Name.Trim(), ignoreCase: false, out var authority)
                || !Enum.IsDefined(authority) || result.ContainsKey(authority))
            {
                return false;
            }

            result[authority] = item.ExpiresAtUtc is { } end
                ? DateTime.SpecifyKind(end, end.Kind == DateTimeKind.Unspecified ? DateTimeKind.Utc : end.Kind).ToUniversalTime()
                : null;
        }

        // The rules of the set itself (enforced only, ends in the future, what each needs) are the domain's, applied
        // when the invitation is made.
        return true;
    }

    private static AuditEvent Audit(
        string action, Guid entityId, Guid farmId, Guid actorUserId, string actorRole, object payload, InvitationAuditContext audit) =>
        AuditEventFactory.Create(
            entityType: action.StartsWith("PersonalInvitation", StringComparison.Ordinal) ? "PersonalInvitation" : "FarmMembership",
            entityId: entityId,
            action: action,
            actorUserId: actorUserId,
            actorRole: actorRole,
            payload: payload,
            farmId: farmId,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(audit.AppVersion) || audit.AppVersion == "unknown"
                ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                : audit.AppVersion,
            deviceId: audit.DeviceId,
            ipHash: audit.IpHash,
            sourceAiJobId: null);
}
