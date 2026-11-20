// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6)
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ShramSafal.Application.UseCases.Admin.ControlRoomDoor;
using ShramSafal.Domain.Identity;
using User.Api.Endpoints;
using User.Application.UseCases.Auth;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// Lock 1, the console door: the control room's own sign-in page talks only to these two routes.
/// <list type="bullet">
/// <item><c>POST /shramsafal/admin/sign-in/send-code</c> <c>{ phone }</c> → 200 <c>{ resendAfterSeconds, message }</c> for
/// EVERY valid number, approved or not (the calm sentence); 400 <c>{ error: "phone_invalid" }</c> for one that is not a
/// mobile number. Only an approved number's code is queued; the background sender texts it after the answer
/// (<see cref="ControlRoomCodeSender"/>). A refused number is written to History with its last four digits; no SMS, no
/// code and no User handler for it.</item>
/// <item><c>POST /shramsafal/admin/sign-in/check-code</c> <c>{ phone, otp, rememberDevice, deviceId, deviceName, platform }</c>
/// → the same web body as <c>/user/auth/verify-otp</c> and the refresh cookie; every refusal 401
/// <c>{ error: "code_not_accepted" }</c>. The session is stored under the reserved platform
/// (<see cref="ControlRoomSessionClaims.SessionPlatform"/>; the client's own platform value is not used), so it and every
/// refresh of it carry the door mark (H10). A refused number's pending farmer-app code is never touched.</item>
/// </list>
/// Both routes hold every answer until <see cref="ControlRoomDoor.AnswerFloor"/> has passed since the request began
/// (D10: on the injected <see cref="TimeProvider"/>), so the answers do not tell an approved number from another by time.
/// Lives in the host because it calls the User handlers, which ShramSafal may not reference (E2).
/// </summary>
public static class ControlRoomSignInEndpoints
{
    public const string SendCodeRoute = "/shramsafal/admin/sign-in/send-code";
    public const string CheckCodeRoute = "/shramsafal/admin/sign-in/check-code";

    /// <summary>D-155, verbatim: what every number sees after "Send me a code".</summary>
    public const string CalmSentence =
        "If this number is approved, a code is on its way. No code after a minute? Check the number, or ask Akash.";

    private const string LogCategory = "AgriSync.Bootstrapper.Endpoints.ControlRoomSignInEndpoints";
    private static readonly EventId BindFailed = new(4602, "ControlRoomBindFailed");
    private static readonly EventId RefusalNotRecorded = new(4603, "ControlRoomRefusalNotRecorded");

    public sealed record SendCodeRequest(string? Phone);

    /// <param name="Platform">Accepted for the console's convenience and ignored: a door session's platform is always the
    /// reserved one.</param>
    public sealed record CheckCodeRequest(
        string? Phone,
        string? Otp,
        bool RememberDevice = false,
        string? DeviceId = null,
        string? DeviceName = null,
        string? Platform = null);

    /// <param name="answerFloor">The hold on every answer; <see cref="ControlRoomDoor.AnswerFloor"/> unless a test names
    /// another.</param>
    public static IEndpointRouteBuilder MapControlRoomSignInEndpoints(this IEndpointRouteBuilder endpoints, TimeSpan? answerFloor = null)
    {
        var floor = answerFloor ?? ControlRoomDoor.AnswerFloor;

        endpoints.MapPost(SendCodeRoute, (
                HttpContext http,
                SendCodeRequest? request,
                [FromServices] ControlRoomDoor door,
                [FromServices] ControlRoomCodeQueue queue,
                [FromServices] TimeProvider time,
                IOptions<OtpPolicyOptions> policy,
                ILoggerFactory logs,
                CancellationToken ct) =>
                HoldTheFloorAsync(time, floor, () => SendCodeAsync(http, request, door, queue, time, policy.Value, logs, ct)))
            .WithName("ControlRoomSendCode")
            .WithTags("Admin")
            .AllowAnonymous()
            .RequireRateLimiting("auth");

        endpoints.MapPost(CheckCodeRoute, (
                HttpContext http,
                CheckCodeRequest? request,
                [FromServices] ControlRoomDoor door,
                [FromServices] VerifyOtpHandler verify,
                [FromServices] TimeProvider time,
                IHostEnvironment env,
                ILoggerFactory logs,
                CancellationToken ct) =>
                HoldTheFloorAsync(time, floor, () => CheckCodeAsync(http, request, door, verify, env, logs, ct)))
            .WithName("ControlRoomCheckCode")
            .WithTags("Admin")
            .AllowAnonymous()
            .RequireRateLimiting("auth");

        return endpoints;
    }

    private static async Task<IResult> SendCodeAsync(
        HttpContext http, SendCodeRequest? request, ControlRoomDoor door, ControlRoomCodeQueue queue, TimeProvider time,
        OtpPolicyOptions policy, ILoggerFactory logs, CancellationToken ct)
    {
        var decision = await door.DecideAsync(request?.Phone, ct);
        if (decision.Outcome == DoorOutcome.InvalidPhone)
        {
            return Results.Json(new { error = "phone_invalid" }, statusCode: StatusCodes.Status400BadRequest);
        }

        var (deviceId, ipHash) = http.AuditClaims();
        if (decision.Outcome == DoorOutcome.NotApproved)
        {
            await RecordRefusalAsync(door, decision, ControlRoomDoor.StepSend, deviceId, ipHash, logs, ct);
        }
        else
        {
            // AM2: never the SMS provider inside the request. The ten digits are queued, never the typed text.
            var code = new ControlRoomCodeRequest(
                decision.TenDigits!, IndianMobile.Tail(decision.PhoneE164!), deviceId, ipHash, time.GetUtcNow().UtcDateTime);
            if (!queue.TryEnqueue(code))
            {
                var reason = queue.IsClosed ? ControlRoomCodeSender.ReasonServerStopping : ControlRoomCodeSender.ReasonQueueFull;
                await ControlRoomCodeSender.RecordNotSentAsync(http.RequestServices, code, reason, logs.CreateLogger(LogCategory), ct);
            }
        }

        // The same answer for every valid number: approved, refused, rate-limited or not queued.
        return Results.Ok(new
        {
            resendAfterSeconds = (int)(policy.ShortWindow.TotalSeconds / Math.Max(1, policy.MaxShortWindowRequests)),
            message = CalmSentence,
        });
    }

