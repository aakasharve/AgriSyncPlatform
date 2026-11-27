using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Domain.Farms;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9; R2-A item 14 "या प्लॉटला पाण्याची सोय कशी केली आहे?"; founder 27 Nov A9.2: many to many)

/// <summary>One link of a plot to a water source, with the motor that pumps it or none (a canal by gravity has no motor).</summary>
public sealed record PlotWaterLinkSpec(Guid WaterSourceId, Guid? MotorId);

/// <summary>One plot's water arrangement as sent, WHOLE: the method and every source / motor that waters the plot.</summary>
public sealed record PlotWaterSpec(string Method, IReadOnlyList<PlotWaterLinkSpec> Links)
{
    /// <summary>The first rule this arrangement breaks, or null when it holds together. A method with no link is allowed: the plot is saved and shows बाकी.</summary>
    public FarmSetupProblem? Check()
    {
        if (!FarmSetupValues.IsOneOf(FarmSetupValues.IrrigationMethods, Method))
        {
            return new("PlotWaterMethod", "A plot's water method is drip, flood, sprinkler or none.");
        }

        if (Links is null)
        {
            return new("PlotWaterLinkCount", "A plot's water arrangement is sent with its list of links (the list may be empty).");
        }

        if (Links.Count > FarmSetupValues.MaxLinksPerPlot)
        {
            return new("PlotWaterLinkCount", $"A plot has at most {FarmSetupValues.MaxLinksPerPlot} water links.");
        }

        var seen = new HashSet<(Guid, Guid?)>();
        foreach (var link in Links)
        {
            if (link is null || link.WaterSourceId == Guid.Empty || link.MotorId == Guid.Empty || !seen.Add((link.WaterSourceId, link.MotorId)))
            {
                return new("PlotWaterLink", "Every water link of a plot names a water source, at most one motor, and is listed once.");
            }
        }

        if (Method == FarmSetupValues.NoWaterMethod && Links.Count > 0)
        {
            // "पाण्याची सोय नाही" and a ticked source are two different facts and are never mixed (P4).
            return new("PlotWaterNoneWithLinks", "A plot that has no water facility cannot also name a water source.");
        }

        return null;
    }
}

/// <summary>
/// How ONE plot gets its water (<c>ssf.plot_water_setups</c>, one row per plot that has ANSWERED the question) with its links to sources and motors
/// (<c>ssf.plot_water_links</c>, many to many): ONE versioned unit under <see cref="Revision"/>. Its id IS the plot's id.
/// <para>No row = the plot was never asked (it shows "बाकी"). A row with <c>none</c> = the farmer said "पाण्याची सोय नाही". The two are different facts and
/// are never mixed (P4). A row with a method and no active link is allowed: he may name the source later, and until then the plot shows बाकी.</para>
/// </summary>
public sealed class PlotWaterSetup : Entity<Guid>
{
    private readonly List<PlotWaterLink> _links = [];

    private PlotWaterSetup() : base(Guid.Empty) { } // EF Core

    private PlotWaterSetup(Guid plotId, FarmId farmId, UserId byUserId, DateTime atUtc)
        : base(plotId)
    {
        FarmId = farmId;
        Revision = 1;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    /// <summary>The plot this arrangement belongs to (the row's key).</summary>
    public Guid PlotId => Id;

    public FarmId FarmId { get; private set; }

    /// <summary>One of <see cref="FarmSetupValues.IrrigationMethods"/>.</summary>
    public string Method { get; private set; } = string.Empty;

    /// <summary>1 for the first answer, one more for every real change of the method or of any link (a link dropped with its motor or source too).</summary>
    public int Revision { get; private set; }

    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Every link this plot ever had (active and removed). Not a database relation: the store attaches the rows it read.</summary>
    public IReadOnlyList<PlotWaterLink> Links => _links;

    /// <summary>Hands the setup the link rows read for it (the store's call, once, after the read). Rows of another plot are refused.</summary>
    public void AttachLinks(IEnumerable<PlotWaterLink> links)
    {
        ArgumentNullException.ThrowIfNull(links);
        _links.Clear();
        foreach (var link in links.OrderBy(l => l.CreatedAtUtc).ThenBy(l => l.Id))
        {
            if (link.PlotId != Id)
            {
                throw new ArgumentException("A water link of another plot cannot be attached.", nameof(links));
            }

            _links.Add(link);
        }
    }

    /// <summary>The plot's first answer. The content must hold together (<see cref="PlotWaterSpec.Check"/>), else this throws.</summary>
    public static PlotWaterSetup Create(Guid plotId, FarmId farmId, PlotWaterSpec spec, UserId byUserId, DateTime atUtc)
    {
        if (plotId == Guid.Empty || farmId.IsEmpty || byUserId.IsEmpty)
        {
            throw new ArgumentException("A plot's water arrangement names its plot, its farm and who saved it.");
        }

        Require(spec);
        var setup = new PlotWaterSetup(plotId, farmId, byUserId, atUtc);
        setup.Apply(spec, byUserId, atUtc);
        return setup;
    }

    /// <summary>True when the plot already holds exactly this method and exactly these active links (a save sent again).</summary>
    public bool Matches(PlotWaterSpec spec)
    {
        if (spec is null || spec.Check() is not null || Method != spec.Method)
        {
            return false;
        }

        var active = _links.Where(l => l.State == FarmSetupState.Active).Select(l => (l.WaterSourceId, l.MotorId)).ToHashSet();
        return active.SetEquals(spec.Links.Select(l => (l.WaterSourceId, l.MotorId)));
    }

    /// <summary>
    /// Writes the arrangement whole: a link that is not in the list is removed (a state), a removed link that is listed again is the same row made active.
    /// Returns false, and changes nothing, when nothing differs.
    /// </summary>
    public bool Set(PlotWaterSpec spec, UserId byUserId, DateTime atUtc)
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

        Apply(spec, byUserId, atUtc);
        Touch(byUserId, atUtc);
        return true;
    }

