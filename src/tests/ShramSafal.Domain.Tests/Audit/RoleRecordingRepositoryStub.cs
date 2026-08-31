// spec: 2026-08-30-shared-farm-foundation-stage-a0
using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Audit;
using System.Collections.Generic;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// Captures the <c>ActorRole</c> an Application handler writes to the audit ledger, and
/// answers the membership/ownership reads that would otherwise short-circuit the handler
/// long before it reaches that write.
///
/// <para><b>A new file, deliberately.</b> <c>feat/labour-v2-r1</c> appends to
/// <c>Work/Handlers/StubShramSafalRepository.cs</c> at EOF. Subclassing keeps Stage A0 out
/// of that file entirely, which is what the isolation guard requires.</para>
///
/// <para><b>Why the ownership/membership overrides exist.</b> The base stub answers
/// <c>false</c> to both (<c>StubShramSafalRepository.cs:30</c>, <c>:77</c>). Without these,
/// every handler under test returns <c>Forbidden</c> and never writes an audit event at
/// all — so a test asserting on the role would see nothing and could be misread as "the
/// role was wrong" rather than "the handler never got there". Every test therefore asserts
/// <see cref="AuditEventCount"/> first.</para>
/// </summary>
internal sealed class RoleRecordingRepositoryStub : StubShramSafalRepository
{
    private readonly AppRole? _role;
    private readonly Farm? _farm;
    private readonly Plot? _plot;

    public RoleRecordingRepositoryStub(AppRole? role, Farm? farm = null, Plot? plot = null)
    {
        _role = role;
        _farm = farm;
        _plot = plot;
    }

    /// <summary>The ActorRole string as it was handed to the audit ledger.</summary>
    public string? LastAuditActorRole { get; private set; }

    /// <summary>
    /// How many audit events the handler actually wrote. Assert this is 1 BEFORE asserting
    /// on the role — a silent early return must never be mistaken for a correct one.
    /// </summary>
    public int AuditEventCount { get; private set; }

    public override Task<AppRole?> GetUserRoleForFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role);

    public override Task<bool> IsUserOwnerOfFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role is AppRole.PrimaryOwner or AppRole.SecondaryOwner);

    public override Task<bool> IsUserMemberOfFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role is not null);

    public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
        => Task.FromResult(_farm);

    public override Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
        => Task.FromResult(_plot);

    /// <summary>Empty, so the crop-cycle overlap check never blocks a test.</summary>
    public override Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(
        Guid plotId, CancellationToken ct = default)
        => Task.FromResult(new List<CropCycle>());

    public override Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default)
        => Task.CompletedTask;

    public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        LastAuditActorRole = auditEvent.ActorRole;
        AuditEventCount++;
        return Task.CompletedTask;
    }
}
