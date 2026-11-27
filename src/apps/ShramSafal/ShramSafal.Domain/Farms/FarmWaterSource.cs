using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9)

/// <summary>A motor's drip details as sent. A detail that is not known is null (left out on the wire).</summary>
public sealed record FarmMotorDripSpec(string? PipeSize, bool HasFilter, decimal? FlowLitresPerHour);

/// <summary>One motor of a water source as sent: the id is made on the phone.</summary>
public sealed record FarmMotorSpec(Guid MotorId, string Name, decimal Hp, int Phase, string PowerSource, string? PowerSourceName, FarmMotorDripSpec? Drip);

/// <summary>A water source with its WHOLE motor list as sent: the unit the screen saves, and the unit the server versions.</summary>
public sealed record FarmWaterSourceSpec(string Name, string SourceType, bool IsAvailable, string? Notes, IReadOnlyList<FarmMotorSpec> Motors)
{
    /// <summary>The first rule this source breaks, or null when it holds together.</summary>
    public FarmSetupProblem? Check()
    {
        if (string.IsNullOrWhiteSpace(Name) || Name.Trim().Length > FarmSetupValues.MaxNameLength)
        {
            return new("FarmWaterSourceName", $"A water source has a name of 1 to {FarmSetupValues.MaxNameLength} characters.");
        }

        if (!FarmSetupValues.IsOneOf(FarmSetupValues.WaterSourceTypes, SourceType))
        {
            return new("FarmWaterSourceType", "A water source is a well, a borewell, a canal, a farm pond or a tanker.");
        }

        if (FarmSetupValues.Optional(Notes) is { Length: > FarmSetupValues.MaxNotesLength })
        {
            return new("FarmWaterSourceNotes", $"The note of a water source has at most {FarmSetupValues.MaxNotesLength} characters.");
        }

        if (Motors is null)
        {
            return new("FarmMotorCount", "A water source is sent with its list of motors (the list may be empty).");
        }

        if (Motors.Count > FarmSetupValues.MaxMotorsPerSource)
        {
            return new("FarmMotorCount", $"A water source has at most {FarmSetupValues.MaxMotorsPerSource} motors.");
        }

        var seen = new HashSet<Guid>();
        foreach (var motor in Motors)
        {
            if (motor is null || motor.MotorId == Guid.Empty || !seen.Add(motor.MotorId))
            {
                return new("FarmMotorId", "Every motor of a water source has its own id.");
            }

            if (string.IsNullOrWhiteSpace(motor.Name) || motor.Name.Trim().Length > FarmSetupValues.MaxNameLength)
            {
                return new("FarmMotorName", $"A motor has a name of 1 to {FarmSetupValues.MaxNameLength} characters.");
            }

            if (motor.Hp <= 0 || motor.Hp > 500 || !FarmSetupValues.HasAtMostTwoDecimals(motor.Hp))
            {
                return new("FarmMotorHp", "A motor's HP is more than 0, at most 500, with at most two decimals.");
            }

            if (motor.Phase is not (1 or 3))
            {
                return new("FarmMotorPhase", "A motor is single phase (1) or three phase (3).");
            }

            if (!FarmSetupValues.IsOneOf(FarmSetupValues.PowerSources, motor.PowerSource))
            {
                return new("FarmMotorPowerSource", "A motor runs on MSEB power, solar or a generator.");
            }

            if (FarmSetupValues.Optional(motor.PowerSourceName) is { Length: > FarmSetupValues.MaxNameLength })
            {
                return new("FarmMotorPowerSource", $"The name of a motor's power source has at most {FarmSetupValues.MaxNameLength} characters.");
            }

            if (motor.Drip is { } drip
                && (FarmSetupValues.Optional(drip.PipeSize) is { Length: > 8 }
                    || drip.FlowLitresPerHour is { } flow && (flow <= 0 || flow >= 100_000_000m || !FarmSetupValues.HasAtMostTwoDecimals(flow))))
            {
                return new("FarmMotorDrip", "A drip pipe size has at most 8 characters and a flow is more than 0 litres an hour, with at most two decimals.");
            }
        }

        return null;
    }
}

/// <summary>
/// One water source of ONE farm (<c>ssf.farm_water_sources</c>) with its motors (<c>ssf.farm_motors</c>): ONE versioned unit. <see cref="Revision"/> goes up
/// once when the source or any of its motors changes, because the screen saves them together. A motor that is not in a save's list is removed (a state;
/// the row stays). Both ids are made on the phone, so a save sent twice lands on the same rows.
/// <para>No silent overwrite: the application compares the phone's base revision with <see cref="Revision"/> before it calls <see cref="Change"/> or
/// <see cref="Remove"/>, and <see cref="Revision"/> is the row's concurrency token, so two saves in the same instant cannot both win.</para>
/// </summary>
public sealed class FarmWaterSource : Entity<Guid>
{
    private readonly List<FarmMotor> _motors = [];