    private static async Task<IResult> CheckCodeAsync(
        HttpContext http, CheckCodeRequest? request, ControlRoomDoor door, VerifyOtpHandler verify, IHostEnvironment env,
        ILoggerFactory logs, CancellationToken ct)
    {
        var decision = await door.DecideAsync(request?.Phone, ct);
        if (decision.Outcome == DoorOutcome.InvalidPhone)
        {
            return NotAccepted();
        }

        var (auditDeviceId, ipHash) = http.AuditClaims();
        if (decision.Outcome == DoorOutcome.NotApproved)
        {
            // No User handler runs: a farmer's pending code for this number is never touched.
            await RecordRefusalAsync(door, decision, ControlRoomDoor.StepCheck, auditDeviceId, ipHash, logs, ct);
            return NotAccepted();
        }

        var session = new DeviceSessionRequest(
            DeviceId: !string.IsNullOrWhiteSpace(request!.DeviceId)
                ? request.DeviceId!
                : (http.Request.Headers["X-Device-Id"].FirstOrDefault() ?? "unknown"),
            RememberDevice: request.RememberDevice,
            DeviceName: request.DeviceName,
            Platform: ControlRoomSessionClaims.SessionPlatform);
        var verified = await verify.HandleAsync(
            new VerifyOtpCommand(decision.TenDigits!, request.Otp ?? string.Empty, decision.Person?.DisplayName, session), ct);
        if (verified.IsFailure)
        {
            return NotAccepted();
        }

        var signedIn = verified.Value!;
        try
        {
            await door.RecordSignedInAsync(decision, signedIn.UserId, signedIn.DeviceCheckRequired, auditDeviceId, ipHash, ct);
        }
        catch (Exception ex)
        {
            // K26 (P1: the bind is a grant and commits with its History row). The tokens just minted are never handed out;
            // the stored refresh row is an orphan that expires on its own, and the person tries again.
            logs.CreateLogger(LogCategory).LogError(BindFailed,
                "ControlRoomBindFailed: the sign-in of the number ending {PhoneTail} was not recorded ({Failure}); no token and no cookie were handed out.",
                IndianMobile.Tail(decision.PhoneE164!), ex.GetType().Name);
            return Results.StatusCode(StatusCodes.Status500InternalServerError);
        }

        http.Response.Cookies.Append(
            AuthCookieOptions.RefreshCookieName,
            signedIn.RefreshToken,
            AuthCookieOptions.Build(env, signedIn.RefreshExpiresAtUtc, request.RememberDevice));

        // The web body of /user/auth/verify-otp, field for field (the console reads deviceCheckRequired exactly as there).
        return Results.Ok(new
        {
            userId = signedIn.UserId,
            accessToken = signedIn.AccessToken,
            expiresAtUtc = signedIn.ExpiresAtUtc,
            createdNewUser = signedIn.CreatedNewUser,
            deviceCheckRequired = signedIn.DeviceCheckRequired,
            accountName = signedIn.AccountName,
        });
    }

    /// <summary>
    /// A refused try is recorded; if History cannot take it, the log line is the record (tail only) and the answer stays
    /// the same, so a failing write can never make a refused number's answer differ from an approved one's.
    /// </summary>
    private static async Task RecordRefusalAsync(
        ControlRoomDoor door, DoorDecision decision, string step, string deviceId, string ipHash, ILoggerFactory logs, CancellationToken ct)
    {
        try
        {
            await door.RecordRefusedAsync(decision, step, deviceId, ipHash, ct);
        }
        catch (Exception ex)
        {
            logs.CreateLogger(LogCategory).LogError(RefusalNotRecorded,
                "ControlRoomRefusalNotRecorded: a {Step} try by the number ending {PhoneTail} was refused ({Reason}) and the history write failed ({Failure}). This log line is the only record.",
                step, IndianMobile.Tail(decision.PhoneE164!), decision.RefusalReason, ex.GetType().Name);
        }
    }

    private static IResult NotAccepted() =>
        Results.Json(new { error = "code_not_accepted" }, statusCode: StatusCodes.Status401Unauthorized);

    /// <summary>Runs the route, then holds its answer (whatever it is, a fault included) until the floor has passed.</summary>
    private static async Task<IResult> HoldTheFloorAsync(TimeProvider time, TimeSpan floor, Func<Task<IResult>> answer)
    {
        var startedAt = time.GetTimestamp();
        try
        {
            return await answer();
        }
        finally
        {
            // A loop, not one wait: a timer may fire a tick early, and the floor is measured on the same clock.
            TimeSpan remaining;
            while ((remaining = floor - time.GetElapsedTime(startedAt)) > TimeSpan.Zero)
            {
                await Task.Delay(remaining, time, CancellationToken.None);
            }
        }
    }
}
