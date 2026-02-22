using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;
using ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;

namespace ShramSafal.Api.Endpoints;

public static class AttachmentEndpoints
{
    public static RouteGroupBuilder MapAttachmentEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/attachments", async (
            CreateAttachmentRequest request,
            ClaimsPrincipal user,
            CreateAttachmentHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
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
            UploadAttachmentHandler handler,
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

            await using var stream = file.OpenReadStream();
            var command = new UploadAttachmentCommand(
                id,
                stream,
                actorUserId,
                file.FileName,
                EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .DisableAntiforgery()
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