    private FarmWaterSource() : base(Guid.Empty) { } // EF Core

    private FarmWaterSource(Guid id, FarmId farmId, UserId byUserId, DateTime atUtc)
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

    /// <summary>One of <see cref="FarmSetupValues.WaterSourceTypes"/>.</summary>
    public string SourceType { get; private set; } = string.Empty;

    public bool IsAvailable { get; private set; }
    public string? Notes { get; private set; }
    public FarmSetupState State { get; private set; }

    /// <summary>1 for the first save, one more for every real change of the source or of any of its motors.</summary>
    public int Revision { get; private set; }

    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Every motor this source ever had (active and removed), oldest first. Not a database relation: the store attaches the rows it read.</summary>
    public IReadOnlyList<FarmMotor> Motors => _motors;

    /// <summary>Hands the source the motor rows read for it (the store's call, once, after the read). Rows of another source are refused.</summary>
    public void AttachMotors(IEnumerable<FarmMotor> motors)
    {
        ArgumentNullException.ThrowIfNull(motors);
        _motors.Clear();
        foreach (var motor in motors.OrderBy(m => m.CreatedAtUtc).ThenBy(m => m.Id))
        {
            if (motor.WaterSourceId != Id)
            {
                throw new ArgumentException("A motor of another water source cannot be attached.", nameof(motors));
            }

            _motors.Add(motor);
        }
    }

    /// <summary>The first save of a source. The content must hold together (<see cref="FarmWaterSourceSpec.Check"/>), else this throws.</summary>
    public static FarmWaterSource Create(Guid id, FarmId farmId, FarmWaterSourceSpec spec, UserId byUserId, DateTime atUtc)
    {
        if (id == Guid.Empty || farmId.IsEmpty || byUserId.IsEmpty)
        {
            throw new ArgumentException("A water source names its id, its farm and who saved it.");
        }

        Require(spec);
        var source = new FarmWaterSource(id, farmId, byUserId, atUtc);
        source.Apply(spec, byUserId, atUtc, out _);
        return source;
    }

    /// <summary>True when the source is active and already holds exactly this content (a save sent again).</summary>
    public bool Matches(FarmWaterSourceSpec spec)
    {
        if (spec?.Check() is not null || spec is null || State != FarmSetupState.Active)
        {
            return false;
        }

        var active = _motors.Where(m => m.State == FarmSetupState.Active).ToList();
        return SameHead(spec)
            && active.Count == spec.Motors.Count
            && spec.Motors.All(sent => active.FirstOrDefault(m => m.Id == sent.MotorId) is { } held && held.Holds(sent));
    }

    /// <summary>
    /// A later save: the content is replaced WHOLE and the source is active again. Returns false, and changes nothing, when it already holds this content.
    /// <paramref name="removedMotorIds"/> names the motors this save took out (their plot links must go with them).
    /// </summary>
    public bool Change(FarmWaterSourceSpec spec, UserId byUserId, DateTime atUtc, out IReadOnlyList<Guid> removedMotorIds)
    {
        Require(spec);
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("A change names who made it.", nameof(byUserId));
        }

        if (Matches(spec))
        {
            removedMotorIds = [];
            return false;
        }

        Apply(spec, byUserId, atUtc, out removedMotorIds);
        State = FarmSetupState.Active;
        Touch(byUserId, atUtc);
        return true;
    }

    /// <summary>Takes the source and its motors out of the farm's setup (rows stay). Returns false when it was removed already.</summary>
    public bool Remove(UserId byUserId, DateTime atUtc, out IReadOnlyList<Guid> removedMotorIds)
    {
        if (State == FarmSetupState.Removed)
        {
            removedMotorIds = [];
            return false;
        }

        var removed = new List<Guid>();
        foreach (var motor in _motors.Where(m => m.State == FarmSetupState.Active))
        {
            motor.Remove(byUserId, atUtc);
            removed.Add(motor.Id);
        }

        removedMotorIds = removed;
        State = FarmSetupState.Removed;
        Touch(byUserId, atUtc);
        return true;
    }

    private void Apply(FarmWaterSourceSpec spec, UserId byUserId, DateTime atUtc, out IReadOnlyList<Guid> removedMotorIds)
    {
        Name = spec.Name.Trim();
        SourceType = spec.SourceType;
        IsAvailable = spec.IsAvailable;
        Notes = FarmSetupValues.Optional(spec.Notes);

        var removed = new List<Guid>();
        foreach (var held in _motors.Where(m => m.State == FarmSetupState.Active && spec.Motors.All(sent => sent.MotorId != m.Id)))
        {
            held.Remove(byUserId, atUtc);
            removed.Add(held.Id);
        }

        foreach (var sent in spec.Motors)
        {
            if (_motors.FirstOrDefault(m => m.Id == sent.MotorId) is { } held)
            {
                held.Set(sent, byUserId, atUtc);
            }
            else
            {
                _motors.Add(FarmMotor.Create(this, sent, byUserId, atUtc));
            }
        }

        removedMotorIds = removed;
    }

    private bool SameHead(FarmWaterSourceSpec spec) =>
        Name == spec.Name.Trim()
        && SourceType == spec.SourceType
        && IsAvailable == spec.IsAvailable
        && Notes == FarmSetupValues.Optional(spec.Notes);

    private void Touch(UserId byUserId, DateTime atUtc)
    {
        Revision++;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    private static void Require(FarmWaterSourceSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        if (spec.Check() is { } problem)
        {
            throw new ArgumentException($"{problem.Code}: {problem.Message}", nameof(spec));
        }
    }
}

