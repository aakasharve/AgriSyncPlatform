using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Accounts.Api.Endpoints;

public static class SubscriptionWebhookEndpoints
{
    /// <summary>
    /// Config key that holds the HMAC-SHA256 signing secret supplied by
    /// the billing provider. No requests are accepted without it.
    /// </summary>
    public const string SigningSecretConfigKey = "Accounts:WebhookSigningSecret";

    /// <summary>
    /// Provider-agnostic webhook endpoint for subscription lifecycle events.
    ///
    /// Expected request shape:
    ///   Header:  X-Webhook-Signature  = hex(HMAC-SHA256(body, signingSecret))
    ///   Body (JSON):
    ///   {
    ///     "providerEventId": "evt_...",         // required — idempotency key
    ///     "eventType":       "subscription.activated",
    ///     "subscriptionId":  "...",             // optional
    ///     "validFromUtc":    "2026-05-01T...",  // for activated/renewed only
    ///     "validUntilUtc":   "2027-05-01T...",  // for activated/renewed only
    ///     "gracePeriodEndsAtUtc": "2026-06-01T...", // for past_due only
    ///     "billingProviderCustomerId": "cus_..." // optional
    ///   }
    ///
    /// Returns 200 on success (including duplicates — provider stops retrying).
    /// Returns 400 on missing required fields.
    /// Returns 401 on bad signature.
    /// </summary>
    public static IEndpointRouteBuilder MapSubscriptionWebhookEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/accounts/subscriptions/webhook", async (
            HttpContext httpContext,
            IConfiguration configuration,
            ApplyProviderEventHandler handler,
            ILogger<SubscriptionWebhookEndpointTag> logger,
            CancellationToken ct) =>
        {
            // 1. Read raw body for signature verification.
            httpContext.Request.EnableBuffering();
            using var bodyReader = new StreamReader(httpContext.Request.Body, Encoding.UTF8, leaveOpen: true);
            var rawBody = await bodyReader.ReadToEndAsync(ct);
            httpContext.Request.Body.Position = 0;

            // 2. Verify HMAC-SHA256 signature.
            var signingSecret = configuration[SigningSecretConfigKey];
            if (string.IsNullOrWhiteSpace(signingSecret))
            {
                logger.LogError("Webhook signing secret is not configured ({Key}). Rejecting request.", SigningSecretConfigKey);
                return Results.Problem(
                    detail: "Webhook not configured.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var incomingSig = httpContext.Request.Headers["X-Webhook-Signature"].FirstOrDefault();
            if (!IsValidSignature(rawBody, signingSecret, incomingSig))
            {
                logger.LogWarning("Webhook signature mismatch. RemoteIp={Ip}", httpContext.Connection.RemoteIpAddress);
                return Results.Unauthorized();
            }

            // 3. Parse payload.
            WebhookPayload? payload;
            try
            {
                payload = JsonSerializer.Deserialize<WebhookPayload>(rawBody, JsonOptions);
            }
            catch (JsonException ex)
            {
                logger.LogWarning(ex, "Webhook payload is malformed JSON.");
                return Results.BadRequest(new { error = "invalid_json", message = "Payload is not valid JSON." });
            }

            if (payload is null || string.IsNullOrWhiteSpace(payload.ProviderEventId) || string.IsNullOrWhiteSpace(payload.EventType))
            {
                return Results.BadRequest(new { error = "missing_fields", message = "providerEventId and eventType are required." });
            }

            // 4. Build command and dispatch.
            SubscriptionId? subId = null;
            if (payload.SubscriptionId.HasValue)
            {
                subId = new SubscriptionId(payload.SubscriptionId.Value);
            }

            var command = new ApplyProviderEventCommand(
                ProviderEventId: payload.ProviderEventId,
                EventType: payload.EventType,
                SubscriptionId: subId,
                ValidFromUtc: payload.ValidFromUtc,
                ValidUntilUtc: payload.ValidUntilUtc,
                GracePeriodEndsAtUtc: payload.GracePeriodEndsAtUtc,
                BillingProviderCustomerId: payload.BillingProviderCustomerId,
                RawPayload: rawBody);

            var result = await handler.HandleAsync(command, ct);
            if (result.IsFailure)
            {
                logger.LogError("ApplyProviderEventHandler failed: {Error}", result.Error);
                return Results.Problem(detail: result.Error.Description, statusCode: 500);
            }

            var outcome = result.Value!;
            if (outcome.WasDuplicate)
            {
                logger.LogInformation("Duplicate webhook event {EventId} — acknowledged.", payload.ProviderEventId);
            }
            else if (outcome.WasUnknownEventType)
            {
                logger.LogWarning("Unknown webhook event type {EventType} — stored but not applied.", payload.EventType);
            }

            return Results.Ok(new { received = true, duplicate = outcome.WasDuplicate });
        })
        .WithName("SubscriptionWebhook")
        .WithTags("Accounts")
        .AllowAnonymous(); // Authenticated via HMAC signature, not JWT

        return endpoints;
    }

    private static bool IsValidSignature(string rawBody, string secret, string? incomingHex)
    {
        if (string.IsNullOrEmpty(incomingHex))
        {
            return false;
        }

        var secretBytes = Encoding.UTF8.GetBytes(secret);
        var bodyBytes = Encoding.UTF8.GetBytes(rawBody);
        var expectedBytes = HMACSHA256.HashData(secretBytes, bodyBytes);
        var expectedHex = Convert.ToHexString(expectedBytes);

        // Constant-time comparison to prevent timing attacks.
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expectedHex.ToLowerInvariant()),
            Encoding.ASCII.GetBytes(incomingHex.ToLowerInvariant()));
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record WebhookPayload(
        string ProviderEventId,
        string EventType,
        Guid? SubscriptionId,
        DateTime? ValidFromUtc,
        DateTime? ValidUntilUtc,
        DateTime? GracePeriodEndsAtUtc,
        string? BillingProviderCustomerId);

    // Marker type for logger category — keeps ILogger<T> strongly typed without
    // exposing an internal endpoint class.
    private sealed class SubscriptionWebhookEndpointTag;
}
