using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;

public sealed class ListAttachmentsForEntityHandler(IShramSafalRepository repository)
{
    public async Task<Result<IReadOnlyList<AttachmentDto>>> HandleAsync(
        ListAttachmentsForEntityQuery query,
        CancellationToken ct = default)
    {
        if (query.LinkedEntityId == Guid.Empty ||
            query.RequestedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(query.LinkedEntityType))
        {
            return Result.Failure<IReadOnlyList<AttachmentDto>>(ShramSafalErrors.InvalidCommand);
        }

        var linkedEntityType = NormalizeLinkedEntityType(query.LinkedEntityType);
        if (linkedEntityType is null)
        {
            return Result.Failure<IReadOnlyList<AttachmentDto>>(ShramSafalErrors.InvalidCommand);
        }

        var farmIds = await repository.GetFarmIdsForUserAsync(query.RequestedByUserId, ct);
        var farmIdSet = farmIds.ToHashSet();
        var attachments = await repository.GetAttachmentsForEntityAsync(
            query.LinkedEntityId,
            linkedEntityType,
            ct);

        var visible = attachments
            .Where(a => farmIdSet.Contains((Guid)a.FarmId))
            .OrderBy(a => a.CreatedAtUtc)
            .Select(a => a.ToDto())
            .ToList();

        return Result.Success<IReadOnlyList<AttachmentDto>>(visible);
    }

    private static string? NormalizeLinkedEntityType(string? linkedEntityType)
    {
        if (string.IsNullOrWhiteSpace(linkedEntityType))
        {
            return null;
        }

        return linkedEntityType.Trim().ToLowerInvariant() switch
        {
            "farm" => "Farm",
            "dailylog" => "DailyLog",
            "costentry" => "CostEntry",
            _ => null
        };
    }
}
