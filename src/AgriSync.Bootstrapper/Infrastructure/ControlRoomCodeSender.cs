// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, AM2)
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomDoor;
using User.Application.UseCases.Auth.StartOtp;
using User.Domain.Security;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// Sends the console door's queued codes after the door has answered (AM2: <c>StartOtpHandler</c> calls the SMS provider
/// inside its call, which would make an approved number's answer slower than a refused one's). Each code runs in a new
/// scope whose <see cref="TenantContext"/> is elevated first, as the admin skip-list elevates a request (a background
/// scope has no request, and the tenant interceptor would otherwise refuse the code and the History write).
/// <para>
/// A failed send never lands nowhere: a refusal (<c>otp.rate_limited*</c>, a provider code) or an exception becomes one
/// <c>code_not_sent</c> History row (<c>{ phoneTail, reason }</c>, the reason an error code or an exception's type name)
/// and one <c>ControlRoomCodeNotSent</c> error log with the same tail and reason. If the History write fails too, that log
/// line is the record and says so. On shutdown the queue is closed and what is still in it is written as
/// <c>server_stopping</c>. Disclosed limit: a hard crash (the process killed with no shutdown) loses what is still in the
/// in-memory queue with no row; the person sees no code, the screen already tells them to try again or ask Akash, and the
/// code table shows no code was issued.
/// </para>
/// <para>
/// Fix wave S-A1 (D-159): every code is issued as a control-room code (<see cref="OtpPurpose.ControlRoomDoor"/>), under the
/// door's own limits, and the farmer routes never see it. Fix wave S-A6: a refused send queued by the door is written here
/// as its <c>door_refused</c> row (after the answer, like an approved send's work); at shutdown it is still written.
/// </para>
/// No number, whole or hashed, is ever logged or written: the last four digits only.
/// </summary>
public sealed class ControlRoomCodeSender(
    ControlRoomCodeQueue queue,
    IServiceScopeFactory scopes,
    ILogger<ControlRoomCodeSender> logger) : BackgroundService
{
    public const string ReasonQueueFull = "queue_full";
    public const string ReasonServerStopping = "server_stopping";

    private static readonly EventId NotSent = new(4601, "ControlRoomCodeNotSent");
    private static readonly EventId RefusalNotRecorded = new(4603, "ControlRoomRefusalNotRecorded");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (await queue.Reader.WaitToReadAsync(stoppingToken))
            {
                while (!stoppingToken.IsCancellationRequested && queue.Reader.TryRead(out var request))
                {
                    // A send that has begun is finished even while the server stops (the provider has its own timeout and
                    // the host its shutdown wait); what is still queued is written as server_stopping by StopAsync.
                    try
                    {
                        await SendOneAsync(request, CancellationToken.None);
                    }
                    catch (Exception ex)
                    {
                        // SendOneAsync writes every failure it can see; this is only for a fault outside it (a scope that
                        // will not open or close). One bad code must never stop the sender, or the host with it.
                        logger.LogError(NotSent,
                            "ControlRoomCodeNotSent: the control-room code for the number ending {PhoneTail} hit a fault outside the send ({Failure}). This log line is the only record.",
                            request.PhoneTail, ex.GetType().Name);
                    }
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Stopping: StopAsync writes what is left.
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);

        // New codes are refused from here on (the door writes them as server_stopping); what is queued is written now.
        queue.Close();
        var drained = 0;
        while (queue.Reader.TryRead(out var request))
        {
            await using var scope = scopes.CreateAsyncScope();
            if (request.Refusal is { } refusal)
            {
                // A refused try is still recorded as refused: nothing was going to be sent for it.
                await RecordRefusedAsync(scope.ServiceProvider, request, refusal, logger, CancellationToken.None);
                continue;
            }

            drained++;
            await RecordNotSentAsync(scope.ServiceProvider, request, ReasonServerStopping, logger, CancellationToken.None);
        }

        if (drained > 0)
        {
            logger.LogWarning("ControlRoomCodeQueueDrained: {Count} queued control-room code(s) were not sent because the server stopped.", drained);
        }
    }

    /// <summary>
    /// Sends one queued code; a refusal or an exception is written as <c>code_not_sent</c> in the same scope. A queued
    /// refused send (<see cref="ControlRoomCodeRequest.Refusal"/>) is written as its <c>door_refused</c> row instead.
    /// </summary>
    public async Task SendOneAsync(ControlRoomCodeRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        await using var scope = scopes.CreateAsyncScope();
        var services = scope.ServiceProvider;

        if (request.Refusal is { } refusal)
        {
            await RecordRefusedAsync(services, request, refusal, logger, ct);
            return;
        }

        string reason;
        try
        {
            services.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            var result = await services.GetRequiredService<StartOtpHandler>()
                .HandleAsync(new StartOtpCommand(request.TenDigits, OtpPurpose.ControlRoomDoor), ct);
            if (result.IsSuccess)
            {
                return;
            }

            reason = result.Error.Code;
        }
        catch (Exception ex)
        {
            // The type name only: an exception's message can quote the number.
            reason = ex.GetType().Name;
        }

        await RecordNotSentAsync(services, request, reason, logger, ct);
    }

    /// <summary>
    /// One <c>door_refused</c> row for a refused send, in the given scope (S-A6). Never throws: when History cannot take the
    /// row, the log line (tail and reason only) is the record and says so.
    /// </summary>
    public static async Task RecordRefusedAsync(
        IServiceProvider services, ControlRoomCodeRequest request, ControlRoomRefusal refusal, ILogger logger, CancellationToken ct)
    {
        try
        {
            var tenant = services.GetRequiredService<TenantContext>();
            if (!tenant.IsAdminCrossTenant)
            {
                tenant.ElevateToAdminCrossTenant();
            }

            await services.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
                ControlRoomDoor.RefusedEntry(refusal.SubjectId, refusal.Step, request.PhoneTail, refusal.Reason, request.DeviceId, request.IpHash),
                ct);
        }
        catch (Exception historyFailure)
        {
            logger.LogError(RefusalNotRecorded,
                "ControlRoomRefusalNotRecorded: a {Step} try by the number ending {PhoneTail} was refused ({Reason}) and the history write failed ({Failure}). This log line is the only record.",
                refusal.Step, request.PhoneTail, refusal.Reason, historyFailure.GetType().Name);
        }
    }

    /// <summary>
    /// One <c>code_not_sent</c> row and one <c>ControlRoomCodeNotSent</c> error log (tail and reason only), in the given scope.
    /// Never throws: when History cannot take the row, the log line says so and is the record. Also used by the door for a
    /// code the queue did not take (<see cref="ReasonQueueFull"/>, <see cref="ReasonServerStopping"/>).
    /// </summary>
    public static async Task RecordNotSentAsync(
        IServiceProvider services, ControlRoomCodeRequest request, string reason, ILogger logger, CancellationToken ct)
    {
        try
        {
            var tenant = services.GetRequiredService<TenantContext>();
            if (!tenant.IsAdminCrossTenant)
            {
                tenant.ElevateToAdminCrossTenant();
            }

            // K10: the approved person the code was for; the founder (no person row) and anyone removed since are the door.
            var person = await services.GetRequiredService<IControlRoomStore>().FindActiveByPhoneAsync("+91" + request.TenDigits, ct);
            await services.GetRequiredService<IControlRoomHistory>().RecordNowAsync(
                ControlRoomDoor.CodeNotSent(person?.Id ?? SystemActor.ControlRoomDoor, request.PhoneTail, reason, request.DeviceId, request.IpHash),
                ct);

            logger.LogError(NotSent,
                "ControlRoomCodeNotSent: the control-room code for the number ending {PhoneTail} could not be sent ({Reason}). Written to History as code_not_sent.",
                request.PhoneTail, reason);
        }
        catch (Exception historyFailure)
        {
            logger.LogError(NotSent,
                "ControlRoomCodeNotSent: the control-room code for the number ending {PhoneTail} could not be sent ({Reason}), and the history write failed too ({HistoryFailure}). This log line is the only record.",
                request.PhoneTail, reason, historyFailure.GetType().Name);
        }
    }
}