/// <summary>
/// One motor of one water source (<c>ssf.farm_motors</c>). It has no revision of its own: its source's revision counts, and it is created, edited and
/// removed only through its source's save. It carries its own <c>farm_id</c> (row security is keyed on it); the database refuses a motor whose source is
/// not on the same farm.
/// </summary>
public sealed class FarmMotor : Entity<Guid>
{
    private FarmMotor() : base(Guid.Empty) { } // EF Core

    private FarmMotor(Guid id, FarmId farmId, Guid waterSourceId, UserId byUserId, DateTime atUtc)
        : base(id)
    {
        FarmId = farmId;
        WaterSourceId = waterSourceId;
        State = FarmSetupState.Active;
        CreatedByUserId = byUserId;
        CreatedAtUtc = atUtc;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid WaterSourceId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public decimal Hp { get; private set; }

    /// <summary>1 (single phase) or 3 (three phase).</summary>
    public int Phase { get; private set; }

    /// <summary>One of <see cref="FarmSetupValues.PowerSources"/>.</summary>
    public string PowerSource { get; private set; } = string.Empty;

    public string? PowerSourceName { get; private set; }

    /// <summary>True when drip details were given for this motor; the three drip columns are null otherwise.</summary>
    public bool HasDrip { get; private set; }

    public string? DripPipeSize { get; private set; }
    public bool? DripHasFilter { get; private set; }
    public decimal? DripFlowLph { get; private set; }
    public FarmSetupState State { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    internal static FarmMotor Create(FarmWaterSource source, FarmMotorSpec spec, UserId byUserId, DateTime atUtc)
    {
        var motor = new FarmMotor(spec.MotorId, source.FarmId, source.Id, byUserId, atUtc);
        motor.Write(spec);
        return motor;
    }

    /// <summary>True when this motor (whatever its state) holds exactly the sent details.</summary>
    internal bool Holds(FarmMotorSpec spec) =>
        Name == spec.Name.Trim()
        && Hp == spec.Hp
        && Phase == spec.Phase
        && PowerSource == spec.PowerSource
        && PowerSourceName == FarmSetupValues.Optional(spec.PowerSourceName)
        && HasDrip == spec.Drip is not null
        && DripPipeSize == FarmSetupValues.Optional(spec.Drip?.PipeSize)
        && DripHasFilter == spec.Drip?.HasFilter
        && DripFlowLph == spec.Drip?.FlowLitresPerHour;

    /// <summary>Writes the sent details and makes the motor active; who and when move only when something really changed.</summary>
    internal void Set(FarmMotorSpec spec, UserId byUserId, DateTime atUtc)
    {
        if (State == FarmSetupState.Active && Holds(spec))
        {
            return;
        }

        Write(spec);
        State = FarmSetupState.Active;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    internal void Remove(UserId byUserId, DateTime atUtc)
    {
        if (State == FarmSetupState.Removed)
        {
            return;
        }

        State = FarmSetupState.Removed;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    private void Write(FarmMotorSpec spec)
    {
        Name = spec.Name.Trim();
        Hp = spec.Hp;
        Phase = spec.Phase;
        PowerSource = spec.PowerSource;
        PowerSourceName = FarmSetupValues.Optional(spec.PowerSourceName);
        HasDrip = spec.Drip is not null;
        DripPipeSize = FarmSetupValues.Optional(spec.Drip?.PipeSize);
        DripHasFilter = spec.Drip?.HasFilter;
        DripFlowLph = spec.Drip?.FlowLitresPerHour;
    }
}
