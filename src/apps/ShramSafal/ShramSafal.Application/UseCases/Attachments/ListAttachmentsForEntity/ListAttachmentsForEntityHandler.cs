using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;

/// <summary>The attachments of one record / receipt / farm. lane MU-3: each read where its parent is read.</summary>
public sealed class ListAttachmentsForEntityHandler(IShramSafalRepository repository, IClock? clock = null)
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

        var now = clock?.UtcNow ?? DateTime.UtcNow;
        var readable = new List<Domain.Attachments.Attachment>();
        foreach (var attachment in attachments.Where(a => farmIdSet.Contains((Guid)a.FarmId)))
        {
            if (await AttachmentParentRule.MayReadAsync(repository, attachment, query.RequestedByUserId, now, ct))
            {
                readable.Add(attachment);
            }
        }

        var visible = readable
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
