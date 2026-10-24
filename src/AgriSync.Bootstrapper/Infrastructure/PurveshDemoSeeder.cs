using System.Security.Cryptography;
using System.Text;
using Accounts.Domain.Affiliation;
using Accounts.Domain.OwnerAccounts;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Domain.Identity;
using User.Infrastructure.Persistence;
using SharedAppRole = AgriSync.SharedKernel.Contracts.Roles.AppRole;
using UserAppRole = User.Domain.Membership.AppRole;

namespace AgriSync.Bootstrapper.Infrastructure;

public sealed partial class PurveshDemoSeeder
{
    private const string AppId = "shramsafal";
    // v2 (2026-05-13): single-test-user redesign per founder spec.
    // Changes from v1: Purvesh phone 9800000001 -> 8888888888, password
    // purvesh123 -> Testuser@123, full name now includes middle (literal
    // spelling "Chandrashkehar" per founder confirmation), plots reduced
    // to 4 (Grapes×2 + Sugarcane×2 only), farm attached to a deterministic
    // OwnerAccountId so the SQL cleanup script can pre-seed a matching
    // Trialing subscription row in accounts.subscriptions.
    private const string SeedVersion = "purvesh-demo-v2";
    private const string PurveshFarmName = "पुरुषोत्तमशेत, खार्डी";
    // UserSeeds key of the farm owner — the one seat that is the PrimaryOwner
    // on both public.memberships and ssf.farm_memberships.
    private const string PurveshUserKey = "purvesh";

    // Deterministic OwnerAccountId for Purvesh's farm. v2 (2026-05-13):
    // seeder now creates the matching accounts.owner_accounts row itself
    // via OwnerAccount.Create(...) in EnsurePurveshOwnerAccountAsync, so
    // the Farm's OwnerAccountId is no longer a dangling reference.
    // (Pre-v2: Ramu still has this orphan bug — tracked in
    // T-RAMU-OWNER-ACCOUNT-ORPHAN-FIX-2026-05-13.md.)
    private static readonly OwnerAccountId PurveshOwnerAccountId =
        new(Guid.Parse("00000000-0000-0000-0000-0000000000c2"));

    // Synthetic "referred" OwnerAccountId used by the demo affiliation chain.
    // Must NOT equal PurveshOwnerAccountId (Invariant I13 — no self-referral).
    // Deterministic via SeedVersion so re-runs produce the same row.
    private static readonly OwnerAccountId PurveshSyntheticReferredAccountId =
        new(CreateDeterministicGuid("purvesh-demo-v2:affiliation:referred-synthetic"));

    // 8-char Crockford Base32 referral code for Purvesh. Crockford forbids
    // I, L, O, U (visually ambiguous with 1, 0, V). "PRVSHARV" drops vowels
    // from "Purvesh Arve" while staying alphabet-compliant. Future-proofs
    // against a hypothetical CHECK constraint on the code column.
    private const string PurveshReferralCode = "PRVSHARV";

    // Belt-and-suspenders compile-visible assertion of Invariant I13 (no
    // self-referral). The deterministic SHA-256 derivation makes a collision
    // with PurveshOwnerAccountId (...c2) cryptographically impossible today,
    // and ReferralRelationship's ctor would throw at runtime if it ever did.
    // This static-ctor guard documents the invariant where it's most visible
    // and catches future refactors that change the seed string.
    static PurveshDemoSeeder()
    {
        if (PurveshOwnerAccountId == PurveshSyntheticReferredAccountId)
        {
            throw new InvalidOperationException(
                "Purvesh demo: synthetic referred owner account collides with " +
                "Purvesh's own (Invariant I13 — no self-referral).");
        }
    }

    private static readonly UserSeed[] UserSeeds =
    [
        new("purvesh", "Purvesh Chandrashkehar Arve", "8888888888", "Testuser@123", UserAppRole.PrimaryOwner),
        new("shankar", "Shankar Jadhav", "9800000002", "shankar123", UserAppRole.Mukadam),
        new("raju", "Raju Bhosale", "9800000003", "raju123", UserAppRole.Worker),
        new("santosh", "Santosh Kamble", "9800000004", "santosh123", UserAppRole.Worker)
    ];

    // v2: 4 plots / 2 crops (Grapes×2 + Sugarcane×2) per founder Q5 Interp A.
    // Pomegranate / Turmeric / Bajra entries removed from PlotSeeds and from
    // all downstream config (TemplateSeeds, PlannedSeedsByPlotKey,
    // OperatorRoutingByPlotKey, TaskPatternsByCropName, AllocationPlotKeys,
    // AttachmentSeeds) and from per-plot helpers (Build*Pattern methods,
    // IsRestDay modulos, ApplyVerificationPattern switch, resource resolvers).
    private static readonly PlotSeed[] PlotSeeds =
    [
        new("grape_g1", "द्राक्ष G1", 1.5m, "Grapes", "Pruning", -85),
        new("grape_g2", "द्राक्ष G2", 1.0m, "Grapes", "Pruning", -75),
        new("sugarcane_s1", "ऊस S1", 1.0m, "Sugarcane", "Planting", -90),
        new("sugarcane_s2", "ऊस S2", 0.5m, "Sugarcane", "Tillering", -60)
    ];

    private static readonly TemplateSeed[] TemplateSeeds =
    [
        new(
            "grapes_irrigation",
            "Grapes - Irrigation",
            "Pruning",
            [
                new TemplateActivitySeed("Drip Irrigation", 0, FrequencyMode.EveryNDays, 3),
                new TemplateActivitySeed("Drip Lines Check", 1, FrequencyMode.EveryNDays, 7)
            ]),
        new(
            "grapes_fertigation",
            "Grapes - Fertigation",
            "Sprouting Phase",
            [
                new TemplateActivitySeed("Calcium Nitrate Fertigation", 0, FrequencyMode.EveryNDays, 7),
                new TemplateActivitySeed("13:00:45 Fertigation", 3, FrequencyMode.EveryNDays, 7),
                new TemplateActivitySeed("0:52:34 Fertigation", 5, FrequencyMode.EveryNDays, 14)
            ]),
        new(
            "grapes_spray",
            "Grapes - Spray",
            "Pre-Flowering",
            [
                new TemplateActivitySeed("Powdery Mildew Spray", 0, FrequencyMode.EveryNDays, 14),
                new TemplateActivitySeed("Thrips Control Spray", 7, FrequencyMode.EveryNDays, 14),
                new TemplateActivitySeed("Botrytis Spray", 10, FrequencyMode.EveryNDays, 14)
            ]),
        new(
            "sugarcane_irrigation",
            "Sugarcane - Irrigation",
            "Planting",
            [
                new TemplateActivitySeed("Flood Irrigation", 0, FrequencyMode.EveryNDays, 7)
            ]),
        new(
            "sugarcane_fertilizer",
            "Sugarcane - Fertilizer",
            "Planting",
            [
                new TemplateActivitySeed("DAP Basal Application", 5, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Urea Dose 1 Application", 30, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Urea Dose 2 Application", 60, FrequencyMode.OneTime, 1)
            ]),
        new(
            "sugarcane_pest_spray",
            "Sugarcane - Pest Spray",
            "Tillering",
            [
                new TemplateActivitySeed("Stem Borer Spray", 0, FrequencyMode.EveryNDays, 30),
                new TemplateActivitySeed("Top Shoot Inspection", 0, FrequencyMode.EveryNDays, 15)
            ])
    ];

    private static readonly IReadOnlyDictionary<string, PlannedActivitySeed[]> PlannedSeedsByPlotKey =
        new Dictionary<string, PlannedActivitySeed[]>(StringComparer.Ordinal)
        {
            ["grape_g1"] =
            [
                new PlannedActivitySeed(1, "Post Pruning", "Heavy Irrigation"),
                new PlannedActivitySeed(2, "Post Pruning", "Paste on Cuts"),
                new PlannedActivitySeed(5, "Budbreak Initiation", "Preventive Fungicide Spray"),
                new PlannedActivitySeed(8, "Budbreak Initiation", "Thrips Control Spray"),
                new PlannedActivitySeed(10, "Sprouting Phase", "Vegetative Boost Fertigation"),
                new PlannedActivitySeed(12, "Sprouting Phase", "Shoot Thinning"),
                new PlannedActivitySeed(20, "Rapid Vegetative", "Pre-Bloom Phosphorous Fertigation"),
                new PlannedActivitySeed(22, "Rapid Vegetative", "GA3 Dose 1"),
                new PlannedActivitySeed(28, "Pre-Flowering", "Powdery Mildew Spray"),
                new PlannedActivitySeed(35, "Flowering Init", "GA3 Dose 2"),
                new PlannedActivitySeed(40, "Flowering-Fruit Set", "0:52:34 Fertigation Boost"),
                new PlannedActivitySeed(45, "Flowering-Fruit Set", "Berry Size Spray"),
                new PlannedActivitySeed(55, "Berry Development", "0:0:50 SOP Fertigation"),
                new PlannedActivitySeed(60, "Fruit Expansion-1", "Botrytis Control Spray")
            ],
            ["grape_g2"] =
            [
                new PlannedActivitySeed(1, "Post Pruning", "Heavy Irrigation"),
                new PlannedActivitySeed(5, "Budbreak Initiation", "Preventive Fungicide Spray"),
                new PlannedActivitySeed(10, "Sprouting Phase", "Vegetative Boost Fertigation"),
                new PlannedActivitySeed(22, "Rapid Vegetative", "GA3 Dose 1"),
                new PlannedActivitySeed(28, "Pre-Flowering", "Powdery Mildew Spray"),
                new PlannedActivitySeed(40, "Flowering-Fruit Set", "0:52:34 Fertigation Boost"),
                new PlannedActivitySeed(55, "Berry Development", "0:0:50 SOP Fertigation"),
                new PlannedActivitySeed(60, "Fruit Expansion-1", "Botrytis Control Spray")
            ],
            ["sugarcane_s1"] =
            [
                new PlannedActivitySeed(1, "Planting", "Flood Irrigation"),
                new PlannedActivitySeed(5, "Planting", "DAP Basal Application"),
                new PlannedActivitySeed(30, "Planting", "Urea Dose 1 Application"),
                new PlannedActivitySeed(45, "Tillering", "Top Shoot Inspection"),
                new PlannedActivitySeed(60, "Tillering", "Urea Dose 2 Application"),
                new PlannedActivitySeed(75, "Tillering", "Stem Borer Spray")
            ],
            ["sugarcane_s2"] =
            [
                new PlannedActivitySeed(1, "Tillering", "Flood Irrigation"),
                new PlannedActivitySeed(8, "Tillering", "Flood Irrigation")
            ]
        };

    private static readonly IReadOnlyDictionary<string, OperatorRoutingSeed> OperatorRoutingByPlotKey =
        new Dictionary<string, OperatorRoutingSeed>(StringComparer.Ordinal)
        {
            ["grape_g1"] = new OperatorRoutingSeed("shankar", "raju", 5, "purvesh"),
            ["grape_g2"] = new OperatorRoutingSeed("raju", "santosh", 2, "purvesh"),
            ["sugarcane_s1"] = new OperatorRoutingSeed("shankar", "santosh", 4, "purvesh"),
            ["sugarcane_s2"] = new OperatorRoutingSeed("raju", null, 0, null)
        };

    // 90-day log schedule constants (v2): drives BuildLogSchedule().
    // Negative offsets are days-before-today. The schedule produces a
    // hand-tuned dense window (last 8 days) and rule-based sparse window
    // (days -8..-90) so the demo data set surfaces all the patterns the
    // founder spec'd: distraction days (work disrupted, only sugarcane
    // logged), multi-crop days (all 4 plots active on one day), and
    // same-crop-different-work days (the two grape plots do contrasting
    // activities — Pruning on g1 vs Spraying on g2 — to demo "two plots
    // of the same crop don't always do the same thing").
    private static readonly HashSet<int> DistractionDayOffsets = new() { -14, -28, -42, -55, -67, -78 };
    private static readonly HashSet<int> MultiCropDayOffsets = new() { -11, -22, -33, -44, -66, -77, -88 };
    private static readonly HashSet<int> SameCropDifferentWorkOffsets = new() { -21, -35, -49, -63 };

    // Dense-window rotation: index 0 = today, index 7 = 7 days ago.
    // Per-day plot list is hand-curated for variety (2-3 plots/day, all 4 on day -3).
    private static readonly string[][] DenseWindowRotation =
    [
        ["grape_g1", "grape_g2", "sugarcane_s1"],
        ["grape_g1", "sugarcane_s1", "sugarcane_s2"],
        ["grape_g2", "sugarcane_s2"],
        ["grape_g1", "grape_g2", "sugarcane_s1", "sugarcane_s2"],
        ["grape_g1", "sugarcane_s1"],
        ["grape_g2", "sugarcane_s2", "grape_g1"],
        ["grape_g2", "sugarcane_s1"],
        ["grape_g1", "sugarcane_s2", "grape_g2"]
    ];

    // Sparse-window default rotation. The 4-cycle (g1 → s1 → g2 → s2)
    // produces a balanced presence across the 90-day window. When the
    // rotation-selected plot didn't exist yet (offset < its StartOffsetDays),
    // the fallback walks the rotation forward until an existing plot is
    // found — this prevents empty days in [-71, -90] where g2/s2 hadn't
    // started yet.
    private static readonly string[] SparseRotationOrder =
    [
        "grape_g1", "sugarcane_s1", "grape_g2", "sugarcane_s2"
    ];

    private static readonly IReadOnlyDictionary<string, int[]> LogSchedule = BuildLogSchedule();

    private static IReadOnlyDictionary<string, int[]> BuildLogSchedule()
    {
        var schedule = PlotSeeds.ToDictionary(s => s.Key, _ => new List<int>(), StringComparer.Ordinal);
        var startOffsetByKey = PlotSeeds.ToDictionary(s => s.Key, s => s.StartOffsetDays, StringComparer.Ordinal);

        bool PlotExists(string plotKey, int dayOffset) =>
            startOffsetByKey.TryGetValue(plotKey, out var start) && dayOffset >= start;

        // Dense window: 8 days, hand-tuned rotation
        for (var day = 0; day < DenseWindowRotation.Length; day++)
        {
            var offset = -day;
            foreach (var plotKey in DenseWindowRotation[day])
            {
                if (PlotExists(plotKey, offset) && schedule.ContainsKey(plotKey))
                {
                    schedule[plotKey].Add(offset);
                }
            }
        }

        // Sparse window: offsets -8 to -90
        for (var offset = -8; offset >= -90; offset--)
        {
            if (DistractionDayOffsets.Contains(offset))
            {
                // Work disrupted: only sugarcane plots log (grapes "skipped" today)
                if (PlotExists("sugarcane_s1", offset)) schedule["sugarcane_s1"].Add(offset);
                if (PlotExists("sugarcane_s2", offset)) schedule["sugarcane_s2"].Add(offset);
            }
            else if (MultiCropDayOffsets.Contains(offset))
            {
                // All 4 plots active on the same day
                foreach (var plotKey in SparseRotationOrder)
                {
                    if (PlotExists(plotKey, offset) && schedule.ContainsKey(plotKey))
                    {
                        schedule[plotKey].Add(offset);
                    }
                }
            }
            else if (SameCropDifferentWorkOffsets.Contains(offset))
            {
                // Both grape plots log; activities overridden in ResolveTaskPattern
                // (g1=Pruning, g2=Spraying). One sugarcane plot also logs via
                // the default-rotation slot so the day isn't grape-only.
                if (PlotExists("grape_g1", offset)) schedule["grape_g1"].Add(offset);
                if (PlotExists("grape_g2", offset)) schedule["grape_g2"].Add(offset);

                var rotIdx = Math.Abs(offset) % SparseRotationOrder.Length;
                for (var step = 0; step < SparseRotationOrder.Length; step++)
                {
                    var candidate = SparseRotationOrder[(rotIdx + step) % SparseRotationOrder.Length];
                    if ((candidate == "sugarcane_s1" || candidate == "sugarcane_s2") &&
                        PlotExists(candidate, offset))
                    {
                        schedule[candidate].Add(offset);
                        break;
                    }
                }
            }
            else
            {
                // Default sparse: 1 plot per day via 4-cycle rotation.
                // Fallback walks the rotation forward when the picked plot
                // didn't exist yet at this offset.
                var rotIdx = Math.Abs(offset) % SparseRotationOrder.Length;
                string? primary = null;
                for (var step = 0; step < SparseRotationOrder.Length; step++)
                {
                    var candidate = SparseRotationOrder[(rotIdx + step) % SparseRotationOrder.Length];
                    if (PlotExists(candidate, offset))
                    {
                        primary = candidate;
                        break;
                    }
                }

                if (primary is not null)
                {
                    schedule[primary].Add(offset);

                    // Every 7th day, add a second log from the next rotation slot
                    if (Math.Abs(offset) % 7 == 0)
                    {
                        var primaryIdx = Array.IndexOf(SparseRotationOrder, primary);
                        for (var step = 1; step <= SparseRotationOrder.Length; step++)
                        {
                            var candidate = SparseRotationOrder[(primaryIdx + step) % SparseRotationOrder.Length];
                            if (candidate != primary && PlotExists(candidate, offset))
                            {
                                schedule[candidate].Add(offset);
                                break;
                            }
                        }
                    }
                }
            }
        }

        return schedule.ToDictionary(
            kvp => kvp.Key,
            kvp => kvp.Value.OrderByDescending(o => o).ToArray(),
            StringComparer.Ordinal);
    }

