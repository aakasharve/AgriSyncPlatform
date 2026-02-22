using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.OCR;

namespace ShramSafal.Application.UseCases.OCR.ExtractFromReceipt;

public sealed class ExtractFromReceiptHandler(
    IShramSafalRepository repository,
    IAttachmentStorageService attachmentStorageService,
    IOcrExtractionService ocrExtractionService,
    IAuthorizationEnforcer authorizationEnforcer,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<OcrExtractionResult>> HandleAsync(ExtractFromReceiptCommand command, CancellationToken ct = default)
    {
        if (command.AttachmentId == Guid.Empty || command.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(command.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.AttachmentNotFound);
        }

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(command.RequestedByUserId), attachment.FarmId);

        if (attachment.Status != AttachmentStatus.Finalized)
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.AttachmentNotFinalized);
        }

        if (!attachment.MimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.AttachmentNotImage);
        }

        if (string.IsNullOrWhiteSpace(attachment.StoragePath))
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.AttachmentFileMissing);
        }

        var exists = await attachmentStorageService.ExistsAsync(attachment.StoragePath, ct);
        if (!exists)
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.AttachmentFileMissing);
        }

        var farm = await repository.GetFarmByIdAsync(attachment.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<OcrExtractionResult>(ShramSafalErrors.FarmNotFound);
        }

        var recentFrom = DateOnly.FromDateTime(clock.UtcNow.AddDays(-90));
        var recentTo = DateOnly.FromDateTime(clock.UtcNow);
        var recentEntries = await repository.GetCostEntriesAsync(recentFrom, recentTo, ct);
        var farmRecentEntries = recentEntries
            .Where(entry => entry.FarmId == attachment.FarmId)
            .ToList();

        var context = new OcrContext(
            farm.Name,
            farmRecentEntries
                .Select(entry => entry.Category.Trim())
                .Where(category => !string.IsNullOrWhiteSpace(category))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(20)
                .ToArray(),
            farmRecentEntries
                .Select(entry => entry.Description.Trim())
                .Where(description => !string.IsNullOrWhiteSpace(description))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(20)
                .ToArray());

        await using var fileStream = await attachmentStorageService.RetrieveFileAsync(attachment.StoragePath, ct);
        var extraction = await ocrExtractionService.ExtractFromImageAsync(fileStream, attachment.MimeType, context, ct);

        var normalizedExtraction = extraction with
        {
            AttachmentId = attachment.Id,
            ExtractedAtUtc = extraction.ExtractedAtUtc == default ? clock.UtcNow : extraction.ExtractedAtUtc
        };

        var ocrResult = OcrResult.Create(
            idGenerator.New(),
            attachment.Id,
            normalizedExtraction.RawText,
            normalizedExtraction.Fields,
            normalizedExtraction.OverallConfidence,
            normalizedExtraction.ModelUsed,
            normalizedExtraction.LatencyMs,
            normalizedExtraction.ExtractedAtUtc);

        await repository.AddOcrResultAsync(ocrResult, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(normalizedExtraction);
    }
}
