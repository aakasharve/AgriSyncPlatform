using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the DEMO LABOUR PLAN: the demo farm's
/// workers (named and partially named), a Mukadam crew, day-rate (रोजंदारी) and contract (उक्ते)
/// engagements, who was attached to which engagement, and the हजेरी marks for the previous
/// ~5 weeks. Pure data: nothing here touches a database.
/// </summary>
/// <remarks>
/// <para><b>Every day is an OFFSET from the run's farm-local "today"</b> (0 = today, -1 =
/// yesterday). The re-seed resolves offsets against the date it runs on, so running it again
/// next month re-anchors the whole picture to that month.</para>
/// <para><b>Every row id is minted from <see cref="SeedVersion"/> + a stable key</b>, which is
/// how both teardowns recognise seed rows by construction: field operators
/// <c>{SeedVersion}:field-operator:{key}</c>, engagements
/// <c>{SeedVersion}:labour-assignment:{key}</c>, attributions
/// <c>{SeedVersion}:field-operator-work-row:{engagement}:{operator}</c>, marks
/// <c>{SeedVersion}:attendance-mark:{operator}:{offset}</c>, payouts
/// <c>{SeedVersion}:cost:{key}</c>. Never change a key for an existing row — the teardown would
/// stop recognising rows it created.</para>
/// <para><b>Doctrine.</b> P7 — every engagement's headcount INCLUDES its unnamed workers; naming
/// people never shrinks it. NO-MULTIPLY — a total is present only where the plan says it was
/// stated; otherwise null. P8 — a stated duration is Explicit, anything else is the server's
/// Assumed default. A mark states only what somebody "said": unmarked days have no row at all.
/// The plan writes NO correction rows (attendance or labour): both tables are append-only
/// history, and the seeder must be able to remove everything it writes.</para>
/// <para><b>Unnamed and partially named people.</b> A <c>FieldOperator</c> must carry a name, so
/// "unknown" workers exist the way the product models them — as the anonymous remainder of a
/// stated headcount (Shankar's crew of 6–8 with two named), plus one spoken name that is not
/// on the roster (राजू) so the review card shows a name with no identity behind it.
/// Partially named people are first-name / honorific / nickname operators with no full name.</para>
/// </remarks>
public sealed partial class PurveshDemoSeeder
{
    /// <summary>First farm-day of the labour picture (35 farm-days including today).</summary>
    private const int LabourWindowStartOffset = -34;

    private const string OpShankar = "shankar-mukadam";
    private const string OpGanesh = "ganesh";
    private const string OpSunita = "sunita";
    private const string OpRamesh = "ramesh";
    private const string OpBalu = "balu";
    private const string OpMangal = "mangal";
    private const string OpPatil = "patil-kaka";

    private const decimal DayRateWage = 400m;
    private const decimal CrewWage = 350m;
    private const decimal NightWage = 300m;

    /// <summary>The weekly rest day of the hired labour — no engagement and no mark at all.</summary>
    private static bool IsWeeklyOff(int offset) => offset is -28 or -21 or -14 or -7;

    /// <summary>उक्ते #1 — रमेश's berry-thinning contract on G1 (one G1 log on each of these days).</summary>
    private static readonly int[] ThinningContractDays = [-24, -20, -16, -12, -8];

    /// <summary>उक्ते #2 — S2 earthing-up (भरणी) lump sum, through Shankar.</summary>
    private static readonly int[] BharaniContractDays = [-23, -19];

    /// <summary>पाटील काका's night irrigation on S1.</summary>
    private static readonly int[] NightIrrigationDays = [-29, -25, -17, -13, -9, -4, -1];

    /// <summary>Cane days on which Shankar's crew did NOT come (the night shift still ran).</summary>
    private static readonly int[] CaneDaysWithoutCrew = [-1, -5, -13];

    private sealed record DemoOperatorSeed(string Key, string DisplayName, string? FullName, int KnownForDays);

