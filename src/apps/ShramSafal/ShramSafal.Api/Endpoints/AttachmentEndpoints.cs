using System.Security.Claims;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Attachments.GetAttachment;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;
using ShramSafal.Application.UseCases.OCR.ExtractFromReceipt;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure.Storage;

namespace ShramSafal.Api.Endpoints;

public static class AttachmentEndpoints
{
    public static RouteGroupBuilder MapAttachmentEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/attachments", async (
            CreateAttachmentRequest request,
            ClaimsPrincipal user,
            IOptions<StorageOptions> storageOptions,
            CreateAttachmentHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var maxBytes = ResolveMaxBytes(storageOptions.Value);
            if (request.SizeBytes > maxBytes)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.AttachmentTooLarge",
                    message = $"Attachment exceeds configured max size of {storageOptions.Value.MaxFileSizeMB} MB."
                });
            }

            var result = await handler.HandleAsync(
                new CreateAttachmentCommand(
                    request.FarmId,
                    callerUserId,
                    request.OriginalFileName,
                    request.MimeType,
                    request.SizeBytes,
                    request.LinkedEntityId,
                    request.LinkedEntityType),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateAttachment")
        .RequireAuthorization();

        group.MapPost("/attachments/{id:guid}/upload", async (
            Guid id,
            HttpRequest request,
            ClaimsPrincipal user,
            IOptions<StorageOptions> storageOptions,
            UploadAttachmentHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (!request.HasFormContentType)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Request must be multipart/form-data with a single file."
                });
            }

            var form = await request.ReadFormAsync(ct);
            if (form.Files.Count != 1)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Exactly one file is required."
                });
            }

            var file = form.Files[0];
            if (file.Length <= 0)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.AttachmentFileMissing",
                    message = "Attachment file is required."
                });
            }

            var maxBytes = ResolveMaxBytes(storageOptions.Value);
            if (file.Length > maxBytes)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.AttachmentTooLarge",
                    message = $"Attachment exceeds configured max size of {storageOptions.Value.MaxFileSizeMB} MB."
                });
            }

            await using var stream = file.OpenReadStream();
            var result = await handler.HandleAsync(new UploadAttachmentCommand(id, callerUserId, stream), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("UploadAttachment")
        .RequireAuthorization();

        group.MapGet("/attachments/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            GetAttachmentHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetAttachmentQuery(id, callerUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetAttachmentMetadata")
        .RequireAuthorization();

        group.MapGet("/attachments/{id:guid}/download", async (
            Guid id,
            ClaimsPrincipal user,
            GetAttachmentFileHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetAttachmentFileQuery(id, callerUserId), ct);
            if (!result.IsSuccess || result.Value is null)
            {
                return ToErrorResult(result.Error);
            }

            return Results.File(
                fileStream: result.Value.FileStream,
                contentType: result.Value.MimeType,
                fileDownloadName: result.Value.FileName,
                enableRangeProcessing: true);
        })
        .WithName("DownloadAttachment")
        .RequireAuthorization();

        group.MapPost("/attachments/{id:guid}/ocr", async (
            Guid id,
            ClaimsPrincipal user,
            ExtractFromReceiptHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new ExtractFromReceiptCommand(id, callerUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ExtractAttachmentOcr")
        .RequireAuthorization();

        group.MapGet("/attachments/{id:guid}/ocr", async (
            Guid id,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IAuthorizationEnforcer authorizationEnforcer,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var attachment = await repository.GetAttachmentByIdAsync(id, ct);
            if (attachment is null)
            {
                return ToErrorResult(ShramSafalErrors.AttachmentNotFound);
            }

            await authorizationEnforcer.EnsureIsFarmMember(new UserId(callerUserId), attachment.FarmId);

            var result = await repository.GetOcrResultByAttachmentIdAsync(id, ct);
            if (result is null)
            {
                return ToErrorResult(ShramSafalErrors.OcrResultNotFound);
            }

            return Results.Ok(result.ToExtractionResult());
        })
        .WithName("GetAttachmentOcr")
        .RequireAuthorization();

        group.MapGet("/attachments", async (
            Guid entityId,
            string entityType,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IAuthorizationEnforcer authorizationEnforcer,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (entityId == Guid.Empty || string.IsNullOrWhiteSpace(entityType))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "entityId and entityType are required."
                });
            }

            var attachments = await repository.GetAttachmentsByEntityAsync(entityId, entityType.Trim(), ct);
            foreach (var farmId in attachments.Select(attachment => attachment.FarmId).Distinct())
            {
                await authorizationEnforcer.EnsureIsFarmMember(new UserId(callerUserId), farmId);
            }

            return Results.Ok(attachments.Select(ToDto).ToList());
        })
        .WithName("ListAttachmentsByEntity")
        .RequireAuthorization();

        return group;
    }

    private static long ResolveMaxBytes(StorageOptions options)
    {
        var maxFileSizeMb = options.MaxFileSizeMB <= 0 ? 25 : options.MaxFileSizeMB;
        return maxFileSizeMb * 1024L * 1024L;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static bool TryGetCallerUserId(ClaimsPrincipal user, out Guid callerUserId)
    {
        callerUserId = Guid.Empty;
        var sub = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return sub is not null && Guid.TryParse(sub, out callerUserId);
    }

    private static AttachmentDto ToDto(Domain.Attachments.Attachment attachment) =>
        new(
            attachment.Id,
            attachment.FarmId,
            attachment.LinkedEntityId,
            attachment.LinkedEntityType,
            attachment.UploadedByUserId,
            attachment.OriginalFileName,
            attachment.MimeType,
            attachment.SizeBytes,
            attachment.StoragePath,
            attachment.Status.ToString(),
            attachment.CreatedAtUtc,
            attachment.FinalizedAtUtc);
}

public sealed record CreateAttachmentRequest(
    Guid FarmId,
    string OriginalFileName,
    string MimeType,
    long SizeBytes,
    Guid? LinkedEntityId = null,
    string? LinkedEntityType = null);
