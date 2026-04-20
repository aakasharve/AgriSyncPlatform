using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Api.Endpoints;

public static class ReferenceDataEndpoints
{
    public static RouteGroupBuilder MapReferenceDataEndpoints(this RouteGroupBuilder group)
    {
        var referenceGroup = group.MapGroup("/reference");

        referenceGroup.MapGet("/schedule-templates", async (
            GetScheduleTemplatesHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetScheduleTemplates");

        referenceGroup.MapGet("/schedule-templates/{id:guid}", async (
            Guid id,
            GetScheduleTemplatesHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(ct);
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
            GetCropTypesHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(ct);
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

        referenceGroup.MapGet("/cost-categories", () => Results.Ok(ReferenceDataCatalog.CostCategories))
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
