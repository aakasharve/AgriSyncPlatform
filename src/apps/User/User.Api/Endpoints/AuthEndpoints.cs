using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging;
using User.Application.Ports;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Users.GetCurrentUser;

namespace User.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/user/auth").WithTags("Auth");
        var publicGroup = group.MapGroup(string.Empty).RequireRateLimiting("auth");

        publicGroup.MapPost("/register", async (
            RegisterRequest request,
            HttpContext context,
            ILoggerFactory loggerFactory,
            RegisterUserHandler handler,
            CancellationToken ct) =>
        {
            if (!TryValidateRegisterRequest(request, out var validationErrors))
            {
                return Results.ValidationProblem(validationErrors);
            }

            var command = new RegisterUserCommand(
                request.Phone!,
                request.Password!,
                request.DisplayName!,
                request.AppId,
                request.Role);

            Result<User.Application.Contracts.Dtos.AuthResponse> result;
            try
            {
                result = await handler.HandleAsync(command, ct);
            }
            catch (ArgumentException ex)
            {
                return CreateValidationErrorResponse(context, loggerFactory, ex);
            }

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("RegisterUser")
        .AllowAnonymous();

        publicGroup.MapPost("/login", async (
            LoginRequest request,
            HttpContext context,
            ILoggerFactory loggerFactory,
            LoginHandler handler,
            CancellationToken ct) =>
        {
            try
            {
                var command = new LoginCommand(request.Phone, request.Password);
                var result = await handler.HandleAsync(command, ct);

                return result.IsSuccess
                    ? Results.Ok(result.Value)
                    : Results.Unauthorized();
            }
            catch (ArgumentException ex)
            {
                return CreateValidationErrorResponse(context, loggerFactory, ex);
            }
        })
        .WithName("LoginUser")
        .AllowAnonymous();

        publicGroup.MapPost("/refresh", async (
            RefreshRequest request,
            RefreshTokenHandler handler,
            CancellationToken ct) =>
        {
            var command = new RefreshTokenCommand(request.RefreshToken);
            var result = await handler.HandleAsync(command, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.Unauthorized();
        })
        .WithName("RefreshToken")
        .AllowAnonymous();

        group.MapPost("/logout", async (
            HttpContext context,
            IRefreshTokenRepository refreshTokenRepository,
            IClock clock,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(context.User, out var userId))
            {
                return Results.Unauthorized();
            }

            await refreshTokenRepository.RevokeAllForUserAsync(userId, clock.UtcNow, ct);
            await refreshTokenRepository.SaveChangesAsync(ct);

            return Results.Ok(new { message = "Logged out successfully" });
        })
        .WithName("LogoutUser")
        .RequireAuthorization();

        group.MapGet("/me", async (
            ClaimsPrincipal user,
            GetCurrentUserHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(userId, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.NotFound(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("GetCurrentUser")
        .RequireAuthorization();

        return endpoints;
    }

    private static IResult CreateValidationErrorResponse(HttpContext context, ILoggerFactory loggerFactory, ArgumentException ex)
    {
        loggerFactory
            .CreateLogger("User.Api.Endpoints.AuthEndpoints")
            .LogWarning(ex, "Auth validation error for endpoint {Endpoint}", context.Request.Path);

        return Results.BadRequest(new { error = "validation_error", message = "Invalid request" });
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
    {
        var subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(subject, out userId);
    }

    private static bool TryValidateRegisterRequest(RegisterRequest? request, out Dictionary<string, string[]> errors)
    {
        errors = [];

        if (request is null)
        {
            errors["body"] = ["Request body is required."];
            return false;
        }

        if (string.IsNullOrWhiteSpace(request.Phone))
        {
            errors["phone"] = ["Phone is required."];
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors["password"] = ["Password is required."];
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            errors["displayName"] = ["Display name is required."];
        }

        return errors.Count == 0;
    }
}

public sealed record RegisterRequest(
    string? Phone,
    string? Password,
    string? DisplayName,
    string? AppId = "shramsafal",
    string? Role = "PrimaryOwner");

public sealed record LoginRequest(string Phone, string Password);

public sealed record RefreshRequest(string RefreshToken);
