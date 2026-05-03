using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateAttachment): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate yielding <see cref="ShramSafalErrors.InvalidCommand"/>:
/// any of FarmId / CreatedByUserId / LinkedEntityId is empty, or
/// FileName / MimeType is blank, or LinkedEntityType is not one of the
/// supported names ("farm" / "dailylog" / "costentry"). The body's
/// normalization helper accepts case-insensitive input; the validator
/// mirrors that contract.
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// link-target existence + cross-farm guard (per-type:
/// <see cref="ShramSafalErrors.FarmNotFound"/> /
/// <see cref="ShramSafalErrors.DailyLogNotFound"/> /
/// <see cref="ShramSafalErrors.CostEntryNotFound"/> /
/// <see cref="ShramSafalErrors.Forbidden"/>) — that check produces
/// multiple distinct error codes depending on the linked-entity type
/// and is not a pure command-shape gate. Farm-membership authorization
/// is extracted into <see cref="CreateAttachmentAuthorizer"/>.
/// </para>
/// </summary>
public sealed class CreateAttachmentValidator : IValidator<CreateAttachmentCommand>
{
    public IEnumerable<Error> Validate(CreateAttachmentCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.CreatedByUserId == Guid.Empty
            || command.LinkedEntityId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.FileName)
            || string.IsNullOrWhiteSpace(command.MimeType)
            || !IsKnownLinkedEntityType(command.LinkedEntityType))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }

    private static bool IsKnownLinkedEntityType(string? linkedEntityType)
    {
        if (string.IsNullOrWhiteSpace(linkedEntityType))
        {
            return false;
        }

        return linkedEntityType.Trim().ToLowerInvariant() switch
        {
            "farm" or "dailylog" or "costentry" => true,
            _ => false
        };
    }
}
