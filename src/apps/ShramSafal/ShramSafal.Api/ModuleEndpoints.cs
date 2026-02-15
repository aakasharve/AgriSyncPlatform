using ShramSafal.Api.Endpoints;

namespace ShramSafal.Api;

public static class ModuleEndpoints
{
    public static IEndpointRouteBuilder MapShramSafalApi(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/shramsafal").WithTags("ShramSafal");

        group.MapGet("/health", () => Results.Ok(new
        {
            module = "ShramSafal",
            status = "ok"
        }))
        .WithName("GetShramSafalModuleHealth");

        group.MapFarmEndpoints();
        group.MapLogsEndpoints();
        group.MapFinanceEndpoints();
        group.MapPlanningEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
