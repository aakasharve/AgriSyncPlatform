using ShramSafal.Api.Endpoints;

namespace ShramSafal.Api;

public static class ModuleEndpoints
{
    public static IEndpointRouteBuilder MapShramSafalApi(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/shramsafal")
            .WithTags("ShramSafal")
            .RequireAuthorization();

        group.MapGet("/health", () => Results.Ok(new
        {
            module = "ShramSafal",
            status = "ok"
        }))
        .WithName("GetShramSafalModuleHealth")
        .AllowAnonymous();

        group.MapFarmEndpoints();
        group.MapMembershipEndpoints();
        group.MapLogsEndpoints();
        group.MapFinanceEndpoints();
        group.MapAiEndpoints();
        group.MapAttachmentEndpoints();
        group.MapPlanningEndpoints();
        group.MapScheduleEndpoints();
        group.MapReferenceDataEndpoints();
        group.MapAuditEndpoints();
        group.MapExportEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
