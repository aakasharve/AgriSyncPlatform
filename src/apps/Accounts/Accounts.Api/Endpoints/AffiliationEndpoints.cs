using System.Security.Claims;
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
        // POST /accounts/{accountId}/affiliation/code
        // Idempotent — returns existing active code or creates one.
        // PrimaryOwner-only; supply the OwnerAccountId from /me context.
        endpoints.MapPost("/accounts/{accountId:guid}/affiliation/code", async (
            Guid accountId,
            ClaimsPrincipal user,
            GenerateReferralCodeHandler handler,
            CancellationToken ct) =>
        {
            // Verify caller is the account owner (JWT sub must match primary owner).
            var subClaim = user.FindFirstValue("sub");
            if (string.IsNullOrWhiteSpace(subClaim) || !Guid.TryParse(subClaim, out _))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new OwnerAccountId(accountId), ct);
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