    /// <summary>One labour engagement (a <c>LabourAssignment</c>) on the seed log of
    /// <see cref="PlotKey"/> on <see cref="DayOffset"/>.</summary>
    private sealed record DemoEngagementSeed(
        string Key,
        string PlotKey,
        int DayOffset,
        LabourEngagementType EngagementType,
        int MaleCount,
        int FemaleCount,
        decimal? WagePerPerson,
        ContractUnit? ContractUnit,
        decimal? ContractQuantity,
        decimal? TotalCost,
        NumericCertainty? CostCertainty,
        string? CostSpokenText,
        LabourShift Shift,
        decimal? StatedHours,
        string Task,
        IReadOnlyList<string> SpokenNames,
        string? ThroughOperatorKey,
        IReadOnlyList<string> AttachedOperatorKeys)
    {
        public int WorkerCount => MaleCount + FemaleCount;
    }

    /// <summary>One हजेरी ruling. Null members are "this mark said nothing about that fact".</summary>
    private sealed record DemoMarkSeed(
        string OperatorKey,
        int DayOffset,
        DayMark? Day,
        NightMark? Night,
        decimal? HoursWorked,
        decimal? ExtraHours);

    private sealed record DemoLabourPlan(
        IReadOnlyList<DemoOperatorSeed> Operators,
        IReadOnlyList<DemoEngagementSeed> Engagements,
        IReadOnlyList<DemoMarkSeed> Marks,
        IReadOnlyList<CostEntrySeed> LabourPayouts,
        IReadOnlyDictionary<string, PlannedActivitySeed[]> UpcomingPlanned)
    {
        public HashSet<Guid> OperatorIds { get; } =
            Operators.Select(o => DemoOperatorId(o.Key)).ToHashSet();

        public HashSet<Guid> LabourAssignmentIds { get; } =
            Engagements.Select(e => DemoLabourAssignmentId(e.Key)).ToHashSet();

        public HashSet<Guid> WorkRowIds { get; } =
            Engagements.SelectMany(e => e.AttachedOperatorKeys.Select(op => DemoWorkRowId(e.Key, op))).ToHashSet();

        public HashSet<Guid> AttendanceMarkIds { get; } =
            Marks.Select(m => DemoAttendanceMarkId(m.OperatorKey, m.DayOffset)).ToHashSet();

        public HashSet<Guid> CostEntryIds { get; } =
            LabourPayouts.Select(c => CreateDeterministicGuid($"{SeedVersion}:cost:{c.Key}")).ToHashSet();
    }

    private static Guid DemoOperatorId(string operatorKey) =>
        CreateDeterministicGuid($"{SeedVersion}:field-operator:{operatorKey}");

    private static Guid DemoLabourAssignmentId(string engagementKey) =>
        CreateDeterministicGuid($"{SeedVersion}:labour-assignment:{engagementKey}");

    private static Guid DemoWorkRowId(string engagementKey, string operatorKey) =>
        CreateDeterministicGuid($"{SeedVersion}:field-operator-work-row:{engagementKey}:{operatorKey}");

    private static Guid DemoAttendanceMarkId(string operatorKey, int dayOffset) =>
        CreateDeterministicGuid($"{SeedVersion}:attendance-mark:{operatorKey}:{dayOffset}");

    private static DemoOperatorSeed[] DemoOperatorSeeds() =>
    [
        // Named — display name and full name. शंकर is the Mukadam: a FieldOperator
        // whose crews other engagements are engaged THROUGH (never an AppRole here).
        new(OpShankar, "शंकर मुकादम", "शंकर जाधव", 210),
        new(OpGanesh, "गणेश पवार", "गणेश दत्तात्रय पवार", 180),
        new(OpSunita, "सुनीता कांबळे", "सुनीता संजय कांबळे", 150),
        new(OpRamesh, "रमेश भोसले", "रमेश शिवाजी भोसले", 45),
        // Partially named — the identity ladder's first rung: a first name, an
        // honorific, a nickname. No full name yet.
        new(OpBalu, "बाळू", null, 90),
        new(OpMangal, "मंगल ताई", null, 120),
        new(OpPatil, "पाटील काका", null, 365),
    ];

