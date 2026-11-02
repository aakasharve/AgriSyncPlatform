using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Api.Endpoints;

public static class ReferenceDataEndpoints
{
    public static RouteGroupBuilder MapReferenceDataEndpoints(this RouteGroupBuilder group)
    {
        var referenceGroup = group.MapGroup("/reference");

        // lane F99 — the reference lists belong to no farm, so each is read under the caller's own user scope: these routes
        // opened none, and their first read failed closed in TenantConnectionInterceptor (500 for everyone).
        referenceGroup.MapGet("/schedule-templates", async (
            ClaimsPrincipal user,
            GetScheduleTemplatesHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(callerUserId, token => handler.HandleAsync(token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetScheduleTemplates");

        referenceGroup.MapGet("/schedule-templates/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            GetScheduleTemplatesHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(callerUserId, token => handler.HandleAsync(token), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            var templates = result.Value ?? [];
            var template = templates.FirstOrDefault(t => t.Id == id);
            return template is null
                ? Results.NotFound(new { error = "ShramSafal.ScheduleTemplateNotFound", message = "Schedule template was not found." })
                : Results.Ok(template);
        })
        .WithName("GetScheduleTemplateById");

        referenceGroup.MapGet("/crop-types", async (
            ClaimsPrincipal user,
            GetCropTypesHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(callerUserId, token => handler.HandleAsync(token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetCropTypes");

        referenceGroup.MapGet("/deviation-reason-codes", async (
            GetDeviationReasonCodesHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetDeviationReasonCodes");

        referenceGroup.MapGet("/activity-categories", () => Results.Ok(ReferenceDataCatalog.ActivityCategories))
            .WithName("GetActivityCategories");

        // DATA_PRINCIPLE_SPINE sub-phase 02.5 — projects from
        // `ssf.cost_categories` (server-owned canonical lookup). Falls
        // back to the in-memory ReferenceDataCatalog list when the DB
        // is empty (test harness without seed replay).
        referenceGroup.MapGet("/cost-categories", async (
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var rows = await userScope.RunForCallerAsync(callerUserId, token => repository.GetCostCategoriesAsync(token), ct);
            IReadOnlyList<CostCategoryRefDto> payload = rows.Count > 0
                ? rows
                    .Select(c => new CostCategoryRefDto(c.Id, c.DisplayEn, c.DisplayMr, c.DisplayHi))
                    .ToList()
                : ReferenceDataCatalog.CostCategories;
            return Results.Ok(payload);
        })
            .WithName("GetCostCategories");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}
