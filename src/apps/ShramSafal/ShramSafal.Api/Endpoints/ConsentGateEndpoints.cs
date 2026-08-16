using System.Security.Claims;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — the first-open consent gate's write.
///
///   POST /shramsafal/consent-gate/accept → one tap, TWO append-only rows
///
/// <para><b>Anonymous by necessity.</b> Consent has to precede the first thing we take,
/// and the first thing we take is a phone number — so the gate runs before login and this
/// endpoint cannot require a token. It is the ONLY endpoint under /shramsafal that does
/// not, and the reason it is safe to leave open is that it can write nothing else: no
/// farm id is accepted, no user id is accepted from the body, and the only row it can
/// produce is one whose <c>user_id</c> is whatever the JWT says — NULL when there is no
/// JWT. There is no tenant here to cross.</para>
///
/// <para><b>Why it is admin-elevated.</b> <c>TenantConnectionInterceptor</c> fails closed
/// on the first DbCommand when no farm claim is present — correct behaviour that would
/// otherwise make a pre-login write impossible. The same treatment
/// <c>AiStreamingEndpoints</c> and <c>FirstFarmBootstrapEndpoints</c> already use. The
/// path is on <c>TenantTransactionMiddleware</c>'s skip list for the same reason, so this
/// handler owns its own commit. Elevation buys nothing here beyond passing the guard: the
/// insert is the only statement, and its shape is fixed by the handler.</para>
///
/// <para><b>A signed-in caller is still recorded as themselves.</b> If a token IS present
/// (re-accepting a new notice version from inside the app) the user id is taken from the
/// JWT subject and never from the request body — a body-supplied user id would let anyone
/// write a consent record in someone else's name.</para>
/// </summary>
public static class ConsentGateEndpoints
{
    public static RouteGroupBuilder MapConsentGateEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/consent-gate/accept", async (
            ConsentGateAcceptRequest request,
            ClaimsPrincipal user,
            RecordConsentGateAcceptanceHandler handler,
            TenantContext tenantContext,
            CancellationToken ct) =>
        {
            // Pre-login there is no farm claim at all; elevate so the interceptor's
            // fail-closed guard does not block the only write this endpoint can make.
            tenantContext.ElevateToAdminCrossTenant();

            // From the token when there is one, never from the body.
            Guid? userId = EndpointActorContext.TryGetUserId(user, out var actorUserId)
                ? actorUserId
                : null;

            var cmd = new RecordConsentGateAcceptanceCommand(
                UserId: userId,
                PreRegistrationSessionId: request.PreRegistrationSessionId,
                NoticeVersion: request.NoticeVersion,
                PrivacyPolicyVersion: request.PrivacyPolicyVersion,
                TermsVersion: request.TermsVersion,
                DisplayedLanguage: request.DisplayedLanguage,
                AcceptedPurposeCodes: request.AcceptedPurposeCodes ?? [],
                DataCategoryCodes: request.DataCategoryCodes ?? [],
                Source: request.Source,
                AppVersion: request.AppVersion,
                DisplayedNoticeText: request.DisplayedNoticeText,
                AgeDeclaredAdult: request.AgeDeclaredAdult);

            var result = await handler.HandleAsync(cmd, ct);
            return result.IsSuccess
                ? Results.Ok(new
                {
                    termsAcceptanceEventId = result.Value.TermsAcceptanceEventId,
                    consentGrantEventId = result.Value.ConsentGrantEventId,
                })
                : ToErrorResult(result.Error);
        })
        .AllowAnonymous()
        .WithName("RecordConsentGateAcceptance");

        return group;
    }

    /// <summary>
    /// No user id — it comes from the token or is null. The notice TEXT is sent, not its
    /// hash: the server hashes what it was told was displayed, because a digest the client
    /// both computes and asserts proves only that the client agrees with itself.
    /// </summary>
    public sealed record ConsentGateAcceptRequest(
        string PreRegistrationSessionId,
        string NoticeVersion,
        string PrivacyPolicyVersion,
        string TermsVersion,
        string DisplayedLanguage,
        IReadOnlyList<string>? AcceptedPurposeCodes,
        IReadOnlyList<string>? DataCategoryCodes,
        string Source,
        string AppVersion,
        string DisplayedNoticeText,
        bool AgeDeclaredAdult);

    private static IResult ToErrorResult(Error error) =>
        error.Code.Contains("Forbidden") ? Results.Forbid()
        : Results.BadRequest(error.Description);
}
