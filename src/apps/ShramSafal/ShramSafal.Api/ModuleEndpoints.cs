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
        // DATA_PRINCIPLE_SPINE 06.2 — consent state surface.
        // Mounts under /shramsafal/consent/* (same convention as security).
        group.MapConsentEndpoints();
        // DATA_PRINCIPLE_SPINE 08.2 / 08.3 — DPDP §11 / §12 self-serve
        // data rights (export + erasure). Mounts under /shramsafal/me/*.
        group.MapDataRightsEndpoints();
        // DATA_PRINCIPLE_SPINE 08.5 — DPDP §8(6) admin breach-report
        // endpoint (scaffolding only — see BreachEndpoints + OQ-5
        // verdict). Mounts under /shramsafal/admin/breach/*.
        group.MapBreachEndpoints();
        // DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — admin PII
        // review queue. Mounts under /shramsafal/admin/pii-review/*
        // and is gated by the "pii_reviewer" policy (allow-list from
        // PiiOptions).
        group.MapPiiReviewEndpoints();
        endpoints.MapSyncEndpoints();

        return endpoints;
    }
}
