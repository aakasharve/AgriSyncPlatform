using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamSttClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamSttClient> logger)
{
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamSttResult> TranscribeAsync(
        Stream audioStream,
        string mimeType,
        string? languageHint,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamSttResult.Failure("Sarvam API subscription key is not configured.");
        }

        try
        {
            var payload = await ReadPayloadAsync(audioStream, ct);
            if (payload.Length == 0)
            {
                return SarvamSttResult.Failure("Audio payload is empty.");
            }

            using var timeout = CreateTimeoutToken(ct, _options.TimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            using var multipart = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(payload);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(
                string.IsNullOrWhiteSpace(mimeType) ? "audio/webm" : mimeType.Trim());

            multipart.Add(fileContent, "file", "audio.webm");
            multipart.Add(new StringContent(_options.SttModel), "model");
            multipart.Add(new StringContent(string.IsNullOrWhiteSpace(languageHint) ? _options.SttLanguage : languageHint.Trim()), "language_code");
            multipart.Add(new StringContent(_options.SttMode), "mode");

            using var request = new HttpRequestMessage(HttpMethod.Post, _options.SttEndpoint)
            {
                Content = multipart
            };
            request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

            using var response = await client.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                var providerError = TryExtractProviderError(body) ??
                                    $"Sarvam STT call failed with status {(int)response.StatusCode}.";
                return SarvamSttResult.Failure(providerError);
            }

            if (!TryExtractTranscript(body, out var transcript, out var languageCode) ||
                string.IsNullOrWhiteSpace(transcript))
            {
                return SarvamSttResult.Failure("Sarvam STT did not return a transcript.");
            }

            return SarvamSttResult.Success(transcript, languageCode);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam STT call failed.");
            return SarvamSttResult.Failure(ex.Message);
        }
    }

    private static bool TryExtractTranscript(
        string responseBody,
        out string transcript,
        out string? languageCode)
    {
        transcript = string.Empty;
        languageCode = null;

        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;

            if (root.TryGetProperty("language_code", out var languageNode) &&
                languageNode.ValueKind == JsonValueKind.String)
            {
                languageCode = languageNode.GetString();
            }

            if (TryReadString(root, "transcript", out transcript) ||
                TryReadString(root, "text", out transcript))
            {
                return true;
            }

            if (root.TryGetProperty("results", out var results) &&
                results.ValueKind == JsonValueKind.Array)
            {
                foreach (var result in results.EnumerateArray())
                {
                    if (TryReadString(result, "transcript", out transcript) ||
                        TryReadString(result, "text", out transcript))
                    {
                        return true;
                    }
                }
            }
        }
        catch (JsonException)
        {
            return false;
        }

        return false;
    }

    private static bool TryReadString(JsonElement root, string propertyName, out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(propertyName, out var node) || node.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var extracted = node.GetString();
        if (string.IsNullOrWhiteSpace(extracted))
        {
            return false;
        }

        value = extracted.Trim();
        return true;
    }

    private static string? TryExtractProviderError(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;

            if (root.TryGetProperty("error", out var errorNode))
            {
                if (errorNode.ValueKind == JsonValueKind.String)
                {
                    return errorNode.GetString();
                }

                if (errorNode.ValueKind == JsonValueKind.Object &&
                    errorNode.TryGetProperty("message", out var messageNode) &&
                    messageNode.ValueKind == JsonValueKind.String)
                {
                    return messageNode.GetString();
                }
            }

            if (root.TryGetProperty("message", out var rootMessage) &&
                rootMessage.ValueKind == JsonValueKind.String)
            {
                return rootMessage.GetString();
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 45 : timeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeout));
        return linked;
    }

    private static async Task<byte[]> ReadPayloadAsync(Stream stream, CancellationToken ct)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        await using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return memory.ToArray();
    }
}

internal sealed record SarvamSttResult(bool IsSuccess, string? Transcript, string? LanguageCode, string? Error)
{
    public static SarvamSttResult Success(string transcript, string? languageCode) =>
        new(true, transcript, languageCode, null);

    public static SarvamSttResult Failure(string error) =>
        new(false, null, null, error);
}
