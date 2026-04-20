using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging;
using User.Application.Ports;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.StartOtp;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Application.UseCases.Users.GetMeContext;
using AgriSync.SharedKernel.Contracts.Ids;

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

        publicGroup.MapPost("/start-otp", async (
            StartOtpRequest request,
            StartOtpHandler handler,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.Phone))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["phone"] = ["Phone is required."],
                });
            }

            var result = await handler.HandleAsync(new StartOtpCommand(request.Phone), ct);

            if (result.IsFailure)
            {
                var statusCode = result.Error.Code.StartsWith("otp.rate_limited") ? 429 : 400;
                return Results.Json(
                    new { error = result.Error.Code, message = result.Error.Description },
                    statusCode: statusCode);
            }

            return Results.Ok(new
            {
                phoneNumberNormalized = result.Value!.PhoneNumberNormalized,
                expiresAtUtc = result.Value.ExpiresAtUtc,
                resendAfterSeconds = result.Value.ResendAfterSeconds,
                provider = result.Value.ProviderName,
            });
        })
        .WithName("StartOtp")
        .AllowAnonymous();

        publicGroup.MapPost("/verify-otp", async (
            VerifyOtpRequest request,
            VerifyOtpHandler handler,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request?.Phone) || string.IsNullOrWhiteSpace(request?.Otp))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["phone"] = string.IsNullOrWhiteSpace(request?.Phone) ? ["Phone is required."] : [],
                    ["otp"] = string.IsNullOrWhiteSpace(request?.Otp) ? ["OTP is required."] : [],
                });
            }

            var result = await handler.HandleAsync(
                new VerifyOtpCommand(request.Phone, request.Otp, request.DisplayName),
                ct);

            if (result.IsFailure)
            {
                var statusCode = result.Error.Code switch
                {
                    "otp.mismatch" => 401,
                    "otp.expired" => 410,
                    "otp.locked_out" => 429,
                    "otp.no_pending_challenge" => 404,
                    _ => 400,
                };
                return Results.Json(
                    new { error = result.Error.Code, message = result.Error.Description },
                    statusCode: statusCode);
            }

            return Results.Ok(new
            {
                userId = result.Value!.UserId,
                accessToken = result.Value.AccessToken,
                refreshToken = result.Value.RefreshToken,
                expiresAtUtc = result.Value.ExpiresAtUtc,
                createdNewUser = result.Value.CreatedNewUser,
            });
        })
        .WithName("VerifyOtp")
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

        group.MapGet("/me/context", async (
            ClaimsPrincipal user,
            GetMeContextHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new UserId(userId), ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.NotFound(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("GetMeContext")
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

public sealed record StartOtpRequest(string? Phone);

public sealed record VerifyOtpRequest(string? Phone, string? Otp, string? DisplayName);
