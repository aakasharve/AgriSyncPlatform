// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.UseCases.Inputs.AssertInputIdentity;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2; founders D-92 and D-95) - the ONE handler behind
/// <c>assert_input_identity</c>: his हो / नाही / फोटो answer about one product of one saved record.
///
/// <list type="number">
/// <item><b>An overlay, never an edit (D-92; P1, P3, P7).</b> The answer is one new append-only row. The record's content
/// document, its version, its tasks, its quantities and its confirmation are not read for writing and not touched: a answer
/// never re-opens or changes a confirmed record.</item>
/// <item><b>Which record, which product.</b> The record is the one the payload names, on the record's OWN farm (a record of
/// another farm is "not found", E4). The product is an item of the record's LATEST stored content: the input event with that
/// id and the slot in its <c>mix[]</c>. An item that is not there is refused as <c>SyncInvalidPayload</c>. His words
/// (<c>spokenName</c>) are copied from that stored item, never from the request.</item>
/// <item><b>Which product it is.</b> A <c>confirmed</c> answer carries a product of the ShramSafal library
/// (<see cref="InputCatalog.Get"/>); a product id that is not in the library is refused whatever the answer.</item>
/// <item><b>Who may answer (D-95).</b> The speaker, who made the record, answers as himself: stored with
/// <c>is_check = false</c>. A holder of the confirm-records authority on the farm (the primary account holder always) gives
/// the check: <c>is_check = true</c> - the SAME standing the compliance and confirmation doors ask
/// (<see cref="FarmAuthorityGate.HoldsAsync"/>), read from the sender's seat now, never from the request. Anyone else on the
/// farm is refused (<see cref="ShramSafalErrors.Forbidden"/>). A record kept from him (its audience, his plots) is refused
/// like every change to it.</item>
/// <item><b>A repeat is the same row.</b> The same sync request on the same farm answers the stored row, however the record
/// has changed since.</item>
/// </list>
/// Checking never blocks मंजूर and no entitlement gate stands in front of it: an answer is never a condition of saving (P9).
/// </summary>
public sealed class AssertInputIdentityHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public const string AssertedAction = "InputIdentityAsserted";

    /// <summary>The code the phone and the sync layer know for "this answer, as sent, can never be applied".</summary>
    public const string InvalidPayloadCode = "ShramSafal.SyncInvalidPayload";

    private static Error Invalid(string description) => Error.Validation(InvalidPayloadCode, description);

    public async Task<Result<InputIdentityAssertionDto>> HandleAsync(AssertInputIdentityCommand command, CancellationToken ct = default)
    {
        if (command is null
            || command.AssertionId == Guid.Empty
            || command.FarmId == Guid.Empty
            || command.DailyLogId == Guid.Empty
            || command.AssertedByUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.ClientMutationId)
            || command.MixIndex < 0
            || string.IsNullOrWhiteSpace(command.InputEventId))
        {
            return Result.Failure<InputIdentityAssertionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!IdentityVerdictWire.TryParse(command.Verdict, out var verdict))
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("The answer must be confirmed, rejected or photo."));
        }

        // E4 - the farm is the RECORD's farm; the payload only says which one the phone means. A record of another farm (or
        // one the sender's scope cannot see) is "not found", the answer every phone reads as "wait for its create".
        var log = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (log is null || (Guid)log.FarmId != command.FarmId)
        {
            return Result.Failure<InputIdentityAssertionDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var farmId = (Guid)log.FarmId;
        var caller = command.AssertedByUserId;
        var now = clock.UtcNow;

        var role = await repository.GetUserRoleForFarmAsync(farmId, caller, ct);
        if (role is null)
        {
            return Result.Failure<InputIdentityAssertionDto>(ShramSafalErrors.Forbidden);
        }

        // PRV and MU-4 - a record kept from him, or outside his plots, is not his to answer about.
        if (!await RecordAudienceGate.MaySeeLogAsync(repository, log, caller, now, ct))
        {
            return Result.Failure<InputIdentityAssertionDto>(ShramSafalErrors.RecordAudienceClosed);
        }

        if (await PlotScopeGate.RefuseAsync(repository, farmId, log.PlotId, caller, now, ct) is { } outsidePlots)
        {
            return Result.Failure<InputIdentityAssertionDto>(outsidePlots);
        }

        // D-95 - the speaker answers as himself; a holder of the confirm-records authority gives the check. The server sets
        // the flag from the sender's standing at this moment; there is no field for it on the wire.
        var isSpeaker = caller == log.OperatorUserId.Value;
        var holdsCheck = await FarmAuthorityGate.HoldsAsync(repository, farmId, caller, FarmAuthority.ConfirmRecords, now, ct);
        if (!isSpeaker && !holdsCheck)
        {
            return Result.Failure<InputIdentityAssertionDto>(ShramSafalErrors.Forbidden);
        }

        // A repeat of the same sync request is the row it already made, whatever has happened to the record since.
        var repeated = await repository.GetInputIdentityAssertionByClientMutationIdAsync(farmId, command.ClientMutationId.Trim(), ct);
        if (repeated is not null)
        {
            return repeated.AssertedByUserId.Value == caller && repeated.FarmId == log.FarmId
                ? Result.Success(InputIdentityAssertionDto.From(repeated))
                : Result.Failure<InputIdentityAssertionDto>(Invalid("This request id was already used for another answer."));
        }

        // His words come from the STORED item of the latest content, never from the request (P1, P7).
        var content = await repository.GetCurrentDailyLogContentAsync(log.Id, ct);
        if (content is null || content.FarmId != log.FarmId)
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("The record holds no such product."));
        }

        var spoken = SpokenNameOf(content.DocumentJson, command.InputEventId.Trim(), command.MixIndex);
        if (spoken.IsFailure)
        {
            // Not there (a removed item, an erased name) or not readable at all: either way no answer is stored, and the
            // sender is told (SyncInvalidPayload) - never a row with a blank name.
            return Result.Failure<InputIdentityAssertionDto>(spoken.Error);
        }

        var spokenName = spoken.Value!;

        var productId = string.IsNullOrWhiteSpace(command.CatalogProductId) ? null : command.CatalogProductId.Trim();
        if (productId is not null && InputCatalog.Get(productId) is null)
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("That product is not in the ShramSafal library."));
        }

        if (verdict == IdentityVerdict.Confirmed && productId is null)
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("A confirmed answer names the library product."));
        }

        // A photo answer IS the photo: it names the attachment. The attachment row itself may not be on the server yet (the
        // phone may be offline when the photo uploads), so a pointer the server cannot find is kept; one found on another farm
        // is refused below.
        if (verdict == IdentityVerdict.Photo && (command.AttachmentId is null || command.AttachmentId == Guid.Empty))
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("A photo answer names its photo."));
        }

        // E4 - a packet photo of another farm is never pointed at. (Under the row policy another farm's photo resolves to
        // nothing and the id is kept as a pointer; a photo found on another farm is refused here.)
        if (command.AttachmentId is { } attachmentId && attachmentId != Guid.Empty
            && await repository.GetAttachmentByIdAsync(attachmentId, ct) is { } photo && photo.FarmId != log.FarmId)
        {
            return Result.Failure<InputIdentityAssertionDto>(Invalid("That photo does not belong to this farm."));
        }

        InputIdentityAssertion assertion;
        try
        {
            assertion = InputIdentityAssertion.Record(
                command.AssertionId,
                log.FarmId,
                log.PlotId,
                log.Id,
                command.InputEventId,
                command.MixIndex,
                spokenName,
                productId,
                verdict,
                command.AttachmentId,
                command.CatalogVersion,
                new UserId(caller),
                now,
                command.ClientMutationId,
                isCheck: holdsCheck);
        }
        catch (ArgumentException)
        {
            // A field the entity's own rules refuse (an over-long id or version). The bytes are the bytes: never retried.
            return Result.Failure<InputIdentityAssertionDto>(Invalid("The answer is not well formed."));
        }

        var appVersion = string.IsNullOrWhiteSpace(command.ClientAppVersion)
            ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
            : command.ClientAppVersion;

        // Repository add methods only stage entities; the single SaveChangesAsync below commits the answer and its audit row
        // together. Neither touches the record.
        await repository.AddInputIdentityAssertionAsync(assertion, ct);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "InputIdentityAssertion",
                entityId: assertion.Id,
                action: AssertedAction,
                actorUserId: caller,
                actorRole: role.Value.ToString(),
                payload: new
                {
                    assertionId = assertion.Id,
                    dailyLogId = assertion.DailyLogId,
                    inputEventId = assertion.InputEventId,
                    mixIndex = assertion.MixIndex,
                    verdict = IdentityVerdictWire.ToWire(assertion.Verdict),
                    catalogProductId = assertion.CatalogProductId,
                    catalogVersion = assertion.CatalogVersion,
                    isCheck = assertion.IsCheck,
                },
                farmId: farmId,
                clientCommandId: command.ClientMutationId,
                appVersion: appVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(InputIdentityAssertionDto.From(assertion));
    }

    private static readonly Error NoSuchProduct = Error.Validation(InvalidPayloadCode, "The record holds no such product.");

    private static readonly Error UnreadableRecord = Error.Validation(InvalidPayloadCode, "The stored record cannot be read.");

    /// <summary>
    /// His words for the product at (<paramref name="inputEventId"/>, <paramref name="mixIndex"/>) in the stored content
    /// document: the <c>productName</c> of that slot of that input event's <c>mix[]</c>. A failure (always
    /// <see cref="InvalidPayloadCode"/>) when the event, the slot or the words are not there (a removed item, an erased name),
    /// or when the stored document cannot be read at all: the answer is then refused, visibly, and never stored with a blank
    /// name.
    /// </summary>
    internal static Result<string> SpokenNameOf(string documentJson, string inputEventId, int mixIndex)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(documentJson);
        }
        catch (JsonException)
        {
            return Result.Failure<string>(UnreadableRecord);
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("inputs", out var inputs)
                || inputs.ValueKind != JsonValueKind.Array)
            {
                return Result.Failure<string>(NoSuchProduct);
            }

            foreach (var ev in inputs.EnumerateArray())
            {
                if (ev.ValueKind != JsonValueKind.Object
                    || !ev.TryGetProperty("id", out var id)
                    || id.ValueKind != JsonValueKind.String
                    || !string.Equals(id.GetString(), inputEventId, StringComparison.Ordinal))
                {
                    continue;
                }

                if (!ev.TryGetProperty("mix", out var mix) || mix.ValueKind != JsonValueKind.Array)
                {
                    return Result.Failure<string>(NoSuchProduct);
                }

                var slot = 0;
                foreach (var item in mix.EnumerateArray())
                {
                    if (slot++ != mixIndex)
                    {
                        continue;
                    }

                    return item.ValueKind == JsonValueKind.Object
                        && item.TryGetProperty("productName", out var name)
                        && name.ValueKind == JsonValueKind.String
                        && !string.IsNullOrWhiteSpace(name.GetString())
                            ? Result.Success(name.GetString()!)
                            : Result.Failure<string>(NoSuchProduct);
                }

                return Result.Failure<string>(NoSuchProduct);
            }

            return Result.Failure<string>(NoSuchProduct);
        }
    }
}
