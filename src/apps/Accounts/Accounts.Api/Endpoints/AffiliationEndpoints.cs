using System.Security.Claims;
using Accounts.Application.Ports;
using Accounts.Application.UseCases.Affiliation.GenerateReferralCode;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Accounts.Api.Endpoints;

public static class AffiliationEndpoints
{
    public static IEndpointRouteBuilder MapAffiliationEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        // POST /accounts/affiliation/code
        // Idempotent — returns existing active code or creates one.
        // OwnerAccountId is resolved from the JWT caller; no path parameter
        // to avoid the trivial IDOR where any authenticated user could
        // request a code for any accountId.
        endpoints.MapPost("/accounts/affiliation/code", async (
            ClaimsPrincipal user,
            IOwnerAccountRepository ownerAccountRepo,
            GenerateReferralCodeHandler handler,
            CancellationToken ct) =>
        {
            if (!Guid.TryParse(user.FindFirstValue("sub"), out var callerUserId))
            {
                return Results.Unauthorized();
            }

            // Resolve the ownerAccountId from the JWT sub — not from a URL param
            // so a caller cannot request codes for someone else's account.
            var account = await ownerAccountRepo.GetByPrimaryOwnerUserIdAsync(
                new UserId(callerUserId), ct);
            if (account is null)
            {
                return Results.NotFound(new { error = "account_not_found", message = "No owner account for this user." });
            }

            var result = await handler.HandleAsync(account.Id, ct);
            return result.IsSuccess
                ? Results.Ok(new { code = result.Value!.Code })
                : Results.BadRequest(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("GenerateReferralCode")
        .WithTags("Accounts")
        .RequireAuthorization();

        return endpoints;
    }
}
