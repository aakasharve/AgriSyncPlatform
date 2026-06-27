using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using User.Application.Ports;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.Logout;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.Session;
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
            IHostEnvironment env,
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
                request.Role,
                BuildDeviceSession(context, request.RememberDevice, request.DeviceId, request.DeviceName, request.Platform));

            Result<User.Application.Contracts.Dtos.AuthResponse> result;
            try
            {
                result = await handler.HandleAsync(command, ct);
            }
            catch (ArgumentException ex)
            {
                return CreateValidationErrorResponse(context, loggerFactory, ex);
            }

            if (!result.IsSuccess)
            {
                return Results.BadRequest(new { error = result.Error.Code, message = result.Error.Description });
            }

            // TODO(security): consider X-CSRF-Token on state-changing auth routes — tracked follow-up
            context.Response.Cookies.Append(
                AuthCookieOptions.RefreshCookieName,
                result.Value.RefreshToken,
                AuthCookieOptions.Build(env, result.Value.ExpiresAtUtc, request.RememberDevice));

            return Results.Ok(new AuthResponseBody(result.Value.UserId, result.Value.AccessToken, result.Value.ExpiresAtUtc));
        })
        .WithName("RegisterUser")
        .AllowAnonymous();

        publicGroup.MapPost("/login", async (
            LoginRequest request,
            HttpContext context,
            ILoggerFactory loggerFactory,
            LoginHandler handler,
            IHostEnvironment env,
            CancellationToken ct) =>
        {
            try
            {
                var session = BuildDeviceSession(context, request.RememberDevice, request.DeviceId, request.DeviceName, request.Platform);
                var command = new LoginCommand(request.Phone, request.Password, session);
                var result = await handler.HandleAsync(command, ct);

                if (!result.IsSuccess)
                {
                    return Results.Unauthorized();
                }

                // TODO(security): consider X-CSRF-Token on state-changing auth routes — tracked follow-up
                context.Response.Cookies.Append(
                    AuthCookieOptions.RefreshCookieName,
                    result.Value.RefreshToken,
                    AuthCookieOptions.Build(env, result.Value.ExpiresAtUtc, request.RememberDevice));

                return Results.Ok(new AuthResponseBody(result.Value.UserId, result.Value.AccessToken, result.Value.ExpiresAtUtc));
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
            HttpContext context,
            VerifyOtpHandler handler,
            IHostEnvironment env,
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

            var session = BuildDeviceSession(context, request.RememberDevice, request.DeviceId, request.DeviceName, request.Platform);
            var result = await handler.HandleAsync(
                new VerifyOtpCommand(request.Phone, request.Otp, request.DisplayName, session),
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

            // TODO(security): consider X-CSRF-Token on state-changing auth routes — tracked follow-up
            context.Response.Cookies.Append(
                AuthCookieOptions.RefreshCookieName,
                result.Value!.RefreshToken,
                AuthCookieOptions.Build(env, result.Value.ExpiresAtUtc, request.RememberDevice));

            return Results.Ok(new
            {
                userId = result.Value.UserId,
                accessToken = result.Value.AccessToken,
                expiresAtUtc = result.Value.ExpiresAtUtc,
                createdNewUser = result.Value.CreatedNewUser,
            });
        })
        .WithName("VerifyOtp")
        .AllowAnonymous();

        publicGroup.MapPost("/refresh", async (
            RefreshRequest request,
            HttpContext context,
            RefreshTokenHandler handler,
            IHostEnvironment env,
            CancellationToken ct) =>
        {
            // Web: read refresh token from HttpOnly cookie.
            // Android/native: token comes in the request body when cookie absent.
            var cookieToken = context.Request.Cookies[AuthCookieOptions.RefreshCookieName];
            var resolvedToken = !string.IsNullOrWhiteSpace(cookieToken)
                ? cookieToken
                : (!string.IsNullOrWhiteSpace(request.RefreshToken) ? request.RefreshToken : null);

            if (resolvedToken is null)
            {
                return Results.Unauthorized();
            }

            var session = BuildDeviceSession(context, request.RememberDevice, request.DeviceId, request.DeviceName, request.Platform);
            var command = new RefreshTokenCommand(resolvedToken, session);
            var result = await handler.HandleAsync(command, ct);

            if (!result.IsSuccess)
            {
                // Clear stale cookie on failure so browsers don't retry with a bad token.
                context.Response.Cookies.Delete(AuthCookieOptions.RefreshCookieName, AuthCookieOptions.BuildForDelete(env));
                return Results.Unauthorized();
            }

            // TODO(security): consider X-CSRF-Token on state-changing auth routes — tracked follow-up
            context.Response.Cookies.Append(
                AuthCookieOptions.RefreshCookieName,
                result.Value.RefreshToken,
                AuthCookieOptions.Build(env, result.Value.ExpiresAtUtc, request.RememberDevice));

            return Results.Ok(new AuthResponseBody(result.Value.UserId, result.Value.AccessToken, result.Value.ExpiresAtUtc));
        })
        .WithName("RefreshToken")
        .AllowAnonymous();

        group.MapPost("/logout", async (
            HttpContext context,
            LogoutCurrentDeviceHandler logoutCurrentDeviceHandler,
            IHostEnvironment env,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(context.User, out var userId))
            {
                return Results.Unauthorized();
            }

            var refreshToken = context.Request.Cookies[AuthCookieOptions.RefreshCookieName];

            // Revoke only the current device session. Idempotent — unknown/null token is a safe no-op.
            await logoutCurrentDeviceHandler.HandleAsync(new LogoutCurrentDeviceCommand(userId, refreshToken), ct);

            // Always clear the cookie regardless of whether the token was found.
            context.Response.Cookies.Delete(AuthCookieOptions.RefreshCookieName, AuthCookieOptions.BuildForDelete(env));

            return Results.Ok(new { message = "Logged out successfully" });
        })
        .WithName("LogoutUser")
        .RequireAuthorization();

        group.MapPost("/logout-all", async (
            HttpContext context,
            RevokeAllDeviceSessionsHandler revokeAllHandler,
            IHostEnvironment env,
            CancellationToken ct) =>
        {
            if (!TryGetUserId(context.User, out var userId))
            {
                return Results.Unauthorized();
            }

            await revokeAllHandler.HandleAsync(new RevokeAllDeviceSessionsCommand(userId), ct);

            context.Response.Cookies.Delete(AuthCookieOptions.RefreshCookieName, AuthCookieOptions.BuildForDelete(env));

            return Results.Ok(new { message = "All sessions revoked" });
        })
        .WithName("LogoutAll")
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

    private static DeviceSessionRequest BuildDeviceSession(
        HttpContext context, bool rememberDevice, string? deviceId, string? deviceName, string? platform)
    {
        var resolvedDeviceId = !string.IsNullOrWhiteSpace(deviceId)
            ? deviceId!
            : (context.Request.Headers["X-Device-Id"].FirstOrDefault() ?? "unknown");
        return new DeviceSessionRequest(
            DeviceId: resolvedDeviceId,
            RememberDevice: rememberDevice,
            DeviceName: deviceName,
            Platform: string.IsNullOrWhiteSpace(platform) ? "unknown" : platform!);
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
    string? Role = "PrimaryOwner",
    bool RememberDevice = false,
    string? DeviceId = null,
    string? DeviceName = null,
    string? Platform = null);

public sealed record LoginRequest(
    string Phone, string Password,
    bool RememberDevice = false, string? DeviceId = null, string? DeviceName = null, string? Platform = null);

// rememberDevice must be sent explicitly by the client on refresh; default false avoids silent session->persistent escalation
public sealed record RefreshRequest(
    string? RefreshToken = null,            // web: omitted (cookie used); android: the Keystore token
    bool RememberDevice = false, string? DeviceId = null, string? DeviceName = null, string? Platform = null);

public sealed record StartOtpRequest(string? Phone);

public sealed record VerifyOtpRequest(
    string? Phone, string? Otp, string? DisplayName,
    bool RememberDevice = false, string? DeviceId = null, string? DeviceName = null, string? Platform = null);
