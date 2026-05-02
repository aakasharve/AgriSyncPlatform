using System.Security.Cryptography;
using System.Text;
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

public sealed class PurveshDemoSeeder
{
    private const string AppId = "shramsafal";
    private const string SeedVersion = "purvesh-demo-v1";
    private const string PurveshFarmName = "पुरुषोत्तमशेत, खार्डी";

    private static readonly UserSeed[] UserSeeds =
    [
        new("purvesh", "Purvesh Arve", "9800000001", "purvesh123", UserAppRole.PrimaryOwner),
        new("shankar", "Shankar Jadhav", "9800000002", "shankar123", UserAppRole.Mukadam),
        new("raju", "Raju Bhosale", "9800000003", "raju123", UserAppRole.Worker),
        new("santosh", "Santosh Kamble", "9800000004", "santosh123", UserAppRole.Worker)
    ];

    private static readonly PlotSeed[] PlotSeeds =
    [
        new("grape_g1", "द्राक्ष G1", 1.5m, "Grapes", "Pruning", -85),
        new("grape_g2", "द्राक्ष G2", 1.0m, "Grapes", "Pruning", -75),
        new("sugarcane_s1", "ऊस S1", 1.0m, "Sugarcane", "Planting", -90),
        new("sugarcane_s2", "ऊस S2", 0.5m, "Sugarcane", "Tillering", -60),
        new("pomegranate_p1", "डाळिंब P1", 1.0m, "Pomegranate", "Bahar Treatment", -80),
        new("turmeric_t1", "हळद T1", 1.0m, "Turmeric", "Planting", -70),
        new("bajra_b1", "बाजरी B1", 1.0m, "Bajra", "Sowing", -45)
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
            ]),
        new(
            "pomegranate_bahar_treatment",
            "Pomegranate - Bahar Treatment",
            "Bahar Treatment",
            [
                new TemplateActivitySeed("Water Stress Start", 0, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Defoliation", 14, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Resume Drip", 21, FrequencyMode.OneTime, 1)
            ]),
        new(
            "pomegranate_drip_irrigation",
            "Pomegranate - Drip Irrigation",
            "Bahar Treatment",
            [
                new TemplateActivitySeed("Drip Irrigation", 0, FrequencyMode.EveryNDays, 2)
            ]),
        new(
            "pomegranate_disease_spray",
            "Pomegranate - Disease Spray",
            "Bahar Treatment",
            [
                new TemplateActivitySeed("Bacterial Blight Spray", 0, FrequencyMode.EveryNDays, 14),
                new TemplateActivitySeed("Cercospora Spray", 7, FrequencyMode.EveryNDays, 14),
                new TemplateActivitySeed("Fruit Borer Spray", 10, FrequencyMode.EveryNDays, 21)
            ]),
        new(
            "turmeric_irrigation",
            "Turmeric - Irrigation",
            "Planting",
            [
                new TemplateActivitySeed("Sprinkler Irrigation", 0, FrequencyMode.EveryNDays, 7)
            ]),
        new(
            "turmeric_fertilizer",
            "Turmeric - Fertilizer",
            "Planting",
            [
                new TemplateActivitySeed("FYM Basal Application", 0, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Urea Split 1", 30, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Urea Split 2 (delayed)", 60, FrequencyMode.OneTime, 1)
            ]),
        new(
            "turmeric_earthing_up",
            "Turmeric - Earthing Up",
            "Planting",
            [
                new TemplateActivitySeed("Earthing Up Round 1", 45, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Earthing Up Round 2", 75, FrequencyMode.OneTime, 1)
            ]),
        new(
            "bajra_irrigation",
            "Bajra - Irrigation",
            "Sowing",
            [
                new TemplateActivitySeed("Light Irrigation", 0, FrequencyMode.EveryNDays, 10)
            ]),
        new(
            "bajra_fertilizer",
            "Bajra - Fertilizer",
            "Sowing",
            [
                new TemplateActivitySeed("Urea Top-Dress", 25, FrequencyMode.OneTime, 1)
            ]),
        new(
            "bajra_weed_management",
            "Bajra - Weed Management",
            "Sowing",
            [
                new TemplateActivitySeed("Herbicide Spray", 15, FrequencyMode.OneTime, 1),
                new TemplateActivitySeed("Manual Weeding", 20, FrequencyMode.OneTime, 1)
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
            ],
            ["pomegranate_p1"] =
            [
                new PlannedActivitySeed(1, "Bahar Treatment", "Water Stress Start"),
                new PlannedActivitySeed(14, "Bahar Treatment", "Defoliation"),
                new PlannedActivitySeed(21, "Bahar Treatment", "Resume Drip"),
                new PlannedActivitySeed(24, "Bahar Treatment", "Drip Irrigation"),
                new PlannedActivitySeed(30, "Bahar Treatment", "Bacterial Blight Spray"),
                new PlannedActivitySeed(37, "Bahar Treatment", "Cercospora Spray"),
                new PlannedActivitySeed(45, "Bahar Treatment", "Fruit Borer Spray"),
                new PlannedActivitySeed(60, "Bahar Treatment", "Drip Irrigation"),
                new PlannedActivitySeed(74, "Bahar Treatment", "Bacterial Blight Spray")
            ],
            ["turmeric_t1"] =
            [
                new PlannedActivitySeed(1, "Planting", "FYM Basal Application"),
                new PlannedActivitySeed(7, "Planting", "Sprinkler Irrigation"),
                new PlannedActivitySeed(30, "Planting", "Urea Split 1"),
                new PlannedActivitySeed(45, "Planting", "Earthing Up Round 1"),
                new PlannedActivitySeed(60, "Planting", "Urea Split 2 (delayed)"),
                new PlannedActivitySeed(75, "Planting", "Earthing Up Round 2")
            ],
            ["bajra_b1"] =
            [
                new PlannedActivitySeed(1, "Sowing", "Light Irrigation"),
                new PlannedActivitySeed(15, "Sowing", "Herbicide Spray"),
                new PlannedActivitySeed(20, "Sowing", "Manual Weeding"),
                new PlannedActivitySeed(25, "Sowing", "Urea Top-Dress")
            ]
        };

    private static readonly IReadOnlyDictionary<string, OperatorRoutingSeed> OperatorRoutingByPlotKey =
        new Dictionary<string, OperatorRoutingSeed>(StringComparer.Ordinal)
        {
            ["grape_g1"] = new OperatorRoutingSeed("shankar", "raju", 5, "purvesh"),
            ["grape_g2"] = new OperatorRoutingSeed("raju", "santosh", 2, "purvesh"),
            ["sugarcane_s1"] = new OperatorRoutingSeed("shankar", "santosh", 4, "purvesh"),
            ["sugarcane_s2"] = new OperatorRoutingSeed("raju", null, 0, null),
            ["pomegranate_p1"] = new OperatorRoutingSeed("shankar", "purvesh", 5, "purvesh"),
            ["turmeric_t1"] = new OperatorRoutingSeed("santosh", null, 0, "purvesh"),
            ["bajra_b1"] = new OperatorRoutingSeed("raju", null, 0, null)
        };

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
            ],
            ["Pomegranate"] =
            [
                ["Bahar Treatment", "Observation"],
                ["Spraying", "Irrigation", "Observation"],
                ["Spraying", "Bahar Treatment"]
            ],
            ["Turmeric"] =
            [
                ["Irrigation", "Fertilizer application", "Observation"],
                ["Irrigation", "Observation"]
            ],
            ["Bajra"] =
            [
                ["Sowing", "Irrigation", "Observation"],
                ["Weeding", "Observation"]
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
            ],
            ["Bahar Treatment"] =
            [
                "पाणी बंद केले. बहार उपचार सुरूवात.",
                "पाने काढली. बहार पूर्ण.",
                "ड्रिप पुन्हा सुरू केले."
            ],
            ["Sowing"] =
            [
                "बाजरी पेरणी केली.",
                "हलके पाणी दिले."
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
        "pomegranate_p1",
        "turmeric_t1",
        "sugarcane_s1"
    ];

    private const string G2DisputeReason = "गव्हाण वेळेत भरले नाही";

    private static readonly AttachmentSeed[] AttachmentSeeds =
    [
        new("grapes-g1-pruning", "grapes-g1-pruning.jpg", "DailyLog", "grape_g1", -85, "shankar", 186_420),
        new("grapes-g2-growth", "grapes-g2-growth.jpg", "DailyLog", "grape_g2", -38, "shankar", 192_300),
        new("sugarcane-s1-planting", "sugarcane-s1-planting.jpg", "DailyLog", "sugarcane_s1", -90, "shankar", 178_650),
        new("pomegranate-p1-bahar", "pomegranate-p1-bahar.jpg", "DailyLog", "pomegranate_p1", -80, "shankar", 183_110),
        new("pomegranate-disease", "pomegranate-disease.jpg", "DailyLog", "pomegranate_p1", -38, "shankar", 167_980),
        new("turmeric-t1-field", "turmeric-t1-field.jpg", "DailyLog", "turmeric_t1", -70, "shankar", 174_240),
        new("bajra-b1-sowing", "bajra-b1-sowing.jpg", "DailyLog", "bajra_b1", -45, "shankar", 169_770),
        new("farm-overview", "farm-overview.jpg", "Farm", null, null, "shankar", 210_510)
    ];

    private readonly ShramSafalDbContext _ssfContext;
    private readonly UserDbContext _userContext;
    private readonly IPasswordHasher _passwordHasher;

    public PurveshDemoSeeder(
        ShramSafalDbContext ssfContext,
        UserDbContext userContext,
        IPasswordHasher passwordHasher)
    {
        _ssfContext = ssfContext;
        _userContext = userContext;
        _passwordHasher = passwordHasher;
    }

    public async Task<string> SeedPurveshDemoAsync(CancellationToken cancellationToken = default)
    {
        var refreshResult = await ClearPurveshDemoAsync(cancellationToken);
        var nowUtc = DateTime.UtcNow;
        var usersByKey = new Dictionary<string, User.Domain.Identity.User>(StringComparer.Ordinal);

        foreach (var seed in UserSeeds)
        {
            var user = await EnsureUserAsync(seed, nowUtc, cancellationToken);
            usersByKey[seed.Key] = user;
        }

        var purvesh = usersByKey["purvesh"];
        var farm = await EnsureFarmAsync(purvesh.Id, nowUtc, cancellationToken);
        var plotContexts = await EnsurePlotsAndCropCyclesAsync(farm.Id, nowUtc, cancellationToken);
        var phase3Stats = await EnsureScheduleTemplatesAndPlannedActivitiesAsync(plotContexts, purvesh.Id, nowUtc, cancellationToken);
        var contextByPlotKey = plotContexts.ToDictionary(c => c.Seed.Key, c => c, StringComparer.Ordinal);
        var phase4LogStats = await EnsureDailyLogsAndVerificationsAsync(
            farm.Id,
            contextByPlotKey,
            usersByKey,
            nowUtc,
            cancellationToken);
        var phase4FinanceStats = await EnsureFinanceAsync(
            farm.Id,
            contextByPlotKey,
            usersByKey,
            nowUtc,
            cancellationToken);
        var phase5AttachmentStats = await EnsureAttachmentsAsync(
            farm.Id,
            usersByKey,
            nowUtc,
            cancellationToken);

        await _ssfContext.SaveChangesAsync(cancellationToken);

        var totals = new PhaseTotals(
            UserCount: usersByKey.Count,
            FarmCount: 1,
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
            AttachmentsAdded: phase5AttachmentStats.AttachmentsAdded);

        return $"Refreshed {SeedVersion}. {refreshResult} | " +
               $"Phase 2+3+4+5 seeded. " +
               $"users={totals.UserCount}, farms={totals.FarmCount}, plots={totals.PlotCount}, " +
               $"cropCycles={totals.CropCycleCount}, templates={totals.ScheduleTemplateCount}, " +
               $"templateActivitiesAdded={totals.TemplateActivitiesAdded}, plannedActivitiesAdded={totals.PlannedActivitiesAdded}, " +
               $"dailyLogsAdded={totals.DailyLogsAdded}, logTasksAdded={totals.LogTasksAdded}, " +
               $"verificationsAdded={totals.VerificationEventsAdded}, costEntriesAdded={totals.CostEntriesAdded}, " +
               $"correctionsAdded={totals.FinanceCorrectionsAdded}, dayLedgersAdded={totals.DayLedgersAdded}, " +
               $"priceConfigsAdded={totals.PriceConfigsAdded}, attachmentsAdded={totals.AttachmentsAdded}, " +
               $"anchorUtc={nowUtc:O}.";
    }

    public async Task<string> ClearPurveshDemoAsync(CancellationToken cancellationToken = default)
    {
        var farmId = new FarmId(CreateDeterministicGuid($"{SeedVersion}:farm:khardi"));
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
        var userPhones = UserSeeds.Select(seed => seed.Phone).ToHashSet(StringComparer.Ordinal);
        var purveshUserId = new UserId(CreateDeterministicGuid($"{SeedVersion}:user:purvesh"));

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

        var farm = await _ssfContext.Farms.FirstOrDefaultAsync(f => f.Id == farmId, cancellationToken);
        var deletedFarmCount = 0;
        if (farm is not null)
        {
            _ssfContext.Farms.Remove(farm);
            deletedFarmCount = 1;
        }

        await _ssfContext.SaveChangesAsync(cancellationToken);

        var users = await _userContext.Users
            .Where(u => userPhones.Contains(u.Phone.Value))
            .ToListAsync(cancellationToken);
        var userIds = users
            .Select(u => u.Id)
            .ToHashSet();
        var memberships = await _userContext.Memberships
            .Where(m => userIds.Contains(m.UserId))
            .ToListAsync(cancellationToken);
        var deletedMembershipCount = memberships.Count;
        if (memberships.Count > 0)
        {
            _userContext.Memberships.RemoveRange(memberships);
        }

        var deletedUserCount = users.Count;
        if (users.Count > 0)
        {
            _userContext.Users.RemoveRange(users);
        }

        await _userContext.SaveChangesAsync(cancellationToken);

        return $"Cleared {SeedVersion}: users={deletedUserCount}, farms={deletedFarmCount}, plots={deletedPlotCount}, " +
               $"cropCycles={deletedCycleCount}, templates={deletedTemplateCount}, templateActivities={deletedTemplateActivityCount}, " +
               $"plannedActivities={deletedPlannedCount}, dailyLogs={deletedDailyLogsCount}, dayLedgers={deletedDayLedgersCount}, " +
               $"costEntries={deletedCostEntriesCount}, corrections={deletedCorrectionsCount}, attachments={deletedAttachmentsCount}, " +
               $"priceConfigs={deletedPriceConfigsCount}, memberships={deletedMembershipCount}.";
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
        _ssfContext.Farms.Add(farm);
        return farm;
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

        foreach (var kvp in PlannedSeedsByPlotKey)
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
                var createdAt = nowUtc.AddDays(context.Seed.StartOffsetDays + plannedSeed.DayOffset);

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

        return new Phase3Stats(templatesAdded, activitiesAdded, plannedAdded);
    }

    private async Task<Phase4LogStats> EnsureDailyLogsAndVerificationsAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, PlotCycleContext> contextByPlotKey,
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey,
        DateTime nowUtc,
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

            var offsets = BuildRollingLogDayOffsets(context.Seed);

            for (var index = 0; index < offsets.Length; index++)
            {
                var dayOffset = offsets[index];
                var idempotencyKey = $"{SeedVersion}:log:{plotKey}:{dayOffset}";
                var logDate = DateOnly.FromDateTime(nowUtc.AddDays(dayOffset));
                var occurredAtUtc = BuildIstAnchoredUtc(logDate, index);
                var operatorKey = ResolveOperatorKey(routing, index);
                var operatorUser = usersByKey[operatorKey];

                if (!logsByKey.TryGetValue(idempotencyKey, out var log))
                {
                    var logId = CreateDeterministicGuid($"{SeedVersion}:daily-log:{plotKey}:{dayOffset}");
                    log = DailyLog.Create(
                        logId,
                        farmId,
                        context.PlotId,
                        context.CropCycleId,
                        operatorUser.Id,
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

                verificationsAdded += ApplyVerificationPattern(
                    log,
                    plotKey,
                    dayOffset,
                    index,
                    offsets.Length,
                    occurredAtUtc,
                    usersByKey);
            }
        }

        return new Phase4LogStats(logsAdded, tasksAdded, verificationsAdded);
    }

    private int ApplyVerificationPattern(
        DailyLog log,
        string plotKey,
        int dayOffset,
        int index,
        int totalLogs,
        DateTime occurredAtUtc,
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey)
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

            case "pomegranate_p1":
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Confirmed,
                    null,
                    "shankar",
                    confirmedAtUtc,
                    usersByKey);
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Verified,
                    null,
                    "purvesh",
                    confirmedAtUtc.AddHours(24),
                    usersByKey);
                break;

            case "turmeric_t1":
                added += EnsureVerificationTransition(
                    log,
                    plotKey,
                    dayOffset,
                    VerificationStatus.Confirmed,
                    null,
                    "santosh",
                    confirmedAtUtc,
                    usersByKey);

                if (index < (int)Math.Ceiling(totalLogs * 0.30m))
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
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey)
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
            usersByKey[actorUserKey].Id,
            occurredAtUtc);

        return 1;
    }

    private async Task<Phase4FinanceStats> EnsureFinanceAsync(
        FarmId farmId,
        IReadOnlyDictionary<string, PlotCycleContext> contextByPlotKey,
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var costSeeds = BuildCostEntrySeeds();
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
                usersByKey[costSeed.CreatedByUserKey].Id,
                null,
                createdAtUtc);

            _ssfContext.CostEntries.Add(entry);
            costById[costId] = entry;
            costsAdded++;
        }

        var correctionSeeds = new[]
        {
            new CorrectionSeed("p1_pesticide_03", 1.10m, "Invoice reconciliation (upward adjustment)", "purvesh"),
            new CorrectionSeed("p1_pesticide_06", 1.10m, "Invoice reconciliation (upward adjustment)", "purvesh")
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
                usersByKey[correctionSeed.CorrectedByUserKey].Id,
                correctedAtUtc);

            _ssfContext.FinanceCorrections.Add(correction);
            costEntry.MarkCorrected(correctionId, correctedAmount, "INR", correctedAtUtc);
            correctionsAdded++;
        }

        var dayLedgerSeeds = new[] { "farmwide_01", "farmwide_02", "farmwide_03", "farmwide_04", "farmwide_05" };
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
                usersByKey["purvesh"].Id,
                allocations,
                createdAtUtc);

            _ssfContext.DayLedgers.Add(dayLedger);
            dayLedgersAdded++;
        }

        var purveshUserId = usersByKey["purvesh"].Id;
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
        IReadOnlyDictionary<string, User.Domain.Identity.User> usersByKey,
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
                usersByKey[seed.CreatedByUserKey].Id,
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

    private static int[] BuildRollingLogDayOffsets(PlotSeed seed)
    {
        return Enumerable.Range(seed.StartOffsetDays, Math.Abs(seed.StartOffsetDays) + 1).ToArray();
    }

    private static string[] ResolveTaskPattern(string plotKey, string cropName, int dayOffset, int index)
    {
        if (IsRestDay(plotKey, dayOffset))
        {
            return ["Observation"];
        }

        return plotKey switch
        {
            "grape_g1" or "grape_g2" => BuildGrapePattern(dayOffset, index),
            "sugarcane_s1" or "sugarcane_s2" => BuildSugarcanePattern(dayOffset, index),
            "pomegranate_p1" => BuildPomegranatePattern(dayOffset, index),
            "turmeric_t1" => BuildTurmericPattern(dayOffset, index),
            "bajra_b1" => BuildBajraPattern(dayOffset, index),
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

    private static string[] BuildPomegranatePattern(int dayOffset, int index)
    {
        if (dayOffset <= -50 && Math.Abs(dayOffset) % 7 == 0)
        {
            return ["Bahar Treatment", "Observation"];
        }

        if (Math.Abs(dayOffset) % 10 == 0)
        {
            return ["Spraying", "Irrigation", "Observation"];
        }

        if (Math.Abs(dayOffset) % 6 == 0)
        {
            return ["Machinery", "Irrigation", "Observation"];
        }

        return index % 2 == 0
            ? ["Irrigation", "Observation"]
            : ["Observation", "Irrigation"];
    }

    private static string[] BuildTurmericPattern(int dayOffset, int index)
    {
        if (Math.Abs(dayOffset) % 16 == 0)
        {
            return ["Fertilizer application", "Observation"];
        }

        if (Math.Abs(dayOffset) % 12 == 0)
        {
            return ["Machinery", "Irrigation", "Observation"];
        }

        return index % 3 == 0
            ? ["Irrigation", "Observation"]
            : ["Irrigation", "Fertilizer application", "Observation"];
    }

    private static string[] BuildBajraPattern(int dayOffset, int index)
    {
        if (dayOffset <= -35 && Math.Abs(dayOffset) % 9 == 0)
        {
            return ["Sowing", "Irrigation", "Observation"];
        }

        if (Math.Abs(dayOffset) % 7 == 0)
        {
            return ["Weeding", "Observation"];
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
            "pomegranate_p1" => 9,
            "turmeric_t1" => 10,
            "bajra_b1" => 7,
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
        if (plotKey == "sugarcane_s1" &&
            dayOffset == -35 &&
            (activityType.Equals("Weeding", StringComparison.OrdinalIgnoreCase)
             || activityType.Equals("Observation", StringComparison.OrdinalIgnoreCase)))
        {
            return "रजू आला नाही आज. काम अर्धे राहिले.";
        }

        if (plotKey == "pomegranate_p1" &&
            dayOffset == -35 &&
            activityType.Equals("Spraying", StringComparison.OrdinalIgnoreCase))
        {
            return "बुरशीनाशक फवारणी. Rs 4500 चे औषध आणले.";
        }

        if (plotKey == "turmeric_t1" &&
            dayOffset == -56 &&
            activityType.Equals("Fertilizer application", StringComparison.OrdinalIgnoreCase))
        {
            return "युरिया पहिला हप्ता. उशीर झाला 14 दिवस.";
        }

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
        var seeds = new List<CostEntrySeed>(82);

        void Add(string key, string? plotKey, string category, decimal amount, int dayOffset, string description, string createdByUserKey)
        {
            seeds.Add(new CostEntrySeed(key, plotKey, category, description, amount, dayOffset, createdByUserKey));
        }

        var g1PesticideOffsets = new[] { -84, -72, -60, -48, -36, -24, -12, -3 };
        var g1PesticideAmounts = new[] { 620m, 610m, 590m, 605m, 615m, 625m, 600m, 630m };
        for (var i = 0; i < g1PesticideOffsets.Length; i++)
        {
            Add($"g1_pesticide_{i + 1:00}", "grape_g1", "Pesticide", g1PesticideAmounts[i], g1PesticideOffsets[i], "Torus + Mancozeb spray - G1", "shankar");
        }

        var g1FertilizerOffsets = new[] { -80, -68, -56, -44, -32, -20, -8, 0 };
        var g1FertilizerAmounts = new[] { 450m, 470m, 460m, 820m, 840m, 430m, 780m, 860m };
        for (var i = 0; i < g1FertilizerOffsets.Length; i++)
        {
            Add($"g1_fertilizer_{i + 1:00}", "grape_g1", "Fertilizer", g1FertilizerAmounts[i], g1FertilizerOffsets[i], "Fertigation input - G1", "shankar");
        }

        var g2PesticideOffsets = new[] { -70, -55, -40, -15 };
        var g2PesticideAmounts = new[] { 600m, 620m, 590m, 610m };
        for (var i = 0; i < g2PesticideOffsets.Length; i++)
        {
            Add($"g2_pesticide_{i + 1:00}", "grape_g2", "Pesticide", g2PesticideAmounts[i], g2PesticideOffsets[i], "Spray cycle - G2", "raju");
        }

        var g2FertilizerOffsets = new[] { -66, -50, -34, -10 };
        var g2FertilizerAmounts = new[] { 440m, 460m, 790m, 830m };
        for (var i = 0; i < g2FertilizerOffsets.Length; i++)
        {
            Add($"g2_fertilizer_{i + 1:00}", "grape_g2", "Fertilizer", g2FertilizerAmounts[i], g2FertilizerOffsets[i], "Fertigation input - G2", "raju");
        }

        var s1LabourOffsets = new[] { -90, -75, -60, -45, -30, -15, 0 };
        var s1LabourAmounts = new[] { 1800m, 2100m, 2100m, 2400m, 2400m, 2700m, 2700m };
        for (var i = 0; i < s1LabourOffsets.Length; i++)
        {
            Add($"s1_labour_{i + 1:00}", "sugarcane_s1", "Labour", s1LabourAmounts[i], s1LabourOffsets[i], "S1 labour payout", "shankar");
        }

        Add("s1_fertilizer_01", "sugarcane_s1", "Fertilizer", 1900m, -85, "DAP basal application - S1", "shankar");
        Add("s1_fertilizer_02", "sugarcane_s1", "Fertilizer", 820m, -58, "Urea dose 1 - S1", "shankar");
        Add("s1_fertilizer_03", "sugarcane_s1", "Fertilizer", 860m, -28, "Urea dose 2 - S1", "shankar");
        Add("s1_equipment_01", "sugarcane_s1", "Equipment", 2200m, -90, "Tractor hire - S1 planting", "shankar");
        Add("s1_equipment_02", "sugarcane_s1", "Equipment", 1950m, -44, "Inter-cultivation implement hire - S1", "shankar");

        Add("s2_labour_01", "sugarcane_s2", "Labour", 1100m, -60, "S2 labour payout", "raju");
        Add("s2_labour_02", "sugarcane_s2", "Labour", 1200m, -46, "S2 labour payout", "raju");
        Add("s2_labour_03", "sugarcane_s2", "Labour", 1150m, -30, "S2 labour payout", "raju");
        Add("s2_labour_04", "sugarcane_s2", "Labour", 1250m, -15, "S2 labour payout", "raju");
        Add("s2_labour_05", "sugarcane_s2", "Labour", 1300m, 0, "S2 labour payout", "raju");

        Add("p1_pesticide_01", "pomegranate_p1", "Pesticide", 820m, -74, "Bacterial blight spray - P1", "shankar");
        Add("p1_pesticide_02", "pomegranate_p1", "Pesticide", 780m, -60, "Cercospora spray - P1", "shankar");
        Add("p1_pesticide_03", "pomegranate_p1", "Pesticide", 860m, -47, "Fruit borer spray - P1", "shankar");
        Add("p1_pesticide_04", "pomegranate_p1", "Pesticide", 4500m, -35, "आपत्कालीन बुरशीनाशक + बॅक्टेरियाविरोधी - डाळिंब P1", "shankar");
        Add("p1_pesticide_05", "pomegranate_p1", "Pesticide", 840m, -22, "Follow-up disease spray - P1", "shankar");
        Add("p1_pesticide_06", "pomegranate_p1", "Pesticide", 790m, -10, "Thrips control spray - P1", "shankar");
        Add("p1_pesticide_07", "pomegranate_p1", "Pesticide", 870m, 0, "Protective spray - P1", "shankar");
        Add("p1_labour_01", "pomegranate_p1", "Labour", 1300m, -68, "P1 labour payout", "purvesh");
        Add("p1_labour_02", "pomegranate_p1", "Labour", 1400m, -42, "P1 labour payout", "purvesh");
        Add("p1_labour_03", "pomegranate_p1", "Labour", 1500m, -14, "P1 labour payout", "purvesh");

        Add("t1_fertilizer_01", "turmeric_t1", "Fertilizer", 1850m, -69, "FYM basal - T1", "santosh");
        Add("t1_fertilizer_02", "turmeric_t1", "Fertilizer", 820m, -39, "Urea split 1 - T1", "santosh");
        Add("t1_fertilizer_03", "turmeric_t1", "Fertilizer", 860m, -9, "Urea split 2 - T1", "santosh");
        Add("t1_labour_01", "turmeric_t1", "Labour", 1100m, -63, "T1 labour payout", "santosh");
        Add("t1_labour_02", "turmeric_t1", "Labour", 1200m, -33, "T1 labour payout", "santosh");
        Add("t1_labour_03", "turmeric_t1", "Labour", 1300m, -3, "T1 labour payout", "santosh");

        Add("b1_seeds_01", "bajra_b1", "Seeds", 460m, -45, "Bajra seed purchase (5kg)", "raju");
        Add("b1_labour_01", "bajra_b1", "Labour", 900m, -31, "B1 labour payout", "raju");
        Add("b1_labour_02", "bajra_b1", "Labour", 950m, -7, "B1 labour payout", "raju");

        Add("farmwide_01", null, "Fuel", 480m, -88, "Diesel for irrigation pump", "purvesh");
        Add("farmwide_02", null, "Equipment", 2100m, -72, "Shared implement repair", "purvesh");
        Add("farmwide_03", null, "Fuel", 520m, -57, "Diesel for transport", "purvesh");
        Add("farmwide_04", null, "Equipment", 1950m, -43, "Water motor maintenance", "purvesh");
        Add("farmwide_05", null, "Fuel", 430m, -29, "Generator diesel refill", "purvesh");
        Add("farmwide_06", null, "Equipment", 2300m, -21, "Shared tractor support", "purvesh");
        Add("farmwide_07", null, "Fuel", 500m, -13, "Field transport diesel", "purvesh");
        Add("farmwide_08", null, "Equipment", 2050m, -9, "Sprayer service and parts", "purvesh");
        Add("farmwide_09", null, "Fuel", 460m, -4, "Diesel refill", "purvesh");
        Add("farmwide_10", null, "Equipment", 1800m, 0, "Pump and line repair", "purvesh");
        Add("farmwide_11", null, "Fuel", 520m, -18, "Generator diesel for late-night irrigation", "purvesh");
        Add("farmwide_12", null, "Equipment", 1450m, -11, "Disc filter cartridge replacement", "purvesh");
        Add("farmwide_13", null, "Equipment", 2600m, -6, "Kirloskar motor rewinding advance", "purvesh");
        Add("farmwide_14", null, "Fuel", 410m, -2, "Sprayer petrol refill", "purvesh");

        Add("g1_equipment_01", "grape_g1", "Equipment", 1650m, -16, "Blower and pruning kit service - G1", "shankar");
        Add("g2_equipment_01", "grape_g2", "Equipment", 980m, -5, "Drip venturi replacement - G2", "raju");
        Add("p1_equipment_01", "pomegranate_p1", "Equipment", 1220m, -8, "Bahar plot spray gun repair - P1", "purvesh");
        Add("t1_equipment_01", "turmeric_t1", "Equipment", 1480m, -4, "Mini tiller hire - T1", "santosh");
        Add("s1_fuel_01", "sugarcane_s1", "Fuel", 390m, -12, "Field bund levelling diesel - S1", "shankar");
        Add("s2_equipment_01", "sugarcane_s2", "Equipment", 760m, -3, "Water gate and pipe coupling - S2", "raju");
        Add("b1_equipment_01", "bajra_b1", "Equipment", 910m, -14, "Seed drill and line marker hire - B1", "raju");
        Add("p1_fuel_01", "pomegranate_p1", "Fuel", 350m, -1, "Farm pond pump diesel - P1", "purvesh");

        if (seeds.Count != 82)
        {
            throw new InvalidOperationException($"Phase 4 cost seed count drifted. Expected 82, found {seeds.Count}.");
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
            "pomegranate_p1" => "शेततळे लाईन",
            "turmeric_t1" => "पूर्व बोअरवेल",
            "bajra_b1" => "तळ्याची पूरक लाईन",
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
            "pomegranate_p1" => "सोलर 10 HP पंप",
            "turmeric_t1" => "बोअरवेल 5 HP मोटर",
            "bajra_b1" => "मोबाइल डिझेल पंप",
            _ => "मोटर"
        };
    }

    private static string ResolveMachineryName(string plotKey)
    {
        return plotKey switch
        {
            "grape_g1" or "grape_g2" => "पॉवर स्प्रेयर",
            "sugarcane_s1" or "sugarcane_s2" => "ट्रॅक्टर आणि इम्प्लिमेंट",
            "pomegranate_p1" => "ब्लोअर स्प्रेयर",
            "turmeric_t1" => "मिनी टिलर",
            "bajra_b1" => "सीड ड्रिल",
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

    private sealed record Phase4LogStats(int LogsAdded, int TasksAdded, int VerificationsAdded);

    private sealed record Phase4FinanceStats(
        int CostEntriesAdded,
        int CorrectionsAdded,
        int DayLedgersAdded,
        int PriceConfigsAdded);

    private sealed record Phase5AttachmentStats(int AttachmentsAdded);

    private sealed record PhaseTotals(
        int UserCount,
        int FarmCount,
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
        int AttachmentsAdded);
}
