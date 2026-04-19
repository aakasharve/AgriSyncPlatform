using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Infrastructure.Seeds;

/// <summary>
/// Phase 3 MIS — bootstrap set of published <see cref="CropScheduleTemplate"/>s.
/// Templates are deterministic (fixed ids + fixed PrescribedTask ids) so that
/// re-running the seeder is idempotent and integration tests can reference
/// templates by key.
///
/// TemplateKey format: <c>{crop}_{region}_{variant}_{version}</c>
/// Version tags follow <c>vN</c> (bumped when the task list or day offsets
/// change — pricing/content tweaks that don't affect compliance math stay on
/// the same version to avoid forcing migrations).
/// </summary>
public static class CropScheduleTemplateSeeds
{
    public static readonly IReadOnlyList<CropScheduleTemplateSeed> All =
    [
        BuildGrapeNashikStandardV1(),
        BuildPomegranateSolapurStandardV1(),
        BuildOnionRabiStandardV1()
    ];

    private static CropScheduleTemplateSeed BuildGrapeNashikStandardV1()
    {
        var templateId = new ScheduleTemplateId(Guid.Parse("10000000-0000-0000-0000-000000000001"));
        var tasks = new[]
        {
            PT("10000000-0000-0000-0000-000000000101", "heavy_irrigation",  "post_pruning",        1,  1),
            PT("10000000-0000-0000-0000-000000000102", "cut_paste",          "post_pruning",        2,  1),
            PT("10000000-0000-0000-0000-000000000103", "fungicide_preventive","budbreak_initiation", 5,  2),
            PT("10000000-0000-0000-0000-000000000104", "thrips_control",     "budbreak_initiation", 8,  2),
            PT("10000000-0000-0000-0000-000000000105", "vegetative_boost",   "sprouting",          10,  2),
            PT("10000000-0000-0000-0000-000000000106", "shoot_thinning",     "sprouting",          12,  3),
            PT("10000000-0000-0000-0000-000000000107", "pre_bloom_phosphorous","rapid_vegetative",  20,  3),
            PT("10000000-0000-0000-0000-000000000108", "ga3_dose_1",         "rapid_vegetative",   22,  2),
            PT("10000000-0000-0000-0000-000000000109", "powdery_mildew_spray","pre_flowering",      28,  2),
            PT("10000000-0000-0000-0000-00000000010a", "ga3_dose_2",         "flowering_init",     35,  2),
            PT("10000000-0000-0000-0000-00000000010b", "boost_0_52_34",      "flowering_fruit_set",40,  3),
            PT("10000000-0000-0000-0000-00000000010c", "berry_size_spray",   "flowering_fruit_set",45,  3),
            PT("10000000-0000-0000-0000-00000000010d", "sop_0_0_50",         "berry_development",  55,  3),
            PT("10000000-0000-0000-0000-00000000010e", "botrytis_control",   "fruit_expansion",    60,  3)
        };

        return new CropScheduleTemplateSeed(
            Id: templateId.Value,
            TemplateKey: "grape_nashik_standard_v1",
            CropKey: "grapes",
            RegionCode: "mh_nashik",
            Name: "Grape — Nashik standard (v1)",
            VersionTag: "v1",
            Tasks: tasks);
    }

    private static CropScheduleTemplateSeed BuildPomegranateSolapurStandardV1()
    {
        var templateId = new ScheduleTemplateId(Guid.Parse("20000000-0000-0000-0000-000000000001"));
        var tasks = new[]
        {
            PT("20000000-0000-0000-0000-000000000101", "bahar_treatment",         "flowering_induction",  1, 2),
            PT("20000000-0000-0000-0000-000000000102", "fertigation_npk_19",      "flowering_induction", 10, 3),
            PT("20000000-0000-0000-0000-000000000103", "thrips_mite_control",     "flowering",           25, 3),
            PT("20000000-0000-0000-0000-000000000104", "bacterial_blight_spray",  "fruit_set",           40, 3),
            PT("20000000-0000-0000-0000-000000000105", "calcium_boron_spray",     "fruit_development",   70, 4),
            PT("20000000-0000-0000-0000-000000000106", "potassium_boost",         "fruit_development",  100, 4),
            PT("20000000-0000-0000-0000-000000000107", "pre_harvest_spray",       "fruit_maturity",     140, 5)
        };

        return new CropScheduleTemplateSeed(
            Id: templateId.Value,
            TemplateKey: "pomegranate_solapur_standard_v1",
            CropKey: "pomegranate",
            RegionCode: "mh_solapur",
            Name: "Pomegranate — Solapur standard (v1)",
            VersionTag: "v1",
            Tasks: tasks);
    }

    private static CropScheduleTemplateSeed BuildOnionRabiStandardV1()
    {
        var templateId = new ScheduleTemplateId(Guid.Parse("30000000-0000-0000-0000-000000000001"));
        var tasks = new[]
        {
            PT("30000000-0000-0000-0000-000000000101", "seed_treatment",         "sowing",          1, 1),
            PT("30000000-0000-0000-0000-000000000102", "first_irrigation",       "sowing",          3, 2),
            PT("30000000-0000-0000-0000-000000000103", "weed_control_manual",    "establishment",  20, 3),
            PT("30000000-0000-0000-0000-000000000104", "fertigation_npk_10_26",  "establishment",  25, 3),
            PT("30000000-0000-0000-0000-000000000105", "thrips_spray_1",         "bulb_initiation",45, 3),
            PT("30000000-0000-0000-0000-000000000106", "thrips_spray_2",         "bulb_formation", 60, 3),
            PT("30000000-0000-0000-0000-000000000107", "potassium_spray",        "bulb_maturation",75, 3),
            PT("30000000-0000-0000-0000-000000000108", "pre_harvest_stop_water", "harvest",       100, 4)
        };

        return new CropScheduleTemplateSeed(
            Id: templateId.Value,
            TemplateKey: "onion_rabi_standard_v1",
            CropKey: "onion",
            RegionCode: "mh",
            Name: "Onion — Rabi standard (v1)",
            VersionTag: "v1",
            Tasks: tasks);
    }

    private static PrescribedTaskSeed PT(
        string idHex, string taskType, string stage, int dayOffset, int tolerance) =>
        new(Guid.Parse(idHex), taskType, stage, dayOffset, tolerance);

    public sealed record CropScheduleTemplateSeed(
        Guid Id,
        string TemplateKey,
        string CropKey,
        string? RegionCode,
        string Name,
        string VersionTag,
        IReadOnlyList<PrescribedTaskSeed> Tasks);

    public sealed record PrescribedTaskSeed(
        Guid Id,
        string TaskType,
        string Stage,
        int DayOffsetFromCycleStart,
        int ToleranceDaysPlusMinus);

    public static CropScheduleTemplate ToEntity(this CropScheduleTemplateSeed seed, DateTime createdAtUtc)
    {
        var tasks = seed.Tasks.Select(t => PrescribedTask.Create(
            new PrescribedTaskId(t.Id),
            t.TaskType,
            t.Stage,
            t.DayOffsetFromCycleStart,
            t.ToleranceDaysPlusMinus));

        var template = CropScheduleTemplate.Create(
            id: seed.Id,
            templateKey: seed.TemplateKey,
            cropKey: seed.CropKey,
            regionCode: seed.RegionCode,
            name: seed.Name,
            versionTag: seed.VersionTag,
            createdAtUtc: createdAtUtc,
            tasks: tasks);
        template.Publish();
        return template;
    }
}
