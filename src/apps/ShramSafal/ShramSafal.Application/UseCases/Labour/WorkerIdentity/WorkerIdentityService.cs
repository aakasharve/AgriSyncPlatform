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
    ErasureTiming? erasureTiming = null)
{
    /// <summary>Per number: at most 3 codes in 15 minutes and 6 in a day (the login OTP's limits).</summary>
    private const int ShortWindowCodes = 3;
    private const int LongWindowCodes = 6;
    private static readonly TimeSpan ShortWindow = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan LongWindow = TimeSpan.FromHours(24);

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

            var sent = await SendCodeAsync(group.Root.Id, verified.PhoneE164!, ChallengePurpose.Link, farmId, userId, ct);
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

        var code = await SendCodeAsync(holderGroup.Root.Id, e164, ChallengePurpose.Link, farmId, userId, ct);
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

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
        if (group.Root.IsErased)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityErased);
        }

        var phones = await store.GetPhonesAsync(group.Ids, ct);
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
                target = phones.FirstOrDefault(p => p.IsActiveVerified)?.PhoneE164;
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

        return await SendCodeAsync(group.Root.Id, target, why, farmId, userId, ct);
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

        var now = clock.UtcNow;
        row.MarkVerified(now);
        await store.AddEventAsync(ShramIdentityEvent.Record(
            ids.New(), farmId, record.Id, group.Root.Id, IdentityEventKind.PhoneVerified, IdentityProof.PhoneCode, userId, now), ct);
        if (!await store.TrySaveChangesAsync(ct))
        {
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
            IdentityProof.OwnerConfirms => await IsOwnerTierAsync(farmId, userId, ct),
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

        var proven = how switch
        {
            IdentityProof.PhoneCode => (await ConsumeAsync(farmId, ticket ?? Guid.Empty, code, ChallengePurpose.Reissue, group, ct)).Error is null,
            IdentityProof.OwnerConfirms => await IsOwnerTierAsync(farmId, userId, ct),
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
        var (record, refused) = await ManagedRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<WorkerIdentityView>(refused!);
        }

        var source = await EnsureGroupAsync(farmId, userId, record, ct);
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
        var (record, refused) = await OwnerRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure<PersonErasureView>(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
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
        var (record, refused) = await OwnerRecordAsync(farmId, userId, fieldOperatorId, ct);
        if (record is null)
        {
            return Result.Failure(refused!);
        }

        var group = await EnsureGroupAsync(farmId, userId, record, ct);
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
        => (await store.GetPhonesAsync(group.Ids, ct)).FirstOrDefault(p => p.IsActiveVerified);

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
        // A code proves only for the person it went to, and only on the farm whose owner asked for it.
        var challenge = ticket == Guid.Empty ? null : await store.GetChallengeAsync(ticket, ct);
        if (challenge is null || !group.Ids.Contains(challenge.PersonId) || challenge.RequestedByFarmId != farmId)
        {
            return new Consumed(null, ShramSafalErrors.IdentityCodeExpired);
        }

        var outcome = challenge.TryConsume(code, purpose, clock.UtcNow);
        if (outcome == ChallengeOutcome.Ok)
        {
            return new Consumed(challenge, null);
        }

        await store.TrySaveChangesAsync(ct);
        return new Consumed(null, outcome is ChallengeOutcome.Wrong or ChallengeOutcome.WrongPurpose
            ? ShramSafalErrors.IdentityCodeWrong
            : ShramSafalErrors.IdentityCodeExpired);
    }

    /// <summary>Issues and sends a code; the challenge is kept only once the SMS was accepted.</summary>
    private async Task<Result<CodeSentView>> SendCodeAsync(
        Guid personId, string e164, ChallengePurpose purpose, Guid farmId, Guid userId, CancellationToken ct)
    {
        var now = clock.UtcNow;
        if (await store.CountChallengesSinceAsync(e164, now - ShortWindow, ct) >= ShortWindowCodes
            || await store.CountChallengesSinceAsync(e164, now - LongWindow, ct) >= LongWindowCodes)
        {
            return Result.Failure<CodeSentView>(ShramSafalErrors.IdentityTooManyCodes);
        }

        var code = ShramPhoneChallenge.NewCode();
        var challenge = ShramPhoneChallenge.Issue(ids.New(), personId, e164, purpose, farmId, userId, code, now);
        var sent = await sender.SendAsync(e164, code, ct);
        if (!sent.IsSuccess)
        {
            return Result.Failure<CodeSentView>(sent.Error);
        }

        await store.AddChallengeAsync(challenge, ct);
        await store.TrySaveChangesAsync(ct);
        return Result.Success(new CodeSentView(challenge.Id, IndianMobile.Tail(e164)));
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
