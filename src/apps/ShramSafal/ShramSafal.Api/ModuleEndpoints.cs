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
        group.MapLogsEndpoints();
        group.MapFinanceEndpoints();
        group.MapAttachmentEndpoints();
        group.MapPlanningEndpoints();
        group.MapReferenceDataEndpoints();
        group.MapAuditEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
