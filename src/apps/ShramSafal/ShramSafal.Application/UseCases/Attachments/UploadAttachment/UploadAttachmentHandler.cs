using System.Globalization;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

public sealed class UploadAttachmentHandler(
    IShramSafalRepository repository,
    IAttachmentStorageService storageService,
    IClock clock)
{
    public async Task<Result<AttachmentDto>> HandleAsync(UploadAttachmentCommand command, CancellationToken ct = default)
    {
        if (command.AttachmentId == Guid.Empty || command.UploadedByUserId == Guid.Empty || command.FileStream is null)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(command.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.AttachmentNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(attachment.FarmId, command.UploadedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.Forbidden);
        }

        if (attachment.Status == AttachmentStatus.Finalized)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.AttachmentAlreadyFinalized);
        }

        var nowUtc = clock.UtcNow;
        var relativePath = BuildRelativePath(attachment, nowUtc, command.ClientFileName);
        var bytesWritten = await storageService.SaveAsync(relativePath, command.FileStream, attachment.MimeType, ct);
        attachment.MarkUploaded(relativePath, bytesWritten, nowUtc);
        attachment.FinalizeUpload(nowUtc);

        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                (Guid)attachment.FarmId,
                "Attachment",
                attachment.Id,
                "UploadedAndFinalized",
                command.UploadedByUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    attachment.Id,
                    attachment.LinkedEntityId,
                    attachment.LinkedEntityType,
                    attachment.FileName,
                    attachment.MimeType,
                    attachment.LocalPath,
                    attachment.SizeBytes,
                    attachment.Status
                },
                command.ClientCommandId,
                nowUtc),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(attachment.ToDto());
    }

    private static string BuildRelativePath(Domain.Attachments.Attachment attachment, DateTime nowUtc, string? clientFileName)
    {
        var year = nowUtc.ToString("yyyy", CultureInfo.InvariantCulture);
        var month = nowUtc.ToString("MM", CultureInfo.InvariantCulture);
        var farmSegment = ((Guid)attachment.FarmId).ToString("N", CultureInfo.InvariantCulture);
        var attachmentSegment = attachment.Id.ToString("N", CultureInfo.InvariantCulture);
        var safeName = ResolveSafeFileName(attachment.FileName, attachment.MimeType, clientFileName);
        return $"attachments/{farmSegment}/{year}/{month}/{attachmentSegment}/{safeName}";
    }

    private static string ResolveSafeFileName(string fileName, string mimeType, string? clientFileName)
    {
        var candidate = string.IsNullOrWhiteSpace(clientFileName) ? fileName : clientFileName;
        var nameOnly = Path.GetFileName(candidate);
        if (string.IsNullOrWhiteSpace(nameOnly))
        {
            nameOnly = Path.GetFileName(fileName);
        }

        if (string.IsNullOrWhiteSpace(nameOnly))
        {
            nameOnly = $"attachment{ResolveExtension(fileName, mimeType, clientFileName)}";
        }

        var sanitized = new string(nameOnly
            .Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch)
            .ToArray())
            .Trim();

        if (string.IsNullOrWhiteSpace(sanitized))
        {
            sanitized = $"attachment{ResolveExtension(fileName, mimeType, clientFileName)}";
        }

        return sanitized;
    }

    private static string ResolveExtension(string fileName, string mimeType, string? clientFileName)
    {
        var extension = Path.GetExtension(clientFileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = Path.GetExtension(fileName);
        }

        if (!string.IsNullOrWhiteSpace(extension) && extension.Length <= 12)
        {
            return extension.ToLowerInvariant();
        }

        return mimeType switch
        {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "application/pdf" => ".pdf",
            _ => string.Empty
        };
    }
}