    private static readonly IReadOnlyDictionary<string, string[][]> TaskPatternsByCropName =
        new Dictionary<string, string[][]>(StringComparer.OrdinalIgnoreCase)
        {
            ["Grapes"] =
            [
                ["Spraying", "Fertigation", "Observation"],
                ["Pruning", "Irrigation", "Observation"],
                ["Spraying", "Observation"]
            ],
            ["Sugarcane"] =
            [
                ["Irrigation", "Fertilizer application", "Observation"],
                ["Weeding", "Irrigation"],
                ["Fertilizer application", "Observation"]
            ]
        };

    private static readonly IReadOnlyDictionary<string, string[][]> TaskPatternsByPlotKey =
        new Dictionary<string, string[][]>(StringComparer.OrdinalIgnoreCase)
        {
            // S2 intentionally skips most fertilizer actions to surface missed-nutrition behavior in Compare.
            ["sugarcane_s2"] =
            [
                ["Irrigation", "Observation"],
                ["Weeding", "Irrigation"],
                ["Observation", "Irrigation"]
            ]
        };

    private static readonly IReadOnlyDictionary<string, string[]> NotesByActivityType =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["Spraying"] =
            [
                "टोरस + मँकोझेब स्प्रे केले. थ्रिप्स दिसत होते.",
                "बोट्रायटिस प्रतिबंधक फवारणी. सकाळी ७ वाजता.",
                "बॅक्टेरियल ब्लाइट स्प्रे. रोग आटोक्यात आहे."
            ],
            ["Fertigation"] =
            [
                "19:19:19 खत दिले. झाडे हिरवी दिसत आहेत.",
                "कॅल्शियम नायट्रेट फर्टिगेशन केले. ड्रिप चालू होती.",
                "0:52:34 डोस दिला. GA3 टाकले."
            ],
            ["Pruning"] =
            [
                "छाटणीची सुरुवात केली. ३ कामगार आले.",
                "छाटणी पूर्ण. जखमांवर बोर्डो पेस्ट लावली."
            ],
            ["Irrigation"] =
            [
                "ड्रिप ३ तास चालली. सर्व ओळी ओल्या झाल्या.",
                "पूर पाणी दिले. जमिनीत ओल वाढली.",
                "स्प्रिंकलरने सिंचन केले."
            ],
            ["Observation"] =
            [
                "सगळे ठीक आहे. नवीन कळ्या येत आहेत.",
                "थ्रिप्स दिसले. उद्या फवारणी करणार.",
                "पाऊस आला, काम थांबवले."
            ],
            ["Fertilizer application"] =
            [
                "युरिया दिला. मजूर ४ आले.",
                "DAP बेसल दिला. जमीन ओली होती.",
                "दुसरा खत डोस दिला."
            ],
            ["Weeding"] =
            [
                "तण काढले. एक दिवसाचे काम पूर्ण.",
                "रजू आला नाही आज. काम अर्धे राहिले."
            ],
            ["Machinery"] =
            [
                "पॉवर स्प्रेयर आणि लाईन तपासणी केली. उद्याच्या कामासाठी यंत्र तयार ठेवले.",
                "ट्रॅक्टर/इम्प्लिमेंट तपासले. बेल्ट आणि ग्रीसिंग पूर्ण.",
                "मोटर, फिल्टर आणि व्हॉल्व्ह तपासून पुन्हा लाईन सुरू केली."
            ]
        };

    private static readonly PriceConfigSeed[] PriceConfigSeeds =
    [
        new("Urea", 290.00m),
        new("DAP", 1350.00m),
        new("19:19:19", 85.00m),
        new("13:00:45", 78.00m),
        new("Calcium Nitrate", 68.00m),
        new("Labour-Male", 550.00m),
        new("Labour-Female", 420.00m),
        new("Tractor Hire", 2000.00m),
        new("Kasugamycin", 820.00m)
    ];

    private static readonly string[] AllocationPlotKeys =
    [
        "grape_g1",
        "grape_g2",
        "sugarcane_s1",
        "sugarcane_s2"
    ];

    private const string G2DisputeReason = "गव्हाण वेळेत भरले नाही";

    private static readonly AttachmentSeed[] AttachmentSeeds =
    [
        // grape_g1 starts at offset -85 but the v2 90-day schedule's earliest
        // g1 log is at -84 (rotation primary at -85 is sugarcane_s1). The
        // attachment must link to an existing daily-log GUID, so we anchor
        // to -84 — the first day g1 logs (narrative "pruning happened on
        // day 1 of the new cycle" still holds).
        new("grapes-g1-pruning", "grapes-g1-pruning.jpg", "DailyLog", "grape_g1", -84, "shankar", 186_420),
        new("grapes-g2-growth", "grapes-g2-growth.jpg", "DailyLog", "grape_g2", -38, "shankar", 192_300),
        new("sugarcane-s1-planting", "sugarcane-s1-planting.jpg", "DailyLog", "sugarcane_s1", -90, "shankar", 178_650),
        new("farm-overview", "farm-overview.jpg", "Farm", null, null, "shankar", 210_510)
    ];

    // ── Labour V1 Task 10 (spec: 2026-07-13-labour-attendance-approval-design) ──
    // The SINGLE SOURCE OF TRUTH for which ssf.field_operators /
    // ssf.field_operator_work_rows / ssf.attendance_marks /
    // ssf.labour_assignments rows this seeder owns is the demo LABOUR PLAN in
    // PurveshDemoSeeder.Labour.cs (BuildDemoLabourPlan). Every id there is
    // minted from CreateDeterministicGuid($"{SeedVersion}:<kind>:<key>"), and the
    // teardowns below identify rows ONLY by re-minting those ids — correct by
    // construction, never by inference — on the demo farm only.
    //
    // History: until 2026-10-17 this set was DELIBERATELY EMPTY (founder-gated,
    // 2026-08-11) — "seeding demo identities is the founder's call". The founder
    // has now asked for demo workers, a Mukadam crew and attendance on the demo
    // farm (spec 2026-08-25-prod-cutover-waves, demo-seed-v3 envelope). They are
    // written ONLY by the one-shot `--reseed-purvesh-demo` command
    // (PurveshDemoSeeder.Reseed.cs), never by SeedPurveshDemoAsync, so the
    // startup / e2e fixture path is unchanged.
    //
    // NOTE the cross-file rule: the plan lives in another partial file, so it is
    // reached through METHODS, never through a static field initializer here —
    // C# does not define the order in which static initializers of different
    // partial-class files run.

    /// <summary>
    /// Thrown by <see cref="ClearPurveshDemoAsync"/> when the demo farm holds
    /// field-operator identity data this seeder did not create. Public so tests
    /// can assert the guard fired rather than matching on prose.
    /// </summary>
    public const string NonSeedFieldOperatorDataMessage =
        "PurveshDemoSeeder refuses to clear the demo farm: it holds field-operator "
        + "identity data that this seeder did not create.";

    private readonly ShramSafalDbContext _ssfContext;
    private readonly UserDbContext _userContext;
    private readonly AccountsDbContext _accountsContext;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IHostEnvironment? _hostEnvironment;

    /// <summary>
    /// The text every Production refusal of the startup clear/seed carries. Public so tests and
    /// operators can recognise the refusal without matching on prose.
    /// </summary>
    public const string ProductionRefusalMessage =
        "PurveshDemoSeeder refuses the startup demo clear/seed in Production: DemoFarmId is the real "
        + "production demo farm, and these methods would delete or rebuild it. Nothing was read or written. "
        + "Use the one-shot `--reseed-purvesh-demo` command (with --dry-run first) instead.";

    /// <param name="hostEnvironment">
    /// The host's environment, injected by DI for every real caller (Program.cs startup,
    /// <c>--migrate-only</c>, TestFixtureService). It is what makes
    /// <see cref="ClearPurveshDemoAsync"/> and <see cref="SeedPurveshDemoAsync"/> refuse in
    /// Production BY CONSTRUCTION. Optional only so an existing direct construction (a test, no
    /// DI) keeps compiling; then the process's <c>ASPNETCORE_ENVIRONMENT</c> /
    /// <c>DOTNET_ENVIRONMENT</c> decides, and "Production" still refuses.
    /// </param>
    public PurveshDemoSeeder(
        ShramSafalDbContext ssfContext,
        UserDbContext userContext,
        AccountsDbContext accountsContext,
        IPasswordHasher passwordHasher,
        IHostEnvironment? hostEnvironment = null)
    {
        _ssfContext = ssfContext;
        _userContext = userContext;
        _accountsContext = accountsContext;
        _passwordHasher = passwordHasher;
        _hostEnvironment = hostEnvironment;
    }

    /// <summary>
    /// The Production guard for the STARTUP clear/seed — checked before any database access.
    /// The one-shot <see cref="ReseedDemoContentAsync"/> never calls the guarded methods and is
    /// not guarded: it is the production path.
    /// </summary>
    private void RefuseInProduction(string operation)
    {
        var environmentName = _hostEnvironment?.EnvironmentName
            ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT");
        if (string.Equals(environmentName, Environments.Production, StringComparison.OrdinalIgnoreCase))
        {
            throw new PurveshDemoStartupSeedRefusedException($"{operation}: {ProductionRefusalMessage}");
        }
    }

    public async Task<string> SeedPurveshDemoAsync(CancellationToken cancellationToken = default)
    {
        RefuseInProduction(nameof(SeedPurveshDemoAsync));
        var refreshResult = await ClearPurveshDemoAsync(cancellationToken);
        var nowUtc = DateTime.UtcNow;
        var usersByKey = new Dictionary<string, User.Domain.Identity.User>(StringComparer.Ordinal);

        foreach (var seed in UserSeeds)
        {
            var user = await EnsureUserAsync(seed, nowUtc, cancellationToken);
            usersByKey[seed.Key] = user;
        }

        var purvesh = usersByKey["purvesh"];

        // v2: Accounts-context aggregates (owner account + subscription) MUST
        // precede the Farm so the Farm's OwnerAccountId references a real row.
        // OwnerAccount.Create(...) internally seeds the PrimaryOwner membership.
        var ownerAccountAdded = await EnsurePurveshOwnerAccountAsync(purvesh.Id, nowUtc, cancellationToken);
        var subscriptionAdded = await EnsurePurveshSubscriptionAsync(nowUtc, cancellationToken);
        await _accountsContext.SaveChangesAsync(cancellationToken);

        var farm = await EnsureFarmAsync(purvesh.Id, nowUtc, cancellationToken);
        // ssf.farm_memberships MUST be seeded alongside the farm. The User
        // context's public.memberships rows created by EnsureUserAsync are a
        // DIFFERENT thing (app-level role per user); every farm-scoped read
        // path — /user/auth/me/context (FarmMembershipSnapshotReader), the
        // labour wage book (GetLabourDataHandler step 1), authorization
        // (ShramSafalAuthorizationEnforcer) — resolves the farm roster from
        // ssf.farm_memberships. Without these rows me/context answers
        // "farms": [] + alert no_farms_yet, the client drops its persisted
        // farm id, and every real screen renders zeros.
        var farmMembershipsAdded = await EnsurePurveshFarmMembershipsAsync(
            farm.Id, usersByKey, nowUtc, cancellationToken);
        var plotContexts = await EnsurePlotsAndCropCyclesAsync(farm.Id, nowUtc, cancellationToken);
        var phase3Stats = await EnsureScheduleTemplatesAndPlannedActivitiesAsync(plotContexts, purvesh.Id, nowUtc, cancellationToken);
        var contextByPlotKey = plotContexts.ToDictionary(c => c.Seed.Key, c => c, StringComparer.Ordinal);
        var userIdsByKey = usersByKey.ToDictionary(pair => pair.Key, pair => pair.Value.Id, StringComparer.Ordinal);
        var phase4LogStats = await EnsureDailyLogsAndVerificationsAsync(
            farm.Id,
            contextByPlotKey,
            userIdsByKey,
            nowUtc,
            DemoVerificationMode.Legacy,
            retainedLogIds: null,
            cancellationToken);
        var phase4FinanceStats = await EnsureFinanceAsync(
            farm.Id,
            contextByPlotKey,
            userIdsByKey,
            nowUtc,
            includePriceConfigs: true,
            BuildCostEntrySeeds(),
            retainedCostIds: null,
            cancellationToken);
        var phase5AttachmentStats = await EnsureAttachmentsAsync(
            farm.Id,
            userIdsByKey,
            nowUtc,
            cancellationToken);

        // v2 Phase 6: multi-tenant aggregates (Accounts + ShramSafal-farms-tenant)
        var phase6Stats = await EnsureMultiTenantDataAsync(
            farm,
            purvesh.Id,
            nowUtc,
            cancellationToken);

        await _ssfContext.SaveChangesAsync(cancellationToken);
        await _accountsContext.SaveChangesAsync(cancellationToken);

        var totals = new PhaseTotals(
            UserCount: usersByKey.Count,
            FarmCount: 1,
            FarmMembershipsAdded: farmMembershipsAdded,
            PlotCount: plotContexts.Count,
            CropCycleCount: plotContexts.Count,
            ScheduleTemplateCount: TemplateSeeds.Length,
            TemplateActivitiesAdded: phase3Stats.TemplateActivitiesAdded,
            PlannedActivitiesAdded: phase3Stats.PlannedActivitiesAdded,
            DailyLogsAdded: phase4LogStats.LogsAdded,
            LogTasksAdded: phase4LogStats.TasksAdded,
            VerificationEventsAdded: phase4LogStats.VerificationsAdded,
            CostEntriesAdded: phase4FinanceStats.CostEntriesAdded,
            FinanceCorrectionsAdded: phase4FinanceStats.CorrectionsAdded,
            DayLedgersAdded: phase4FinanceStats.DayLedgersAdded,
            PriceConfigsAdded: phase4FinanceStats.PriceConfigsAdded,
            AttachmentsAdded: phase5AttachmentStats.AttachmentsAdded,
            OwnerAccountsAdded: ownerAccountAdded,
            SubscriptionsAdded: subscriptionAdded,
            FarmInvitationsAdded: phase6Stats.FarmInvitationsAdded,
            FarmJoinTokensAdded: phase6Stats.FarmJoinTokensAdded,
            AffiliationRowsAdded: phase6Stats.AffiliationRowsAdded);

        return $"Refreshed {SeedVersion}. {refreshResult} | " +
               $"Phase 2+3+4+5+6 seeded. " +
               $"users={totals.UserCount}, farms={totals.FarmCount}, " +
               $"farmMembershipsAdded={totals.FarmMembershipsAdded}, plots={totals.PlotCount}, " +
               $"cropCycles={totals.CropCycleCount}, templates={totals.ScheduleTemplateCount}, " +
               $"templateActivitiesAdded={totals.TemplateActivitiesAdded}, plannedActivitiesAdded={totals.PlannedActivitiesAdded}, " +
               $"dailyLogsAdded={totals.DailyLogsAdded}, logTasksAdded={totals.LogTasksAdded}, " +
               $"verificationsAdded={totals.VerificationEventsAdded}, costEntriesAdded={totals.CostEntriesAdded}, " +
               $"correctionsAdded={totals.FinanceCorrectionsAdded}, dayLedgersAdded={totals.DayLedgersAdded}, " +
               $"priceConfigsAdded={totals.PriceConfigsAdded}, attachmentsAdded={totals.AttachmentsAdded}, " +
               $"ownerAccountsAdded={totals.OwnerAccountsAdded}, subscriptionsAdded={totals.SubscriptionsAdded}, " +
               $"farmInvitationsAdded={totals.FarmInvitationsAdded}, farmJoinTokensAdded={totals.FarmJoinTokensAdded}, " +
               $"affiliationRowsAdded={totals.AffiliationRowsAdded}, " +
               $"anchorUtc={nowUtc:O}.";
    }

    /// <summary>
    /// The startup / e2e teardown of the WHOLE demo spine (<c>CLEAR_PURVESH_DEMO=true</c>, and
    /// <c>TestFixtureService</c>'s "purvesh-demo" reset): the demo farm with its content and labour
    /// layer, then the seeder's own global rows — its logins, owner account, templates and price
    /// configs.
    /// </summary>
    /// <remarks>
    /// <para><b>No silent partial clear (2026-10-17).</b> Run as <c>agrisync_app</c> — the role the
    /// tracked appsettings.Development.json gives the startup path — the clear used to query the
    /// FORCE-RLS tables with no tenant setting, see none of the farm's rows, delete the logins,
    /// account, templates and price configs anyway, and report "Cleared" while the farm, its 135
    /// logs and its labour layer stayed behind. Now, in this order:</para>
    /// <list type="number">
    /// <item><b>Who must survive is decided first, read-only.</b> A seed login that still owns or
    /// belongs to ANY other farm, and the owner account when any other farm is attached to it, are
    /// kept and named in the result — multi-farm-per-login is core, and those rows are not the
    /// demo's to delete.</item>
    /// <item><b>The demo farm goes in ONE transaction under its own tenant scope</b>
    /// (<see cref="RlsIdentityScope.RunAsFarmAsync(DbContext, Guid, Guid, Guid?, Func{CancellationToken, Task}, CancellationToken)"/>),
    /// so FORCE-RLS shows the clear exactly the rows it must remove. Before that transaction
    /// commits, the clear re-reads that the farm row and every seed row it targeted are gone —
    /// through the farm scope AND through each demo login's own view of its farms. Anything left:
    /// it throws, the transaction rolls back, nothing is deleted.</item>
    /// <item><b>Only then</b> are the account rows and the logins removed — so identity and
    /// account rows can never be deleted while the farm's rows survive.</item>
    /// </list>
    /// </remarks>
    public async Task<string> ClearPurveshDemoAsync(CancellationToken cancellationToken = default)
    {
        RefuseInProduction(nameof(ClearPurveshDemoAsync));
        var farmId = new FarmId(DemoFarmId);
        var userPhones = UserSeeds.Select(seed => seed.Phone).ToHashSet(StringComparer.Ordinal);

        // ── 1. Who must survive — decided BEFORE anything is deleted. ───────────────────
        var seedLogins = await _userContext.Users
            .Where(u => userPhones.Contains(u.Phone.Value))
            .ToListAsync(cancellationToken);
        var loginsToDelete = new List<User.Domain.Identity.User>();
        var keptLogins = new List<string>();
        foreach (var login in seedLogins)
        {
            var otherFarms = await CountOtherFarmsOfLoginAsync(login.Id, farmId, cancellationToken);
            if (otherFarms > 0)
            {
                // Named by its SEED KEY, never by phone or id: this summary is logged.
                var seedKey = UserSeeds.FirstOrDefault(seed => seed.Phone == login.Phone.Value)?.Key ?? "seed-login";
                keptLogins.Add($"{seedKey} (still on {otherFarms} other farm(s))");
            }
            else
            {
                loginsToDelete.Add(login);
            }
        }

        var ownerAccount = await _accountsContext.OwnerAccounts
            .Include(o => o.Memberships)
            .FirstOrDefaultAsync(o => o.Id == PurveshOwnerAccountId, cancellationToken);
        var accountUserIds = (ownerAccount?.Memberships.Select(m => m.UserId) ?? [])
            .Concat(seedLogins.Select(u => u.Id))
            .Distinct()
            .ToList();
        var otherFarmsOnAccount = await CountOtherFarmsOnOwnerAccountAsync(
            PurveshOwnerAccountId, farmId, accountUserIds, cancellationToken);

        // ── 2. The demo farm: one transaction, its own tenant scope, verified before commit. ──
        // No ssf policy reads agrisync.owner_account_id; the seeder's own account is the
        // truthful claim for the farm it seeded, whichever account the row is attached to now.
        var seedLoginIds = seedLogins.Select(u => u.Id).ToList();
        var farm = await RlsIdentityScope.RunAsFarmAsync(
            _ssfContext,
            farmId.Value,
            (Guid)PurveshOwnerAccountId,
            actorUserId: null,
            ct => ClearDemoFarmRowsAsync(farmId, seedLoginIds, ct),
            cancellationToken);

        // ── 3. Account rows — after the farm is provably gone, and only if no other farm
        //       is attached to the account. ────────────────────────────────────────────────
        var account = otherFarmsOnAccount > 0
            ? new DemoAccountClearCounts(KeptBecauseOtherFarms: otherFarmsOnAccount)
            : await ClearDemoOwnerAccountRowsAsync(ownerAccount, cancellationToken);

        // ── 4. Logins no other farm uses. public.memberships is FORCE-RLS on the user's own
        //       id, so each login's rows are removed under that login's own scope. ──────────
        var deletedMembershipCount = 0;
        foreach (var login in loginsToDelete)
        {
            deletedMembershipCount += await RlsIdentityScope.RunAsUserAsync(
                _userContext,
                login.Id.Value,
                async ct =>
                {
                    var memberships = await _userContext.Memberships
                        .Where(m => m.UserId == login.Id)
                        .ToListAsync(ct);
                    _userContext.Memberships.RemoveRange(memberships);
                    _userContext.Users.Remove(login);
                    await _userContext.SaveChangesAsync(ct);
                    return memberships.Count;
                },
                cancellationToken);
        }

        return $"Cleared {SeedVersion}: users={loginsToDelete.Count}, farms={farm.Farms}, plots={farm.Plots}, " +
               $"cropCycles={farm.CropCycles}, templates={farm.Templates}, templateActivities={farm.TemplateActivities}, " +
               $"plannedActivities={farm.PlannedActivities}, dailyLogs={farm.DailyLogs}, dayLedgers={farm.DayLedgers}, " +
               $"costEntries={farm.CostEntries}, corrections={farm.Corrections}, attachments={farm.Attachments}, " +
               $"priceConfigs={farm.PriceConfigs}, memberships={deletedMembershipCount}, " +
               $"farmMemberships={farm.FarmMemberships}, " +
               $"farmInvitations={farm.FarmInvitations}, farmJoinTokens={farm.FarmJoinTokens}, " +
               $"ownerAccounts={account.OwnerAccounts}, ownerMemberships={account.OwnerMemberships}, " +
               $"subscriptions={account.Subscriptions}, referralCodes={account.ReferralCodes}, " +
               $"referralRelationships={account.ReferralRelationships}, growthEvents={account.GrowthEvents}, " +
               $"benefitLedgerEntries={account.BenefitLedgerEntries}, " +
               $"fieldOperators={farm.FieldOperators}, " +
               $"fieldOperatorWorkRows={farm.FieldOperatorWorkRows}, " +
               $"attendanceMarks={farm.AttendanceMarks}, " +
               $"labourAssignments={farm.LabourAssignments}. " +
               $"Kept logins (still used by another farm): {(keptLogins.Count == 0 ? "none" : string.Join(", ", keptLogins))}. " +
               $"Kept demo owner account: {(account.KeptBecauseOtherFarms > 0 ? $"yes (still on {account.KeptBecauseOtherFarms} other farm(s))" : "no")}.";
    }

    /// <summary>
    /// How many farms OTHER than the demo farm this login owns or belongs to (non-terminal
    /// membership). Read under the login's own scope, so FORCE-RLS shows the app role exactly
    /// that login's farms; the explicit predicate keeps the answer right for a role that
    /// bypasses RLS too.
    /// </summary>
    private Task<int> CountOtherFarmsOfLoginAsync(UserId loginId, FarmId demoFarmId, CancellationToken cancellationToken) =>
        RlsIdentityScope.RunAsUserAsync(
            _ssfContext,
            loginId.Value,
            ct => _ssfContext.Farms
                .AsNoTracking()
                .Where(f => f.Id != demoFarmId
                    && (f.OwnerUserId == loginId
                        || _ssfContext.FarmMemberships.Any(m =>
                            m.FarmId == f.Id
                            && m.UserId == loginId
                            && m.Status != MembershipStatus.Revoked
                            && m.Status != MembershipStatus.Exited)))
                .CountAsync(ct),
            cancellationToken);

    /// <summary>
    /// How many farms OTHER than the demo farm are attached to the owner account. A role that
    /// bypasses RLS answers in one read; the app role can only see a farm through someone's own
    /// scope, so the account's members (and the seed logins) are asked too.
    /// </summary>
    private async Task<int> CountOtherFarmsOnOwnerAccountAsync(
        OwnerAccountId ownerAccountId,
        FarmId demoFarmId,
        IReadOnlyList<UserId> accountUserIds,
        CancellationToken cancellationToken)
    {
        var count = await _ssfContext.Farms
            .AsNoTracking()
            .CountAsync(f => f.OwnerAccountId == ownerAccountId && f.Id != demoFarmId, cancellationToken);
        foreach (var userId in accountUserIds)
        {
            var seenByUser = await RlsIdentityScope.RunAsUserAsync(
                _ssfContext,
                userId.Value,
                ct => _ssfContext.Farms
                    .AsNoTracking()
                    .CountAsync(f => f.OwnerAccountId == ownerAccountId && f.Id != demoFarmId, ct),
                cancellationToken);
            count = Math.Max(count, seenByUser);
        }

        return count;
    }

    private sealed record DemoFarmClearCounts(
        int Farms,
        int Plots,
        int CropCycles,
        int Templates,
        int TemplateActivities,
        int PlannedActivities,
        int DailyLogs,
        int DayLedgers,
        int CostEntries,
        int Corrections,
        int Attachments,
        int PriceConfigs,
        int FarmMemberships,
        int FarmInvitations,
        int FarmJoinTokens,
        int FieldOperators,
        int FieldOperatorWorkRows,
        int AttendanceMarks,
        int LabourAssignments);

    private sealed record DemoAccountClearCounts(
        int OwnerAccounts = 0,
        int OwnerMemberships = 0,
        int Subscriptions = 0,
        int ReferralCodes = 0,
        int ReferralRelationships = 0,
        int GrowthEvents = 0,
        int BenefitLedgerEntries = 0,
        int KeptBecauseOtherFarms = 0);

    /// <summary>
    /// The demo farm's rows. Runs INSIDE the farm-scoped transaction opened by
    /// <see cref="ClearPurveshDemoAsync"/>; every guard throws before the first write, and the
    /// closing check throws (rolling everything back) if anything it targeted survived.
    /// </summary>
    private async Task<DemoFarmClearCounts> ClearDemoFarmRowsAsync(
        FarmId farmId,
        IReadOnlyList<UserId> seedLoginIds,
        CancellationToken cancellationToken)
    {
        var cycleIds = PlotSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:cycle:{seed.Key}"))
            .ToHashSet();
        var plotIds = PlotSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:plot:{seed.Key}"))
            .ToHashSet();
        var templateIds = TemplateSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:template:{seed.Key}"))
            .ToHashSet();
        var costSeeds = BuildCostEntrySeeds();
        var costIds = costSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:cost:{seed.Key}"))
            .ToHashSet();
        var attachmentIds = AttachmentSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:attachment:{seed.SeedKey}"))
            .ToHashSet();
        var purveshUserId = new UserId(CreateDeterministicGuid($"{SeedVersion}:user:purvesh"));
        var joinTokenIds = new[]
        {
            new FarmJoinTokenId(CreateDeterministicGuid($"{SeedVersion}:joinToken:active"))
        }.ToHashSet();
        var invitationIds = new[]
        {
            new FarmInvitationId(CreateDeterministicGuid($"{SeedVersion}:invitation:worker-anchor"))
        }.ToHashSet();

        var plannedRows = await _ssfContext.PlannedActivities
            .Where(p => cycleIds.Contains(p.CropCycleId))
            .ToListAsync(cancellationToken);
        var deletedPlannedCount = plannedRows.Count;
        if (plannedRows.Count > 0)
        {
            _ssfContext.PlannedActivities.RemoveRange(plannedRows);
        }

        var deletedTemplateActivityCount = await _ssfContext.TemplateActivities
            .Where(a => templateIds.Contains(a.ScheduleTemplateId))
            .CountAsync(cancellationToken);

        // ── Labour V1 Task 10.4 (spec: 2026-07-13-labour-attendance-approval-design) ──
        // Field-operator attribution teardown. MUST run BEFORE the daily-log
        // teardown immediately below, and MUST NOT be nested inside its
        // `if (dailyLogs.Count > 0)` block — nesting it there would silently
        // skip this cleanup whenever there are zero seeded daily logs.
        //
        // WHY BEFORE: ssf.labour_assignments.daily_log_id is ON DELETE CASCADE,
        // so removing seeded daily logs removes their labour_assignments too;
        // ssf.field_operator_work_rows.labour_assignment_id is ON DELETE
        // RESTRICT, so a surviving work row turns the re-seed into an opaque
        // 23503. The farm delete at the end of this method would fail the same
        // way on field_operators.originating_farm_id.
        //
        // SCOPED, NEVER BLANKET. This method runs against the founder's only
        // real farm whenever CLEAR_PURVESH_DEMO=true (Program.cs:1025-1046).
        // Rows are identified by DETERMINISTIC ID, minted from the same
        // expression the creation side uses, so identification is correct by
        // construction rather than by inference. Anything on this farm the
        // seeder did not create is a REAL worker's identity, or a REAL record
        // of whose work it was: we THROW and delete nothing. Constraint 13 —
        // destroying a farm must FAIL rather than destroy identities. The
        // RESTRICT guard is the protection, not the defect.
        //
        // Work rows are matched on their OWN ids, never on their parent
        // FieldOperatorId: a real attribution attached to a SEEDED demo
        // operator is still real work, and deleting it because its parent was
        // seeded is exactly the mistake this scoping exists to prevent.
        //
        // 2026-10-17 (demo-seed-v3): the seed sets are no longer empty — they
        // come from the demo labour plan written by `--reseed-purvesh-demo`.
        // Attendance marks join the guarded set (a mark is a ruling about a
        // person; the seeder owns only the marks it minted), and the seed's own
        // labour assignments are removed explicitly BEFORE the operators,
        // because labour_assignments.engaged_through_field_operator_id is ON
        // DELETE RESTRICT.
        var labourPlan = BuildDemoLabourPlan();
        var seededFieldOperatorIds = labourPlan.OperatorIds;
        var seededFieldOperatorWorkRowIds = labourPlan.WorkRowIds;
        var seededAttendanceMarkIds = labourPlan.AttendanceMarkIds;
        var seededLabourAssignmentIds = labourPlan.LabourAssignmentIds;
        costIds.UnionWith(labourPlan.CostEntryIds);

        var fieldOperatorWorkRows = await _ssfContext.FieldOperatorWorkRows
            .Where(r => r.FarmId == farmId)
            .ToListAsync(cancellationToken);
        var nonSeedWorkRows = fieldOperatorWorkRows
            .Count(r => !seededFieldOperatorWorkRowIds.Contains(r.Id));
        if (nonSeedWorkRows > 0)
        {
            throw new InvalidOperationException(
                $"{NonSeedFieldOperatorDataMessage} {nonSeedWorkRows} ssf.field_operator_work_rows "
                + $"row(s) on farm {farmId.Value} were not created by seed version '{SeedVersion}'. "
                + "These record which real person did which real work; the seeder will never delete "
                + "them. Remove them deliberately, or clear a different database.");
        }

        var fieldOperators = await _ssfContext.FieldOperators
            .Where(o => o.OriginatingFarmId == farmId)
            .ToListAsync(cancellationToken);
        var nonSeedFieldOperators = fieldOperators
            .Count(o => !seededFieldOperatorIds.Contains(o.Id));
        if (nonSeedFieldOperators > 0)
        {
            throw new InvalidOperationException(
                $"{NonSeedFieldOperatorDataMessage} {nonSeedFieldOperators} ssf.field_operators "
                + $"row(s) on farm {farmId.Value} were not created by seed version '{SeedVersion}'. "
                + "These are real people's work identities; the seeder will never delete them. "
                + "Remove them deliberately, or clear a different database.");
        }

        var attendanceMarks = await _ssfContext.AttendanceMarks
            .Where(m => m.FarmId == farmId)
            .ToListAsync(cancellationToken);
        var nonSeedAttendanceMarks = attendanceMarks
            .Count(m => !seededAttendanceMarkIds.Contains(m.Id));
        var attendanceCorrections = await _ssfContext.AttendanceMarkCorrections
            .CountAsync(c => c.FarmId == farmId, cancellationToken);
        var labourCorrections = await _ssfContext.LabourCorrections
            .CountAsync(c => c.FarmId == farmId, cancellationToken);
        if (nonSeedAttendanceMarks > 0 || attendanceCorrections > 0 || labourCorrections > 0)
        {
            // The seeder writes no correction rows of either kind (both are
            // append-only history), so ANY correction here is a real person's
            // act — as is any mark it did not mint.
            throw new InvalidOperationException(
                $"{NonSeedFieldOperatorDataMessage} farm {farmId.Value} holds {nonSeedAttendanceMarks} "
                + $"ssf.attendance_marks row(s), {attendanceCorrections} ssf.attendance_mark_corrections "
                + $"row(s) and {labourCorrections} ssf.labour_corrections row(s) not created by seed "
                + $"version '{SeedVersion}'. The seeder will never delete them. Use "
                + "`--reseed-purvesh-demo`, which leaves them untouched, or clear a different database.");
        }

        var farmLabourAssignments = await (
                from assignment in _ssfContext.LabourAssignments
                join log in _ssfContext.DailyLogs on assignment.DailyLogId equals log.Id
                where log.FarmId == farmId
                select assignment)
            .ToListAsync(cancellationToken);
        var nonSeedCrewLinks = farmLabourAssignments.Count(a =>
            !seededLabourAssignmentIds.Contains(a.Id)
            && a.EngagedThroughFieldOperatorId is { } throughId
            && seededFieldOperatorIds.Contains(throughId));
        if (nonSeedCrewLinks > 0)
        {
            throw new InvalidOperationException(
                $"{NonSeedFieldOperatorDataMessage} {nonSeedCrewLinks} ssf.labour_assignments row(s) on "
                + $"farm {farmId.Value} that the seeder did not create name a demo worker as their mukadam. "
                + "They are real records; the seeder will never delete them.");
        }

        var seededLabourAssignments = farmLabourAssignments
            .Where(a => seededLabourAssignmentIds.Contains(a.Id))
            .ToList();

        var deletedFieldOperatorWorkRowsCount = fieldOperatorWorkRows.Count;
        if (fieldOperatorWorkRows.Count > 0)
        {
            _ssfContext.FieldOperatorWorkRows.RemoveRange(fieldOperatorWorkRows);
        }

        var deletedAttendanceMarksCount = attendanceMarks.Count;
        if (attendanceMarks.Count > 0)
        {
            _ssfContext.AttendanceMarks.RemoveRange(attendanceMarks);
        }

        var deletedLabourAssignmentsCount = seededLabourAssignments.Count;
        if (seededLabourAssignments.Count > 0)
        {
            _ssfContext.LabourAssignments.RemoveRange(seededLabourAssignments);
        }

        // Own flush so the RESTRICT children (work rows; seed engagements that
        // name a demo mukadam) are gone BEFORE their parents below.
        await _ssfContext.SaveChangesAsync(cancellationToken);

        var deletedFieldOperatorsCount = fieldOperators.Count;
        if (fieldOperators.Count > 0)
        {
            _ssfContext.FieldOperators.RemoveRange(fieldOperators);
        }

        // Own flush so the ordering above is explicit. The rest of this
        // teardown flushes further down, where EF's ordering is not
        // guaranteed to satisfy the RESTRICT constraints.
        await _ssfContext.SaveChangesAsync(cancellationToken);

        var dailyLogs = await _ssfContext.DailyLogs
            .Where(l =>
                l.FarmId == farmId &&
                l.IdempotencyKey != null &&
                l.IdempotencyKey.StartsWith($"{SeedVersion}:log:"))
            .ToListAsync(cancellationToken);
        var deletedDailyLogsCount = dailyLogs.Count;
        if (dailyLogs.Count > 0)
        {
            _ssfContext.DailyLogs.RemoveRange(dailyLogs);
        }

        var dayLedgers = await _ssfContext.DayLedgers
            .Where(l => costIds.Contains(l.SourceCostEntryId))
            .ToListAsync(cancellationToken);
        var deletedDayLedgersCount = dayLedgers.Count;
        if (dayLedgers.Count > 0)
        {
            _ssfContext.DayLedgers.RemoveRange(dayLedgers);
        }

        var corrections = await _ssfContext.FinanceCorrections
            .Where(c => costIds.Contains(c.CostEntryId))
            .ToListAsync(cancellationToken);
        var deletedCorrectionsCount = corrections.Count;
        if (corrections.Count > 0)
        {
            _ssfContext.FinanceCorrections.RemoveRange(corrections);
        }

        // Own flush BEFORE the cost entries: under the app role, the tenant policy on
        // ssf.finance_corrections is an EXISTS on its cost entry, and the model has no
        // FK to make EF order the two — a cost deleted first would hide its correction
        // from the correction's own DELETE (0 rows affected).
        await _ssfContext.SaveChangesAsync(cancellationToken);

        var costs = await _ssfContext.CostEntries
            .Where(c => costIds.Contains(c.Id))
            .ToListAsync(cancellationToken);
        var deletedCostEntriesCount = costs.Count;
        if (costs.Count > 0)
        {
            _ssfContext.CostEntries.RemoveRange(costs);
        }

        var attachments = await _ssfContext.Attachments
            .Where(a => attachmentIds.Contains(a.Id))
            .ToListAsync(cancellationToken);
        var deletedAttachmentsCount = attachments.Count;
        if (attachments.Count > 0)
        {
            _ssfContext.Attachments.RemoveRange(attachments);
        }

        var priceItems = PriceConfigSeeds
            .Select(seed => seed.ItemName)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var priceConfigs = await _ssfContext.PriceConfigs
            .Where(p => p.CreatedByUserId == purveshUserId && priceItems.Contains(p.ItemName))
            .ToListAsync(cancellationToken);
        var deletedPriceConfigsCount = priceConfigs.Count;
        if (priceConfigs.Count > 0)
        {
            _ssfContext.PriceConfigs.RemoveRange(priceConfigs);
        }

        var templates = await _ssfContext.ScheduleTemplates
            .Where(t => templateIds.Contains(t.Id))
            .ToListAsync(cancellationToken);
        var deletedTemplateCount = templates.Count;
        if (templates.Count > 0)
        {
            _ssfContext.ScheduleTemplates.RemoveRange(templates);
        }

        var cycles = await _ssfContext.CropCycles
            .Where(c => cycleIds.Contains(c.Id))
            .ToListAsync(cancellationToken);
        var deletedCycleCount = cycles.Count;
        if (cycles.Count > 0)
        {
            _ssfContext.CropCycles.RemoveRange(cycles);
        }

        var plots = await _ssfContext.Plots
            .Where(p => plotIds.Contains(p.Id))
            .ToListAsync(cancellationToken);
        var deletedPlotCount = plots.Count;
        if (plots.Count > 0)
        {
            _ssfContext.Plots.RemoveRange(plots);
        }

        // v2 Phase 6 cleanup — FarmJoinTokens BEFORE FarmInvitations
        // (token.InvitationId FK referential discipline).
        var joinTokens = await _ssfContext.FarmJoinTokens
            .Where(t => joinTokenIds.Contains(t.Id))
            .ToListAsync(cancellationToken);
        var deletedFarmJoinTokensCount = joinTokens.Count;
        if (joinTokens.Count > 0)
        {
            _ssfContext.FarmJoinTokens.RemoveRange(joinTokens);
        }

        var invitations = await _ssfContext.FarmInvitations
            .Where(i => invitationIds.Contains(i.Id))
            .ToListAsync(cancellationToken);
        var deletedFarmInvitationsCount = invitations.Count;
        if (invitations.Count > 0)
        {
            _ssfContext.FarmInvitations.RemoveRange(invitations);
        }

        // farm_memberships BEFORE the farm. There is no DB-level FK from
        // ssf.farm_memberships.farm_id to ssf.farms (see migration
        // 20260418023102_AddFarmMemberships — the table has only a PK), so
        // nothing cascades: without this the demo farm's roster would survive
        // as orphan rows pointing at a deleted farm and deleted users, and a
        // re-seed would then collide on the deterministic membership PK.
        var farmMemberships = await _ssfContext.FarmMemberships
            .Where(m => m.FarmId == farmId)
            .ToListAsync(cancellationToken);
        var deletedFarmMembershipsCount = farmMemberships.Count;
        if (farmMemberships.Count > 0)
        {
            _ssfContext.FarmMemberships.RemoveRange(farmMemberships);
        }

        var farm = await _ssfContext.Farms.FirstOrDefaultAsync(f => f.Id == farmId, cancellationToken);
        var deletedFarmCount = 0;
        if (farm is not null)
        {
            _ssfContext.Farms.Remove(farm);
            deletedFarmCount = 1;
        }

        await _ssfContext.SaveChangesAsync(cancellationToken);

        // ── Closing check, still inside the transaction: nothing this clear targeted survived.
        //    First through the farm's own tenant scope …
        var survivors = new List<string>();
        void Survived(string table, int count)
        {
            if (count > 0)
            {
                survivors.Add($"{table}: {count}");
            }
        }

        Survived("ssf.farms", await _ssfContext.Farms.CountAsync(f => f.Id == farmId, cancellationToken));
        Survived("ssf.plots", await _ssfContext.Plots.CountAsync(p => plotIds.Contains(p.Id), cancellationToken));
        Survived("ssf.crop_cycles", await _ssfContext.CropCycles.CountAsync(c => cycleIds.Contains(c.Id), cancellationToken));
        Survived("ssf.planned_activities", await _ssfContext.PlannedActivities.CountAsync(p => cycleIds.Contains(p.CropCycleId), cancellationToken));
        Survived("ssf.daily_logs", await _ssfContext.DailyLogs.CountAsync(
            l => l.FarmId == farmId && l.IdempotencyKey != null && l.IdempotencyKey.StartsWith($"{SeedVersion}:log:"),
            cancellationToken));
        Survived("ssf.cost_entries", await _ssfContext.CostEntries.CountAsync(c => costIds.Contains(c.Id), cancellationToken));
        Survived("ssf.finance_corrections", await _ssfContext.FinanceCorrections.CountAsync(c => costIds.Contains(c.CostEntryId), cancellationToken));
        Survived("ssf.day_ledgers", await _ssfContext.DayLedgers.CountAsync(l => costIds.Contains(l.SourceCostEntryId), cancellationToken));
        Survived("ssf.attachments", await _ssfContext.Attachments.CountAsync(a => attachmentIds.Contains(a.Id), cancellationToken));
        Survived("ssf.field_operators", await _ssfContext.FieldOperators.CountAsync(o => o.OriginatingFarmId == farmId, cancellationToken));
        Survived("ssf.field_operator_work_rows", await _ssfContext.FieldOperatorWorkRows.CountAsync(r => r.FarmId == farmId, cancellationToken));
        Survived("ssf.attendance_marks", await _ssfContext.AttendanceMarks.CountAsync(m => m.FarmId == farmId, cancellationToken));
        Survived("ssf.farm_memberships", await _ssfContext.FarmMemberships.CountAsync(m => m.FarmId == farmId, cancellationToken));

        // … then through each demo login's OWN view of its farms — an independent policy, so
        // a farm row the tenant scope somehow failed to show is still caught here.
        foreach (var loginId in seedLoginIds)
        {
            var stillVisible = await RlsIdentityScope.RunAsUserAsync(
                _ssfContext,
                loginId.Value,
                ct => _ssfContext.Farms.AsNoTracking().CountAsync(f => f.Id == farmId, ct),
                cancellationToken);
            Survived($"ssf.farms (seen by login {loginId.Value})", stillVisible);
        }

        if (survivors.Count > 0)
        {
            throw new InvalidOperationException(
                $"PurveshDemoSeeder refuses to report a partial clear of demo farm {farmId.Value}: "
                + $"{string.Join("; ", survivors)} row(s) it targeted are still there. The whole clear has "
                + "been rolled back and no login or account row was touched.");
        }

        return new DemoFarmClearCounts(
            Farms: deletedFarmCount,
            Plots: deletedPlotCount,
            CropCycles: deletedCycleCount,
            Templates: deletedTemplateCount,
            TemplateActivities: deletedTemplateActivityCount,
            PlannedActivities: deletedPlannedCount,
            DailyLogs: deletedDailyLogsCount,
            DayLedgers: deletedDayLedgersCount,
            CostEntries: deletedCostEntriesCount,
            Corrections: deletedCorrectionsCount,
            Attachments: deletedAttachmentsCount,
            PriceConfigs: deletedPriceConfigsCount,
            FarmMemberships: deletedFarmMembershipsCount,
            FarmInvitations: deletedFarmInvitationsCount,
            FarmJoinTokens: deletedFarmJoinTokensCount,
            FieldOperators: deletedFieldOperatorsCount,
            FieldOperatorWorkRows: deletedFieldOperatorWorkRowsCount,
            AttendanceMarks: deletedAttendanceMarksCount,
            LabourAssignments: deletedLabourAssignmentsCount);
    }

    /// <summary>
    /// The seeder's own owner-account rows (affiliation chain, subscriptions, the account and its
    /// memberships), in reverse dependency order:
    /// BenefitLedgerEntries -> GrowthEvents -> ReferralRelationships -> ReferralCodes ->
    /// Subscriptions -> OwnerAccountMemberships -> OwnerAccounts.
    /// </summary>
    private async Task<DemoAccountClearCounts> ClearDemoOwnerAccountRowsAsync(
        OwnerAccount? ownerAccount,
        CancellationToken cancellationToken)
    {
        var benefitEntryIds = new[]
        {
            new BenefitLedgerEntryId(CreateDeterministicGuid($"{SeedVersion}:affiliation:benefit-ledger-entry"))
        }.ToHashSet();
        var benefitEntries = await _accountsContext.BenefitLedgerEntries
            .Where(b => benefitEntryIds.Contains(b.Id))
            .ToListAsync(cancellationToken);
        _accountsContext.BenefitLedgerEntries.RemoveRange(benefitEntries);

        var growthEventIds = new[]
        {
            new GrowthEventId(CreateDeterministicGuid($"{SeedVersion}:affiliation:growth-event"))
        }.ToHashSet();
        var growthEvents = await _accountsContext.GrowthEvents
            .Where(g => growthEventIds.Contains(g.Id))
            .ToListAsync(cancellationToken);
        _accountsContext.GrowthEvents.RemoveRange(growthEvents);

        var relationshipIds = new[]
        {
            new ReferralRelationshipId(CreateDeterministicGuid($"{SeedVersion}:affiliation:referral-relationship"))
        }.ToHashSet();
        var relationships = await _accountsContext.ReferralRelationships
            .Where(r => relationshipIds.Contains(r.Id))
            .ToListAsync(cancellationToken);
        _accountsContext.ReferralRelationships.RemoveRange(relationships);

        var codeIds = new[]
        {
            new ReferralCodeId(CreateDeterministicGuid($"{SeedVersion}:affiliation:referral-code"))
        }.ToHashSet();
        var codes = await _accountsContext.ReferralCodes
            .Where(c => codeIds.Contains(c.Id))
            .ToListAsync(cancellationToken);
        _accountsContext.ReferralCodes.RemoveRange(codes);

        var subscriptions = await _accountsContext.Subscriptions
            .Where(s => s.OwnerAccountId == PurveshOwnerAccountId)
            .ToListAsync(cancellationToken);
        _accountsContext.Subscriptions.RemoveRange(subscriptions);

        // OwnerAccountMemberships cascade from OwnerAccount via EF cascade
        // delete (configured in OwnerAccountConfiguration). Explicit removal
        // keeps the cleanup deterministic across configurations.
        var ownerMemberships = 0;
        if (ownerAccount is not null)
        {
            ownerMemberships = ownerAccount.Memberships.Count;
            _accountsContext.OwnerAccounts.Remove(ownerAccount);
        }

        await _accountsContext.SaveChangesAsync(cancellationToken);

        return new DemoAccountClearCounts(
            OwnerAccounts: ownerAccount is null ? 0 : 1,
            OwnerMemberships: ownerMemberships,
            Subscriptions: subscriptions.Count,
            ReferralCodes: codes.Count,
            ReferralRelationships: relationships.Count,
            GrowthEvents: growthEvents.Count,
            BenefitLedgerEntries: benefitEntries.Count);
    }

    private async Task<User.Domain.Identity.User> EnsureUserAsync(
        UserSeed seed,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var expectedUserId = new UserId(CreateDeterministicGuid($"{SeedVersion}:user:{seed.Key}"));
        var existing = await _userContext.Users
            .FirstOrDefaultAsync(u => u.Phone.Value == seed.Phone, cancellationToken);

        if (existing is not null)
        {
            var passwordMatches = _passwordHasher.Verify(seed.Password, existing.Credential.PasswordHash);
            if (!passwordMatches)
            {
                _userContext.Users.Remove(existing);
                await _userContext.SaveChangesAsync(cancellationToken);
                existing = null;
            }
        }

        if (existing is null)
        {
            var user = User.Domain.Identity.User.Register(
                expectedUserId,
                PhoneNumber.Create(seed.Phone),
                seed.DisplayName,
                _passwordHasher.Hash(seed.Password),
                nowUtc);

            user.AddMembership(
                CreateDeterministicGuid($"{SeedVersion}:membership:{seed.Key}"),
                AppId,
                seed.Role,
                nowUtc);

            _userContext.Users.Add(user);
            await _userContext.SaveChangesAsync(cancellationToken);
            return user;
        }

        var membership = existing.Memberships
            .FirstOrDefault(m => m.AppId.Equals(AppId, StringComparison.OrdinalIgnoreCase) && !m.IsRevoked);
        if (membership is null)
        {
            existing.AddMembership(
                CreateDeterministicGuid($"{SeedVersion}:membership:{seed.Key}:{existing.Id}"),
                AppId,
                seed.Role,
                nowUtc);
            await _userContext.SaveChangesAsync(cancellationToken);
        }
        else if (membership.Role != seed.Role)
        {
            existing.ChangeRole(AppId, seed.Role, nowUtc);
            await _userContext.SaveChangesAsync(cancellationToken);
        }

        return existing;
    }

    private async Task<Farm> EnsureFarmAsync(UserId ownerUserId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        var farmId = new FarmId(CreateDeterministicGuid($"{SeedVersion}:farm:khardi"));
        var existingById = await _ssfContext.Farms.FirstOrDefaultAsync(f => f.Id == farmId, cancellationToken);
        if (existingById is not null)
        {
            return existingById;
        }

        var existingByOwnerAndName = await _ssfContext.Farms.FirstOrDefaultAsync(
            f => f.OwnerUserId == ownerUserId && f.Name == PurveshFarmName,
            cancellationToken);
        if (existingByOwnerAndName is not null)
        {
            return existingByOwnerAndName;
        }

        var farm = Farm.Create(farmId, PurveshFarmName, ownerUserId, nowUtc);
        // v2: attach the deterministic Purvesh OwnerAccountId so the
        // EntitlementGate's subscription lookup (accounts.subscriptions
        // WHERE owner_account_id = ...c2) resolves to the Trialing row
        // pre-seeded by purvesh-cleanup.sql. Without this, the
        // ParseVoiceInputHandler entitlement check returns
        // SubscriptionMissing (the exact 403 reproduced on 2026-05-13).
        farm.AttachToOwnerAccount(PurveshOwnerAccountId, nowUtc);
        _ssfContext.Farms.Add(farm);
        return farm;
    }

    /// <summary>
    /// Seeds the <c>ssf.farm_memberships</c> roster for the demo farm — the
    /// row set the seeder never created (0 rows in ssf while public.memberships
    /// held 5), which is what made every real screen render zeros:
    /// <c>/user/auth/me/context</c> reads memberships only, answered
    /// <c>"farms": []</c> + alert <c>no_farms_yet</c>, and the client then
    /// cleared its persisted farm id so no farm-scoped endpoint was ever called.
    ///
    /// <para>
    /// Roster: Purvesh as <see cref="SharedAppRole.PrimaryOwner"/> via
    /// <see cref="JoinedVia.PrimaryOwnerBootstrap"/> (mirrors what
    /// <c>FirstFarmBootstrapEndpoints</c> writes for a real first farm), and the
    /// three worker users via <see cref="JoinedVia.OwnerManualAdd"/> — the demo
    /// farm's roster was assembled by the owner, not through the QR/OTP
    /// invitation flow, so <see cref="FarmMembership.CreateFromInvitation"/>
    /// (which yields a Pending* status) would misrepresent provenance AND leave
    /// the rows non-Active, i.e. still invisible to the wage book. Roles come
    /// from the SAME <see cref="UserSeeds"/> table that drives
    /// <c>public.memberships</c> (via <see cref="ResolveSharedRole"/>), so the
    /// two contexts can never drift apart. All rows are
    /// <see cref="MembershipStatus.Active"/> — the status
    /// <c>GetLabourDataHandler</c> filters on.
    /// </para>
    /// <para>
    /// <c>owner_account_id</c> is NOT set here: it is a shadow property
    /// populated centrally in <c>ShramSafalDbContext.SaveChangesAsync</c> from
    /// the membership's farm, which resolves to
    /// <see cref="PurveshOwnerAccountId"/> (…c2) for the tracked demo farm.
    /// </para>
    /// <para>
    /// Idempotent on two axes with a single round trip: the deterministic
    /// membership id (PK reuse) and the partial unique index
    /// <c>ix_farm_memberships_farm_user_nonterminal</c> on
    /// <c>(farm_id, user_id) WHERE status NOT IN (5, 6)</c> — the latter also
    /// covers a membership created outside the seeder (bootstrap endpoint /
    /// ClaimJoin) with a random id.
    /// </para>
    /// </summary>
    private async Task<int> EnsurePurveshFarmMembershipsAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var existing = await _ssfContext.FarmMemberships
            .Where(m => m.FarmId == farmId)
            .ToListAsync(cancellationToken);

        var added = 0;

        foreach (var seed in UserSeeds)
        {
            if (!usersByKey.TryGetValue(seed.Key, out var user))
            {
                continue;
            }

            var membershipId = CreateDeterministicGuid($"{SeedVersion}:farmMembership:{seed.Key}");
            if (existing.Any(m => m.Id == membershipId || (m.UserId == user.Id && !m.IsTerminal)))
            {
                continue;
            }

            var membership = FarmMembership.Create(
                membershipId,
                farmId,
                user.Id,
                ResolveSharedRole(seed.Key),
                nowUtc,
                joinedVia: seed.Key == PurveshUserKey
                    ? JoinedVia.PrimaryOwnerBootstrap
                    : JoinedVia.OwnerManualAdd);

            _ssfContext.FarmMemberships.Add(membership);
            existing.Add(membership);
            added++;
        }

        return added;
    }

    private async Task<List<PlotCycleContext>> EnsurePlotsAndCropCyclesAsync(
        FarmId farmId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var plots = await _ssfContext.Plots
            .Where(p => p.FarmId == farmId)
            .ToListAsync(cancellationToken);
        var cycles = await _ssfContext.CropCycles
            .Where(c => c.FarmId == farmId)
            .ToListAsync(cancellationToken);

        var result = new List<PlotCycleContext>(PlotSeeds.Length);

        foreach (var seed in PlotSeeds)
        {
            var plotId = CreateDeterministicGuid($"{SeedVersion}:plot:{seed.Key}");
            var plot = plots.FirstOrDefault(p => p.Id == plotId)
                       ?? plots.FirstOrDefault(p => p.Name.Equals(seed.DisplayName, StringComparison.OrdinalIgnoreCase));

            if (plot is null)
            {
                var createdAt = nowUtc.AddDays(seed.StartOffsetDays);
                plot = Plot.Create(plotId, farmId, seed.DisplayName, seed.AreaInAcres, createdAt);
                _ssfContext.Plots.Add(plot);
                plots.Add(plot);
            }

            var cycleId = CreateDeterministicGuid($"{SeedVersion}:cycle:{seed.Key}");
            var cycle = cycles.FirstOrDefault(c => c.Id == cycleId)
                        ?? cycles.FirstOrDefault(c =>
                            c.PlotId == plot.Id &&
                            c.CropName.Equals(seed.CropName, StringComparison.OrdinalIgnoreCase));

            if (cycle is null)
            {
                var startDate = DateOnly.FromDateTime(nowUtc.AddDays(seed.StartOffsetDays));
                var createdAt = nowUtc.AddDays(seed.StartOffsetDays);
                cycle = CropCycle.Create(
                    cycleId,
                    farmId,
                    plot.Id,
                    seed.CropName,
                    seed.Stage,
                    startDate,
                    null,
                    createdAt);
                _ssfContext.CropCycles.Add(cycle);
                cycles.Add(cycle);
            }

            result.Add(new PlotCycleContext(seed, plot.Id, cycle.Id, cycle.StartDate));
        }

        return result;
    }

    private async Task<Phase3Stats> EnsureScheduleTemplatesAndPlannedActivitiesAsync(
        IReadOnlyList<PlotCycleContext> plotContexts,
        UserId ownerUserId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var templateIds = TemplateSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:template:{seed.Key}"))
            .ToHashSet();

        var existingTemplates = await _ssfContext.ScheduleTemplates
            .Include(t => t.Activities)
            .Where(t => templateIds.Contains(t.Id))
            .ToListAsync(cancellationToken);

        var templatesById = existingTemplates.ToDictionary(t => t.Id);
        var templatesAdded = 0;
        var activitiesAdded = 0;

        foreach (var templateSeed in TemplateSeeds)
        {
            var templateId = CreateDeterministicGuid($"{SeedVersion}:template:{templateSeed.Key}");
            if (!templatesById.TryGetValue(templateId, out var template))
            {
                template = existingTemplates.FirstOrDefault(t =>
                    t.Name.Equals(templateSeed.Name, StringComparison.OrdinalIgnoreCase) &&
                    t.Stage.Equals(templateSeed.Stage, StringComparison.OrdinalIgnoreCase));

                if (template is null)
                {
                    template = ScheduleTemplate.Create(templateId, templateSeed.Name, templateSeed.Stage, nowUtc);
                    _ssfContext.ScheduleTemplates.Add(template);
                    templatesAdded++;
                }

                templatesById[templateId] = template;
            }

            for (var i = 0; i < templateSeed.Activities.Length; i++)
            {
                var activitySeed = templateSeed.Activities[i];
                var exists = template.Activities.Any(a =>
                    a.ActivityName.Equals(activitySeed.ActivityName, StringComparison.OrdinalIgnoreCase) &&
                    a.OffsetDays == activitySeed.OffsetDays);

                if (exists)
                {
                    continue;
                }

                var activityId = CreateDeterministicGuid(
                    $"{SeedVersion}:template-activity:{templateSeed.Key}:{i}:{activitySeed.ActivityName}:{activitySeed.OffsetDays}");
                template.AddActivity(
                    activityId,
                    activitySeed.ActivityName,
                    activitySeed.OffsetDays,
                    activitySeed.FrequencyMode,
                    activitySeed.IntervalDays);

                activitiesAdded++;
            }
        }

        var plannedAdded = await EnsurePlannedActivitiesAsync(
            plotContexts, ownerUserId, nowUtc, PlannedSeedsByPlotKey, cancellationToken);

        return new Phase3Stats(templatesAdded, activitiesAdded, plannedAdded);
    }

    /// <summary>
    /// The planned-activity half of <see cref="EnsureScheduleTemplatesAndPlannedActivitiesAsync"/>,
    /// split out so the one-shot re-seed can re-anchor the demo farm's planned work WITHOUT
    /// touching <c>ssf.schedule_templates</c>, which are global rows rather than demo-farm rows.
    /// Behaviour for the startup path is unchanged: <c>createdAt</c> is clamped to
    /// <paramref name="nowUtc"/>, which every pre-existing seed already satisfied
    /// (StartOffsetDays + DayOffset is never positive for them).
    /// </summary>
    private async Task<int> EnsurePlannedActivitiesAsync(
        IReadOnlyList<PlotCycleContext> plotContexts,
        UserId ownerUserId,
        DateTime nowUtc,
        IReadOnlyDictionary<string, PlannedActivitySeed[]> seedsByPlotKey,
        CancellationToken cancellationToken)
    {
        var contextByPlotKey = plotContexts.ToDictionary(c => c.Seed.Key, c => c, StringComparer.Ordinal);
        var cycleIds = contextByPlotKey.Values.Select(c => c.CropCycleId).ToHashSet();

        var existingPlannedRows = await _ssfContext.PlannedActivities
            .Where(p => cycleIds.Contains(p.CropCycleId))
            .Select(p => new { p.CropCycleId, p.ActivityName, p.PlannedDate })
            .ToListAsync(cancellationToken);

        var plannedKeys = existingPlannedRows
            .Select(row => BuildPlannedKey(row.CropCycleId, row.ActivityName, row.PlannedDate))
            .ToHashSet(StringComparer.Ordinal);

        var plannedAdded = 0;

        foreach (var kvp in seedsByPlotKey)
        {
            if (!contextByPlotKey.TryGetValue(kvp.Key, out var context))
            {
                continue;
            }

            foreach (var plannedSeed in kvp.Value)
            {
                var plannedDate = context.StartDate.AddDays(plannedSeed.DayOffset);
                var plannedKey = BuildPlannedKey(context.CropCycleId, plannedSeed.ActivityName, plannedDate);

                if (plannedKeys.Contains(plannedKey))
                {
                    continue;
                }

                var plannedId = CreateDeterministicGuid(
                    $"{SeedVersion}:planned:{context.Seed.Key}:{plannedSeed.DayOffset}:{Normalize(plannedSeed.ActivityName)}");
                var createdAt = nowUtc.AddDays(Math.Min(0, context.Seed.StartOffsetDays + plannedSeed.DayOffset));

                // Seeded as a locally-added activity owned by Purvesh (the demo
                // farm's primary owner). The sentinel reason "seed:purvesh-demo"
                // makes these rows grep-able in the demo dataset; UI badges flag
                // them as locally-added (IsLocallyChanged=true) which matches
                // their semantics — they are NOT linked to any template activity.
                var plannedActivity = PlannedActivity.CreateLocallyAdded(
                    plannedId,
                    context.CropCycleId,
                    plannedSeed.ActivityName,
                    plannedSeed.Stage,
                    plannedDate,
                    ownerUserId,
                    "seed:purvesh-demo",
                    createdAt);

                _ssfContext.PlannedActivities.Add(plannedActivity);
                plannedKeys.Add(plannedKey);
                plannedAdded++;
            }
        }

        return plannedAdded;
    }

    /// <param name="retainedLogIds">
    /// Re-seed only (null on the startup path): seed logs the re-seed RETAINED because a row
    /// the seeder did not create depends on them. They are skipped entirely — neither re-created
    /// nor given missing tasks/verifications — so a retained log stays exactly as found.
    /// </param>
    private async Task<Phase4LogStats> EnsureDailyLogsAndVerificationsAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, PlotCycleContext> contextByPlotKey,
        IReadOnlyDictionary<string, UserId> usersByKey,
        DateTime nowUtc,
        DemoVerificationMode verificationMode,
        IReadOnlySet<Guid>? retainedLogIds,
        CancellationToken cancellationToken)
    {
        var existingLogs = await _ssfContext.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l =>
                l.FarmId == farmId &&
                l.IdempotencyKey != null &&
                l.IdempotencyKey.StartsWith($"{SeedVersion}:log:"))
            .ToListAsync(cancellationToken);

        var logsByKey = existingLogs
            .Where(l => !string.IsNullOrWhiteSpace(l.IdempotencyKey))
            .ToDictionary(l => l.IdempotencyKey!, StringComparer.Ordinal);

        var logsAdded = 0;
        var tasksAdded = 0;
        var verificationsAdded = 0;

        foreach (var context in contextByPlotKey.Values.OrderBy(value => value.Seed.Key, StringComparer.Ordinal))
        {
            var plotKey = context.Seed.Key;

            if (!OperatorRoutingByPlotKey.TryGetValue(plotKey, out var routing))
            {
                continue;
            }

            // v2: schedule is driven by BuildLogSchedule() per the 90-day pattern
            // (dense + sparse + distraction/multi-crop/same-crop-DW markers).
            // Returns an empty array if the plot key isn't in the schedule
            // (defensive — should not happen for plots in PlotSeeds).
            var offsets = LogSchedule.TryGetValue(plotKey, out var scheduled)
                ? scheduled
                : Array.Empty<int>();

            for (var index = 0; index < offsets.Length; index++)
            {
                var dayOffset = offsets[index];
                var idempotencyKey = $"{SeedVersion}:log:{plotKey}:{dayOffset}";
                var logDate = DateOnly.FromDateTime(nowUtc.AddDays(dayOffset));
                var occurredAtUtc = BuildIstAnchoredUtc(logDate, index);
                var operatorKey = ResolveOperatorKey(routing, index);
                var operatorUserId = usersByKey[operatorKey];
                var logId = CreateDeterministicGuid($"{SeedVersion}:daily-log:{plotKey}:{dayOffset}");

                if (retainedLogIds is not null && retainedLogIds.Contains(logId))
                {
                    continue;
                }

                if (!logsByKey.TryGetValue(idempotencyKey, out var log))
                {
                    log = DailyLog.Create(
                        logId,
                        farmId,
                        context.PlotId,
                        context.CropCycleId,
                        operatorUserId,
                        logDate,
                        idempotencyKey,
                        null,
                        occurredAtUtc);

                    _ssfContext.DailyLogs.Add(log);
                    logsByKey[idempotencyKey] = log;
                    logsAdded++;
                }

                var taskPattern = ResolveTaskPattern(plotKey, context.Seed.CropName, dayOffset, index);
                for (var taskIndex = 0; taskIndex < taskPattern.Length; taskIndex++)
                {
                    var activityType = taskPattern[taskIndex];
                    var alreadyExists = log.Tasks.Any(t =>
                        t.ActivityType.Equals(activityType, StringComparison.OrdinalIgnoreCase));
                    if (alreadyExists)
                    {
                        continue;
                    }

                    var taskId = CreateDeterministicGuid(
                        $"{SeedVersion}:task:{plotKey}:{dayOffset}:{Normalize(activityType)}:{taskIndex}");
                    var notes = ResolveTaskNote(activityType, plotKey, dayOffset, index, taskIndex);
                    var taskTime = occurredAtUtc.AddMinutes(20 + (taskIndex * 35));

                    log.AddTask(taskId, activityType, notes, taskTime);
                    tasksAdded++;
                }

                verificationsAdded += verificationMode == DemoVerificationMode.RecentPending
                    ? ApplyRecentPendingVerificationPattern(
                        log,
                        plotKey,
                        dayOffset,
                        index,
                        occurredAtUtc,
                        usersByKey)
                    : ApplyVerificationPattern(
                        log,
                        plotKey,
                        dayOffset,
                        index,
                        offsets.Length,
                        occurredAtUtc,
                        usersByKey);
            }
        }

        return new Phase4LogStats(logsAdded, tasksAdded, verificationsAdded, logsByKey);
    }

    private int ApplyVerificationPattern(
        DailyLog log,
        string plotKey,
        int dayOffset,
        int index,
        int totalLogs,
        DateTime occurredAtUtc,
        IReadOnlyDictionary<string, UserId> usersByKey)
    {
        var added = 0;
        var confirmedAtUtc = occurredAtUtc.AddHours(2);

        switch (plotKey)
        {
            case "grape_g1":
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Confirmed,
                    null,
                    "shankar",
                    confirmedAtUtc,
                    usersByKey);

                if (index < (int)Math.Ceiling(totalLogs * 0.70m))
                {
                    added += EnsureVerificationTransition(
                        log,
                        plotKey,
                        dayOffset,
                        VerificationStatus.Verified,
                        null,
                        "purvesh",
                        confirmedAtUtc.AddHours(24),
                        usersByKey);
                }
                break;

            case "grape_g2":
                if (index % 2 == 0)
                {
                    added += EnsureVerificationTransition(
                        log,
                        plotKey,
                        dayOffset,
                        VerificationStatus.Confirmed,
                        null,
                        "raju",
                        confirmedAtUtc,
                        usersByKey);
                }

                if (index == 0 || index == 2 || index == 4)
                {
                    added += EnsureVerificationTransition(
                        log,
                        plotKey,
                        dayOffset,
                        VerificationStatus.Disputed,
                        G2DisputeReason,
                        "purvesh",
                        confirmedAtUtc.AddHours(6),
                        usersByKey);
                }
                break;

            case "sugarcane_s1":
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Confirmed,
                    null,
                    "shankar",
                    confirmedAtUtc,
                    usersByKey);

                if (index < (int)Math.Ceiling(totalLogs * 0.40m))
                {
                    added += EnsureVerificationTransition(
                        log,
                        plotKey,
                        dayOffset,
                        VerificationStatus.Verified,
                        null,
                        "purvesh",
                        confirmedAtUtc.AddHours(24),
                        usersByKey);
                }
                break;

            case "sugarcane_s2":
                // v2: s2 was previously missing from the verification switch,
                // leaving all s2 logs at Reported (founder note: that read
                // as a glitch, not as "less-tracked plot"). Mirrors the s1
                // pattern but with ~50/50 split (newer plot, similar cadence
                // to s1 but no Disputed signal — s2's operator "raju" has no
                // dispute history in the seed narrative).
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Confirmed,
                    null,
                    "raju",
                    confirmedAtUtc,
                    usersByKey);

                if (index < (int)Math.Ceiling(totalLogs * 0.50m))
                {
                    added += EnsureVerificationTransition(
                        log,
                        plotKey,
                        dayOffset,
                        VerificationStatus.Verified,
                        null,
                        "purvesh",
                        confirmedAtUtc.AddHours(24),
                        usersByKey);
                }
                break;
        }

        return added;
    }

    private int EnsureVerificationTransition(
        DailyLog log,
        string plotKey,
        int dayOffset,
        VerificationStatus targetStatus,
        string? reason,
        string actorUserKey,
        DateTime occurredAtUtc,
        IReadOnlyDictionary<string, UserId> usersByKey)
    {
        if (log.VerificationEvents.Any(v => v.Status == targetStatus))
        {
            return 0;
        }

        var actorRole = ResolveSharedRole(actorUserKey);
        if (!VerificationStateMachine.CanTransitionWithRole(log.CurrentVerificationStatus, targetStatus, actorRole))
        {
            return 0;
        }

        var eventId = CreateDeterministicGuid(
            $"{SeedVersion}:verification:{plotKey}:{dayOffset}:{targetStatus}");

        log.Verify(
            eventId,
            targetStatus,
            reason,
            actorRole,
            usersByKey[actorUserKey],
            occurredAtUtc);

        return 1;
    }

    /// <param name="includePriceConfigs">
    /// <c>ssf.price_configs</c> are GLOBAL rows (no farm column — every farm pulls them), so
    /// only the startup demo seed may write them. The one-shot re-seed passes <c>false</c>.
    /// </param>
    /// <param name="costSeeds">The cost rows to ensure (v2 set, or v2 + demo labour payouts).</param>
    /// <param name="retainedCostIds">
    /// Re-seed only: seed cost entries retained because a row the seeder did not create depends on
    /// them. Skipped entirely, including their corrections and day ledgers.
    /// </param>
    private async Task<Phase4FinanceStats> EnsureFinanceAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, PlotCycleContext> contextByPlotKey,
        IReadOnlyDictionary<string, UserId> usersByKey,
        DateTime nowUtc,
        bool includePriceConfigs,
        IReadOnlyList<CostEntrySeed> costSeeds,
        IReadOnlySet<Guid>? retainedCostIds,
        CancellationToken cancellationToken,
        Func<Task>? flushAfterCostEntries = null)
    {
        var costIdByKey = costSeeds.ToDictionary(
            seed => seed.Key,
            seed => CreateDeterministicGuid($"{SeedVersion}:cost:{seed.Key}"),
            StringComparer.Ordinal);
        var costIds = costIdByKey.Values.ToHashSet();

        var existingCosts = await _ssfContext.CostEntries
            .Where(c => costIds.Contains(c.Id))
            .ToListAsync(cancellationToken);

        var costById = existingCosts.ToDictionary(c => c.Id);
        var costsAdded = 0;

        foreach (var costSeed in costSeeds)
        {
            var costId = costIdByKey[costSeed.Key];
            if (costById.ContainsKey(costId))
            {
                continue;
            }

            Guid? plotId = null;
            Guid? cropCycleId = null;
            if (!string.IsNullOrWhiteSpace(costSeed.PlotKey) &&
                contextByPlotKey.TryGetValue(costSeed.PlotKey, out var context))
            {
                plotId = context.PlotId;
                cropCycleId = context.CropCycleId;
            }

            var entryDate = DateOnly.FromDateTime(nowUtc.AddDays(costSeed.DayOffset));
            var createdAtUtc = BuildIstAnchoredUtc(entryDate, Math.Abs(costSeed.DayOffset));

            var entry = CostEntry.Create(
                costId,
                farmId,
                plotId,
                cropCycleId,
                costSeed.Category,
                costSeed.Description,
                costSeed.Amount,
                "INR",
                entryDate,
                usersByKey[costSeed.CreatedByUserKey],
                null,
                createdAtUtc,
                // Stated, not assumed. Every row in `costSeeds` is authored
                // here as a purchase or a payout — fertilizer, pesticide,
                // labour — so this seeder is the thing that KNOWS, and saying
                // so is a statement rather than a guess about someone else's
                // record. Without it the demo's cost entries read back as
                // direction-unknown and fall out of the expense total, which
                // would make a correct app look broken on the one dataset the
                // founder demonstrates with.
                direction: MoneyDirection.Expense);

            _ssfContext.CostEntries.Add(entry);
            costById[costId] = entry;
            costsAdded++;
        }

        // Re-seed only (null on the startup path, which keeps its single save): under the
        // app role, ssf.finance_corrections' tenant policy checks its cost entry with an
        // EXISTS, so the cost rows must be written before their corrections.
        if (flushAfterCostEntries is not null)
        {
            await flushAfterCostEntries();
        }

        // v2 (post-supervisor Option C): re-anchored from p1_pesticide_03/06
        // (pomegranate cost entries removed) to higher-value cost entries on
        // two different plots + two different categories, preserving the
        // FinanceCorrection demo signal amplitude (~₹480 total upward
        // adjustment vs the v1 ₹450 baseline).
        //   s1_fertilizer_01 (₹1900 DAP basal) × 1.15 → ₹2185 (+₹285)
        //   s2_labour_05     (₹1300 labour)    × 1.15 → ₹1495 (+₹195)
        // The Spraying / Pesticide cost entries for grape plots stay at their
        // original amounts so the cost ledger reads consistently; corrections
        // appear only against fertilizer + labour, which matches typical
        // smallholder reconciliation patterns (invoice mismatches on bulk
        // chemical purchases and shift-end labour payouts).
        var correctionSeeds = new[]
        {
            new CorrectionSeed("s1_fertilizer_01", 1.15m, "DAP basal invoice reconciled upward after vendor receipt", "purvesh"),
            new CorrectionSeed("s2_labour_05", 1.15m, "S2 labour payout adjusted for extra-hours claim", "purvesh")
        };

        var correctionIds = correctionSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:correction:{seed.CostKey}"))
            .ToHashSet();
        var existingCorrectionIds = await _ssfContext.FinanceCorrections
            .Where(c => correctionIds.Contains(c.Id))
            .Select(c => c.Id)
            .ToHashSetAsync(cancellationToken);

        var correctionsAdded = 0;
        foreach (var correctionSeed in correctionSeeds)
        {
            var correctionId = CreateDeterministicGuid($"{SeedVersion}:correction:{correctionSeed.CostKey}");
            if (existingCorrectionIds.Contains(correctionId))
            {
                continue;
            }

            if (!costIdByKey.TryGetValue(correctionSeed.CostKey, out var costId) ||
                retainedCostIds?.Contains(costId) == true ||
                !costById.TryGetValue(costId, out var costEntry))
            {
                continue;
            }

            var correctedAmount = decimal.Round(
                costEntry.Amount * correctionSeed.Multiplier,
                2,
                MidpointRounding.AwayFromZero);
            var correctedAtUtc = DateTime.SpecifyKind(
                    costEntry.EntryDate.ToDateTime(TimeOnly.MinValue),
                    DateTimeKind.Utc)
                .AddHours(12);

            var correction = FinanceCorrection.Create(
                correctionId,
                costEntry.Id,
                costEntry.Amount,
                correctedAmount,
                "INR",
                correctionSeed.Reason,
                usersByKey[correctionSeed.CorrectedByUserKey],
                correctedAtUtc);

            _ssfContext.FinanceCorrections.Add(correction);
            costEntry.MarkCorrected(correctionId, correctedAmount, "INR", correctedAtUtc);
            correctionsAdded++;
        }

        var dayLedgerSeeds = SeedDayLedgerKeys;
        var sourceCostIds = dayLedgerSeeds
            .Where(costIdByKey.ContainsKey)
            .Select(key => costIdByKey[key])
            .ToHashSet();

        var existingDayLedgerSources = await _ssfContext.DayLedgers
            .Where(l => sourceCostIds.Contains(l.SourceCostEntryId))
            .Select(l => l.SourceCostEntryId)
            .ToHashSetAsync(cancellationToken);

        var dayLedgersAdded = 0;
        foreach (var dayLedgerSeed in dayLedgerSeeds)
        {
            if (!costIdByKey.TryGetValue(dayLedgerSeed, out var sourceCostId) ||
                existingDayLedgerSources.Contains(sourceCostId) ||
                retainedCostIds?.Contains(sourceCostId) == true ||
                !costById.TryGetValue(sourceCostId, out var sourceCost))
            {
                continue;
            }

            var allocations = BuildAcreageAllocations(dayLedgerSeed, sourceCost.Amount, sourceCost.EntryDate, contextByPlotKey);
            if (allocations.Count == 0)
            {
                continue;
            }

            var dayLedgerId = CreateDeterministicGuid($"{SeedVersion}:day-ledger:{dayLedgerSeed}");
            var createdAtUtc = DateTime.SpecifyKind(sourceCost.EntryDate.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc)
                .AddHours(13);

            var dayLedger = DayLedger.Create(
                dayLedgerId,
                farmId,
                sourceCost.Id,
                sourceCost.EntryDate,
                "ByAcreage",
                usersByKey["purvesh"],
                allocations,
                createdAtUtc);

            _ssfContext.DayLedgers.Add(dayLedger);
            dayLedgersAdded++;
        }

        if (!includePriceConfigs)
        {
            return new Phase4FinanceStats(costsAdded, correctionsAdded, dayLedgersAdded, 0);
        }

        var purveshUserId = usersByKey["purvesh"];
        var priceItemNames = PriceConfigSeeds
            .Select(seed => seed.ItemName)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existingPriceConfigs = await _ssfContext.PriceConfigs
            .Where(p => priceItemNames.Contains(p.ItemName))
            .Select(p => new { p.ItemName, p.Version, p.CreatedByUserId })
            .ToListAsync(cancellationToken);
        var existingPurveshItems = existingPriceConfigs
            .Where(p => p.CreatedByUserId == purveshUserId)
            .Select(p => Normalize(p.ItemName))
            .ToHashSet(StringComparer.Ordinal);

        var priceConfigsAdded = 0;
        foreach (var priceSeed in PriceConfigSeeds)
        {
            var normalizedItem = Normalize(priceSeed.ItemName);
            if (existingPurveshItems.Contains(normalizedItem))
            {
                continue;
            }

            var nextVersion = existingPriceConfigs
                .Where(p => p.ItemName.Equals(priceSeed.ItemName, StringComparison.OrdinalIgnoreCase))
                .Select(p => p.Version)
                .DefaultIfEmpty(0)
                .Max() + 1;

            var priceConfig = PriceConfig.Create(
                CreateDeterministicGuid($"{SeedVersion}:price:{normalizedItem}:{nextVersion}"),
                priceSeed.ItemName,
                priceSeed.UnitPrice,
                "INR",
                DateOnly.FromDateTime(nowUtc.Date),
                nextVersion,
                purveshUserId,
                nowUtc);

            _ssfContext.PriceConfigs.Add(priceConfig);
            existingPurveshItems.Add(normalizedItem);
            existingPriceConfigs.Add(new
            {
                priceSeed.ItemName,
                Version = nextVersion,
                CreatedByUserId = purveshUserId
            });
            priceConfigsAdded++;
        }

        return new Phase4FinanceStats(costsAdded, correctionsAdded, dayLedgersAdded, priceConfigsAdded);
    }

    private async Task<Phase5AttachmentStats> EnsureAttachmentsAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, UserId> usersByKey,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var attachmentIds = AttachmentSeeds
            .Select(seed => CreateDeterministicGuid($"{SeedVersion}:attachment:{seed.SeedKey}"))
            .ToHashSet();

        var existingAttachmentIds = await _ssfContext.Attachments
            .Where(a => attachmentIds.Contains(a.Id))
            .Select(a => a.Id)
            .ToHashSetAsync(cancellationToken);

        var added = 0;

        for (var index = 0; index < AttachmentSeeds.Length; index++)
        {
            var seed = AttachmentSeeds[index];
            var attachmentId = CreateDeterministicGuid($"{SeedVersion}:attachment:{seed.SeedKey}");
            if (existingAttachmentIds.Contains(attachmentId))
            {
                continue;
            }

            var linkedEntityId = ResolveAttachmentLinkedEntityId(seed, farmId);
            var createdAtUtc = ResolveAttachmentCreatedAtUtc(seed, nowUtc, index);

            var attachment = Attachment.Create(
                attachmentId,
                farmId,
                linkedEntityId,
                seed.LinkedEntityType,
                seed.FileName,
                "image/jpeg",
                usersByKey[seed.CreatedByUserKey],
                createdAtUtc);

            var uploadedAtUtc = createdAtUtc.AddMinutes(5);
            attachment.MarkUploaded($"/demo-photos/{seed.FileName}", seed.SizeBytes, uploadedAtUtc);
            attachment.FinalizeUpload(uploadedAtUtc.AddMinutes(1));

            _ssfContext.Attachments.Add(attachment);
            existingAttachmentIds.Add(attachmentId);
            added++;
        }

        return new Phase5AttachmentStats(added);
    }

    /// <summary>
    /// v2 — creates the Accounts.OwnerAccount aggregate for Purvesh. The
    /// factory <see cref="OwnerAccount.Create"/> internally seeds the
    /// PrimaryOwner OwnerAccountMembership (lines 73-80 of OwnerAccount.cs),
    /// so EF cascade-inserts the membership row when SaveChanges runs.
    /// Idempotent: skips insertion if the OwnerAccountId already exists.
    /// </summary>
    private async Task<int> EnsurePurveshOwnerAccountAsync(
        UserId purveshUserId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var exists = await _accountsContext.OwnerAccounts
            .AnyAsync(x => x.Id == PurveshOwnerAccountId, cancellationToken);
        if (exists)
        {
            return 0;
        }

        var account = OwnerAccount.Create(
            PurveshOwnerAccountId,
            "Purvesh Chandrashkehar Arve Farm",
            purveshUserId,
            OwnerAccountType.Individual,
            nowUtc);

        _accountsContext.OwnerAccounts.Add(account);
        return 1;
    }

    /// <summary>
    /// v2 — creates the Trialing Subscription row for Purvesh's OwnerAccount.
    /// Replaces the prior pattern where this INSERT lived in
    /// .deploy-tmp/purvesh-cleanup.sql; ownership moved into the seeder so the
    /// data-creation story is centralized. Subscription.StartTrial sets both
    /// ValidUntilUtc and TrialEndsAtUtc to the same date — chosen as
    /// 2099-12-31 per founder's "unlimited trial" spec.
    /// Idempotent: the partial unique index ux_subscriptions_owner_account_active
    /// guarantees at most one Trialing/Active row per OwnerAccount; this method
    /// short-circuits if one already exists.
    /// </summary>
    private async Task<int> EnsurePurveshSubscriptionAsync(
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var hasActive = await _accountsContext.Subscriptions
            .AnyAsync(
                x => x.OwnerAccountId == PurveshOwnerAccountId &&
                     (x.Status == SubscriptionStatus.Trialing || x.Status == SubscriptionStatus.Active),
                cancellationToken);
        if (hasActive)
        {
            return 0;
        }

        var subscriptionId = new SubscriptionId(
            CreateDeterministicGuid($"{SeedVersion}:subscription:trial"));
        var trialEndsAtUtc = new DateTime(2099, 12, 31, 23, 59, 59, DateTimeKind.Utc);

        var subscription = Subscription.StartTrial(
            subscriptionId,
            PurveshOwnerAccountId,
            "shramsafal_pro",
            nowUtc,
            trialEndsAtUtc);

        _accountsContext.Subscriptions.Add(subscription);
        return 1;
    }

    /// <summary>
    /// v2 — seeds the multi-tenant "demo content" rows: 1 FarmInvitation
    /// (created -3d, active, anchors the join-token), 1 FarmJoinToken (active
    /// QR for new-worker scan flow), and the 4-row affiliation chain
    /// (ReferralCode -> ReferralRelationship -> GrowthEvent -> BenefitLedgerEntry).
    ///
    /// Domain note: the as-shipped FarmInvitation entity is simpler than the
    /// plan documented — no phone/role/expiry/maxUses fields, AND the DB
    /// enforces ONE Active invitation per farm via partial unique index
    /// `ux_farm_invitations_active_per_farm`. Halt Point 4 (2026-05-13)
    /// caught a seeder bug where this orchestrator's child method tried to
    /// seed 2 invitations and SaveChanges blew up on SqlState 23505. Fixed
    /// to 1. The richer model (multiple targeted invitations) is tracked at:
    ///   _COFOUNDER/Projects/AgriSync/Operations/Plans/
    ///   PENDING_FARM_INVITATION_RICHER_MODEL_IMPL_2026-05-13.md
    ///
    /// Similarly, the AffiliationProfile entity (plan §2.1.3 5th row) never
    /// shipped — chain is 4 entities not 5. Tracked at:
    ///   _COFOUNDER/Projects/AgriSync/Operations/Plans/
    ///   PENDING_AFFILIATION_PROFILE_IMPL_2026-05-13.md
    /// </summary>
    private async Task<Phase6MultiTenantStats> EnsureMultiTenantDataAsync(
        Farm farm,
        UserId purveshUserId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var farmInvitationsAdded = await EnsurePurveshFarmInvitationsAsync(
            farm.Id, purveshUserId, nowUtc, cancellationToken);
        var farmJoinTokensAdded = await EnsurePurveshFarmJoinTokenAsync(
            farm.Id, nowUtc, cancellationToken);
        var affiliationRowsAdded = await EnsurePurveshAffiliationAsync(
            nowUtc, cancellationToken);

        return new Phase6MultiTenantStats(
            farmInvitationsAdded,
            farmJoinTokensAdded,
            affiliationRowsAdded);
    }

    private async Task<int> EnsurePurveshFarmInvitationsAsync(
        FarmId farmId,
        UserId purveshUserId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        // As-shipped FarmInvitation invariant: exactly ONE Active invitation
        // per farm. Enforced by partial unique index
        // `ux_farm_invitations_active_per_farm` on `(farm_id) WHERE status=1`
        // (Active) — see
        //   src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/
        //   Configurations/FarmInvitationConfiguration.cs:38-42
        // and the domain comment at `FarmInvitation.cs:7-12` ("One persistent
        // 'join my farm' invitation per farm").
        //
        // Halt Point 4 (2026-05-13) caught a seeder bug where this method
        // attempted to seed two Active invitations; the second SaveChanges
        // hit `SqlState 23505` on the partial unique index. The richer
        // model (multiple targeted invitations, one per (phone, role)
        // pair) is tracked at:
        //   _COFOUNDER/Projects/AgriSync/Operations/Plans/
        //   PENDING_FARM_INVITATION_RICHER_MODEL_IMPL_2026-05-13.md
        // When that ships, this method becomes a multi-row seeder again.
        var invitationId = new FarmInvitationId(
            CreateDeterministicGuid($"{SeedVersion}:invitation:worker-anchor"));
        var exists = await _ssfContext.FarmInvitations
            .AnyAsync(x => x.Id == invitationId, cancellationToken);
        if (exists)
        {
            return 0;
        }

        var invitation = FarmInvitation.Issue(
            invitationId,
            farmId,
            purveshUserId,
            nowUtc.AddDays(-3));

        _ssfContext.FarmInvitations.Add(invitation);
        return 1;
    }

    private async Task<int> EnsurePurveshFarmJoinTokenAsync(
        FarmId farmId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        // Token must link to an existing FarmInvitation. Anchors on the
        // single Active invitation seeded by
        // EnsurePurveshFarmInvitationsAsync (worker-anchor — see the
        // 1-per-farm partial unique index rationale there).
        var anchorInvitationId = new FarmInvitationId(
            CreateDeterministicGuid($"{SeedVersion}:invitation:worker-anchor"));

        var tokenId = new FarmJoinTokenId(
            CreateDeterministicGuid($"{SeedVersion}:joinToken:active"));
        var exists = await _ssfContext.FarmJoinTokens
            .AnyAsync(x => x.Id == tokenId, cancellationToken);
        if (exists)
        {
            return 0;
        }

        // Deterministic raw-token string so re-runs produce the same QR
        // payload. In real onboarding the rawToken is randomly generated;
        // deterministic-for-seed is acceptable since the demo's QR is
        // bearer-style anyway (per FarmInvitation.cs:9-13 design note).
        const string rawToken = "purvesh-demo-v2-qr-token-active";
        var tokenHash = ComputeSha256Hex(rawToken);

        var createdAtUtc = nowUtc.AddDays(-2);
        var token = FarmJoinToken.Issue(
            tokenId,
            anchorInvitationId,
            farmId,
            rawToken,
            tokenHash,
            createdAtUtc);

        _ssfContext.FarmJoinTokens.Add(token);
        return 1;
    }

    /// <summary>
    /// v2 — seeds the 4-row affiliation chain (per plan §2.1.3 minus
    /// AffiliationProfile which never shipped). Order matters: GrowthEvent
    /// must be inserted before BenefitLedgerEntry because the ledger entry
    /// references the growth event's Id.
    ///
    /// Invariants honored:
    ///   I13 — Referrer != Referred. PurveshSyntheticReferredAccountId is
    ///         derived from a distinct seed string so it cannot collide
    ///         with PurveshOwnerAccountId.
    ///   I10 — At most one non-cancelled ReferralRelationship per referred
    ///         account. Deterministic id + idempotent check.
    ///   I11 — GrowthEvent table is append-only at DB level; idempotent
    ///         INSERT via existence check.
    /// </summary>
    private async Task<int> EnsurePurveshAffiliationAsync(
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var added = 0;

        // 1) ReferralCode
        var referralCodeId = new ReferralCodeId(
            CreateDeterministicGuid($"{SeedVersion}:affiliation:referral-code"));
        var hasCode = await _accountsContext.ReferralCodes
            .AnyAsync(x => x.Id == referralCodeId, cancellationToken);
        if (!hasCode)
        {
            var code = new ReferralCode(
                referralCodeId,
                PurveshOwnerAccountId,
                PurveshReferralCode,
                nowUtc.AddDays(-30));
            _accountsContext.ReferralCodes.Add(code);
            added++;
        }

        // 2) ReferralRelationship (Pending -> later MarkQualified)
        var relationshipId = new ReferralRelationshipId(
            CreateDeterministicGuid($"{SeedVersion}:affiliation:referral-relationship"));
        var hasRel = await _accountsContext.ReferralRelationships
            .AnyAsync(x => x.Id == relationshipId, cancellationToken);
        if (!hasRel)
        {
            var relationship = new ReferralRelationship(
                relationshipId,
                referrerOwnerAccountId: PurveshOwnerAccountId,
                referredOwnerAccountId: PurveshSyntheticReferredAccountId,
                referralCodeId: referralCodeId,
                createdAtUtc: nowUtc.AddDays(-20));
            relationship.MarkQualified(nowUtc.AddDays(-10));
            _accountsContext.ReferralRelationships.Add(relationship);
            added++;
        }

        // 3) GrowthEvent (append-only at DB level; idempotent via existence)
        var growthEventId = new GrowthEventId(
            CreateDeterministicGuid($"{SeedVersion}:affiliation:growth-event"));
        var hasEvent = await _accountsContext.GrowthEvents
            .AnyAsync(x => x.Id == growthEventId, cancellationToken);
        if (!hasEvent)
        {
            var growthEvent = new GrowthEvent(
                growthEventId,
                ownerAccountId: PurveshOwnerAccountId,
                eventType: GrowthEventType.ReferralQualified,
                referenceId: (Guid)relationshipId,
                metadata: null,
                occurredAtUtc: nowUtc.AddDays(-10));
            _accountsContext.GrowthEvents.Add(growthEvent);
            added++;
        }

        // 4) BenefitLedgerEntry (EarnedLocked badge tied to the growth event)
        // Plan §7.2.3 V1 rule: badge-only, quantity=1, unit="count".
        // Redemption path pending — see:
        //   _COFOUNDER/Projects/AgriSync/Operations/Plans/
        //   PENDING_BENEFIT_REDEMPTIONS_IMPL_2026-05-13.md
        var benefitEntryId = new BenefitLedgerEntryId(
            CreateDeterministicGuid($"{SeedVersion}:affiliation:benefit-ledger-entry"));
        var hasEntry = await _accountsContext.BenefitLedgerEntries
            .AnyAsync(x => x.Id == benefitEntryId, cancellationToken);
        if (!hasEntry)
        {
            var entry = new BenefitLedgerEntry(
                benefitEntryId,
                ownerAccountId: PurveshOwnerAccountId,
                sourceGrowthEventId: growthEventId,
                status: BenefitStatus.EarnedLocked,
                benefitType: "Badge",
                quantity: 1,
                unit: "count",
                createdAtUtc: nowUtc.AddDays(-10));
            _accountsContext.BenefitLedgerEntries.Add(entry);
            added++;
        }

        return added;
    }

    private static string ComputeSha256Hex(string input)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        var hash = SHA256.HashData(bytes);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash)
        {
            sb.Append(b.ToString("x2"));
        }
        return sb.ToString();
    }

    private static Guid ResolveAttachmentLinkedEntityId(AttachmentSeed seed, FarmId farmId)
    {
        if (seed.LinkedEntityType.Equals("Farm", StringComparison.OrdinalIgnoreCase))
        {
            return (Guid)farmId;
        }

        if (seed.LinkedEntityType.Equals("DailyLog", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(seed.PlotKey) &&
            seed.DayOffset.HasValue)
        {
            return CreateDeterministicGuid($"{SeedVersion}:daily-log:{seed.PlotKey}:{seed.DayOffset.Value}");
        }

        throw new InvalidOperationException($"Attachment seed '{seed.SeedKey}' has invalid link target.");
    }

    private static DateTime ResolveAttachmentCreatedAtUtc(AttachmentSeed seed, DateTime nowUtc, int sequence)
    {
        if (seed.DayOffset.HasValue)
        {
            var date = DateOnly.FromDateTime(nowUtc.AddDays(seed.DayOffset.Value));
            return BuildIstAnchoredUtc(date, sequence).AddMinutes(50);
        }

        return new DateTime(nowUtc.Year, nowUtc.Month, nowUtc.Day, 9, 0, 0, DateTimeKind.Utc)
            .AddMinutes(sequence);
    }

    private static string ResolveOperatorKey(OperatorRoutingSeed routing, int index)
    {
        if (!string.IsNullOrWhiteSpace(routing.SecondaryUserKey) &&
            routing.SecondaryModulo > 0 &&
            index % routing.SecondaryModulo == 0)
        {
            return routing.SecondaryUserKey;
        }

        return routing.PrimaryUserKey;
    }

    private static string[] ResolveTaskPattern(string plotKey, string cropName, int dayOffset, int index)
    {
        // Same-crop-different-work override (v2 90-day pattern). On these
        // offsets the two grape plots do contrasting work: Pruning on g1
        // (the Marathi note covers "Bordeaux paste on wounds" — i.e. bud
        // paste post-pruning) and Spraying on g2 (preventive fungicide).
        // This contrast is the demo signal for the same-crop-DW criterion.
        // Override fires BEFORE the rest-day check; same-crop-DW offsets
        // {-21,-35,-49,-63} don't collide with rest-day moduli (g1=13, g2=11).
        if (SameCropDifferentWorkOffsets.Contains(dayOffset))
        {
            if (plotKey == "grape_g1") return ["Pruning", "Observation"];
            if (plotKey == "grape_g2") return ["Spraying", "Observation"];
        }

        if (IsRestDay(plotKey, dayOffset))
        {
            return ["Observation"];
        }

        return plotKey switch
        {
            "grape_g1" or "grape_g2" => BuildGrapePattern(dayOffset, index),
            "sugarcane_s1" or "sugarcane_s2" => BuildSugarcanePattern(dayOffset, index),
            _ => BuildFallbackPattern(cropName, index)
        };
    }

    private static string[] BuildGrapePattern(int dayOffset, int index)
    {
        if (dayOffset <= -65 && Math.Abs(dayOffset) % 5 == 0)
        {
            return ["Pruning", "Machinery", "Observation"];
        }

        if (Math.Abs(dayOffset) % 9 == 0)
        {
            return ["Spraying", "Observation"];
        }

        if (Math.Abs(dayOffset) % 4 == 0)
        {
            return ["Fertigation", "Irrigation", "Observation"];
        }

        return index % 3 == 0
            ? ["Irrigation", "Machinery", "Observation"]
            : ["Irrigation", "Observation"];
    }

    private static string[] BuildSugarcanePattern(int dayOffset, int index)
    {
        if (Math.Abs(dayOffset) % 15 == 0)
        {
            return ["Fertilizer application", "Irrigation", "Observation"];
        }

        if (Math.Abs(dayOffset) % 8 == 0)
        {
            return ["Weeding", "Observation"];
        }

        if (Math.Abs(dayOffset) % 11 == 0)
        {
            return ["Machinery", "Irrigation", "Observation"];
        }

        return index % 2 == 0
            ? ["Irrigation", "Observation"]
            : ["Observation", "Irrigation"];
    }

    private static string[] BuildFallbackPattern(string cropName, int index)
    {
        if (TaskPatternsByCropName.TryGetValue(cropName, out var patterns) && patterns.Length > 0)
        {
            return patterns[index % patterns.Length];
        }

        return ["Observation"];
    }

    private static bool IsRestDay(string plotKey, int dayOffset)
    {
        var restingModulo = plotKey switch
        {
            "grape_g1" => 13,
            "grape_g2" => 11,
            "sugarcane_s1" => 10,
            "sugarcane_s2" => 8,
            _ => 12
        };

        return Math.Abs(dayOffset) > 0 && Math.Abs(dayOffset) % restingModulo == 0;
    }

    private static string ResolveTaskNote(
        string activityType,
        string plotKey,
        int dayOffset,
        int logIndex,
        int taskIndex)
    {
        // v2: sugarcane_s1 no longer logs at -35 (-35 is a same-crop-DW day —
        // grape-only); pomegranate/turmeric plots removed entirely. The
        // historical "labour no-show" + "fungicide cost" + "delayed urea"
        // demo signals previously anchored on these offsets are dropped from
        // the v2 dataset; if needed, re-anchor them on existing grape/
        // sugarcane log days in a follow-up.
        if (activityType.Equals("Observation", StringComparison.OrdinalIgnoreCase) && IsRestDay(plotKey, dayOffset))
        {
            return "प्लॉट रेस्टिंग आहे. आज कोणते काम केले नाही.";
        }

        if (activityType.Equals("Irrigation", StringComparison.OrdinalIgnoreCase))
        {
            var waterSource = ResolveWaterSourceName(plotKey);
            var motor = ResolveMotorName(plotKey);
            return (Math.Abs(dayOffset) + logIndex + taskIndex) % 2 == 0
                ? $"शेड्यूल नुसार पाणी दिले. {waterSource} वरून {motor} चालू करून लाईन पूर्ण केली."
                : $"{waterSource} वरून {motor} ने सिंचन केले. दाब आणि ओल दोन्ही समाधानकारक होते.";
        }

        if (activityType.Equals("Machinery", StringComparison.OrdinalIgnoreCase))
        {
            return $"{ResolveMachineryName(plotKey)} वापरून सहाय्यक काम केले. फिल्टर, बेल्ट आणि नोजल तपासले.";
        }

        if (NotesByActivityType.TryGetValue(activityType, out var notes) && notes.Length > 0)
        {
            return notes[(logIndex + taskIndex) % notes.Length];
        }

        return $"{activityType} kaam nond.";
    }

    private static DateTime BuildIstAnchoredUtc(DateOnly date, int sequence)
    {
        var midnightUtc = DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        return sequence % 2 == 0
            ? midnightUtc.AddHours(2).AddMinutes(30)   // 08:00 IST
            : midnightUtc.AddHours(11).AddMinutes(30); // 17:00 IST
    }

    private static SharedAppRole ResolveSharedRole(string userKey)
    {
        var role = UserSeeds.FirstOrDefault(seed => seed.Key == userKey)?.Role ?? UserAppRole.Worker;
        return (SharedAppRole)(int)role;
    }

    private static List<DayLedgerAllocation> BuildAcreageAllocations(
        string ledgerSeedKey,
        decimal totalAmount,
        DateOnly ledgerDate,
        IReadOnlyDictionary<string, PlotCycleContext> contextByPlotKey)
    {
        var targets = AllocationPlotKeys
            .Where(contextByPlotKey.ContainsKey)
            .Select(key => contextByPlotKey[key])
            .ToList();

        if (targets.Count == 0 || totalAmount <= 0)
        {
            return [];
        }

        var totalArea = targets.Sum(target => target.Seed.AreaInAcres);
        if (totalArea <= 0)
        {
            return [];
        }

        var amounts = new decimal[targets.Count];
        decimal assigned = 0;

        for (var i = 0; i < targets.Count; i++)
        {
            if (i == targets.Count - 1)
            {
                amounts[i] = decimal.Round(totalAmount - assigned, 2, MidpointRounding.AwayFromZero);
            }
            else
            {
                amounts[i] = decimal.Round(
                    totalAmount * (targets[i].Seed.AreaInAcres / totalArea),
                    2,
                    MidpointRounding.AwayFromZero);
                assigned += amounts[i];
            }
        }

        var delta = decimal.Round(totalAmount - amounts.Sum(), 2, MidpointRounding.AwayFromZero);
        if (targets.Count > 0 && delta != 0)
        {
            amounts[0] += delta;
        }

        var allocatedAtUtc = DateTime.SpecifyKind(ledgerDate.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc).AddHours(13);
        var allocations = new List<DayLedgerAllocation>(targets.Count);

        for (var i = 0; i < targets.Count; i++)
        {
            if (amounts[i] <= 0)
            {
                continue;
            }

            var allocationId = CreateDeterministicGuid(
                $"{SeedVersion}:allocation:{ledgerSeedKey}:{targets[i].Seed.Key}");
            allocations.Add(DayLedgerAllocation.Create(
                allocationId,
                targets[i].PlotId,
                amounts[i],
                "INR",
                allocatedAtUtc.AddMinutes(i)));
        }

        return allocations;
    }

    private static List<CostEntrySeed> BuildCostEntrySeeds()
    {
        var seeds = new List<CostEntrySeed>(59);

        void Add(string key, string? plotKey, string category, decimal amount, int dayOffset, string description, string createdByUserKey)
        {
            seeds.Add(new CostEntrySeed(key, plotKey, category, description, amount, dayOffset, createdByUserKey));
        }

        var g1PesticideOffsets = new[] { -84, -72, -60, -48, -36, -24, -12, -3 };
        var g1PesticideAmounts = new[] { 620m, 610m, 590m, 605m, 615m, 625m, 600m, 630m };
        for (var i = 0; i < g1PesticideOffsets.Length; i++)
        {
            Add($"g1_pesticide_{i + 1:00}", "grape_g1", "pesticide", g1PesticideAmounts[i], g1PesticideOffsets[i], "Torus + Mancozeb spray - G1", "shankar");
        }

        var g1FertilizerOffsets = new[] { -80, -68, -56, -44, -32, -20, -8, 0 };
        var g1FertilizerAmounts = new[] { 450m, 470m, 460m, 820m, 840m, 430m, 780m, 860m };
        for (var i = 0; i < g1FertilizerOffsets.Length; i++)
        {
            Add($"g1_fertilizer_{i + 1:00}", "grape_g1", "fertilizer", g1FertilizerAmounts[i], g1FertilizerOffsets[i], "Fertigation input - G1", "shankar");
        }

        var g2PesticideOffsets = new[] { -70, -55, -40, -15 };
        var g2PesticideAmounts = new[] { 600m, 620m, 590m, 610m };
        for (var i = 0; i < g2PesticideOffsets.Length; i++)
        {
            Add($"g2_pesticide_{i + 1:00}", "grape_g2", "pesticide", g2PesticideAmounts[i], g2PesticideOffsets[i], "Spray cycle - G2", "raju");
        }

        var g2FertilizerOffsets = new[] { -66, -50, -34, -10 };
        var g2FertilizerAmounts = new[] { 440m, 460m, 790m, 830m };
        for (var i = 0; i < g2FertilizerOffsets.Length; i++)
        {
            Add($"g2_fertilizer_{i + 1:00}", "grape_g2", "fertilizer", g2FertilizerAmounts[i], g2FertilizerOffsets[i], "Fertigation input - G2", "raju");
        }

        var s1LabourOffsets = new[] { -90, -75, -60, -45, -30, -15, 0 };
        var s1LabourAmounts = new[] { 1800m, 2100m, 2100m, 2400m, 2400m, 2700m, 2700m };
        for (var i = 0; i < s1LabourOffsets.Length; i++)
        {
            Add($"s1_labour_{i + 1:00}", "sugarcane_s1", "labour_misc", s1LabourAmounts[i], s1LabourOffsets[i], "S1 labour payout", "shankar");
        }

        Add("s1_fertilizer_01", "sugarcane_s1", "fertilizer", 1900m, -85, "DAP basal application - S1", "shankar");
        Add("s1_fertilizer_02", "sugarcane_s1", "fertilizer", 820m, -58, "Urea dose 1 - S1", "shankar");
        Add("s1_fertilizer_03", "sugarcane_s1", "fertilizer", 860m, -28, "Urea dose 2 - S1", "shankar");
        Add("s1_equipment_01", "sugarcane_s1", "equipment", 2200m, -90, "Tractor hire - S1 planting", "shankar");
        Add("s1_equipment_02", "sugarcane_s1", "equipment", 1950m, -44, "Inter-cultivation implement hire - S1", "shankar");

        Add("s2_labour_01", "sugarcane_s2", "labour_misc", 1100m, -60, "S2 labour payout", "raju");
        Add("s2_labour_02", "sugarcane_s2", "labour_misc", 1200m, -46, "S2 labour payout", "raju");
        Add("s2_labour_03", "sugarcane_s2", "labour_misc", 1150m, -30, "S2 labour payout", "raju");
        Add("s2_labour_04", "sugarcane_s2", "labour_misc", 1250m, -15, "S2 labour payout", "raju");
        Add("s2_labour_05", "sugarcane_s2", "labour_misc", 1300m, 0, "S2 labour payout", "raju");

        Add("farmwide_01", null, "fuel", 480m, -88, "Diesel for irrigation pump", "purvesh");
        Add("farmwide_02", null, "equipment", 2100m, -72, "Shared implement repair", "purvesh");
        Add("farmwide_03", null, "fuel", 520m, -57, "Diesel for transport", "purvesh");
        Add("farmwide_04", null, "equipment", 1950m, -43, "Water motor maintenance", "purvesh");
        Add("farmwide_05", null, "fuel", 430m, -29, "Generator diesel refill", "purvesh");
        Add("farmwide_06", null, "equipment", 2300m, -21, "Shared tractor support", "purvesh");
        Add("farmwide_07", null, "fuel", 500m, -13, "Field transport diesel", "purvesh");
        Add("farmwide_08", null, "equipment", 2050m, -9, "Sprayer service and parts", "purvesh");
        Add("farmwide_09", null, "fuel", 460m, -4, "Diesel refill", "purvesh");
        Add("farmwide_10", null, "equipment", 1800m, 0, "Pump and line repair", "purvesh");
        Add("farmwide_11", null, "fuel", 520m, -18, "Generator diesel for late-night irrigation", "purvesh");
        Add("farmwide_12", null, "equipment", 1450m, -11, "Disc filter cartridge replacement", "purvesh");
        Add("farmwide_13", null, "equipment", 2600m, -6, "Kirloskar motor rewinding advance", "purvesh");
        Add("farmwide_14", null, "fuel", 410m, -2, "Sprayer petrol refill", "purvesh");

        Add("g1_equipment_01", "grape_g1", "equipment", 1650m, -16, "Blower and pruning kit service - G1", "shankar");
        Add("g2_equipment_01", "grape_g2", "equipment", 980m, -5, "Drip venturi replacement - G2", "raju");
        Add("s1_fuel_01", "sugarcane_s1", "fuel", 390m, -12, "Field bund levelling diesel - S1", "shankar");
        Add("s2_equipment_01", "sugarcane_s2", "equipment", 760m, -3, "Water gate and pipe coupling - S2", "raju");

        // v2: expected seed count = 59 after pomegranate/turmeric/bajra removal
        // (82 original − 10 p1 − 6 t1 − 3 b1 − 1 p1_equipment − 1 t1_equipment
        //  − 1 b1_equipment − 1 p1_fuel = 59).
        if (seeds.Count != 59)
        {
            throw new InvalidOperationException($"Phase 4 cost seed count drifted. Expected 59, found {seeds.Count}.");
        }

        return seeds;
    }

    private static string ResolveWaterSourceName(string plotKey)
    {
        return plotKey switch
        {
            "grape_g1" or "grape_g2" => "मेन विहीर",
            "sugarcane_s1" => "कालवा फीड लाईन",
            "sugarcane_s2" => "पूर्व बोअरवेल",
            _ => "शेतीतील स्रोत"
        };
    }

    private static string ResolveMotorName(string plotKey)
    {
        return plotKey switch
        {
            "grape_g1" => "किर्लोस्कर 7.5 HP मोटर",
            "grape_g2" => "CRI 5 HP मोटर",
            "sugarcane_s1" => "कालवा पंप सेट",
            "sugarcane_s2" => "शक्ती 5 HP मोटर",
            _ => "मोटर"
        };
    }

    private static string ResolveMachineryName(string plotKey)
    {
        return plotKey switch
        {
            "grape_g1" or "grape_g2" => "पॉवर स्प्रेयर",
            "sugarcane_s1" or "sugarcane_s2" => "ट्रॅक्टर आणि इम्प्लिमेंट",
            _ => "यंत्रसामग्री"
        };
    }

    private static string BuildPlannedKey(Guid cropCycleId, string activityName, DateOnly plannedDate)
    {
        return $"{cropCycleId:N}|{plannedDate:yyyyMMdd}|{Normalize(activityName)}";
    }

    private static string Normalize(string value)
    {
        return value.Trim().ToLowerInvariant();
    }

    public static Guid CreateDeterministicGuid(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        var guidBytes = hash[..16];
        guidBytes[6] = (byte)((guidBytes[6] & 0x0F) | 0x50);
        guidBytes[8] = (byte)((guidBytes[8] & 0x3F) | 0x80);
        return new Guid(guidBytes);
    }

    private sealed record UserSeed(string Key, string DisplayName, string Phone, string Password, UserAppRole Role);

    private sealed record OperatorRoutingSeed(
        string PrimaryUserKey,
        string? SecondaryUserKey,
        int SecondaryModulo,
        string? VerifierUserKey);

    private sealed record PlotSeed(
        string Key,
        string DisplayName,
        decimal AreaInAcres,
        string CropName,
        string Stage,
        int StartOffsetDays);

    private sealed record TemplateSeed(
        string Key,
        string Name,
        string Stage,
        TemplateActivitySeed[] Activities);

    private sealed record TemplateActivitySeed(
        string ActivityName,
        int OffsetDays,
        FrequencyMode FrequencyMode,
        int IntervalDays);

    private sealed record CostEntrySeed(
        string Key,
        string? PlotKey,
        string Category,
        string Description,
        decimal Amount,
        int DayOffset,
        string CreatedByUserKey);

    private sealed record CorrectionSeed(
        string CostKey,
        decimal Multiplier,
        string Reason,
        string CorrectedByUserKey);

    private sealed record PriceConfigSeed(string ItemName, decimal UnitPrice);

    /// <summary>
    /// Labour V1 Task 10. <paramref name="Key"/> is the stable seed key the
    /// deterministic id is minted from — never change it for an existing
    /// operator, or the teardown stops recognising rows it created.
    /// </summary>
    private sealed record FieldOperatorSeed(string Key, string DisplayName, string? FullName);

    private sealed record AttachmentSeed(
        string SeedKey,
        string FileName,
        string LinkedEntityType,
        string? PlotKey,
        int? DayOffset,
        string CreatedByUserKey,
        long SizeBytes);

    private sealed record PlannedActivitySeed(int DayOffset, string Stage, string ActivityName);

    private sealed record PlotCycleContext(
        PlotSeed Seed,
        Guid PlotId,
        Guid CropCycleId,
        DateOnly StartDate);

    private sealed record Phase3Stats(int TemplatesAdded, int TemplateActivitiesAdded, int PlannedActivitiesAdded);

    private sealed record Phase4LogStats(
        int LogsAdded,
        int TasksAdded,
        int VerificationsAdded,
        IReadOnlyDictionary<string, DailyLog> LogsByIdempotencyKey);

    private sealed record Phase4FinanceStats(
        int CostEntriesAdded,
        int CorrectionsAdded,
        int DayLedgersAdded,
        int PriceConfigsAdded);

    private sealed record Phase5AttachmentStats(int AttachmentsAdded);

    private sealed record Phase6MultiTenantStats(
        int FarmInvitationsAdded,
        int FarmJoinTokensAdded,
        int AffiliationRowsAdded);

    private sealed record PhaseTotals(
        int UserCount,
        int FarmCount,
        int FarmMembershipsAdded,
        int PlotCount,
        int CropCycleCount,
        int ScheduleTemplateCount,
        int TemplateActivitiesAdded,
        int PlannedActivitiesAdded,
        int DailyLogsAdded,
        int LogTasksAdded,
        int VerificationEventsAdded,
        int CostEntriesAdded,
        int FinanceCorrectionsAdded,
        int DayLedgersAdded,
        int PriceConfigsAdded,
        int AttachmentsAdded,
        int OwnerAccountsAdded,
        int SubscriptionsAdded,
        int FarmInvitationsAdded,
        int FarmJoinTokensAdded,
        int AffiliationRowsAdded);
}

/// <summary>
/// Thrown by <see cref="PurveshDemoSeeder.ClearPurveshDemoAsync"/> and
/// <see cref="PurveshDemoSeeder.SeedPurveshDemoAsync"/> in a Production host, before any database
/// access. The message carries <see cref="PurveshDemoSeeder.ProductionRefusalMessage"/>.
/// </summary>
public sealed class PurveshDemoStartupSeedRefusedException(string message) : InvalidOperationException(message);
