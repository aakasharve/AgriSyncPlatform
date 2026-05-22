using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamStreamingSttClient(
    IOptions<SarvamOptions> optionsAccessor,
    ILogger<SarvamStreamingSttClient> logger)
{
    private const string ApiSubscriptionKeyHeader = "Api-Subscription-Key";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamStreamingSttResult> TranscribeAsync(
        Stream audioStream,
        string mimeType,
        CancellationToken ct = default)
    {
        if (!TryResolveAudioFormat(mimeType, _options.StreamingInputAudioCodec, out var encoding, out var error))
        {
            return SarvamStreamingSttResult.Failure(error);
        }

        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamStreamingSttResult.Failure("Sarvam API subscription key is not configured.");
        }

        try
        {
            var payload = await ReadPayloadAsync(audioStream, ct);
            if (payload.Length == 0)
            {
                return SarvamStreamingSttResult.Failure("Audio payload is empty.");
            }

            using var timeout = CreateTimeoutToken(ct, _options.StreamingTimeoutSeconds);
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader(ApiSubscriptionKeyHeader, _options.ApiSubscriptionKey);

            var connectUri = BuildStreamingUri(_options);
            await socket.ConnectAsync(connectUri, timeout.Token);

            var message = JsonSerializer.SerializeToUtf8Bytes(new
            {
                audio = new
                {
                    data = Convert.ToBase64String(payload),
                    sample_rate = _options.StreamingSampleRate,
                    encoding
                }
            }, JsonOptions);

            await socket.SendAsync(message, WebSocketMessageType.Text, true, timeout.Token);
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "audio sent", timeout.Token);

            var transcript = await ReceiveTranscriptAsync(socket, timeout.Token);
            if (string.IsNullOrWhiteSpace(transcript))
            {
                return SarvamStreamingSttResult.Failure("Sarvam streaming STT did not return a transcript.");
            }

            return SarvamStreamingSttResult.Success(transcript);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam streaming STT call failed.");
            return SarvamStreamingSttResult.Failure(ex.Message);
        }
    }

    internal static Uri BuildStreamingUri(SarvamOptions options)
    {
        var queryParams = new Dictionary<string, string>
        {
            ["language-code"] = options.StreamingSttLanguage,
            ["model"] = options.StreamingSttModel,
            ["mode"] = options.StreamingSttMode,
            ["sample_rate"] = options.StreamingSampleRate.ToString(CultureInfo.InvariantCulture),
            ["input_audio_codec"] = options.StreamingInputAudioCodec,
            ["high_vad_sensitivity"] = ToQueryBool(options.StreamingHighVadSensitivity),
            ["vad_signals"] = ToQueryBool(options.StreamingVadSignals),
            ["flush_signal"] = ToQueryBool(options.StreamingFlushSignal)
        };

        var builder = new UriBuilder(options.StreamingSttEndpoint);
        var existingQuery = builder.Query;
        var query = string.Join("&", queryParams
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value.Trim())}"));

        builder.Query = string.IsNullOrWhiteSpace(existingQuery)
            ? query
            : $"{existingQuery.TrimStart('?')}&{query}";

        return builder.Uri;
    }

    internal static IReadOnlyDictionary<string, string> BuildHeaders(SarvamOptions options)
    {
        return new Dictionary<string, string>
        {
            [ApiSubscriptionKeyHeader] = options.ApiSubscriptionKey
        };
    }

    internal static bool TryExtractTranscript(string responseBody, out string transcript)
    {
        transcript = string.Empty;

        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            var type = ReadString(root, "type");

            if (string.Equals(type, "speech_start", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(type, "speech_end", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (string.Equals(type, "data", StringComparison.OrdinalIgnoreCase) &&
                root.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object &&
                TryReadTranscript(data, out transcript))
            {
                return true;
            }

            if (string.Equals(type, "transcript", StringComparison.OrdinalIgnoreCase) &&
                TryReadTranscript(root, out transcript))
            {
                return true;
            }

            return string.IsNullOrWhiteSpace(type) && TryReadTranscript(root, out transcript);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static async Task<string?> ReceiveTranscriptAsync(ClientWebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[8192];

        while (socket.State is WebSocketState.Open or WebSocketState.CloseSent)
        {
            await using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return null;
                }

                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
            {
                continue;
            }

            var responseBody = Encoding.UTF8.GetString(message.ToArray());
            if (TryExtractTranscript(responseBody, out var transcript))
            {
                return transcript;
            }
        }

        return null;
    }

    private static bool TryReadTranscript(JsonElement root, out string transcript)
    {
        transcript = ReadString(root, "transcript") ?? ReadString(root, "text") ?? string.Empty;
        transcript = transcript.Trim();
        return transcript.Length > 0;
    }

    private static string? ReadString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var node) && node.ValueKind == JsonValueKind.String
            ? node.GetString()
            : null;
    }

    private static bool TryResolveAudioFormat(
        string mimeType,
        string configuredEncoding,
        out string encoding,
        out string error)
    {
        encoding = string.Empty;
        error = string.Empty;

        var normalizedMimeType = NormalizeMimeType(mimeType);
        if (normalizedMimeType is "audio/wav" or "audio/x-wav" or "audio/wave" or "audio/vnd.wave")
        {
            encoding = "wav";
            return true;
        }

        if (normalizedMimeType is "audio/pcm" or "audio/raw" or "application/octet-stream")
        {
            encoding = string.IsNullOrWhiteSpace(configuredEncoding) ? "pcm" : configuredEncoding.Trim();
            return true;
        }

        error = $"Unsupported audio MIME type '{normalizedMimeType}'. Sarvam streaming STT currently accepts WAV or raw PCM only; webm must be converted before calling this backend client.";
        return false;
    }

    private static string NormalizeMimeType(string mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return string.Empty;
        }

        var normalized = mimeType.Trim().ToLowerInvariant();
        var semicolonIndex = normalized.IndexOf(';', StringComparison.Ordinal);
        return semicolonIndex > 0 ? normalized[..semicolonIndex] : normalized;
    }

    private static string ToQueryBool(bool value) => value ? "true" : "false";

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 30 : timeoutSeconds;
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

internal sealed record SarvamStreamingSttResult(bool IsSuccess, string? Transcript, string? Error)
{
    public static SarvamStreamingSttResult Success(string transcript) => new(true, transcript, null);

    public static SarvamStreamingSttResult Failure(string error) => new(false, null, error);
}