    /// <summary>Drops the active links to these motors (they were removed from the farm's setup). The plot's answer stays; it shows बाकी until re-linked.</summary>
    public bool DropLinksToMotors(IReadOnlyCollection<Guid> motorIds, UserId byUserId, DateTime atUtc)
    {
        ArgumentNullException.ThrowIfNull(motorIds);
        return Drop(l => l.MotorId is { } motor && motorIds.Contains(motor), byUserId, atUtc);
    }

    /// <summary>Drops every active link to this water source, with or without a motor (the source was removed from the farm's setup).</summary>
    public bool DropLinksToSource(Guid waterSourceId, UserId byUserId, DateTime atUtc) =>
        Drop(l => l.WaterSourceId == waterSourceId, byUserId, atUtc);

    private bool Drop(Func<PlotWaterLink, bool> which, UserId byUserId, DateTime atUtc)
    {
        var dropped = _links.Where(l => l.State == FarmSetupState.Active && which(l)).ToList();
        if (dropped.Count == 0)
        {
            return false;
        }

        foreach (var link in dropped)
        {
            link.SetState(FarmSetupState.Removed, byUserId, atUtc);
        }

        Touch(byUserId, atUtc);
        return true;
    }

    private void Apply(PlotWaterSpec spec, UserId byUserId, DateTime atUtc)
    {
        Method = spec.Method;
        var wanted = spec.Links.Select(l => (l.WaterSourceId, l.MotorId)).ToHashSet();
        foreach (var held in _links.Where(l => l.State == FarmSetupState.Active && !wanted.Contains((l.WaterSourceId, l.MotorId))))
        {
            held.SetState(FarmSetupState.Removed, byUserId, atUtc);
        }

        foreach (var sent in spec.Links)
        {
            if (_links.FirstOrDefault(l => l.WaterSourceId == sent.WaterSourceId && l.MotorId == sent.MotorId) is { } held)
            {
                held.SetState(FarmSetupState.Active, byUserId, atUtc);
            }
            else
            {
                _links.Add(PlotWaterLink.Create(this, sent, byUserId, atUtc));
            }
        }
    }

    private void Touch(UserId byUserId, DateTime atUtc)
    {
        Revision++;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    private static void Require(PlotWaterSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        if (spec.Check() is { } problem)
        {
            throw new ArgumentException($"{problem.Code}: {problem.Message}", nameof(spec));
        }
    }
}

/// <summary>
/// One link of a plot to a water source and (or not) a motor (<c>ssf.plot_water_links</c>). The id is made by the SERVER as a UUIDv5 of plot, source and
/// motor (<see cref="IdFor"/>), so every phone and every re-send lands on the same row. It carries its own <c>farm_id</c> (row security is keyed on it);
/// the database refuses a link whose plot, source or motor is not on the same farm. It has no revision of its own: its plot's setup counts.
/// </summary>
public sealed class PlotWaterLink : Entity<Guid>
{
    /// <summary>The fixed namespace of every plot-water link id. Never changes.</summary>
    public static readonly Guid IdNamespace = Guid.Parse("7e1f4c90-3b5a-4d27-8c64-2a9d0f6e1b35");

    private PlotWaterLink() : base(Guid.Empty) { } // EF Core

    private PlotWaterLink(Guid id, FarmId farmId, Guid plotId, Guid waterSourceId, Guid? motorId, UserId byUserId, DateTime atUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        WaterSourceId = waterSourceId;
        MotorId = motorId;
        State = FarmSetupState.Active;
        CreatedByUserId = byUserId;
        CreatedAtUtc = atUtc;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid WaterSourceId { get; private set; }
    public Guid? MotorId { get; private set; }
    public FarmSetupState State { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public UserId UpdatedByUserId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>The id of the link of this plot to this source through this motor (or none): the same on every phone and every server.</summary>
    public static Guid IdFor(Guid plotId, Guid waterSourceId, Guid? motorId) =>
        MoneyEntryIdentity.V5(IdNamespace, $"{plotId:D}:{waterSourceId:D}:{(motorId is { } motor ? motor.ToString("D") : "-")}".ToLowerInvariant());

    internal static PlotWaterLink Create(PlotWaterSetup setup, PlotWaterLinkSpec spec, UserId byUserId, DateTime atUtc) =>
        new(IdFor(setup.Id, spec.WaterSourceId, spec.MotorId), setup.FarmId, setup.Id, spec.WaterSourceId, spec.MotorId, byUserId, atUtc);

    internal void SetState(FarmSetupState state, UserId byUserId, DateTime atUtc)
    {
        if (State == state)
        {
            return;
        }

        State = state;
        UpdatedByUserId = byUserId;
        UpdatedAtUtc = atUtc;
    }
}
