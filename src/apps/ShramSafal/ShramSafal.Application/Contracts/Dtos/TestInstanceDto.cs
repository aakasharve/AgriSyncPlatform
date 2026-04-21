using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Transport shape for a <see cref="TestInstance"/>. See CEI §4.5.
/// Includes the protocol name when available (caller passes it in from a
/// <c>ITestProtocolRepository</c> lookup).
/// </summary>
public sealed record TestInstanceDto(
    Guid TestInstanceId,
    Guid TestProtocolId,
    string? TestProtocolName,
    string ProtocolKind,
    Guid CropCycleId,
    Guid FarmId,
    Guid PlotId,
    string StageName,
    DateOnly PlannedDueDate,
    string Status,
    Guid? CollectedByUserId,
    DateTime? CollectedAtUtc,
    Guid? ReportedByUserId,
    DateTime? ReportedAtUtc,
    int AttachmentCount,
    int ResultCount,
    DateTime ModifiedAtUtc)
{
    public static TestInstanceDto FromDomain(TestInstance instance, string? protocolName = null) =>
        new(
            TestInstanceId: instance.Id,
            TestProtocolId: instance.TestProtocolId,
            TestProtocolName: protocolName,
            ProtocolKind: instance.ProtocolKind.ToString(),
            CropCycleId: instance.CropCycleId,
            FarmId: instance.FarmId.Value,
            PlotId: instance.PlotId,
            StageName: instance.StageName,
            PlannedDueDate: instance.PlannedDueDate,
            Status: instance.Status.ToString(),
            CollectedByUserId: instance.CollectedByUserId?.Value,
            CollectedAtUtc: instance.CollectedAtUtc,
            ReportedByUserId: instance.ReportedByUserId?.Value,
            ReportedAtUtc: instance.ReportedAtUtc,
            AttachmentCount: instance.AttachmentIds.Count,
            ResultCount: instance.Results.Count,
            ModifiedAtUtc: instance.ModifiedAtUtc);
}
