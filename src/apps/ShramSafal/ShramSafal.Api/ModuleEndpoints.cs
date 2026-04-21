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
        group.MapPlannedActivityEndpoints();
        group.MapScheduleTemplateEndpoints();
        group.MapScheduleEndpoints();
        group.MapReportEndpoints();
        group.MapAdminEndpoints();
        group.MapAttentionEndpoints();
        group.MapReferenceDataEndpoints();
        group.MapAuditEndpoints();
        group.MapExportEndpoints();
        group.MapTestEndpoints();
        group.MapComplianceEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