    private static DemoLabourPlan BuildDemoLabourPlan()
    {
        var operators = DemoOperatorSeeds();
        var logPlotsByDay = BuildSeedLogPlotsByDay();

        var engagements = new List<DemoEngagementSeed>();
        for (var day = LabourWindowStartOffset; day <= 0; day++)
        {
            if (IsWeeklyOff(day) || !logPlotsByDay.TryGetValue(day, out var plots))
            {
                continue;
            }

            var grapePlot = plots.FirstOrDefault(IsGrapePlot);
            var canePlot = plots.FirstOrDefault(p => !IsGrapePlot(p));

            if (ThinningContractDays.Contains(day) && plots.Contains("grape_g1"))
            {
                var first = day == ThinningContractDays[0];
                engagements.Add(new DemoEngagementSeed(
                    Key: $"ukte-thinning:grape_g1:{day}",
                    PlotKey: "grape_g1",
                    DayOffset: day,
                    EngagementType: LabourEngagementType.Contract,
                    MaleCount: 2,
                    FemaleCount: 1,
                    WagePerPerson: null,
                    ContractUnit: ContractUnit.Row,
                    // Stated once, on the day the job was agreed; later days are the same job.
                    ContractQuantity: first ? 40m : null,
                    TotalCost: first ? 12_000m : null,
                    CostCertainty: first ? NumericCertainty.Reported : null,
                    CostSpokenText: first ? "४० ओळी घड विरळणी, १२००० ठरले" : null,
                    Shift: LabourShift.Full,
                    StatedHours: null,
                    Task: "घड विरळणी (उक्ते)",
                    SpokenNames: ["रमेश"],
                    ThroughOperatorKey: null,
                    AttachedOperatorKeys: [OpRamesh]));
            }

            if (BharaniContractDays.Contains(day) && plots.Contains("sugarcane_s2"))
            {
                var first = day == BharaniContractDays[0];
                engagements.Add(new DemoEngagementSeed(
                    Key: $"ukte-bharani:sugarcane_s2:{day}",
                    PlotKey: "sugarcane_s2",
                    DayOffset: day,
                    EngagementType: LabourEngagementType.Contract,
                    MaleCount: 3,
                    FemaleCount: 2,
                    WagePerPerson: null,
                    ContractUnit: ContractUnit.LumpSum,
                    ContractQuantity: null,
                    TotalCost: first ? 6_500m : null,
                    CostCertainty: first ? NumericCertainty.Reported : null,
                    CostSpokenText: first ? "S2 ची भरणी उक्ते, ६५०० ठरले" : null,
                    Shift: LabourShift.Full,
                    StatedHours: null,
                    Task: "भरणी (उक्ते)",
                    SpokenNames: ["शंकर"],
                    ThroughOperatorKey: OpShankar,
                    AttachedOperatorKeys: [OpShankar]));
            }

            if (grapePlot is not null)
            {
                engagements.Add(BuildGrapeDayRateCrew(grapePlot, day));
            }

            if (canePlot is not null
                && !CaneDaysWithoutCrew.Contains(day)
                && !BharaniContractDays.Contains(day))
            {
                engagements.Add(BuildCaneCrew(canePlot, day));
            }

            if (NightIrrigationDays.Contains(day) && plots.Contains("sugarcane_s1"))
            {
                var spoken = day == -1;
                engagements.Add(new DemoEngagementSeed(
                    Key: $"night-irrigation:sugarcane_s1:{day}",
                    PlotKey: "sugarcane_s1",
                    DayOffset: day,
                    EngagementType: LabourEngagementType.Hired,
                    MaleCount: 1,
                    FemaleCount: 0,
                    WagePerPerson: NightWage,
                    ContractUnit: null,
                    ContractQuantity: null,
                    TotalCost: spoken ? NightWage : null,
                    CostCertainty: spoken ? NumericCertainty.Reported : null,
                    CostSpokenText: spoken ? "रात्रीचे ३०० दिले" : null,
                    Shift: LabourShift.Night,
                    // "६ तास पाणी दिले" — a stated duration, so it is Explicit.
                    StatedHours: 6m,
                    Task: "रात्री पाणी देणे",
                    SpokenNames: ["पाटील काका"],
                    ThroughOperatorKey: null,
                    AttachedOperatorKeys: [OpPatil]));
            }
        }

        var marks = BuildDemoMarks(engagements);
        var payouts = BuildDemoLabourPayouts(engagements);

        return new DemoLabourPlan(operators, engagements, marks, payouts, BuildUpcomingPlannedSeeds());
    }

