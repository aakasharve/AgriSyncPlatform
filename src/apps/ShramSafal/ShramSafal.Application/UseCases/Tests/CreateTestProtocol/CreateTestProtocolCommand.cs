using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.CreateTestProtocol;

/// <summary>
/// Create a new <see cref="TestProtocol"/>. Allowed roles:
/// PrimaryOwner, SecondaryOwner, Agronomist, Consultant. See CEI §4.5.
/// </summary>
public sealed record CreateTestProtocolCommand(
    string Name,
    string CropType,
    TestProtocolKind Kind,
    TestProtocolPeriodicity Periodicity,
    int? EveryNDays,
    IReadOnlyList<string> StageNames,
    IReadOnlyList<string> ParameterCodes,
    UserId CallerUserId,
    AppRole CallerRole);
