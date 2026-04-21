using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.CreateTestProtocol;

/// <summary>
/// Handler for <see cref="CreateTestProtocolCommand"/>. Gates role, builds the
/// aggregate via <see cref="TestProtocol.Create"/>, persists it, and emits
/// an <see cref="AuditEvent"/> with action <c>test.protocol.created</c>.
/// See CEI §4.5.
/// </summary>
public sealed class CreateTestProtocolHandler(
    ITestProtocolRepository testProtocolRepository,
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant
    ];

    public async Task<Result<Guid>> HandleAsync(
        CreateTestProtocolCommand command,
        CancellationToken ct = default)
    {
        if (command is null)
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        if (!AllowedRoles.Contains(command.CallerRole))
        {
            return Result.Failure<Guid>(ShramSafalErrors.TestRoleNotAllowed);
        }

        if (string.IsNullOrWhiteSpace(command.Name) ||
            string.IsNullOrWhiteSpace(command.CropType))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        if (command.Periodicity == TestProtocolPeriodicity.EveryNDays &&
            (command.EveryNDays is null or <= 0))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        var now = clock.UtcNow;

        TestProtocol protocol;
        try
        {
            protocol = TestProtocol.Create(
                idGenerator.New(),
                command.Name,
                command.CropType,
                command.Kind,
                command.Periodicity,
                command.CallerUserId,
                now,
                command.EveryNDays);

            foreach (var stage in command.StageNames ?? Array.Empty<string>())
            {
                if (!string.IsNullOrWhiteSpace(stage))
                {
                    protocol.AttachToStage(stage);
                }
            }

            foreach (var code in command.ParameterCodes ?? Array.Empty<string>())
            {
                if (!string.IsNullOrWhiteSpace(code))
                {
                    protocol.AddParameterCode(code);
                }
            }
        }
        catch (ArgumentException)
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        await testProtocolRepository.AddAsync(protocol, ct);

        var audit = AuditEvent.Create(
            entityType: "TestProtocol",
            entityId: protocol.Id,
            action: "test.protocol.created",
            actorUserId: command.CallerUserId.Value,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                protocolId = protocol.Id,
                name = protocol.Name,
                cropType = protocol.CropType,
                kind = protocol.Kind.ToString(),
                periodicity = protocol.Periodicity.ToString(),
                everyNDays = protocol.EveryNDays,
                stageNames = protocol.StageNames,
                parameterCodes = protocol.ParameterCodes
            },
            occurredAtUtc: now);

        await repository.AddAuditEventAsync(audit, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(protocol.Id);
    }
}
