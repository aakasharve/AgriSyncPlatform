using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.RecordTestResult;

/// <summary>
/// Transition a <see cref="TestInstance"/> from <c>Collected</c> to
/// <c>Reported</c>. Allowed role: LabOperator. Requires >=1 attachment
/// (CEI-I5). See CEI §4.5.
/// </summary>
public sealed record RecordTestResultCommand(
    Guid TestInstanceId,
    IReadOnlyCollection<TestResult> Results,
    IReadOnlyCollection<Guid> AttachmentIds,
    UserId CallerUserId,
    AppRole CallerRole,
    string? ClientCommandId);

public sealed record RecordTestResultResponse(
    Guid TestInstanceId,
    string Status,
    IReadOnlyList<TestRecommendationDto> Recommendations);
