using System.Net.Http.Json;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using User.Application.Ports.External;

namespace User.Infrastructure.Otp;

/// <summary>
/// Real MSG91 v5 OTP gateway.
///
/// Endpoint: POST https://control.msg91.com/api/v5/otp
/// Headers:  authkey (bearer of our MSG91 API key), Content-Type: application/json
/// Body:     { template_id, mobile, otp, otp_length, otp_expiry }
/// Response: { type: "success" | "error", message, request_id? }
///
/// This class only handles the outbound call. Persisting the OTP hash,
/// tracking attempts, and rate-limiting live in the StartOtp / VerifyOtp
/// handlers so providers are interchangeable.
/// </summary>
internal sealed class Msg91SmsSender(
    HttpClient httpClient,
    IOptions<Msg91Options> options,
    ILogger<Msg91SmsSender> logger) : ISmsSender
{
    private const string ProviderName = "msg91";
    private readonly Msg91Options _options = options.Value;

    public async Task<Result<SmsDispatchReceipt>> SendOtpAsync(
        string phoneNumberInternational,
        string otpCode,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.AuthKey))
        {
            return Result.Failure<SmsDispatchReceipt>(
                new Error("msg91.missing_authkey", "MSG91 AuthKey is not configured."));
        }

        if (string.IsNullOrWhiteSpace(_options.TemplateId))
        {
            return Result.Failure<SmsDispatchReceipt>(
                new Error("msg91.missing_template", "MSG91 DLT TemplateId is not configured."));
        }

        var payload = new Msg91SendOtpPayload(
            TemplateId: _options.TemplateId,
            Mobile: phoneNumberInternational,
            Otp: otpCode,
            OtpLength: _options.OtpLength,
            OtpExpiry: _options.OtpExpiryMinutes,
            SenderId: _options.SenderId);

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/otp")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };
        request.Headers.Add("authkey", _options.AuthKey);

        try
        {
            using var response = await httpClient.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "MSG91 send-otp returned HTTP {Status} for phone ending ****{Tail}: {Body}",
                    (int)response.StatusCode,
                    SafeTail(phoneNumberInternational),
                    body);
                return Result.Failure<SmsDispatchReceipt>(
                    new Error("msg91.http_error", $"MSG91 returned HTTP {(int)response.StatusCode}."));
            }

            var parsed = TryParseResponse(body);
            if (parsed is null)
            {
                return Result.Failure<SmsDispatchReceipt>(
                    new Error("msg91.parse_error", "MSG91 returned an unparseable payload."));
            }

            if (!string.Equals(parsed.Type, "success", StringComparison.OrdinalIgnoreCase))
            {
                logger.LogWarning(
                    "MSG91 send-otp rejected phone ending ****{Tail}: {Message}",
                    SafeTail(phoneNumberInternational),
                    parsed.Message);
                return Result.Failure<SmsDispatchReceipt>(
                    new Error("msg91.provider_error", parsed.Message ?? "MSG91 returned an error."));
            }

            var requestId = parsed.RequestId ?? parsed.Message ?? Guid.NewGuid().ToString("N");
            return Result.Success(new SmsDispatchReceipt(requestId, ProviderName));
        }
        catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "MSG91 send-otp transport failure for phone ending ****{Tail}.",
                SafeTail(phoneNumberInternational));
            return Result.Failure<SmsDispatchReceipt>(
                new Error("msg91.transport_error", "Failed to reach MSG91."));
        }
    }

    private static Msg91Response? TryParseResponse(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
            var message = root.TryGetProperty("message", out var messageProp) ? messageProp.GetString() : null;
            var requestId = root.TryGetProperty("request_id", out var reqProp) ? reqProp.GetString() : null;
            return new Msg91Response(type, message, requestId);
        }
        catch
        {
            return null;
        }
    }

    private static string SafeTail(string phone) =>
        phone.Length <= 4 ? phone : phone[^4..];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private sealed record Msg91SendOtpPayload(
        string TemplateId,
        string Mobile,
        string Otp,
        int OtpLength,
        int OtpExpiry,
        string? SenderId);

    private sealed record Msg91Response(string? Type, string? Message, string? RequestId);
}