    private static DemoEngagementSeed BuildGrapeDayRateCrew(string plotKey, int day)
    {
        var named = new List<string>();
        if (GaneshAttachedToGrapeCrew(day))
        {
            named.Add(OpGanesh);
        }

        if (SunitaMark(day)?.Day == DayMark.Full)
        {
            named.Add(OpSunita);
        }

        if (MangalMark(day)?.Day == DayMark.Full)
        {
            named.Add(OpMangal);
        }

        // Unnamed people who came too — counted, never named (P7).
        var anonymous = day == 0 ? 2 : 1 + (Math.Abs(day) % 3);
        var male = (named.Contains(OpGanesh) ? 1 : 0) + ((anonymous + 1) / 2);
        var female = (named.Contains(OpSunita) ? 1 : 0) + (named.Contains(OpMangal) ? 1 : 0) + (anonymous / 2);
        var count = male + female;

        // The farmer states a total on some days and not on others (NO-MULTIPLY: a total is
        // never derived — null means "not said"). One day is stated only approximately.
        decimal? total = null;
        NumericCertainty? certainty = null;
        string? spoken = null;
        if (day == -12)
        {
            total = 2_400m;
            certainty = NumericCertainty.Approximate;
            spoken = "साधारण २४०० झाले";
        }
        else if (day != 0 && Math.Abs(day) % 3 == 0)
        {
            total = count * DayRateWage;
            certainty = NumericCertainty.Reported;
        }

        return new DemoEngagementSeed(
            Key: $"grape-crew:{plotKey}:{day}",
            PlotKey: plotKey,
            DayOffset: day,
            EngagementType: LabourEngagementType.Hired,
            MaleCount: male,
            FemaleCount: female,
            WagePerPerson: DayRateWage,
            ContractUnit: null,
            ContractQuantity: null,
            TotalCost: total,
            CostCertainty: certainty,
            CostSpokenText: spoken,
            Shift: LabourShift.Full,
            StatedHours: null,
            Task: ResolveDemoLabourTask(plotKey, day),
            SpokenNames: named.Select(SpokenNameOf).ToList(),
            ThroughOperatorKey: null,
            AttachedOperatorKeys: named);
    }

    private static DemoEngagementSeed BuildCaneCrew(string plotKey, int day)
    {
        var count = 6 + (Math.Abs(day) % 3);
        var attached = new List<string> { OpShankar };
        if (day != 0)
        {
            attached.Add(OpBalu);
        }

        var spoken = attached.Select(SpokenNameOf).ToList();
        if (day != 0 && Math.Abs(day) % 5 == 0)
        {
            // Spoken, but nobody on the roster: a name with no identity behind it.
            spoken.Add("राजू");
        }

        return new DemoEngagementSeed(
            Key: $"cane-crew:{plotKey}:{day}",
            PlotKey: plotKey,
            DayOffset: day,
            EngagementType: LabourEngagementType.Hired,
            MaleCount: count - 3,
            FemaleCount: 3,
            WagePerPerson: CrewWage,
            ContractUnit: null,
            ContractQuantity: null,
            // The mukadam quotes the crew's day ("८ जण, २८०० ठरले") — stated, every day.
            TotalCost: count * CrewWage,
            CostCertainty: NumericCertainty.Reported,
            CostSpokenText: null,
            Shift: LabourShift.Full,
            StatedHours: null,
            Task: ResolveDemoLabourTask(plotKey, day),
            SpokenNames: spoken,
            ThroughOperatorKey: OpShankar,
            AttachedOperatorKeys: attached);
    }

