// spec: correctionevent-server-persistence
// spec: dfes-companion-2026-07-11 — tenant-scope prelude fix.
// spec: 2026-08-25-prod-cutover-waves — that prelude now runs through the shared
// RlsIdentityScope helper instead of hand-writing the tenant GUC.
using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http.HttpResults;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Corrections;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Api.Endpoints;

public static class CorrectionsEndpoints
{
    public static RouteGroupBuilder MapCorrectionsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/corrections", HandleRecordCorrectionAsync)
            .WithName("RecordCorrectionEvent")
            .RequireAuthorization();

        return group;
    }

    // spec: 2026-08-25-prod-cutover-waves — POST /shramsafal/corrections is on NEITHER of
    // TenantTransactionMiddleware's lists: not skip-listed, and carrying no farmId there
    // is nothing for EnsureIsFarmMember to claim against. So TenantContext arrives empty
    // and the handler's first DbCommand would fail-closed in TenantConnectionInterceptor
    // ("no tenant claim set and not in admin scope") — the 500 founder testing hit on
    // 2026-07-19. ssf.correction_events' policy p_user_correction_events keys entirely on
    // agrisync.user_id, so the whole write has to run with that GUC set.
    //
    // The scope is established by ICallerUserTenantScope, which now delegates the GUC to
    // the shared RlsIdentityScope helper rather than hand-writing set_config here. It is
    // a WRAPPER, not a prelude: the GUC is transaction-scoped, so whoever sets it has to
    // own the block it covers. See the port's docs for why the middleware's user-scoped
    // mode cannot serve this route (measured: its SET LOCAL prepend desyncs the INSERT).
    //
    // userId comes only from the validated JWT subject, never the body — the request
    // record has no userId field at all.
    private static async Task<IResult> HandleRecordCorrectionAsync(
        RecordCorrectionRequest request,
        ClaimsPrincipal user,
        IRecordCorrectionEventHandler handler,
        ICallerUserTenantScope scope,
        CancellationToken ct)
    {
        // Guid.Empty passes Guid.TryParse, so a token whose subject is the all-zeros GUID
        // reaches here as a "successful" parse. It is not an identity: it matches no row
        // and would be refused by the WITH CHECK anyway. Refuse it as unauthenticated,
        // BEFORE the scope opens — an unidentified caller must never reach the handler.
        if (!EndpointActorContext.TryGetUserId(user, out var userId) || userId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var command = new RecordCorrectionEventCommand(
            userId,
            request.OriginalParseId,
            request.OriginalParseRaw,
            request.CorrectedParse,
            request.PromptVersion,
            request.Locale ?? "mr-IN",
            request.Trigger,
            request.PromptContentHash);

        var result = await scope.RunForCallerAsync(
            userId,
            token => handler.HandleAsync(command, token),
            ct);

        return result.IsSuccess
            ? Results.Created($"/shramsafal/corrections/{result.Value}", result.Value)
            : Results.BadRequest(new { error = result.Error?.Code, description = result.Error?.Description });
    }
}

/// <summary>
/// Request body for POST /corrections.
/// </summary>
/// <remarks>
/// §P0.4 — <c>OriginalParseId</c> is nullable (absent = no known originating
/// AiJob, rather than a fabricated UUID) and <c>PromptContentHash</c> is now
/// accepted. The two draft payloads are redacted of verbatim speech inside
/// <see cref="CorrectionEvent.Record"/>, so a stale client that still sends a
/// transcript cannot get one persisted.
/// </remarks>
public sealed record RecordCorrectionRequest(
    Guid? OriginalParseId,
    string OriginalParseRaw,
    string CorrectedParse,
    string PromptVersion,
    string? Locale,
    CorrectionTrigger Trigger,
    string? PromptContentHash = null);
