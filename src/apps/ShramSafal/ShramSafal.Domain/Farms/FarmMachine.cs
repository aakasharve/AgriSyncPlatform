using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; machine types and details: founder 27 Nov, A11.1 / A11.2)

/// <summary>One machine as sent. The name is the only required detail; an optional detail that is not known is null (left out on the wire).</summary>
public sealed record FarmMachineSpec(
    string Name, string MachineType, string Ownership, string? Company, string? Model, decimal? Hp, int? NozzleCount, decimal? TankLitres, string? DetailLine)
{
    /// <summary>The first rule this machine breaks, or null when it holds together.</summary>
    public FarmSetupProblem? Check()
    {
        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > FarmSetupValues.MaxNameLength)
        {
            return new("FarmMachineName", $"A machine has a name of 1 to {FarmSetupValues.MaxNameLength} characters.");
        }

        if (!FarmSetupValues.IsOneOf(FarmSetupValues.MachineTypes, MachineType))
        {
            return new("FarmMachineType", "A machine is a tractor, a blower, a sprayer, a rotavator, a harvester or other.");
        }

        if (!FarmSetupValues.IsOneOf(FarmSetupValues.Ownerships, Ownership))
        {
            return new("FarmMachineOwnership", "A machine is owned or rented.");
        }

        if (FarmSetupValues.Optional(Company) is { Length: > 60 } || FarmSetupValues.Optional(Model) is { Length: > 60 })
        {
            return new("FarmMachineMaker", "A machine's company and model have at most 60 characters each.");
        }

        if (Hp is { } hp && (hp <= 0 || hp >= 10_000m || !FarmSetupValues.HasAtMostTwoDecimals(hp)))
        {
            return new("FarmMachineHp", "A machine's HP is more than 0 and under 10000, with at most two decimals.");
        }

        if (NozzleCount is { } nozzles && nozzles is <= 0 or > short.MaxValue)
        {
            return new("FarmMachineNozzles", "A machine's nozzle count is a whole number above 0.");
        }

        if (TankLitres is { } tank && (tank <= 0 || tank >= 1_000_000m || !FarmSetupValues.HasAtMostTwoDecimals(tank)))
        {
            return new("FarmMachineTank", "A machine's tank is more than 0 litres and under 1000000, with at most two decimals.");
        }

        if (FarmSetupValues.Optional(DetailLine) is { Length: > 200 })
        {
            return new("FarmMachineDetail", "A machine's extra line has at most 200 characters.");
        }

        return null;
    }
}

/// <summary>
/// One machine of ONE farm (<c>ssf.farm_machines</c>): machines belong to the whole farm, never to a plot. The id is made on the phone and kept across
/// edits. <see cref="Revision"/> goes up once per real change and is the row's concurrency token. No rate or cost is held here: the "अंदाजे" machine cost
/// is a later step that adds its own columns, keyed on this id.
/// </summary>
public sealed class FarmMachine : Entity<Guid>
{
    private FarmMachine() : base(Guid.Empty) { } // EF Core

    private FarmMachine(Guid id, FarmId farmId, UserId byUserId, DateTime atUtc)
        : base(id)
    {
        FarmId = farmId;
        State = FarmSetupState.Active;
        Revision = 1;
        CreatedByUserId = byUserId;
        CreatedAtUtc = atUtc;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    public FarmId FarmId { get; private set; }
    public string Name { get; private set; } = string.Empty;

    /// <summary>One of <see cref="FarmSetupValues.MachineTypes"/>.</summary>
    public string MachineType { get; private set; } = string.Empty;

    /// <summary>One of <see cref="FarmSetupValues.Ownerships"/>.</summary>
    public string Ownership { get; private set; } = string.Empty;

    public string? Company { get; private set; }
    public string? Model { get; private set; }
    public decimal? Hp { get; private set; }
    public short? NozzleCount { get; private set; }
    public decimal? TankLitres { get; private set; }
    public string? DetailLine { get; private set; }
    public FarmSetupState State { get; private set; }
    public int Revision { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>The first save of a machine. The content must hold together (<see cref="FarmMachineSpec.Check"/>), else this throws.</summary>
    public static FarmMachine Create(Guid id, FarmId farmId, FarmMachineSpec spec, UserId byUserId, DateTime atUtc)
    {
        if (id == Guid.Empty || farmId.IsEmpty || byUserId.IsEmpty)
        {
            throw new ArgumentException("A machine names its id, its farm and who saved it.");
        }

        Require(spec);
        var machine = new FarmMachine(id, farmId, byUserId, atUtc);
        machine.Write(spec);
        return machine;
    }

    /// <summary>True when the machine is active and already holds exactly this content (a save sent again).</summary>
    public bool Matches(FarmMachineSpec spec) =>
        spec is not null
        && spec.Check() is null
        && State == FarmSetupState.Active
        && Name == spec.Name.Trim()
        && MachineType == spec.MachineType
        && Ownership == spec.Ownership
        && Company == FarmSetupValues.Optional(spec.Company)
        && Model == FarmSetupValues.Optional(spec.Model)
        && Hp == spec.Hp
        && NozzleCount == (short?)spec.NozzleCount
        && TankLitres == spec.TankLitres
        && DetailLine == FarmSetupValues.Optional(spec.DetailLine);

    /// <summary>A later save: the details are replaced whole and the machine is active again. Returns false, and changes nothing, when nothing differs.</summary>
    public bool Change(FarmMachineSpec spec, UserId byUserId, DateTime atUtc)
    {
        Require(spec);
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("A change names who made it.", nameof(byUserId));
        }

        if (Matches(spec))
        {
            return false;
        }

        Write(spec);
        State = FarmSetupState.Active;
        Touch(byUserId, atUtc);
        return true;
    }

    /// <summary>Takes the machine out of the farm's setup (the row stays). Returns false when it was removed already.</summary>
    public bool Remove(UserId byUserId, DateTime atUtc)
    {
        if (State == FarmSetupState.Removed)
        {
            return false;
        }

        State = FarmSetupState.Removed;
        Touch(byUserId, atUtc);
        return true;
    }

    private void Write(FarmMachineSpec spec)
    {
        Name = spec.Name.Trim();
        MachineType = spec.MachineType;
        Ownership = spec.Ownership;
        Company = FarmSetupValues.Optional(spec.Company);
        Model = FarmSetupValues.Optional(spec.Model);
        Hp = spec.Hp;
        NozzleCount = (short?)spec.NozzleCount;
        TankLitres = spec.TankLitres;
        DetailLine = FarmSetupValues.Optional(spec.DetailLine);
    }

    private void Touch(UserId byUserId, DateTime atUtc)
    {
        Revision++;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    private static void Require(FarmMachineSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        if (spec.Check() is { } problem)
        {
            throw new ArgumentException($"{problem.Code}: {problem.Message}", nameof(spec));
        }
    }
}