    private static string SpokenNameOf(string operatorKey) => operatorKey switch
    {
        OpShankar => "शंकर",
        OpGanesh => "गणेश",
        OpSunita => "सुनीता",
        OpRamesh => "रमेश",
        OpBalu => "बाळू",
        OpMangal => "मंगल ताई",
        OpPatil => "पाटील काका",
        _ => operatorKey,
    };

    // ── हजेरी — who was marked how, per farm-day ───────────────────────────────

    private static bool GaneshAttachedToGrapeCrew(int day) =>
        // Named on the crew whenever he came — including the one day nobody
        // marked him (-10): being named on work is not being marked present.
        day == -10 || GaneshMark(day)?.Day == DayMark.Full;

    private static DemoMarkSeed? GaneshMark(int day)
    {
        if (IsWeeklyOff(day) || day == -10)
        {
            return null;
        }

        if (day is -31 or -17)
        {
            return new DemoMarkSeed(OpGanesh, day, DayMark.Absent, null, null, null);
        }

        // +2 जादा on the grape spraying days.
        var sprays = ResolveDemoLabourTask(FirstGrapePlotOn(day) ?? string.Empty, day) == "फवारणी";
        return new DemoMarkSeed(OpGanesh, day, DayMark.Full, null, null, sprays ? 2m : null);
    }

    private static DemoMarkSeed? SunitaMark(int day)
    {
        if (IsWeeklyOff(day) || day is -2 or -15)
        {
            return null;
        }

        return day switch
        {
            -30 or -18 or -5 => new DemoMarkSeed(OpSunita, day, DayMark.Absent, null, null, null),
            -26 or -12 or -3 => new DemoMarkSeed(OpSunita, day, DayMark.Half, null, null, null),
            _ => new DemoMarkSeed(OpSunita, day, DayMark.Full, null, null, null),
        };
    }

    private static DemoMarkSeed? MangalMark(int day)
    {
        if (IsWeeklyOff(day))
        {
            return null;
        }

        if (day is -33 or -11 or -1)
        {
            return new DemoMarkSeed(OpMangal, day, DayMark.Full, null, null, null);
        }

        return day % 2 == 0
            ? new DemoMarkSeed(OpMangal, day, DayMark.Half, null, null, null)
            : null;
    }

    private static List<DemoMarkSeed> BuildDemoMarks(IReadOnlyList<DemoEngagementSeed> engagements)
    {
        var attachedDays = engagements
            .SelectMany(e => e.AttachedOperatorKeys.Select(op => (op, e.DayOffset)))
            .ToHashSet();

        var marks = new List<DemoMarkSeed>();
        for (var day = LabourWindowStartOffset; day <= 0; day++)
        {
            if (GaneshMark(day) is { } ganesh)
            {
                marks.Add(ganesh);
            }

            if (SunitaMark(day) is { } sunita)
            {
                marks.Add(sunita);
            }

            if (MangalMark(day) is { } mangal)
            {
                marks.Add(mangal);
            }

            if (IsWeeklyOff(day))
            {
                continue;
            }

            // बाळू — Full whenever he was on Shankar's crew; otherwise an irregular hand:
            // some days absent, some days a stated four hours, some days nobody said.
            if (day == 0)
            {
                marks.Add(new DemoMarkSeed(OpBalu, day, DayMark.Half, null, null, null));
            }
            else if (attachedDays.Contains((OpBalu, day)))
            {
                marks.Add(new DemoMarkSeed(OpBalu, day, DayMark.Full, null, null, null));
            }
            else if (Math.Abs(day) % 3 == 0)
            {
                marks.Add(new DemoMarkSeed(OpBalu, day, DayMark.Absent, null, null, null));
            }
            else if (Math.Abs(day) % 3 == 1)
            {
                marks.Add(new DemoMarkSeed(OpBalu, day, null, null, 4m, null));
            }

            // शंकर — present on every day his crew (or his उक्ते job) worked, and today.
            if (day == 0 || attachedDays.Contains((OpShankar, day)))
            {
                marks.Add(new DemoMarkSeed(OpShankar, day, DayMark.Full, null, null, null));
            }

            // रमेश — on his contract days only.
            if (attachedDays.Contains((OpRamesh, day)))
            {
                marks.Add(new DemoMarkSeed(OpRamesh, day, DayMark.Full, null, null, null));
            }

            // पाटील काका — the night half; once both halves; once a day shift only.
            if (day == -1)
            {
                marks.Add(new DemoMarkSeed(OpPatil, day, DayMark.Full, NightMark.Worked, null, null));
            }
            else if (attachedDays.Contains((OpPatil, day)))
            {
                marks.Add(new DemoMarkSeed(OpPatil, day, null, NightMark.Worked, null, null));
            }
            else if (day == -20)
            {
                marks.Add(new DemoMarkSeed(OpPatil, day, DayMark.Full, null, null, null));
            }
        }

        return marks;
    }

