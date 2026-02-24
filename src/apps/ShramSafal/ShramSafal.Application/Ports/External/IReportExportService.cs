using System;
using System.Threading;
using System.Threading.Tasks;

namespace ShramSafal.Application.Ports.External;

public interface IReportExportService
{
    Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct = default);
    Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct = default);
    Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct = default);
}
