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
        group.MapAiStreamingEndpoints();
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
        group.MapJobCardEndpoints();
        group.MapWorkerProfileEndpoints();
        group.MapCorrectionsEndpoints();
        // DATA_PRINCIPLE_SPINE 05.2 — KMS-backed per-tenant DEK endpoints.
        // Mounts under /shramsafal/security/* (same convention sub-phase 05.1
        // used) rather than the plan body's bare /api/security/* so the
        // tenant-context middleware stack covers both routes.
        group.MapSecurityEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