    // ── payouts — labour money PAID (labour_misc cost entries) ─────────────────

    private static List<CostEntrySeed> BuildDemoLabourPayouts(IReadOnlyList<DemoEngagementSeed> engagements)
    {
        var payouts = new List<CostEntrySeed>();
        int[] payDays = [-27, -20, -13, -6];
        for (var week = 0; week < payDays.Length; week++)
        {
            var payDay = payDays[week];
            bool InWeek(DemoEngagementSeed e) => e.DayOffset >= payDay - 7 && e.DayOffset < payDay;

            var crewWages = engagements
                .Where(e => InWeek(e) && e.Key.StartsWith("cane-crew:", StringComparison.Ordinal))
                .Sum(e => e.TotalCost ?? 0m);
            if (crewWages > 0)
            {
                payouts.Add(new CostEntrySeed(
                    $"labour_crew_week_{week + 1}", null, "labour_misc",
                    "शंकर मुकादम टोळी — आठवड्याची मजुरी", crewWages, payDay, PurveshUserKey));
            }

            var dayRateWages = engagements
                .Where(e => InWeek(e)
                    && (e.Key.StartsWith("grape-crew:", StringComparison.Ordinal)
                        || e.Key.StartsWith("night-irrigation:", StringComparison.Ordinal)))
                .Sum(e => e.WorkerCount * (e.WagePerPerson ?? 0m));
            if (dayRateWages > 0)
            {
                payouts.Add(new CostEntrySeed(
                    $"labour_dayrate_week_{week + 1}", null, "labour_misc",
                    "रोजंदारी मजूर — आठवड्याची मजुरी", dayRateWages, payDay, PurveshUserKey));
            }
        }

        payouts.Add(new CostEntrySeed(
            "labour_ukte_thinning_advance", "grape_g1", "labour_misc",
            "रमेश भोसले — घड विरळणी उक्ते (आगाऊ)", 5_000m, -18, PurveshUserKey));
        payouts.Add(new CostEntrySeed(
            "labour_ukte_thinning_final", "grape_g1", "labour_misc",
            "रमेश भोसले — घड विरळणी उक्ते (उरलेले)", 7_000m, -6, PurveshUserKey));
        payouts.Add(new CostEntrySeed(
            "labour_ukte_bharani", "sugarcane_s2", "labour_misc",
            "S2 भरणी उक्ते — शंकर मुकादम टोळी", 6_500m, -17, PurveshUserKey));

        return payouts;
    }

    // ── planned work that is still AHEAD (the v2 plan is entirely in the past) ──

