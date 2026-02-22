using ShramSafal.Domain.OCR;

namespace ShramSafal.Application.Ports.External;

public interface IOcrExtractionService
{
    Task<OcrExtractionResult> ExtractFromImageAsync(Stream imageStream, string mimeType, OcrContext context, CancellationToken ct);
}

public sealed record OcrContext(string FarmName, string[] RecentCategories, string[] RecentVendors);
