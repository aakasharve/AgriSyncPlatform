using System.Security.Claims;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;
using ShramSafal.Application.UseCases.Consent.RecordConsentGateAcceptance;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-4.2) — the first-open consent gate's write.
///
///   POST /shramsafal/consent-gate/accept → one tap, TWO append-only rows  (ANONYMOUS)
///   POST /shramsafal/consent-gate/link   → the account behind it, TWO more (AUTHENTICATED)
///
/// <para>The two routes have deliberately opposite auth postures. <c>/accept</c> must be
/// anonymous because consent precedes the account, and the row it writes claims nothing
/// about who wrote it. <c>/link</c> asserts "that acceptance was mine", so it requires a
/// token and reads the user id from the JWT subject. See the comment above the route.</para>
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

        // spec: 2026-08-25-prod-cutover-waves (B1) — the acceptance gets its owner.
        //
        //   POST /shramsafal/consent-gate/link → one linking row in EACH ledger
        //
        // AUTHENTICATED, unlike /accept above, and the difference is the whole point: this
        // call ASSERTS AN IDENTITY. /accept is anonymous because consent must precede the
        // account and the row it writes claims nothing about who wrote it. This one claims
        // "that acceptance was mine", so it inherits the group's RequireAuthorization and
        // takes the user id from the validated JWT subject — never from the body, which
        // would let anyone attach someone else's consent to their own account.
        //
        // NOT elevated to admin cross-tenant, again unlike /accept. It must run
        // USER-SCOPED so TenantConnectionInterceptor emits
        // `SET LOCAL agrisync.user_id`, because the ledgers' RLS WITH CHECK reads
        // `user_id IS NULL OR user_id = <GUC>` — a row naming a user, written with the GUC
        // unset, is refused by Postgres with 42501. TenantTransactionMiddleware routes this
        // exact path into user-scoped mode inside a transaction (same branch shape as
        // /sync/pull) and owns the commit, so this handler does not.
        //
        // That is also the strongest guarantee here: even if this endpoint were wrong about
        // who the caller is, the database refuses a linking row written in another user's
        // name. Proved on real Postgres in ConsentGateLedgerRlsTests PROOF 4.
        group.MapPost("/consent-gate/link", async (
            ConsentGateLinkRequest request,
            ClaimsPrincipal user,
            LinkConsentGateToUserHandler handler,
            CancellationToken ct) =>
        {
            // From the token, always. The group requires authorization, so a missing or
            // unparseable subject here is a malformed token, not an anonymous caller.
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var cmd = new LinkConsentGateToUserCommand(
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
                DisplayedNoticeText: request.DisplayedNoticeText);

            var result = await handler.HandleAsync(cmd, ct);
            return result.IsSuccess
                ? Results.Ok(new
                {
                    termsAcceptanceEventId = result.Value.TermsAcceptanceEventId,
                    consentGrantEventId = result.Value.ConsentGrantEventId,
                    // Distinguishes "we wrote it" from "it was already there". A retry is a
                    // 200 either way — that is what lets the client keep retrying until it
                    // succeeds without ever blocking the farmer (doctrine P9).
                    alreadyLinked = result.Value.AlreadyLinked,
                })
                : ToErrorResult(result.Error);
        })
        .WithName("LinkConsentGateToUser");

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

    /// <summary>
    /// spec: 2026-08-25-prod-cutover-waves (B1). No user id — it comes from the token, and
    /// a body-supplied one would let any signed-in caller claim another farmer's
    /// acceptance. No acceptance timestamp either: the link is stamped with the server's
    /// clock at link time, and the acceptance moment stays on the row that recorded it.
    ///
    /// <para>The notice TEXT is re-sent rather than a row id, because the orphaned
    /// accepting row cannot be read back by any role — a pointer would name something
    /// nothing can dereference. The server re-hashes what it is told was displayed, with
    /// the same function the accepting write used, so the two rows describe the same words
    /// with the same digest.</para>
    /// </summary>
    public sealed record ConsentGateLinkRequest(
        string PreRegistrationSessionId,
        string NoticeVersion,
        string PrivacyPolicyVersion,
        string TermsVersion,
        string DisplayedLanguage,
        IReadOnlyList<string>? AcceptedPurposeCodes,
        IReadOnlyList<string>? DataCategoryCodes,
        string Source,
        string AppVersion,
        string DisplayedNoticeText);

    private static IResult ToErrorResult(Error error) =>
        error.Code.Contains("Forbidden") ? Results.Forbid()
        : Results.BadRequest(error.Description);
}