    /// <summary>
    /// Keyed like <see cref="PlannedSeedsByPlotKey"/>: <c>DayOffset</c> counts from the crop
    /// cycle's start, so <c>-StartOffsetDays + k</c> lands <c>k</c> days after today.
    /// </summary>
    private static Dictionary<string, PlannedActivitySeed[]> BuildUpcomingPlannedSeeds()
    {
        int FromToday(string plotKey, int daysAhead) =>
            -PlotSeeds.Single(p => p.Key == plotKey).StartOffsetDays + daysAhead;

        return new Dictionary<string, PlannedActivitySeed[]>(StringComparer.Ordinal)
        {
            ["grape_g1"] =
            [
                new PlannedActivitySeed(FromToday("grape_g1", 2), "Fruit Expansion-1", "Botrytis Control Spray"),
                new PlannedActivitySeed(FromToday("grape_g1", 6), "Berry Development", "0:0:50 SOP Fertigation"),
                new PlannedActivitySeed(FromToday("grape_g1", 10), "Berry Development", "Berry Size Spray"),
            ],
            ["grape_g2"] =
            [
                new PlannedActivitySeed(FromToday("grape_g2", 1), "Pre-Flowering", "Powdery Mildew Spray"),
                new PlannedActivitySeed(FromToday("grape_g2", 5), "Flowering Init", "GA3 Dose 2"),
            ],
            ["sugarcane_s1"] =
            [
                new PlannedActivitySeed(FromToday("sugarcane_s1", 4), "Tillering", "Flood Irrigation"),
                new PlannedActivitySeed(FromToday("sugarcane_s1", 9), "Tillering", "Top Shoot Inspection"),
            ],
            ["sugarcane_s2"] =
            [
                new PlannedActivitySeed(FromToday("sugarcane_s2", 2), "Tillering", "Flood Irrigation"),
                new PlannedActivitySeed(FromToday("sugarcane_s2", 7), "Tillering", "Urea Dose 1 Application"),
            ],
        };
    }

    // ── helpers over the v2 log schedule ───────────────────────────────────────

    private static bool IsGrapePlot(string plotKey) => plotKey.StartsWith("grape_", StringComparison.Ordinal);

    /// <summary>Seed-log plot keys per day offset, in PlotSeeds order (g1, g2, s1, s2).</summary>
    private static Dictionary<int, List<string>> BuildSeedLogPlotsByDay()
    {
        var byDay = new Dictionary<int, List<string>>();
        foreach (var plot in PlotSeeds)
        {
            if (!LogSchedule.TryGetValue(plot.Key, out var offsets))
            {
                continue;
            }

            foreach (var offset in offsets)
            {
                if (!byDay.TryGetValue(offset, out var plots))
                {
                    plots = [];
                    byDay[offset] = plots;
                }

                plots.Add(plot.Key);
            }
        }

        return byDay;
    }

    private static string? FirstGrapePlotOn(int day) =>
        BuildSeedLogPlotsByDay().TryGetValue(day, out var plots) ? plots.FirstOrDefault(IsGrapePlot) : null;

    /// <summary>
    /// The engagement's task, read off the SAME task pattern the seed log on that plot and day
    /// carries, so the labour line and the log's own work agree.
    /// </summary>
    private static string ResolveDemoLabourTask(string plotKey, int day)
    {
        var plot = PlotSeeds.FirstOrDefault(p => p.Key == plotKey);
        if (plot is null || !LogSchedule.TryGetValue(plotKey, out var offsets))
        {
            return "शेतातील कामे";
        }

        var index = Array.IndexOf(offsets, day);
        if (index < 0)
        {
            return "शेतातील कामे";
        }

        var work = ResolveTaskPattern(plotKey, plot.CropName, day, index)
            .FirstOrDefault(a => !a.Equals("Observation", StringComparison.OrdinalIgnoreCase));

        return work switch
        {
            "Spraying" => "फवारणी",
            "Fertigation" => "खत (फर्टिगेशन)",
            "Irrigation" => "पाणी देणे",
            "Pruning" => "छाटणी",
            "Weeding" => "तण काढणी",
            "Fertilizer application" => "खत देणे",
            "Machinery" => "यंत्र मदत",
            _ => IsGrapePlot(plotKey) ? "घड व पाने तपासणी" : "बांध दुरुस्ती",
        };
    }
}
