namespace ShramSafal.Application.Ports.External;

public interface IReportExportService
{
    Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct);
    Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct);
    Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct);
}
