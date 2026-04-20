using System.IO.Compression;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// Sarvam Document Intelligence client — 7-step async pipeline.
/// Designed for background use only. Never call from the HTTP request path.
/// Steps: create job → upload ZIP → start → poll → download → unzip → extract markdown.
/// </summary>
internal sealed class SarvamDocIntelClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamDocIntelClient> logger)
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamDocIntelResult> ProcessAsync(
        Stream imageStream,
        string mimeType,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamDocIntelResult.Failure("Sarvam API subscription key is not configured.");
        }

        if (string.IsNullOrWhiteSpace(_options.DocIntelEndpoint))
        {
            return SarvamDocIntelResult.Failure("Sarvam Doc Intelligence endpoint is not configured.");
        }

        try
        {
            using var timeout = CreateTimeoutToken(ct, _options.DocIntelTimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamDocIntel");

            // Step 1: Create job and get presigned upload URL
            var (jobId, uploadUrl) = await CreateJobAsync(client, timeout.Token);
            if (string.IsNullOrWhiteSpace(jobId) || string.IsNullOrWhiteSpace(uploadUrl))
            {
                return SarvamDocIntelResult.Failure("Failed to create Doc Intelligence job.");
            }

            logger.LogDebug("Sarvam DocIntel job created: {JobId}", jobId);

            // Step 2: Package image into ZIP archive
            var zipBytes = await PackageAsZipAsync(imageStream, mimeType, ct);

            // Step 3: Upload ZIP to presigned URL
            var uploaded = await UploadZipAsync(client, uploadUrl, zipBytes, timeout.Token);
            if (!uploaded)
            {
                return SarvamDocIntelResult.Failure("Failed to upload document to Doc Intelligence.");
            }

            // Step 4: Start/trigger job processing
            var started = await StartJobAsync(client, jobId, timeout.Token);
            if (!started)
            {
                return SarvamDocIntelResult.Failure("Failed to start Doc Intelligence job.");
            }

            logger.LogDebug("Sarvam DocIntel job started: {JobId}", jobId);

            // Step 5: Poll until complete or timeout
            var downloadUrl = await PollUntilCompleteAsync(client, jobId, timeout.Token);
            if (string.IsNullOrWhiteSpace(downloadUrl))
            {
                return SarvamDocIntelResult.Failure("Doc Intelligence job did not complete within timeout.");
            }

            logger.LogDebug("Sarvam DocIntel job completed: {JobId}", jobId);

            // Step 6: Download result ZIP
            var resultZipBytes = await DownloadResultAsync(client, downloadUrl, timeout.Token);
            if (resultZipBytes is null)
            {
                return SarvamDocIntelResult.Failure("Failed to download Doc Intelligence result.");
            }

            // Step 7: Extract markdown from result ZIP
            var markdown = ExtractMarkdownFromZip(resultZipBytes);
            if (string.IsNullOrWhiteSpace(markdown))
            {
                return SarvamDocIntelResult.Failure("Doc Intelligence result contained no extractable text.");
            }

            return SarvamDocIntelResult.Success(markdown);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return SarvamDocIntelResult.Failure("Doc Intelligence processing timed out.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam DocIntel pipeline failed.");
            return SarvamDocIntelResult.Failure(ex.Message);
        }
    }

    private async Task<(string? JobId, string? UploadUrl)> CreateJobAsync(HttpClient client, CancellationToken ct)
    {
        var requestBody = new { filename = "document.zip", pages = 1 };
        using var request = new HttpRequestMessage(HttpMethod.Post, _options.DocIntelEndpoint)
        {
            Content = JsonContent.Create(requestBody)
        };
        request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("DocIntel create job failed with status {Status}.", (int)response.StatusCode);
            return (null, null);
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            var jobId = TryReadString(root, "job_id") ?? TryReadString(root, "jobId") ?? TryReadString(root, "id");
            var uploadUrl = TryReadString(root, "upload_url") ?? TryReadString(root, "uploadUrl");
            return (jobId, uploadUrl);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Failed to parse DocIntel create response.");
            return (null, null);
        }
    }

    private static async Task<byte[]> PackageAsZipAsync(Stream imageStream, string mimeType, CancellationToken ct)
    {
        if (imageStream.CanSeek)
        {
            imageStream.Position = 0;
        }

        var extension = mimeType.ToLowerInvariant() switch
        {
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/heic" or "image/heif" => ".heic",
            _ => ".jpg"
        };

        await using var zipStream = new MemoryStream();
        using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry($"page_1{extension}", CompressionLevel.NoCompression);
            await using var entryStream = entry.Open();
            await imageStream.CopyToAsync(entryStream, ct);
        }

        return zipStream.ToArray();
    }

    private static async Task<bool> UploadZipAsync(HttpClient client, string uploadUrl, byte[] zipBytes, CancellationToken ct)
    {
        using var content = new ByteArrayContent(zipBytes);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/zip");

        using var response = await client.PutAsync(uploadUrl, content, ct);
        return response.IsSuccessStatusCode;
    }

    private async Task<bool> StartJobAsync(HttpClient client, string jobId, CancellationToken ct)
    {
        var startUrl = $"{_options.DocIntelEndpoint}/{jobId}/start";
        using var request = new HttpRequestMessage(HttpMethod.Post, startUrl);
        request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

        using var response = await client.SendAsync(request, ct);
        return response.IsSuccessStatusCode;
    }

    private async Task<string?> PollUntilCompleteAsync(HttpClient client, string jobId, CancellationToken ct)
    {
        var statusUrl = $"{_options.DocIntelEndpoint}/{jobId}";

        while (!ct.IsCancellationRequested)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, statusUrl);
            request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var body = await response.Content.ReadAsStringAsync(ct);
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                var status = TryReadString(root, "status") ?? string.Empty;

                if (string.Equals(status, "COMPLETED", StringComparison.OrdinalIgnoreCase))
                {
                    return TryReadString(root, "download_url") ?? TryReadString(root, "downloadUrl");
                }

                if (string.Equals(status, "FAILED", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(status, "ERROR", StringComparison.OrdinalIgnoreCase))
                {
                    logger.LogWarning("DocIntel job {JobId} failed with status: {Status}", jobId, status);
                    return null;
                }
            }
            catch (JsonException)
            {
                return null;
            }

            await Task.Delay(PollInterval, ct);
        }

        return null;
    }

    private static async Task<byte[]?> DownloadResultAsync(HttpClient client, string downloadUrl, CancellationToken ct)
    {
        using var response = await client.GetAsync(downloadUrl, ct);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        return await response.Content.ReadAsByteArrayAsync(ct);
    }

    private static string? ExtractMarkdownFromZip(byte[] zipBytes)
    {
        try
        {
            using var zipStream = new MemoryStream(zipBytes);
            using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

            // Find first markdown file, or any text file
            var markdownEntry = archive.Entries
                .FirstOrDefault(e => e.Name.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
                ?? archive.Entries.FirstOrDefault(e => e.Name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
                ?? archive.Entries.FirstOrDefault();

            if (markdownEntry is null)
            {
                return null;
            }

            using var entryStream = markdownEntry.Open();
            using var reader = new StreamReader(entryStream);
            return reader.ReadToEnd().Trim();
        }
        catch
        {
            return null;
        }
    }

    private static string? TryReadString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var node) &&
               node.ValueKind == JsonValueKind.String
            ? node.GetString()
            : null;
    }

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 120 : timeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeout));
        return linked;
    }
}

internal sealed record SarvamDocIntelResult(bool IsSuccess, string? ExtractedMarkdown, string? Error)
{
    public static SarvamDocIntelResult Success(string markdown) =>
        new(true, markdown, null);

    public static SarvamDocIntelResult Failure(string error) =>
        new(false, null, error);
}
