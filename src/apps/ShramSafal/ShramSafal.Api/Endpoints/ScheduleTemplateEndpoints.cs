using System.Security.Claims;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Api.Endpoints;

public static class ScheduleTemplateEndpoints
{
    public static RouteGroupBuilder MapScheduleTemplateEndpoints(this RouteGroupBuilder group)
    {
        // TODO: add rate limit 30/hr/user when rate limiting middleware is configured with a dedicated "schedule-clone" policy
        group.MapPost("/schedule-templates/{id}/clone", async (
            Guid id,
            CloneScheduleTemplateRequest request,
            ClaimsPrincipal user,
            CloneScheduleTemplateHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var newTemplateId = request.NewId ?? Guid.NewGuid();

            var command = new CloneScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: newTemplateId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewScope: request.NewScope,
                Reason: request.Reason,
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CloneScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/edit", async (
            Guid id,
            EditScheduleTemplateRequest request,
            ClaimsPrincipal user,
            EditScheduleTemplateHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new EditScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: request.NewId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewName: request.NewName,
                NewStage: request.NewStage,
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("EditScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/publish", async (
            Guid id,
            PublishScheduleTemplateRequest request,
            ClaimsPrincipal user,
            PublishScheduleTemplateHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new PublishScheduleTemplateCommand(
                TemplateId: id,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PublishScheduleTemplate");

        group.MapGet("/schedule-templates/{rootId}/lineage", async (
            Guid rootId,
            GetScheduleLineageHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new GetScheduleLineageQuery(rootId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetScheduleLineage");

        return group;
    }

    private static IResult ToErrorResult(AgriSync.BuildingBlocks.Results.Error error)
    {
        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
            return Results.NotFound(new { error = error.Code, message = error.Description });

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
            return Results.Forbid();

        return Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record CloneScheduleTemplateRequest(
    Guid? NewId,
    TenantScope NewScope,
    string Reason,
    string? ClientCommandId);

public sealed record EditScheduleTemplateRequest(
    Guid NewId,
    string? NewName,
    string? NewStage,
    string? ClientCommandId);

public sealed record PublishScheduleTemplateRequest(
    string? ClientCommandId);
