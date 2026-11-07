using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;
using static ShramSafal.Application.UseCases.Labour.WorkerIdentity.WorkerIdentityProjection;

namespace ShramSafal.Application.UseCases.Labour.WorkerIdentity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL + D-55). The narrow worker-identity
/// use cases: scan-resolve, link (start + confirm), unlink, phone (record, check, send a code, verify, move), card
/// reissue, merge and its undo, erasure (ask, cancel) and the farm's PIN. One service, one rule set — every method runs
/// AFTER the route opened the caller's farm scope (<c>RouteFarmScope</c>), checks the labour rule itself (defence in
/// depth, as every labour handler does), and reaches the person tables only through <see cref="IShramIdentityStore"/>.
/// </summary>
/// <remarks>
/// <para><b>The rules this enforces (design §5, §10).</b> R1: a link needs the worker's own proof (his card in person, or
/// a code on his verified phone) — never a name, never a number alone. R2: linking or unlinking only re-points a farm
/// record at a person; no work row, mark or headcount moves (P7). R3: a verified number has one holder; moving it is the
/// case-5 flow. R4: an unverified number may repeat — a warning, never a block. R5: every change is an append-only event
/// naming who, when and the proof; an undo names what it reverses. R6: a scan shows the name on the card and the level,
/// nothing else. R8: erasure anonymises the person after the D-71 wait, never the work. R10: another farm never sees this
/// farm's records about him, nor the PIN or number this farm entered.</para>
/// <para><b>Who may.</b> Everything a farm does to its worker's identity follows the shared labour rule
/// (<see cref="LabourManagementGate"/>: owner-tier, मुकादम, or an explicit grant) — the same rule that lets him add the
/// worker. An owner's confirmation in place of a code (cases 5 and 13) and an erasure request are owner-tier only. An
/// undo is for the person who made the change, or the farm's owner.</para>
/// </remarks>
public sealed class WorkerIdentityService(
    IShramSafalRepository repository,
    IShramIdentityStore store,
    IWorkerPhoneCodeSender sender,
    IHandler<CreateFieldOperatorCommand, FieldOperatorDto> createWorker,
    IIdGenerator ids,
    IClock clock,
    ErasureTiming? erasureTiming = null,
    WorkerIdentityFlows? flows = null)
{
    private bool UnscreenedOpen => flows?.UnscreenedFlowsEnabled == true;

    /// <summary>
    /// Per number: at most 3 codes in 15 minutes and 6 in a day (the login OTP's limits). Fix pass 2 (N2): these count
    /// only the codes asked by the farms he trusts — the farm holding his proof, and farms he linked with his own code —
    /// so no other farm can use them up.
    /// </summary>
    private const int ShortWindowCodes = 3;
    private const int LongWindowCodes = 6;

    /// <summary>
    /// Fix pass 2 (N2, builder's call) — any OTHER farm (one that has his card but not his trust: a farm asking to link
    /// him) gets its own small budget for his number: 2 codes a day per farm and 6 a day for all such farms together. So
    /// screen 5 still works, and those farms can never spend the trusted farms' codes.
    /// </summary>
    public const int OtherFarmCodesPerNumberPerDay = 2;
    public const int OtherFarmsCodesPerNumberPerDay = 6;
    private static readonly TimeSpan ShortWindow = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan LongWindow = TimeSpan.FromHours(24);

    /// <summary>
    /// Fix pass 1 (review M2) — before real SMS is ever switched on: per requesting FARM at most 20 codes a day, per
    /// requesting USER at most 10, and per farm at most 10 wrong tries at any of its codes a day (a 4-digit code then
    /// stays out of reach). The per-number limits above stay; the routes also carry the per-user request limiter.
    /// </summary>
    public const int FarmCodesPerDay = 20;
    public const int UserCodesPerDay = 10;

    /// <summary>Fix pass 2 (N2) — the orchestrator's call: raised from 10, so one member's typos cannot lock out a farm.</summary>
    public const int FarmWrongTriesPerDay = 30;

    /// <summary>
    /// Fix pass 2 (N2) — the orchestrator's call: at most 10 wrong tries a day at ALL of one person's codes, from every
    /// farm together. Then no code is sent to him or read for him until the day has passed, so guesses at his 4-digit
    /// code stay bounded however many farms or logins try.
    /// </summary>
    public const int PersonWrongTriesPerDay = 10;

    /// <summary>
    /// Fix pass 3 (review R2, the orchestrator's ruling) — of his 10 wrong tries a day, farms he does not trust (no proof
    /// of him, never linked him by his code) may use at most 5 together, so his own farms always keep 5.
    /// </summary>
    public const int StrangerWrongTriesPerDay = 5;
    // ── a login that proved the number an owner's invitation named (lane MU-2) ─────────────────────────

    /// <summary>
    /// spec: plr-d10 lane MU-2 — "this is रमेश from your हजेरी list": an owner's personal invitation named this farm record
    /// and the person's number, and that person claimed it from a login whose number a one-time code proved. That is R1's
    /// proof (the owner's explicit choice + the worker's own phone code), so the record may become this login's — under
    /// R3: never when ANOTHER identity holds the number proven, never when his own proven number is a different one, never
    /// for an erased identity or a record that is not this farm's working one. When the number is one THIS farm typed for
    /// him but nobody had proven, the login's code proves it now (screen 3's effect) — but, as for screen 3, only while the
    /// farm holds his proof (lane MU-2 fix round 1, review H-2: WID fix 2's N1 — with no verified number anywhere, only the
    /// farm that issued his working card proves his first one). Otherwise the seat link is recorded and the number stays
    /// unproven. Every change is an append-only event naming the login as actor and the proof as the phone code (R5). It
    /// moves no work (R2, P7) and writes no seat: the caller records the link on the seat and saves both in one unit of
    /// work, then closes the door (<see cref="CloseIdentityDoorAsync"/>). Returns false, with nothing staged, when any rule
    /// says no.
    /// </summary>
    public async Task<bool> RecordLoginLinkAsync(
        Guid farmId, Guid fieldOperatorId, string phoneE164, Guid loginUserId, CancellationToken ct)
    {
        var record = await RecordOnFarmAsync(farmId, fieldOperatorId, ct);
        if (record is null || !record.IsActive || IndianMobile.Normalize(phoneE164) != phoneE164)
        {
            return false;
        }

        var group = await WorkerIdentityReads.GroupOfAsync(store, record.PersonId, ct);
        if (group is null || group.Root.IsErased)
        {
            return false;
        }

        // WID fix 3's person lock (lane MU-2 fix round 1, review H-2): the same lock fix 3's send and verify paths take, taken
        // before any read below decides, so a login link and a verify for one person run one at a time. A clash on the
        // per-person verified index is still answered cleanly by the caller (IdentityClash → 409 invitation.try_again).
        await store.LockPersonAsync(group.Root.Id, ct);

        if (await HeldByAnotherAsync(phoneE164, group, ct))
        {
            return false;
        }

        var phones = await store.GetPhonesAsync(group.Ids, ct);
        if (phones.Any(p => p.IsActiveVerified && p.PhoneE164 != phoneE164))
        {
            return false;
        }

        var now = clock.UtcNow;
        var alreadyProven = phones.Any(p => p.IsActiveVerified && p.PhoneE164 == phoneE164);
        // N1: with no verified number at all, only the farm holding his proof (the issuer of his working card) may prove
        // one; and only a number THIS farm added (as WID's own verify target, SendRecordCodeAsync).
        if (!alreadyProven && await HoldsHisProofAsync(farmId, group, ct))
        {
            var typed = phones.FirstOrDefault(p =>
                p.IsActive && !p.IsActiveVerified && p.PhoneE164 == phoneE164 && p.AddedByFarmId == farmId);
            if (typed is not null)
            {
                typed.MarkVerified(now);
                await store.AddEventAsync(ShramIdentityEvent.Record(
                    ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.PhoneVerified, IdentityProof.PhoneCode, loginUserId, now), ct);
            }
        }

        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.LinkedToLogin, IdentityProof.PhoneCode, loginUserId, now), ct);
        return true;
    }

    /// <summary>lane MU-2 — closes the identity door after the caller saved what <see cref="RecordLoginLinkAsync"/> staged.</summary>
    public Task CloseIdentityDoorAsync(CancellationToken ct) => store.CloseAsync(ct);

    // ── scan-resolve (R6) ───────────────────────────────────────────────────────────────────────────

    public async Task<Result<CardResolveView>> ResolveAsync(Guid farmId, Guid userId, string? code, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return Result.Failure<CardResolveView>(ShramSafalErrors.Forbidden);
        }

        var found = await FindCardAsync(code, ct);
        if (found.Error is { } error)
        {
            return error == ShramSafalErrors.IdentityCardRetired
                ? Result.Success(new CardResolveView("Retired", null, null))
                : Result.Failure<CardResolveView>(error);
        }

        var (group, level) = (found.Group!, found.Level);
        return Result.Success(new CardResolveView("Active", group.Root.CardName, level.ToString()));
    }

    // ── link: start, confirm, undo (R1, R2, R5) ─────────────────────────────────────────────────────

    public async Task<Result<LinkStartView>> StartLinkAsync(
        Guid farmId, Guid userId, string? cardCode, string? phone, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return Result.Failure<LinkStartView>(ShramSafalErrors.Forbidden);
        }

        if (!string.IsNullOrWhiteSpace(cardCode))
        {
            var found = await FindCardAsync(cardCode, ct);
            if (found.Error is { } error)
            {
                return Result.Failure<LinkStartView>(error);
            }

            var group = found.Group!;
            var verified = await VerifiedPhoneOfAsync(group, ct);
            if (verified is null)
            {
                // His card in person is the proof: no code to send.
                return Result.Success(new LinkStartView(null, false, group.Root.CardName, found.Level.ToString()));
            }

            var sent = await SendCodeAsync(group, verified.PhoneE164!, ChallengePurpose.Link, farmId, userId, ct);
            return sent.IsSuccess
                ? Result.Success(new LinkStartView(sent.Value!.Ticket, true, group.Root.CardName, found.Level.ToString()))
                : Result.Failure<LinkStartView>(sent.Error);
        }

        var e164 = IndianMobile.Normalize(phone);
        if (e164 is null)
        {
            return Result.Failure<LinkStartView>(ShramSafalErrors.InvalidCommand);
        }

        // A typed number links only when a VERIFIED identity holds it, and only after his code comes back. The answer
        // names nobody (case 11).
        var holder = (await store.GetActivePhonesByNumberAsync(e164, ct)).FirstOrDefault(p => p.IsActiveVerified);
        if (holder is null)
        {
            return Result.Failure<LinkStartView>(ShramSafalErrors.IdentityNotFound);
        }

        var holderGroup = await WorkerIdentityReads.GroupOfAsync(store, holder.PersonId, ct);
        if (holderGroup is null || holderGroup.Root.IsErased)
        {
            return Result.Failure<LinkStartView>(ShramSafalErrors.IdentityNotFound);
        }

        var code = await SendCodeAsync(holderGroup, e164, ChallengePurpose.Link, farmId, userId, ct);
        return code.IsSuccess
            ? Result.Success(new LinkStartView(code.Value!.Ticket, true, null, null))
            : Result.Failure<LinkStartView>(code.Error);
    }

    /// <summary>
    /// Links the worker on THIS farm: his existing farm record (<paramref name="fieldOperatorId"/>) or a new one. The
    /// proof is his card (when he has no verified phone) or the code sent to his verified phone.
    /// </summary>
    public async Task<Result<(WorkerIdentityView View, bool Created)>> LinkAsync(
        Guid farmId, Guid userId, string? cardCode, Guid? ticket, string? code, Guid? fieldOperatorId, Guid? clientId,
        string? displayName, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return Result.Failure<(WorkerIdentityView, bool)>(ShramSafalErrors.Forbidden);
        }

        FieldOperator? record = null;
        if (fieldOperatorId is not null && !UnscreenedOpen)
        {
            // Re-pointing an EXISTING farm record has no approved screen yet (M3): only a new team member links.
            return Result.Failure<(WorkerIdentityView, bool)>(ShramSafalErrors.IdentityFlowOff);
        }

        if (fieldOperatorId is { } recordId)
        {
            record = await RecordOnFarmAsync(farmId, recordId, ct);
            if (record is null)
            {
                return Result.Failure<(WorkerIdentityView, bool)>(ShramSafalErrors.FieldOperatorNotFound);
            }
        }

        var proven = await ProveWorkerAsync(farmId, cardCode, ticket, code, ChallengePurpose.Link, ct);
        if (proven.Error is { } refused)
        {
            return Result.Failure<(WorkerIdentityView, bool)>(refused);
        }

        var (group, proof) = (proven.Group!, proven.Proof);
        var now = clock.UtcNow;

        var team = await repository.GetFieldOperatorsForFarmAsync(new FarmId(farmId), ct);
        var teamGroups = await WorkerIdentityReads.GroupsOfAsync(
            store, team.Where(t => t.PersonId is not null).Select(t => t.PersonId!.Value).Distinct().ToList(), ct);
        var alreadyHere = team.FirstOrDefault(t =>
            t.Id != record?.Id && t.PersonId is { } pid && teamGroups.TryGetValue(pid, out var g) && g.Root.Id == group.Root.Id);

        if (record is not null)
        {
            var current = await WorkerIdentityReads.GroupOfAsync(store, record.PersonId, ct);
            if (current?.Root.Id == group.Root.Id)
            {
                await store.TrySaveChangesAsync(ct);
                return Result.Success((await WorkerIdentityReads.ViewAsync(store, farmId, record, ct), false));
            }

            if (alreadyHere is not null)
            {
                await store.TrySaveChangesAsync(ct);
                return Result.Failure<(WorkerIdentityView, bool)>(ShramSafalErrors.IdentityAlreadyOnTeam);
            }

            var before = record.PersonId;
            record.AttachPerson(group.Root.Id);
            await store.AddEventAsync(ShramIdentityEvent.Record(
                ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.Linked, proof, userId, now, otherPersonId: before), ct);
            await store.TrySaveChangesAsync(ct);
            return Result.Success((await WorkerIdentityReads.ViewAsync(store, farmId, record, ct), false));
        }

        if (alreadyHere is not null)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<(WorkerIdentityView, bool)>(ShramSafalErrors.IdentityAlreadyOnTeam);
        }

        // A new farm record that IS this person: made by the one create use case, never here.
        var created = await createWorker.HandleAsync(
            new CreateFieldOperatorCommand(
                new FarmId(farmId),
                string.IsNullOrWhiteSpace(displayName) ? group.Root.CardName : displayName.Trim(),
                null,
                new UserId(userId),
                clientId,
                LinkPersonId: group.Root.Id,
                LinkProof: proof),
            ct);
        if (!created.IsSuccess)
        {
            return Result.Failure<(WorkerIdentityView, bool)>(created.Error);
        }

        var made = await repository.GetFieldOperatorByIdAsync(created.Value!.Id, ct);
        return Result.Success((await WorkerIdentityReads.ViewAsync(store, farmId, made!, ct), true));
    }

    /// <summary>R2 + R5 — undoes this farm's last link of the record: it goes back to the person it was (or a new card).</summary>
    public async Task<Result<WorkerIdentityView>> UnlinkAsync(Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var history = await store.GetEventsForRecordAsync(farmId, record.Id, ct);
        var link = LastUnreversed(history, IdentityEventKind.Linked, IdentityEventKind.Unlinked);
        if (link is null || record.PersonId != link.PersonId)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNothingToUndo);
        }

        if (link.ActorUserId != userId && !await IsOwnerTierAsync(farmId, userId, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.Forbidden);
        }

        var now = clock.UtcNow;
        var back = link.OtherPersonId is { } previous ? await store.GetPersonAsync(previous, ct) : null;
        Guid restored;
        if (back is not null && !back.IsErased)
        {
            restored = back.Id;
        }
        else
        {
            // Linked when it was made (no person before): it gets its own new person and card back.
            var (fresh, _) = await WorkerIdentityReads.IssueNewPersonAsync(store, ids.New(), record.DisplayName, farmId, userId, now, ct);
            restored = fresh.Id;
        }

        record.AttachPerson(restored);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, restored, IdentityEventKind.Unlinked, IdentityProof.OwnerConfirms, userId, now,
            otherPersonId: link.PersonId, reversesEventId: link.Id), ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
    }

    // ── phone and PIN: record, check (R4), code, verify (R3), move (case 5) ─────────────────────────

    /// <summary>"यांचा फोन व पिन भरा" — records (or changes) this farm's phone for him, its tag, and his PIN.</summary>
    public async Task<Result<WorkerIdentityView>> RecordContactAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, string? phone, string? phoneWhose, string? homePin, CancellationToken ct)
    {
        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var e164 = phone is null ? null : IndianMobile.Normalize(phone);
        var pin = homePin is null ? null : HomePinCode.Normalize(homePin);
        if ((phone is not null && e164 is null) || (homePin is not null && pin is null)
            || !CreateFieldOperatorHandler.TryParseWhose(phoneWhose, out var whose))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.InvalidCommand);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        if (group.Root.IsErased)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityErased);
        }

        var now = clock.UtcNow;
        if (pin is not null && group.Root.SetHomePin(pin, farmId) == PinOutcome.Set)
        {
            await store.AddEventAsync(ShramIdentityEvent.Record(
                ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.PinSet, IdentityProof.None, userId, now), ct);
        }

        if (e164 is not null)
        {
            var phones = await store.GetPhonesAsync(group.Ids, ct);
            var mine = phones.Where(p => p.AddedByFarmId == farmId && p.IsActive).ToList();
            var same = mine.FirstOrDefault(p => p.PhoneE164 == e164);
            if (same is not null)
            {
                same.ChangeWhose(whose);
            }
            else
            {
                if (mine.Any(p => p.IsActiveVerified))
                {
                    // His proved number changes only by the case-5 move, never by an edit.
                    return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityUseMove);
                }

                foreach (var old in mine)
                {
                    old.Release(now);
                }

                await store.AddPhoneAsync(ShramPersonPhone.Add(ids.New(), group.Root.Id, e164, whose, farmId, now), ct);
                await store.AddEventAsync(ShramIdentityEvent.Record(
                    ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.PhoneAdded, IdentityProof.None, userId, now), ct);
            }
        }

        await store.TrySaveChangesAsync(ct);
        var view = await WorkerIdentityReads.ViewAsync(store, farmId, record, ct);
        var sameNames = e164 is null ? [] : await SameFarmNamesAsync(farmId, e164, record.Id, ct);
        return Result.Success(view with { SameNumberNames = sameNames });
    }

    /// <summary>R4 / case 4 — the gentle question before a shared number is saved. Never a block.</summary>
    public async Task<Result<PhoneCheckView>> CheckPhoneAsync(Guid farmId, Guid userId, string? phone, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return Result.Failure<PhoneCheckView>(ShramSafalErrors.Forbidden);
        }

        var e164 = IndianMobile.Normalize(phone);
        if (e164 is null)
        {
            return Result.Failure<PhoneCheckView>(ShramSafalErrors.InvalidCommand);
        }

        var holders = await store.GetActivePhonesByNumberAsync(e164, ct);
        var names = await SameFarmNamesAsync(farmId, e164, null, ct);
        return Result.Success(new PhoneCheckView(names, holders.Any(h => h.IsActiveVerified)));
    }

    /// <summary>Sends a one-time code: to this farm's number for him (verify), to a new number (case 5), or to his verified one.</summary>
    public async Task<Result<CodeSentView>> SendRecordCodeAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, string? purpose, string? phone, CancellationToken ct)
    {
        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<CodeSentView>(refused!);
        }

        if (!TryParsePurpose(purpose, out var why) || why == ChallengePurpose.Link)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.InvalidCommand);
        }

        if (why is ChallengePurpose.MoveNew or ChallengePurpose.MoveOld && !UnscreenedOpen)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityFlowOff);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        if (group.Root.IsErased)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityErased);
        }

        var phones = await store.GetPhonesAsync(group.Ids, ct);

        // N1 (fix pass 2) — his FIRST verified number is proved only through the farm that issued his card. Any other
        // farm (one that linked him by card) cannot make itself the farm that holds his proof by verifying a number it
        // entered — its own SIM, say. It is answered as for a person it does not know, and nothing is written.
        if (why == ChallengePurpose.Verify && !phones.Any(p => p.IsActiveVerified) && !await HoldsHisProofAsync(farmId, group, ct))
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityNotFound);
        }

        string? target;
        switch (why)
        {
            case ChallengePurpose.Verify:
                target = phones.Where(p => p.AddedByFarmId == farmId && p.IsActive).OrderByDescending(p => p.AddedAtUtc).FirstOrDefault()?.PhoneE164;
                break;
            case ChallengePurpose.MoveNew:
                target = IndianMobile.Normalize(phone);
                if (target is null)
                {
                    return Result.Failure<CodeSentView>(ShramSafalErrors.InvalidCommand);
                }

                break;
            default:
                target = OldestVerified(phones)?.PhoneE164;
                break;
        }

        if (target is null)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityNoPhone);
        }

        if (why is ChallengePurpose.Verify or ChallengePurpose.MoveNew && await HeldByAnotherAsync(target, group, ct))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityNumberHeldByVerified);
        }

        // H2 — one verified number at a time: a second one only by the case-5 move, never by a verify.
        if (why == ChallengePurpose.Verify && phones.Any(p => p.IsActiveVerified && p.PhoneE164 != target))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityUseMove);
        }

        return await SendCodeAsync(group, target, why, farmId, userId, ct);
    }

    /// <summary>Screen 3 — the code he read back proves this farm's number for him. It is now his alone (R3).</summary>
    public async Task<Result<WorkerIdentityView>> VerifyAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, Guid ticket, string? code, CancellationToken ct)
    {
        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);

        // N1 (fix pass 2) — as for the code: while he has no verified number, only the farm that issued his card proves
        // one. Checked before the code is read, so a refused farm spends no try and writes nothing.
        if (!(await store.GetPhonesAsync(group.Ids, ct)).Any(p => p.IsActiveVerified) && !await HoldsHisProofAsync(farmId, group, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNotFound);
        }

        var consumed = await ConsumeAsync(farmId, ticket, code, ChallengePurpose.Verify, group, ct);
        if (consumed.Error is { } wrong)
        {
            return Result.Failure<WorkerIdentityView>(wrong);
        }

        var challenge = consumed.Challenge!;
        var phones = await store.GetPhonesAsync(group.Ids, ct);
        var row = phones.FirstOrDefault(p => p.IsActive && p.PhoneE164 == challenge.PhoneE164);
        if (row is null)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNoPhone);
        }

        if (await HeldByAnotherAsync(row.PhoneE164!, group, ct))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNumberHeldByVerified);
        }

        // H2 (R3) — he already has a verified number: a different one becomes his only by the case-5 move.
        if (phones.Any(p => p.IsActiveVerified && p.PhoneE164 != row.PhoneE164))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityUseMove);
        }

        var now = clock.UtcNow;
        row.MarkVerified(now);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.PhoneVerified, IdentityProof.PhoneCode, userId, now), ct);
        switch (await store.SaveChangesOrClashAsync(ct))
        {
            case IdentitySaveClash.None:
                break;
            case IdentitySaveClash.PersonAlreadyVerified:
                // N3 — another verify for him won at the same moment: one verified number at a time; a second only by the move.
                return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityUseMove);
            default:
                return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNumberHeldByVerified);
        }

        return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
    }

    /// <summary>
    /// Case 5 — he changed his SIM. A code on the NEW number, plus one of: the old number's code, his card shown, or an
    /// owner where he is known confirming him. The old number is released, its history kept; the card never changes.
    /// </summary>
    public async Task<Result<WorkerIdentityView>> MoveNumberAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, string? newPhone, string? newWhose, Guid newTicket, string? newCode,
        string? proof, Guid? oldTicket, string? oldCode, string? cardCode, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var e164 = IndianMobile.Normalize(newPhone);
        if (e164 is null || !CreateFieldOperatorHandler.TryParseWhose(newWhose, out var whose)
            || !Enum.TryParse<IdentityProof>(proof, ignoreCase: true, out var second) || second == IdentityProof.None)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.InvalidCommand);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        if (group.Root.IsErased)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityErased);
        }

        // H1 — his card or an owner's word confirms him only on the farm that holds his proof; any other farm is
        // answered exactly as for a person it does not know (R6, E4). His own old-number code works from any farm.
        if (second is IdentityProof.CardShown or IdentityProof.OwnerConfirms && !await HoldsHisProofAsync(farmId, group, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNotFound);
        }

        if (second == IdentityProof.OwnerConfirms && !await IsOwnerTierAsync(farmId, userId, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityOwnerOnly);
        }

        var newProof = await ConsumeAsync(farmId, newTicket, newCode, ChallengePurpose.MoveNew, group, ct);
        if (newProof.Error is { } badNew)
        {
            return Result.Failure<WorkerIdentityView>(badNew);
        }

        if (newProof.Challenge!.PhoneE164 != e164)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityCodeWrong);
        }

        var secondOk = second switch
        {
            IdentityProof.PhoneCode => (await ConsumeAsync(farmId, oldTicket ?? Guid.Empty, oldCode, ChallengePurpose.MoveOld, group, ct)).Error is null,
            IdentityProof.CardShown => await CardBelongsAsync(cardCode, group, ct),
            IdentityProof.OwnerConfirms => true,
            _ => false,
        };
        if (!secondOk)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityProofNeeded);
        }

        if (await HeldByAnotherAsync(e164, group, ct))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNumberHeldByVerified);
        }

        var now = clock.UtcNow;
        var phones = await store.GetPhonesAsync(group.Ids, ct);
        foreach (var old in phones.Where(p => p.IsActiveVerified && p.PhoneE164 != e164))
        {
            old.Release(now);
        }

        var target = phones.FirstOrDefault(p => p.IsActive && p.PhoneE164 == e164);
        if (target is null)
        {
            target = ShramPersonPhone.Add(ids.New(), group.Root.Id, e164, whose, farmId, now);
            await store.AddPhoneAsync(target, ct);
        }

        target.MarkVerified(now);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.NumberMoved, second, userId, now), ct);
        if (!await store.TrySaveChangesAsync(ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNumberHeldByVerified);
        }

        return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
    }

    // ── card reissue (case 13) ──────────────────────────────────────────────────────────────────────

    public async Task<Result<CardReissuedView>> ReissueCardAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, string? proof, Guid? ticket, string? code, CancellationToken ct)
    {
        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<CardReissuedView>(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        if (group.Root.IsErased)
        {
            return Result.Failure<CardReissuedView>(ShramSafalErrors.IdentityErased);
        }

        if (!Enum.TryParse<IdentityProof>(proof, ignoreCase: true, out var how))
        {
            return Result.Failure<CardReissuedView>(ShramSafalErrors.InvalidCommand);
        }

        if (how == IdentityProof.OwnerConfirms)
        {
            // H1 — an owner's word reissues his card only on the farm that holds his proof (his verified number was
            // entered there, or, with none, it issued his card). Any other farm: as for a person it does not know.
            if (!await HoldsHisProofAsync(farmId, group, ct))
            {
                return Result.Failure<CardReissuedView>(ShramSafalErrors.IdentityNotFound);
            }

            if (!await IsOwnerTierAsync(farmId, userId, ct))
            {
                return Result.Failure<CardReissuedView>(ShramSafalErrors.IdentityOwnerOnly);
            }
        }

        var proven = how switch
        {
            IdentityProof.PhoneCode => (await ConsumeAsync(farmId, ticket ?? Guid.Empty, code, ChallengePurpose.Reissue, group, ct)).Error is null,
            IdentityProof.OwnerConfirms => true,
            _ => false,
        };
        if (!proven)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<CardReissuedView>(ShramSafalErrors.IdentityProofNeeded);
        }

        var now = clock.UtcNow;
        var cards = await store.GetCardsAsync(group.Ids, ct);
        var fresh = ShramCard.Issue(await WorkerIdentityReads.FreshCodeAsync(store, ct), group.Root.Id, farmId, now);
        await store.AddCardAsync(fresh, ct);
        string? retired = null;
        foreach (var old in cards.Where(c => c.IsActive))
        {
            old.Retire(now, fresh.Code);
            retired ??= ShramCardCode.Display(old.Code);
        }

        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.CardReissued, how, userId, now), ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(new CardReissuedView(ShramCardCode.Display(fresh.Code), retired));
    }

    // ── merge (case 9) and its undo ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// "Same person": this farm's record (his card <paramref name="sourceCardCode"/>) is the person behind
    /// <paramref name="targetCardCode"/>. Proof from both sides: both cards shown, and the code on the target's verified
    /// phone when he has one. Both ids are kept; his old card now resolves to the person he is.
    /// </summary>
    public async Task<Result<WorkerIdentityView>> MergeAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, string? sourceCardCode, string? targetCardCode, Guid? ticket,
        string? code, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var source = await EnsureGroupAsync(farmId, userId, record, ct);
        // H2 — a person who holds a verified number is never merged away: his number would follow him into another
        // person without the case-5 move, and the farm that merged would then hold the gate to that person.
        if ((await store.GetPhonesAsync(source.Ids, ct)).Any(p => p.IsActiveVerified))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityUseMove);
        }

        if (!await CardBelongsAsync(sourceCardCode, source, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityProofNeeded);
        }

        var proven = await ProveWorkerAsync(farmId, targetCardCode, ticket, code, ChallengePurpose.Link, ct, requireCard: true);
        if (proven.Error is { } error)
        {
            return Result.Failure<WorkerIdentityView>(error);
        }

        var target = proven.Group!;
        if (target.Root.Id == source.Root.Id)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
        }

        // One level only: a person others were merged into is not merged away.
        if (source.Members.Count > 1 || source.Root.IsErased)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;
        source.Root.MergeInto(target.Root.Id);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, target.Root.Id, IdentityEventKind.Merged, proven.Proof, userId, now,
            otherPersonId: source.Root.Id), ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
    }

    public async Task<Result<WorkerIdentityView>> UnmergeAsync(Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var history = await store.GetEventsForRecordAsync(farmId, record.Id, ct);
        var merge = LastUnreversed(history, IdentityEventKind.Merged, IdentityEventKind.Unmerged);
        var merged = merge?.OtherPersonId is { } sourceId ? await store.GetPersonAsync(sourceId, ct) : null;
        if (merge is null || merged?.MergedIntoPersonId != merge.PersonId)
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.IdentityNothingToUndo);
        }

        if (merge.ActorUserId != userId && !await IsOwnerTierAsync(farmId, userId, ct))
        {
            return Result.Failure<WorkerIdentityView>(ShramSafalErrors.Forbidden);
        }

        var now = clock.UtcNow;
        merged.Unmerge();
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, merged.Id, IdentityEventKind.Unmerged, IdentityProof.OwnerConfirms, userId, now,
            otherPersonId: merge.PersonId, reversesEventId: merge.Id), ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(await WorkerIdentityReads.ViewAsync(store, farmId, record, ct));
    }

    // ── erasure (R8, D-71) ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// He wants out (case 16): erasure of the PERSON is asked, and waits (D-71, 30 days by default) for the erasure
    /// worker, cancellable until then. Owner-tier only. The work is never erased (P6).
    /// </summary>
    public async Task<Result<PersonErasureView>> RequestErasureAsync(Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure<PersonErasureView>(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await OwnerRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<PersonErasureView>(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        // H1 — erasing a person reaches every farm's record of him: only the farm that holds his proof may ask it on
        // the owner's word. Any other farm: as for a person it does not know (R6, E4).
        if (!await HoldsHisProofAsync(farmId, group, ct))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<PersonErasureView>(ShramSafalErrors.IdentityNotFound);
        }

        var now = clock.UtcNow;
        if (!group.Root.RequestErasure(userId, now))
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure<PersonErasureView>(ShramSafalErrors.IdentityErased);
        }

        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.ErasureRequested, IdentityProof.OwnerConfirms, userId, now), ct);
        await store.TrySaveChangesAsync(ct);
        var wait = erasureTiming ?? new ErasureTiming();
        return Result.Success(new PersonErasureView(group.Root.ErasureRequestedAtUtc!.Value + wait.WaitBeforeErasure));
    }

    public async Task<Result> CancelErasureAsync(Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!UnscreenedOpen)
        {
            return Result.Failure(ShramSafalErrors.IdentityFlowOff);
        }

        var (record, refused) = await OwnerRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        // H1 — only the person who asked may withdraw it; anyone else is answered as for a person he does not know.
        if (group.Root.ErasureRequestedAtUtc is not null && group.Root.ErasureRequestedByUserId != userId)
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure(ShramSafalErrors.IdentityNotFound);
        }

        if (!group.Root.CancelErasure())
        {
            await store.TrySaveChangesAsync(ct);
            return Result.Failure(ShramSafalErrors.IdentityNothingToUndo);
        }

        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.ErasureCancelled, IdentityProof.OwnerConfirms, userId, clock.UtcNow), ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success();
    }

    // ── the farm's own PIN (for the one-tap chip) ───────────────────────────────────────────────────

    public async Task<Result<FarmPinView>> FarmPinAsync(Guid farmId, Guid userId, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return Result.Failure<FarmPinView>(ShramSafalErrors.Forbidden);
        }

        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        return Result.Success(new FarmPinView(farm?.PinCode));
    }

    // ── shared steps ───────────────────────────────────────────────────────────────────────────────

    private sealed record CardFound(PersonGroup? Group, IdentityLevel Level, Error? Error);

    private sealed record Proven(PersonGroup? Group, IdentityProof Proof, Error? Error);

    private sealed record Consumed(ShramPhoneChallenge? Challenge, Error? Error);

    private Task<bool> MayManageAsync(Guid farmId, Guid userId, CancellationToken ct)
        => LabourManagementGate.IsAllowedAsync(repository, farmId, userId, clock.UtcNow, ct);

    private async Task<bool> IsOwnerTierAsync(Guid farmId, Guid userId, CancellationToken ct)
        => await repository.GetUserRoleForFarmAsync(farmId, userId, ct) is AppRole.PrimaryOwner or AppRole.SecondaryOwner;

    /// <summary>This farm's record, or nothing: another farm's record is NOT FOUND here, exactly like a made-up id (E4).</summary>
    private async Task<FieldOperator?> RecordOnFarmAsync(Guid farmId, Guid fieldOperatorId, CancellationToken ct)
    {
        var record = await repository.GetFieldOperatorByIdAsync(fieldOperatorId, ct);
        return record is not null && record.OriginatingFarmId.Value == farmId ? record : null;
    }

    private async Task<(FieldOperator? Record, Error? Refused)> ManagedRecordAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!await MayManageAsync(farmId, userId, ct))
        {
            return (null, ShramSafalErrors.Forbidden);
        }

        var record = await RecordOnFarmAsync(farmId, fieldOperatorId, ct);
        return record is null ? (null, ShramSafalErrors.FieldOperatorNotFound) : (record, null);
    }

    private async Task<(FieldOperator? Record, Error? Refused)> OwnerRecordAsync(
        Guid farmId, Guid userId, Guid fieldOperatorId, CancellationToken ct)
    {
        if (!await IsOwnerTierAsync(farmId, userId, ct))
        {
            return (null, ShramSafalErrors.Forbidden);
        }

        var record = await RecordOnFarmAsync(farmId, fieldOperatorId, ct);
        return record is null ? (null, ShramSafalErrors.FieldOperatorNotFound) : (record, null);
    }

    /// <summary>The record's person group; a row an older server made without one gets its person and card now.</summary>
    private async Task<PersonGroup> EnsureGroupAsync(Guid farmId, Guid userId, FieldOperator record, CancellationToken ct)
    {
        if (await WorkerIdentityReads.GroupOfAsync(store, record.PersonId, ct) is { } group)
        {
            return group;
        }

        var now = clock.UtcNow;
        var (person, _) = await WorkerIdentityReads.IssueNewPersonAsync(store, ids.New(), record.DisplayName, farmId, userId, now, ct);
        record.AttachPerson(person.Id);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, person.Id, IdentityEventKind.CardIssued, IdentityProof.None, userId, now), ct);

        // Fix pass 3 — written at once, so every rule that reads the database sees him (N1 reads which farm issued his
        // card: without this, a worker who had no ShramSafal person yet was refused his first verify on his own farm).
        await store.TrySaveChangesAsync(ct);
        return new PersonGroup(person, [person]);
    }

    private async Task<CardFound> FindCardAsync(string? code, CancellationToken ct)
    {
        var body = ShramCardCode.Normalize(code);
        var card = body is null ? null : await store.GetCardAsync(body, ct);
        if (card is null)
        {
            return new CardFound(null, IdentityLevel.Name, ShramSafalErrors.IdentityNotFound);
        }

        if (!card.IsActive)
        {
            return new CardFound(null, IdentityLevel.Name, ShramSafalErrors.IdentityCardRetired);
        }

        var group = await WorkerIdentityReads.GroupOfAsync(store, card.PersonId, ct);
        if (group is null || group.Root.IsErased)
        {
            return new CardFound(null, IdentityLevel.Name, ShramSafalErrors.IdentityCardRetired);
        }

        var level = LevelOf(group, await store.GetCardsAsync(group.Ids, ct), await store.GetPhonesAsync(group.Ids, ct));
        return new CardFound(group, level, null);
    }

    private async Task<ShramPersonPhone?> VerifiedPhoneOfAsync(PersonGroup group, CancellationToken ct)
        => OldestVerified(await store.GetPhonesAsync(group.Ids, ct));

    /// <summary>
    /// H2 — his consent codes always go to his verified number. Since fix pass 2 (N3) the database keeps at most one per
    /// person, so the order only matters for a merged person's alias rows; it is kept fixed (first verified, then id).
    /// </summary>
    private static ShramPersonPhone? OldestVerified(IEnumerable<ShramPersonPhone> phones)
        => phones.Where(p => p.IsActiveVerified).OrderBy(p => p.VerifiedAtUtc).ThenBy(p => p.Id).FirstOrDefault();

    /// <summary>
    /// H1 — "an owner where he is verified" (design cases 5 and 13): the farm whose OWN entered number is his active
    /// verified number; while he has no verified number anywhere, the farm that issued his working card. Nobody else.
    /// </summary>
    private async Task<bool> HoldsHisProofAsync(Guid farmId, PersonGroup group, CancellationToken ct)
        => (await ProofFarmsAsync(group, ct)).Contains(farmId);

    private async Task<HashSet<Guid>> ProofFarmsAsync(PersonGroup group, CancellationToken ct)
    {
        var members = group.Ids;
        var verified = (await store.GetPhonesAsync(members, ct)).Where(p => p.IsActiveVerified).ToList();
        if (verified.Count > 0)
        {
            return verified.Where(p => p.AddedByFarmId is not null).Select(p => p.AddedByFarmId!.Value).ToHashSet();
        }

        return ActiveCardOf(group, await store.GetCardsAsync(members, ct))?.IssuedByFarmId is { } issuer ? [issuer] : [];
    }

    /// <summary>
    /// N2 (fix pass 2) — the farms whose codes count against his number's own budget: the farm holding his proof, and
    /// every farm he linked with his own code. Any other farm's codes to him are counted on their own (see
    /// <see cref="OtherFarmCodesPerNumberPerDay"/>).
    /// </summary>
    private async Task<HashSet<Guid>> TrustedFarmsAsync(PersonGroup group, CancellationToken ct)
    {
        var trusted = await ProofFarmsAsync(group, ct);
        trusted.UnionWith(await store.GetFarmsLinkedByCodeAsync(group.Ids, ct));
        return trusted;
    }

    /// <summary>N2 (fix pass 2) — a farm over its wrong tries, or a person over his, reads and gets no more codes today.</summary>
    private async Task<bool> TooManyWrongTriesAsync(Guid farmId, PersonGroup group, CancellationToken ct)
    {
        var since = clock.UtcNow - LongWindow;
        if (await store.CountWrongTriesByFarmSinceAsync(farmId, since, ct) >= FarmWrongTriesPerDay)
        {
            return true;
        }

        var byFarm = await store.CountWrongTriesForPersonsByFarmSinceAsync(group.Ids, since, ct);
        if (byFarm.Values.Sum() >= PersonWrongTriesPerDay)
        {
            return true;
        }

        // R2 (fix pass 3) — farms without his trust share at most 5 of his 10; his own farms keep the rest.
        var trusted = await TrustedFarmsAsync(group, ct);
        return !trusted.Contains(farmId)
            && byFarm.Where(f => !trusted.Contains(f.Key)).Sum(f => f.Value) >= StrangerWrongTriesPerDay;
    }

    /// <summary>
    /// R1 — the worker's own proof: his card (enough only while he has no verified phone), or the code sent to his
    /// verified phone. A name or a number is never proof.
    /// </summary>
    private async Task<Proven> ProveWorkerAsync(
        Guid farmId, string? cardCode, Guid? ticket, string? code, ChallengePurpose purpose, CancellationToken ct, bool requireCard = false)
    {
        if (!string.IsNullOrWhiteSpace(cardCode))
        {
            var found = await FindCardAsync(cardCode, ct);
            if (found.Error is { } error)
            {
                return new Proven(null, IdentityProof.None, error);
            }

            var group = found.Group!;
            if (await VerifiedPhoneOfAsync(group, ct) is null)
            {
                return new Proven(group, IdentityProof.CardShown, null);
            }

            if (ticket is not { } withCode)
            {
                return new Proven(null, IdentityProof.None, ShramSafalErrors.IdentityProofNeeded);
            }

            var consumed = await ConsumeAsync(farmId, withCode, code, purpose, group, ct);
            return consumed.Error is { } wrong
                ? new Proven(null, IdentityProof.None, wrong)
                : new Proven(group, IdentityProof.PhoneCode, null);
        }

        if (requireCard || ticket is not { } onlyCode)
        {
            return new Proven(null, IdentityProof.None, ShramSafalErrors.IdentityProofNeeded);
        }

        var challenge = await store.GetChallengeAsync(onlyCode, ct);
        if (challenge is null || challenge.RequestedByFarmId != farmId)
        {
            return new Proven(null, IdentityProof.None, ShramSafalErrors.IdentityCodeExpired);
        }

        var holder = await WorkerIdentityReads.GroupOfAsync(store, challenge.PersonId, ct);
        if (holder is null || holder.Root.IsErased)
        {
            return new Proven(null, IdentityProof.None, ShramSafalErrors.IdentityNotFound);
        }

        var byNumber = await ConsumeAsync(farmId, onlyCode, code, purpose, holder, ct);
        return byNumber.Error is { } bad
            ? new Proven(null, IdentityProof.None, bad)
            : new Proven(holder, IdentityProof.PhoneCode, null);
    }

    /// <summary>Checks a code read back; a wrong try is counted (and saved) before the refusal goes back.</summary>
    private async Task<Consumed> ConsumeAsync(
        Guid farmId, Guid ticket, string? code, ChallengePurpose purpose, PersonGroup group, CancellationToken ct)
    {
        // R1 (fix pass 3) — his code checks and sends run one at a time: wait for any other one for him, then count.
        await store.LockPersonAsync(group.Root.Id, ct);

        // M2 / N2 — a farm that has spent its wrong tries for the day, or a person whose codes have taken his day's wrong
        // tries from every farm together, gets no code read until the day has passed.
        if (await TooManyWrongTriesAsync(farmId, group, ct))
        {
            return new Consumed(null, ShramSafalErrors.IdentityTooManyTries);
        }

        // A code proves only for the person it went to, and only on the farm whose owner asked for it.
        var challenge = ticket == Guid.Empty ? null : await store.GetChallengeAsync(ticket, ct);
        if (challenge is null || !group.Ids.Contains(challenge.PersonId) || challenge.RequestedByFarmId != farmId)
        {
            return new Consumed(null, ShramSafalErrors.IdentityCodeExpired);
        }

        var now = clock.UtcNow;
        if (challenge.RefuseBeforeCounting(purpose, now) is { } refused)
        {
            await store.TrySaveChangesAsync(ct);
            return new Consumed(null, RefusalFor(refused));
        }

        // R1 — the try is counted in ONE statement (never above five, never on a spent code); only then is it compared.
        var counted = await store.CountTryAsync(challenge, ct);
        if (!counted.Counted)
        {
            await store.TrySaveChangesAsync(ct);
            return new Consumed(null, counted.Spent ? ShramSafalErrors.IdentityCodeExpired : ShramSafalErrors.IdentityCodeUsedUp);
        }

        if (challenge.CompareCounted(code, now) == ChallengeOutcome.Ok)
        {
            return new Consumed(challenge, null);
        }

        // The wrong try is already counted in the database; anything else this request staged is saved as before.
        await store.TrySaveChangesAsync(ct);
        return new Consumed(null, ShramSafalErrors.IdentityCodeWrong);
    }

    /// <summary>
    /// A code refused before its try was counted. Its own five tries used up is "this code is used up — ask a new one"
    /// (fix pass 3 add-on, P5): a fresh code works today. "Too many tries" is only the DAILY cap (person or farm).
    /// </summary>
    private static Error RefusalFor(ChallengeOutcome refused) => refused switch
    {
        ChallengeOutcome.WrongPurpose => ShramSafalErrors.IdentityCodeWrong,
        ChallengeOutcome.TooManyTries => ShramSafalErrors.IdentityCodeUsedUp,
        _ => ShramSafalErrors.IdentityCodeExpired,
    };

    /// <summary>Issues and sends a code; the challenge is kept only once the SMS was accepted.</summary>
    private async Task<Result<CodeSentView>> SendCodeAsync(
        PersonGroup group, string e164, ChallengePurpose purpose, Guid farmId, Guid userId, CancellationToken ct)
    {
        // R1 (fix pass 3) — sends for one person run one at a time, so each one counts the codes already sent (a parallel
        // request waits here, then sees the code this one sent). Before any count.
        await store.LockPersonAsync(group.Root.Id, ct);

        var now = clock.UtcNow;
        if (await NumberBudgetSpentAsync(group, e164, farmId, now, ct)
            || await store.CountChallengesByFarmSinceAsync(farmId, now - LongWindow, ct) >= FarmCodesPerDay
            || await store.CountChallengesByUserSinceAsync(userId, now - LongWindow, ct) >= UserCodesPerDay)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityTooManyCodes);
        }

        if (await TooManyWrongTriesAsync(farmId, group, ct))
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityTooManyTries);
        }

        var code = ShramPhoneChallenge.NewCode();
        var challenge = ShramPhoneChallenge.Issue(ids.New(), group.Root.Id, e164, purpose, farmId, userId, code, now);
        var sent = await sender.SendAsync(e164, code, ct);
        if (!sent.IsSuccess)
        {
            return Result.Failure<CodeSentView>(sent.Error);
        }

        await store.AddChallengeAsync(challenge, ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(new CodeSentView(challenge.Id, IndianMobile.Tail(e164)));
    }

    /// <summary>
    /// N2 (fix pass 2) — this number's day of codes. A farm he trusts counts against his own 3-in-15-minutes and
    /// 6-a-day, which only those farms' codes use up; any other farm counts against its own 2 a day and all such farms'
    /// 6 a day (and the same 3 in 15 minutes among them).
    /// </summary>
    private async Task<bool> NumberBudgetSpentAsync(PersonGroup group, string e164, Guid farmId, DateTime now, CancellationToken ct)
    {
        var trusted = await TrustedFarmsAsync(group, ct);
        var sent = await store.GetChallengesToNumberSinceAsync(e164, now - LongWindow, ct);
        var pool = sent.Where(c => trusted.Contains(c.RequestedByFarmId) == trusted.Contains(farmId)).ToList();
        if (pool.Count(c => c.CreatedAtUtc >= now - ShortWindow) >= ShortWindowCodes)
        {
            return true;
        }

        return trusted.Contains(farmId)
            ? pool.Count >= LongWindowCodes
            : pool.Count >= OtherFarmsCodesPerNumberPerDay || pool.Count(c => c.RequestedByFarmId == farmId) >= OtherFarmCodesPerNumberPerDay;
    }

    private async Task<bool> HeldByAnotherAsync(string e164, PersonGroup group, CancellationToken ct)
        => (await store.GetActivePhonesByNumberAsync(e164, ct)).Any(p => p.IsActiveVerified && !group.Ids.Contains(p.PersonId));

    private async Task<bool> CardBelongsAsync(string? cardCode, PersonGroup group, CancellationToken ct)
    {
        var body = ShramCardCode.Normalize(cardCode);
        var card = body is null ? null : await store.GetCardAsync(body, ct);
        return card is not null && card.IsActive && group.Ids.Contains(card.PersonId);
    }

    /// <summary>THIS farm's active workers whose identity has this number (never another farm's).</summary>
    private async Task<IReadOnlyList<string>> SameFarmNamesAsync(Guid farmId, string e164, Guid? except, CancellationToken ct)
    {
        var team = (await repository.GetFieldOperatorsForFarmAsync(new FarmId(farmId), ct))
            .Where(t => t.IsActive && t.Id != except && t.PersonId is not null)
            .ToList();
        if (team.Count == 0)
        {
            return [];
        }

        var groups = await WorkerIdentityReads.GroupsOfAsync(store, team.Select(t => t.PersonId!.Value).Distinct().ToList(), ct);
        var holders = (await store.GetActivePhonesByNumberAsync(e164, ct)).Select(p => p.PersonId).ToHashSet();
        return team
            .Where(t => groups.TryGetValue(t.PersonId!.Value, out var g) && g.Ids.Any(holders.Contains))
            .Select(t => t.DisplayName)
            .ToList();
    }

    private static ShramIdentityEvent? LastUnreversed(
        IReadOnlyList<ShramIdentityEvent> history, IdentityEventKind kind, IdentityEventKind undoKind)
    {
        var reversed = history.Where(e => e.Kind == undoKind && e.ReversesEventId is not null).Select(e => e.ReversesEventId!.Value).ToHashSet();
        return history
            .Where(e => e.Kind == kind && !reversed.Contains(e.Id))
            .OrderByDescending(e => e.OccurredAtUtc)
            .FirstOrDefault();
    }

    private static bool TryParsePurpose(string? text, out ChallengePurpose purpose)
    {
        purpose = ChallengePurpose.Verify;
        return string.IsNullOrWhiteSpace(text)
            || (Enum.TryParse(text.Trim(), ignoreCase: true, out purpose) && Enum.IsDefined(purpose));
    }
}
