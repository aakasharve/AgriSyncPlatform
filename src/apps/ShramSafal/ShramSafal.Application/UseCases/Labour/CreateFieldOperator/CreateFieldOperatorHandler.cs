using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.CreateFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// mints a new <see cref="FieldOperator"/> work identity on the farm
/// established by <c>ICallerFarmTenantScope</c> for this request.
/// </summary>
/// <remarks>
/// lane WID (founder D-54, call 3) — <b>a card on add.</b> Every worker added here gets a ShramSafal person and a fresh
/// random card in the same unit of work, with his phone (tagged) and home PIN when sent; or, when the link use case has
/// already checked the worker's own proof, the new farm record IS that existing person (R1). This stays the ONE place a
/// farm record is made (<c>FieldOperatorSingleProducerRules</c>). The identity store is optional only so the in-tree
/// unit doubles keep compiling; production always supplies it.
/// </remarks>
public sealed class CreateFieldOperatorHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IShramIdentityStore? identity = null)
    : IHandler<CreateFieldOperatorCommand, FieldOperatorDto>
{
    public async Task<Result<FieldOperatorDto>> HandleAsync(
        CreateFieldOperatorCommand command, CancellationToken ct = default)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty
            || string.IsNullOrWhiteSpace(command.DisplayName))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        // lane WID — what is SENT must be right (the new phone never sends a half-typed number or PIN); what is ABSENT
        // is never a refusal: an older phone and the हजेरी quick add send neither (P11, P9).
        var phone = command.Phone is null ? null : IndianMobile.Normalize(command.Phone);
        var pin = command.HomePin is null ? null : HomePinCode.Normalize(command.HomePin);
        if ((command.Phone is not null && phone is null)
            || (command.HomePin is not null && pin is null)
            || !TryParseWhose(command.PhoneWhose, out var whose)
            || (command.FarmPinToo && pin is null))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        // LABOUR_PHASE2 Phase 5 — the SHARED labour predicate, not a membership
        // check. This used to be `callerRole is null`, i.e. ANY member could
        // mint a work identity, a Worker included. Founder decision O-4 makes
        // the five governed labour actions obey one rule: owner-tier always,
        // Mukadam by default, any other role only when explicitly granted. The
        // gate still fails closed for a non-member, so the defense-in-depth
        // property this line originally had (the HTTP entry point gates via
        // ICallerFarmTenantScope, but a handler invoked from any other surface
        // must stand on its own) is preserved, not replaced.
        if (!await LabourManagementGate.IsAllowedAsync(
                repository, command.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        // Idempotent create. A client that supplies an id and retries (lost response,
        // double tap) must get the SAME person back, not a twin. The lookup is NOT
        // farm-scoped by itself (PERMISSIVE select policy), so an id that already
        // names a person on a DIFFERENT farm is refused, never returned or re-used.
        if (command.ClientOperatorId is { } requestedId)
        {
            if (requestedId == Guid.Empty)
            {
                return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
            }

            var existing = await repository.GetFieldOperatorByIdAsync(requestedId, ct);
            if (existing is not null)
            {
                return existing.OriginatingFarmId == command.FarmId
                    ? Result.Success(await WithIdentityAsync(existing, command.FarmId.Value, ct))
                    : Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
            }
        }

        FieldOperator operatorEntity;
        try
        {
            operatorEntity = FieldOperator.Create(
                command.ClientOperatorId ?? idGenerator.New(),
                command.DisplayName,
                command.FullName,
                // 11.3 — OriginatingFarmId is command.FarmId (the farm
                // ICallerFarmTenantScope established for THIS request),
                // never "the caller's farm": a caller may own or belong to
                // several farms, so there is no single "the caller's farm".
                command.FarmId,
                command.CallerUserId,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.InvalidCommand);
        }

        // lane WID — staged BEFORE the farm record's insert, so the one SaveChanges below writes the person, his card,
        // his phone and PIN, the record pointing at him and the events, or nothing.
        if (identity is not null
            && !await StageIdentityAsync(identity, operatorEntity, command, phone, whose, pin, ct))
        {
            // The person a link names is gone (erased or never existed): nothing is made.
            return Result.Failure<FieldOperatorDto>(ShramSafalErrors.IdentityNotFound);
        }

        if (command.ClientOperatorId is { } clientId)
        {
            if (await repository.TryAddFieldOperatorAsync(operatorEntity, ct))
            {
                return Result.Success(await WithIdentityAsync(operatorEntity, command.FarmId.Value, ct));
            }

            // Lost a race with the same id (a double tap): the winner's row is the answer if
            // it is ours; an id that is not visible to this farm is never handed back.
            var winner = await repository.GetFieldOperatorByIdAsync(clientId, ct);
            return winner is not null && winner.OriginatingFarmId == command.FarmId
                ? Result.Success(await WithIdentityAsync(winner, command.FarmId.Value, ct))
                : Result.Failure<FieldOperatorDto>(ShramSafalErrors.Forbidden);
        }

        await repository.AddFieldOperatorAsync(operatorEntity, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(await WithIdentityAsync(operatorEntity, command.FarmId.Value, ct));
    }

    private async Task<bool> StageIdentityAsync(
        IShramIdentityStore store,
        FieldOperator record,
        CreateFieldOperatorCommand command,
        string? phone,
        PhoneWhose whose,
        string? pin,
        CancellationToken ct)
    {
        var now = clock.UtcNow;
        var farmId = command.FarmId.Value;
        var actor = command.CallerUserId.Value;
        ShramPerson person;

        if (command.LinkPersonId is { } linked)
        {
            // The link use case checked his proof (R1) and resolved the person he is; nothing new is issued.
            var found = await store.GetPersonAsync(linked, ct);
            if (found is null || found.IsErased)
            {
                return false;
            }

            person = found;
            record.AttachPerson(person.Id);
            await store.AddEventAsync(ShramIdentityEvent.Record(
                idGenerator.New(), farmId, record.Id, person.Id, IdentityEventKind.Linked, command.LinkProof, actor, now), ct);
        }
        else
        {
            (person, _) = await WorkerIdentityReads.IssueNewPersonAsync(store, idGenerator.New(), record.DisplayName, farmId, actor, now, ct);
            record.AttachPerson(person.Id);
            await store.AddEventAsync(ShramIdentityEvent.Record(
                idGenerator.New(), farmId, record.Id, person.Id, IdentityEventKind.CardIssued, IdentityProof.None, actor, now), ct);
        }

        if (phone is not null)
        {
            await store.AddPhoneAsync(ShramPersonPhone.Add(idGenerator.New(), person.Id, phone, whose, farmId, now), ct);
            await store.AddEventAsync(ShramIdentityEvent.Record(
                idGenerator.New(), farmId, record.Id, person.Id, IdentityEventKind.PhoneAdded, IdentityProof.None, actor, now), ct);
        }

        if (pin is not null && person.SetHomePin(pin, farmId) == PinOutcome.Set)
        {
            await store.AddEventAsync(ShramIdentityEvent.Record(
                idGenerator.New(), farmId, record.Id, person.Id, IdentityEventKind.PinSet, IdentityProof.None, actor, now), ct);
        }

        if (command.FarmPinToo && pin is not null && await repository.GetFarmByIdAsync(farmId, ct) is { } farm)
        {
            farm.RecordPinCodeOnce(pin, now);
        }

        return true;
    }

    /// <summary>The write-side answer, with his card, level and completeness (lane WID).</summary>
    private async Task<FieldOperatorDto> WithIdentityAsync(FieldOperator record, Guid farmId, CancellationToken ct)
    {
        var dto = record.ToDto();
        if (identity is null)
        {
            return dto;
        }

        var view = await WorkerIdentityReads.ViewAsync(identity, farmId, record, ct);
        return dto with { CardCode = view.CardCode, IdentityLevel = view.IdentityLevel, NeedsPhoneAndPin = view.NeedsPhoneAndPin };
    }

    internal static bool TryParseWhose(string? text, out PhoneWhose whose)
    {
        whose = PhoneWhose.Own;
        return string.IsNullOrWhiteSpace(text)
            || (Enum.TryParse(text.Trim(), ignoreCase: true, out whose) && Enum.IsDefined(whose));
    }
}
