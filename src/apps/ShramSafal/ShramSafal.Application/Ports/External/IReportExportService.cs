using System;
using System.Threading;
using System.Threading.Tasks;

namespace ShramSafal.Application.Ports.External;

/// <summary>
/// Farm reports. spec: plr-d10 lane PRV fix pass 1 (M5) — each is built for its reader: what he may see, plus the W4
/// line when a record of the period is kept from him (see <c>ExportVisibility</c>).
/// </summary>
public interface IReportExportService
{
    Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, Guid readerUserId, CancellationToken ct = default);
    Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, Guid readerUserId, CancellationToken ct = default);
    Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, Guid readerUserId, CancellationToken ct = default);
}
