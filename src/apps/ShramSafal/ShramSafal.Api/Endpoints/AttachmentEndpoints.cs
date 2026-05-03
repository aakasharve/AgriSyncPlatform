using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;
using ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;

namespace ShramSafal.Api.Endpoints;

public static class AttachmentEndpoints
{
    private const long MaxAttachmentBytes = 10 * 1024 * 1024;
    private static readonly HashSet<string> AllowedAttachmentMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "application/pdf"
    };

    public static RouteGroupBuilder MapAttachmentEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/attachments", async (
            CreateAttachmentRequest request,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreateAttachmentCommand, ShramSafal.Application.Contracts.Dtos.AttachmentDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!IsAllowedAttachmentMimeType(request.MimeType))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Unsupported attachment mime type."
                });
            }

            var command = new CreateAttachmentCommand(
                request.FarmId,
                request.LinkedEntityId,
                request.LinkedEntityType,
                request.FileName,
                request.MimeType,
                actorUserId,
                request.AttachmentId,
                EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            var attachment = result.Value!;
            var uploadUrl = $"/shramsafal/attachments/{attachment.Id}/upload";
            return Results.Ok(new
            {
                attachment,
                uploadUrl
            });
        })
        .WithName("CreateAttachment");

        group.MapPost("/attachments/{id:guid}/upload", async (
            Guid id,
            IFormFile? file,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<UploadAttachmentCommand, ShramSafal.Application.Contracts.Dtos.AttachmentDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (file is null || file.Length <= 0)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Upload request must include a non-empty file."
                });
            }

            if (!IsAllowedAttachmentMimeType(file.ContentType))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Unsupported attachment mime type."
                });
            }

            if (file.Length > MaxAttachmentBytes)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = $"Attachment payload too large. Max {MaxAttachmentBytes / (1024 * 1024)} MB."
                });
            }

            await using var stream = file.OpenReadStream();
            if (!await HasValidAttachmentSignatureAsync(stream, file.ContentType, ct))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Attachment content does not match the declared file type."
                });
            }

            var command = new UploadAttachmentCommand(
                id,
                stream,
                actorUserId,
                file.ContentType,
                file.FileName,
                EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .DisableAntiforgery()
        .WithMetadata(new RequestFormLimitsAttribute { MultipartBodyLengthLimit = MaxAttachmentBytes })
        .WithName("UploadAttachment");

        group.MapGet("/attachments/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            GetAttachmentMetadataHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetAttachmentMetadataQuery(id, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetAttachmentMetadata");

        group.MapGet("/attachments/{id:guid}/download", async (
            Guid id,
            ClaimsPrincipal user,
            GetAttachmentFileHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetAttachmentFileQuery(id, actorUserId), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            var file = result.Value!;
            return Results.File(file.ContentStream, file.MimeType, file.FileName);
        })
        .WithName("DownloadAttachment");

        group.MapGet("/attachments", async (
            Guid entityId,
            string entityType,
            ClaimsPrincipal user,
            ListAttachmentsForEntityHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new ListAttachmentsForEntityQuery(entityId, entityType, actorUserId),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ListAttachmentsForEntity");

        return group;
    }

    private static bool IsAllowedAttachmentMimeType(string? mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return false;
        }

        var normalized = NormalizeMimeType(mimeType);
        return normalized is not null && AllowedAttachmentMimeTypes.Contains(normalized);
    }

    private static string? NormalizeMimeType(string? mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return null;
        }

        var normalized = mimeType.Trim().ToLowerInvariant();
        var separator = normalized.IndexOf(';');
        if (separator > 0)
        {
            normalized = normalized[..separator];
        }

        return normalized;
    }

    private static async Task<bool> HasValidAttachmentSignatureAsync(Stream stream, string? mimeType, CancellationToken ct)
    {
        if (!stream.CanSeek)
        {
            return false;
        }

        var normalizedMimeType = NormalizeMimeType(mimeType);
        var header = new byte[16];
        var bytesRead = await stream.ReadAsync(header.AsMemory(0, header.Length), ct);
        stream.Position = 0;

        return normalizedMimeType switch
        {
            "image/jpeg" or "image/jpg" => bytesRead >= 3 &&
                                           header[0] == 0xFF &&
                                           header[1] == 0xD8 &&
                                           header[2] == 0xFF,
            "image/png" => bytesRead >= 8 &&
                           header[0] == 0x89 &&
                           header[1] == 0x50 &&
                           header[2] == 0x4E &&
                           header[3] == 0x47 &&
                           header[4] == 0x0D &&
                           header[5] == 0x0A &&
                           header[6] == 0x1A &&
                           header[7] == 0x0A,
            "image/webp" => bytesRead >= 12 &&
                            Encoding.ASCII.GetString(header, 0, 4) == "RIFF" &&
                            Encoding.ASCII.GetString(header, 8, 4) == "WEBP",
            "application/pdf" => bytesRead >= 5 &&
                                 header[0] == 0x25 &&
                                 header[1] == 0x50 &&
                                 header[2] == 0x44 &&
                                 header[3] == 0x46 &&
                                 header[4] == 0x2D,
            _ => false
        };
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record CreateAttachmentRequest(
    Guid FarmId,
    Guid LinkedEntityId,
    string LinkedEntityType,
    string FileName,
    string MimeType,
    Guid? AttachmentId = null);
