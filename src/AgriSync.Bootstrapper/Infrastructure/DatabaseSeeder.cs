using System.Security.Cryptography;
using System.Text;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Domain.Identity;
using User.Domain.Membership;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

public class DatabaseSeeder
{
    private const string AppId = "shramsafal";
    private const string SeedVersion = "phase0-seed-v1";

    private static readonly UserId PreferredRamuId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    private static readonly UserId PreferredGaneshId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));

    private static readonly int[] LogDayOffsets = [0, 2, 5, 8, 11, 15, 20, 27];

    private static readonly PlotSeed[] PlotSeeds =
    [
        new("grape_export", "Export Plot (A)", 2.0m, "Grapes", "Pruning", -29),
        new("grape_local", "Local Plot (B)", 1.5m, "Grapes", "Pruning", -29),
        new("pomegranate_1", "Bhagwa #1", 2.0m, "Pomegranate", "Bahar Treatment", -29),
        new("pomegranate_2", "Bhagwa #2", 2.0m, "Pomegranate", "Fertigation", -29),
        new("sugarcane_river", "River Bank", 4.0m, "Sugarcane", "Planting", -60),
        new("onion_summer", "Summer Crop", 1.0m, "Onion", "Sowing", -10)
    ];

    private static readonly PriceSeed[] PriceSeeds =
    [
        new("Urea", 290m),
        new("DAP", 1350m),
        new("Sulphur", 430m),
        new("Labour-Male", 550m),
        new("Labour-Female", 420m)
    ];

    private static readonly GrapeMasterPlanSeed[] GrapeMasterPlan =
    [
        new(1, "Post Pruning", "Heavy Irrigation"),
        new(2, "Post Pruning", "Apply Paste on Cuts"),
        new(5, "Budbreak Initiation", "Preventive Fungicide Spray"),
        new(8, "Budbreak Initiation", "Thrips Control"),
        new(10, "Sprouting Phase", "Vegetative Boost"),
        new(12, "Sprouting Phase", "Shoot thinning"),
        new(20, "Rapid Vegetative", "Pre-Bloom Phosphorous"),
        new(22, "Rapid Vegetative", "GA3 Dose 1"),
        new(28, "Pre-Flowering", "Powdery Mildew Spray"),
        new(35, "Flowering Init", "GA3 Dose 2"),
        new(40, "Flowering-Fruit Set", "0:52:34 Boost"),
        new(45, "Flowering-Fruit Set", "Berry Size Spray"),
        new(55, "Berry Development", "0:0:50 (SOP)"),
        new(60, "Fruit Expansion-1", "Botrytis Control")
    ];

    private readonly ShramSafalDbContext _SSFContext;
    private readonly UserDbContext _userContext;
    private readonly IPasswordHasher _passwordHasher;

    public DatabaseSeeder(ShramSafalDbContext ssfContext, UserDbContext userContext, IPasswordHasher passwordHasher)
    {
        _SSFContext = ssfContext;
        _userContext = userContext;
        _passwordHasher = passwordHasher;
    }

    public async Task<string> SeedDemoDataAsync()
    {
        var nowUtc = DateTime.UtcNow;

        var ramu = await EnsureUserAsync(
            PreferredRamuId,
            "9999999999",
            "Ramu Patil",
            "ramu123",
            AppRole.PrimaryOwner,
            nowUtc);

        var ganesh = await EnsureUserAsync(
            PreferredGaneshId,
            "8888888888",
            "Ganesh Mukadam",
            "ganesh123",
            AppRole.Mukadam,
            nowUtc);

        var farm = await EnsureFarmAsync(ramu.Id, nowUtc);
        var cycleContexts = await EnsurePlotsAndCropCyclesAsync(farm.Id, nowUtc);
        await _SSFContext.SaveChangesAsync();

        var templateStats = await EnsureScheduleTemplatesAndPlansAsync(cycleContexts, nowUtc);
        var logStats = await EnsureDailyLogsAsync(farm.Id, cycleContexts, ramu.Id, ganesh.Id, nowUtc);
        var costStats = await EnsureCostEntriesAndCorrectionsAsync(farm.Id, cycleContexts, ramu.Id, ganesh.Id, nowUtc);
        var priceAdded = await EnsurePriceConfigsAsync(ramu.Id, nowUtc);
        await _SSFContext.SaveChangesAsync();

        var totals = await BuildSeedTotalsAsync(farm.Id);

        Console.WriteLine(
            $"Seeded: {totals.LogCount} logs, {totals.TaskCount} tasks, {totals.CostEntryCount} cost entries, {totals.VerificationCount} verifications");

        var totalAdded = templateStats.TemplatesAdded
                         + templateStats.PlannedActivitiesAdded
                         + logStats.LogsAdded
                         + logStats.TasksAdded
                         + logStats.VerificationsAdded
                         + costStats.CostEntriesAdded
                         + costStats.CorrectionsAdded
                         + priceAdded;

        var status = totalAdded == 0
            ? "Demo data already seeded."
            : "Demo data seeded successfully.";

        return $"{status} Seeded: {totals.LogCount} logs, {totals.TaskCount} tasks, {totals.CostEntryCount} cost entries, {totals.VerificationCount} verifications.";
    }

    private async Task<User.Domain.Identity.User> EnsureUserAsync(
        UserId preferredId,
        string phone,
        string displayName,
        string password,
        AppRole role,
        DateTime nowUtc)
    {
        var existing = await _userContext.Users.FirstOrDefaultAsync(u => u.Phone.Value == phone);

        if (existing is not null && !_passwordHasher.Verify(password, existing.Credential.PasswordHash))
        {
            // Keep the same ID so any existing references remain valid.
            var replacementId = existing.Id;
            _userContext.Users.Remove(existing);
            await _userContext.SaveChangesAsync();

            existing = null;
            preferredId = replacementId;
        }

        if (existing is null)
        {
            var user = User.Domain.Identity.User.Register(
                preferredId,
                PhoneNumber.Create(phone),
                displayName,
                _passwordHasher.Hash(password),
                nowUtc);

            user.AddMembership(
                CreateDeterministicGuid($"{SeedVersion}:membership:{phone}"),
                AppId,
                role,
                nowUtc);

            _userContext.Users.Add(user);
            await _userContext.SaveChangesAsync();
            return user;
        }

        var membership = existing.Memberships
            .FirstOrDefault(m => m.AppId.Equals(AppId, StringComparison.OrdinalIgnoreCase) && !m.IsRevoked);

        if (membership is null)
        {
            existing.AddMembership(
                CreateDeterministicGuid($"{SeedVersion}:membership:{phone}:{existing.Id}"),
                AppId,
                role,
                nowUtc);
            await _userContext.SaveChangesAsync();
        }
        else if (membership.Role != role)
        {
            existing.ChangeRole(AppId, role, nowUtc);
            await _userContext.SaveChangesAsync();
        }

        return existing;
    }

    private async Task<Farm> EnsureFarmAsync(UserId ownerUserId, DateTime nowUtc)
    {
        var farm = await _SSFContext.Farms.FirstOrDefaultAsync(f => f.OwnerUserId == ownerUserId);
        if (farm is not null)
        {
            return farm;
        }

        var farmId = new FarmId(CreateDeterministicGuid($"{SeedVersion}:farm:ramu"));
        farm = Farm.Create(farmId, "Ramu's Farm", ownerUserId, nowUtc);
        _SSFContext.Farms.Add(farm);
        return farm;
    }

    private async Task<List<PlotCycleContext>> EnsurePlotsAndCropCyclesAsync(FarmId farmId, DateTime nowUtc)
    {
        var plots = await _SSFContext.Plots
            .Where(p => p.FarmId == farmId)
            .ToListAsync();

        var cycles = await _SSFContext.CropCycles
            .Where(c => c.FarmId == farmId)
            .ToListAsync();

        var result = new List<PlotCycleContext>(PlotSeeds.Length);

        foreach (var seed in PlotSeeds)
        {
            var plot = plots.FirstOrDefault(p => p.Name.Equals(seed.PlotName, StringComparison.OrdinalIgnoreCase));
            if (plot is null)
            {
                var plotId = CreateDeterministicGuid($"{SeedVersion}:plot:{seed.Key}");
                var createdAt = nowUtc.AddDays(seed.StartOffsetDays);
                plot = Plot.Create(plotId, farmId, seed.PlotName, seed.AreaInAcres, createdAt);
                _SSFContext.Plots.Add(plot);
                plots.Add(plot);
            }

            var cycle = cycles.FirstOrDefault(c =>
                c.PlotId == plot.Id &&
                c.CropName.Equals(seed.CropName, StringComparison.OrdinalIgnoreCase));

            if (cycle is null)
            {
                var cycleId = CreateDeterministicGuid($"{SeedVersion}:cycle:{seed.Key}");
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
                _SSFContext.CropCycles.Add(cycle);
                cycles.Add(cycle);
            }

            result.Add(new PlotCycleContext(seed, plot.Id, cycle.Id, cycle.StartDate));
        }

        return result;
    }

    private async Task<TemplateSeedStats> EnsureScheduleTemplatesAndPlansAsync(
        IReadOnlyList<PlotCycleContext> cycleContexts,
        DateTime nowUtc)
    {
        var cycleIds = cycleContexts.Select(c => c.CropCycleId).ToHashSet();
        var templateIds = cycleContexts
            .Select(c => CreateDeterministicGuid($"{SeedVersion}:template:{c.CropCycleId}"))
            .ToHashSet();

        var existingTemplates = await _SSFContext.ScheduleTemplates
            .Include(t => t.Activities)
            .Where(t => templateIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);

        var existingPlannedRows = await _SSFContext.PlannedActivities
            .Where(p => cycleIds.Contains(p.CropCycleId))
            .Select(p => new { p.CropCycleId, p.ActivityName, p.PlannedDate })
            .ToListAsync();

        var existingPlannedKeys = existingPlannedRows
            .Select(p => BuildPlannedKey(p.CropCycleId, p.ActivityName, p.PlannedDate))
            .ToHashSet(StringComparer.Ordinal);

        var templatesAdded = 0;
        var plannedAdded = 0;

        foreach (var context in cycleContexts)
        {
            var templateId = CreateDeterministicGuid($"{SeedVersion}:template:{context.CropCycleId}");
            if (!existingTemplates.TryGetValue(templateId, out var template))
            {
                template = ScheduleTemplate.Create(
                    templateId,
                    $"{context.Seed.CropName} - {context.Seed.PlotName} Template",
                    context.Seed.Stage,
                    nowUtc);

                _SSFContext.ScheduleTemplates.Add(template);
                existingTemplates[templateId] = template;
                templatesAdded++;
            }

            var templateActivities = GetTemplateActivities(context.Seed.CropName);
            for (var i = 0; i < templateActivities.Length; i++)
            {
                var activityName = templateActivities[i];
                var offsetDays = i * 3;

                var exists = template.Activities.Any(a =>
                    a.ActivityName.Equals(activityName, StringComparison.OrdinalIgnoreCase) &&
                    a.OffsetDays == offsetDays);

                if (exists)
                {
                    continue;
                }

                var activityId = CreateDeterministicGuid(
                    $"{SeedVersion}:template-activity:{templateId}:{activityName}:{offsetDays}");
                template.AddActivity(activityId, activityName, offsetDays);
            }

            foreach (var planned in BuildPlannedSeeds(context))
            {
                var plannedDate = context.StartDate.AddDays(planned.DayOffset);
                var plannedKey = BuildPlannedKey(context.CropCycleId, planned.ActivityName, plannedDate);

                if (existingPlannedKeys.Contains(plannedKey))
                {
                    continue;
                }

                var plannedId = CreateDeterministicGuid($"{SeedVersion}:planned:{plannedKey}");
                var createdAt = nowUtc.AddDays(planned.DayOffset - 1);

                var plannedActivity = PlannedActivity.Create(
                    plannedId,
                    context.CropCycleId,
                    planned.ActivityName,
                    planned.Stage,
                    plannedDate,
                    createdAt);

                _SSFContext.PlannedActivities.Add(plannedActivity);
                existingPlannedKeys.Add(plannedKey);
                plannedAdded++;
            }
        }

        return new TemplateSeedStats(templatesAdded, plannedAdded);
    }

    private async Task<LogSeedStats> EnsureDailyLogsAsync(
        FarmId farmId,
        IReadOnlyList<PlotCycleContext> cycleContexts,
        UserId ramuUserId,
        UserId ganeshUserId,
        DateTime nowUtc)
    {
        var existingLogs = await _SSFContext.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l =>
                l.FarmId == farmId &&
                l.IdempotencyKey != null &&
                l.IdempotencyKey.StartsWith($"{SeedVersion}:log:"))
            .ToListAsync();

        var logByKey = existingLogs
            .ToDictionary(l => l.IdempotencyKey!, StringComparer.Ordinal);

        var logsAdded = 0;
        var tasksAdded = 0;
        var verificationsAdded = 0;

        for (var cycleIndex = 0; cycleIndex < cycleContexts.Count; cycleIndex++)
        {
            var context = cycleContexts[cycleIndex];
            var taskPatterns = GetTaskPatterns(context.Seed.CropName);

            for (var logIndex = 0; logIndex < LogDayOffsets.Length; logIndex++)
            {
                var dayOffset = LogDayOffsets[logIndex];
                var idempotencyKey = $"{SeedVersion}:log:{context.CropCycleId:N}:{dayOffset}";
                var occurredAtUtc = nowUtc.Date.AddDays(-dayOffset).AddHours(6 + ((cycleIndex + logIndex) % 6));
                var logDate = DateOnly.FromDateTime(occurredAtUtc);
                var operatorUserId = (cycleIndex + logIndex) % 4 == 0 ? ganeshUserId : ramuUserId;

                if (!logByKey.TryGetValue(idempotencyKey, out var log))
                {
                    var logId = CreateDeterministicGuid($"{SeedVersion}:daily-log:{idempotencyKey}");
                    log = DailyLog.Create(
                        logId,
                        farmId,
                        context.PlotId,
                        context.CropCycleId,
                        operatorUserId,
                        logDate,
                        idempotencyKey,
                        occurredAtUtc);

                    _SSFContext.DailyLogs.Add(log);
                    logByKey[idempotencyKey] = log;
                    logsAdded++;
                }

                var taskNames = taskPatterns[(cycleIndex + logIndex) % taskPatterns.Length];
                for (var taskIndex = 0; taskIndex < taskNames.Length; taskIndex++)
                {
                    var activityType = taskNames[taskIndex];
                    var hasTask = log.Tasks.Any(t => t.ActivityType.Equals(activityType, StringComparison.OrdinalIgnoreCase));
                    if (hasTask)
                    {
                        continue;
                    }

                    var taskId = CreateDeterministicGuid($"{SeedVersion}:task:{log.Id}:{activityType}:{taskIndex}");
                    var notes = $"{context.Seed.CropName} activity: {activityType}.";
                    var taskTime = occurredAtUtc.AddMinutes((taskIndex + 1) * 17);
                    log.AddTask(taskId, activityType, notes, taskTime);
                    tasksAdded++;
                }

                if ((cycleIndex + logIndex) % 3 == 0)
                {
                    var status = (cycleIndex + logIndex) % 2 == 0
                        ? VerificationStatus.Verified
                        : VerificationStatus.Disputed;

                    var hasStatus = log.VerificationEvents.Any(v => v.Status == status);
                    if (!hasStatus)
                    {
                        // New verification FSM only allows Draft -> Confirmed first.
                        var hasConfirmed = log.VerificationEvents.Any(v => v.Status == VerificationStatus.Confirmed);
                        var confirmedAtUtc = occurredAtUtc.AddHours(2);

                        if (!hasConfirmed)
                        {
                            var confirmId = CreateDeterministicGuid($"{SeedVersion}:verify:{log.Id}:{VerificationStatus.Confirmed}");
                            log.Verify(
                                confirmId,
                                VerificationStatus.Confirmed,
                                null,
                                AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner,
                                ramuUserId,
                                confirmedAtUtc);

                            verificationsAdded++;
                        }

                        var reason = status == VerificationStatus.Disputed
                            ? "Deviation observed during supervisor review."
                            : null;

                        var verificationId = CreateDeterministicGuid($"{SeedVersion}:verify:{log.Id}:{status}");
                        var statusAtUtc = status == VerificationStatus.Verified
                            ? confirmedAtUtc.AddMinutes(10)
                            : confirmedAtUtc.AddMinutes(20);

                        log.Verify(
                            verificationId,
                            status,
                            reason,
                            AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner,
                            ramuUserId,
                            statusAtUtc);

                        verificationsAdded++;
                    }
                }
            }
        }

        return new LogSeedStats(logsAdded, tasksAdded, verificationsAdded);
    }

    private async Task<CostSeedStats> EnsureCostEntriesAndCorrectionsAsync(
        FarmId farmId,
        IReadOnlyList<PlotCycleContext> cycleContexts,
        UserId ramuUserId,
        UserId ganeshUserId,
        DateTime nowUtc)
    {
        var specs = BuildCostSpecs();

        var existingCosts = await _SSFContext.CostEntries
            .Where(c => c.FarmId == farmId)
            .ToListAsync();

        var existingCostIds = existingCosts.Select(c => c.Id).ToHashSet();

        var existingCorrectionIds = await _SSFContext.FinanceCorrections
            .Select(c => c.Id)
            .ToHashSetAsync();

        var costEntriesAdded = 0;
        var correctionsAdded = 0;

        for (var i = 0; i < specs.Count; i++)
        {
            var spec = specs[i];
            var targetCycle = cycleContexts[i % cycleContexts.Count];
            var costId = CreateDeterministicGuid($"{SeedVersion}:cost:{spec.Index}");

            if (existingCostIds.Contains(costId))
            {
                continue;
            }

            var entryDate = DateOnly.FromDateTime(nowUtc.AddDays(-spec.DayOffset));
            var createdAt = nowUtc.Date.AddDays(-spec.DayOffset).AddHours(9 + (i % 6));
            var createdBy = i % 2 == 0 ? ramuUserId : ganeshUserId;

            var entry = CostEntry.Create(
                costId,
                farmId,
                targetCycle.PlotId,
                targetCycle.CropCycleId,
                spec.Category,
                $"[SeedV2] {spec.Description}",
                spec.Amount,
                "INR",
                entryDate,
                createdBy,
                createdAt);

            _SSFContext.CostEntries.Add(entry);
            existingCosts.Add(entry);
            existingCostIds.Add(costId);
            costEntriesAdded++;
        }

        var correctionSpecs = new[]
        {
            new CorrectionSeed(4, 1.12m, "Quantity adjusted after invoice reconciliation"),
            new CorrectionSeed(11, 0.93m, "Discount applied by supplier"),
            new CorrectionSeed(18, 1.08m, "Late labour overtime added")
        };

        foreach (var correctionSeed in correctionSpecs)
        {
            var costId = CreateDeterministicGuid($"{SeedVersion}:cost:{correctionSeed.CostIndex}");
            var costEntry = existingCosts.FirstOrDefault(c => c.Id == costId);
            if (costEntry is null)
            {
                continue;
            }

            var correctionId = CreateDeterministicGuid($"{SeedVersion}:correction:{correctionSeed.CostIndex}");
            if (existingCorrectionIds.Contains(correctionId))
            {
                continue;
            }

            var correctedAmount = decimal.Round(
                costEntry.Amount * correctionSeed.Multiplier,
                2,
                MidpointRounding.AwayFromZero);

            var correctedAt = nowUtc.Date.AddDays(-(correctionSeed.CostIndex % 20)).AddHours(18);
            var correctedBy = correctionSeed.CostIndex % 2 == 0 ? ramuUserId : ganeshUserId;

            var correction = FinanceCorrection.Create(
                correctionId,
                costEntry.Id,
                costEntry.Amount,
                correctedAmount,
                costEntry.CurrencyCode,
                $"[SeedV2] {correctionSeed.Reason}",
                correctedBy,
                correctedAt);

            _SSFContext.FinanceCorrections.Add(correction);
            costEntry.MarkCorrected(correctionId, correctedAmount, costEntry.CurrencyCode, correctedAt);
            existingCorrectionIds.Add(correctionId);
            correctionsAdded++;
        }

        return new CostSeedStats(costEntriesAdded, correctionsAdded);
    }

    private async Task<int> EnsurePriceConfigsAsync(UserId createdByUserId, DateTime nowUtc)
    {
        var existingRows = await _SSFContext.PriceConfigs
            .Select(p => new { p.ItemName, p.Version })
            .ToListAsync();

        var existingKeys = existingRows
            .Select(p => BuildPriceConfigKey(p.ItemName, p.Version))
            .ToHashSet(StringComparer.Ordinal);

        var added = 0;

        foreach (var seed in PriceSeeds)
        {
            const int version = 1;
            var key = BuildPriceConfigKey(seed.ItemName, version);
            if (existingKeys.Contains(key))
            {
                continue;
            }

            var configId = CreateDeterministicGuid($"{SeedVersion}:price:{seed.ItemName}:{version}");
            var config = PriceConfig.Create(
                configId,
                seed.ItemName,
                seed.UnitPrice,
                "INR",
                DateOnly.FromDateTime(nowUtc.Date),
                version,
                createdByUserId,
                nowUtc);

            _SSFContext.PriceConfigs.Add(config);
            existingKeys.Add(key);
            added++;
        }

        return added;
    }

    private async Task<SeedTotals> BuildSeedTotalsAsync(FarmId farmId)
    {
        var logCount = await _SSFContext.DailyLogs.CountAsync(l => l.FarmId == farmId);

        var taskCount = await (
            from task in _SSFContext.LogTasks
            join log in _SSFContext.DailyLogs on task.DailyLogId equals log.Id
            where log.FarmId == farmId
            select task.Id).CountAsync();

        var verificationCount = await (
            from verification in _SSFContext.VerificationEvents
            join log in _SSFContext.DailyLogs on verification.DailyLogId equals log.Id
            where log.FarmId == farmId
            select verification.Id).CountAsync();

        var costEntryCount = await _SSFContext.CostEntries.CountAsync(c => c.FarmId == farmId);

        return new SeedTotals(logCount, taskCount, costEntryCount, verificationCount);
    }

    private static string[] GetTemplateActivities(string cropName)
    {
        return Normalize(cropName) switch
        {
            "grapes" => ["Spraying", "Pruning", "Fertigation", "Observation"],
            "pomegranate" => ["Bahar Treatment", "Defoliation", "Irrigation"],
            "sugarcane" => ["Irrigation", "Weeding", "Fertilizer application"],
            "onion" => ["Sowing", "Sprinkler irrigation", "Observation"],
            _ => ["Observation"]
        };
    }

    private static string[][] GetTaskPatterns(string cropName)
    {
        return Normalize(cropName) switch
        {
            "grapes" =>
            [
                ["Spraying", "Observation"],
                ["Pruning", "Fertigation", "Observation"],
                ["Spraying", "Fertigation"],
                ["Pruning", "Observation"]
            ],
            "pomegranate" =>
            [
                ["Bahar Treatment", "Irrigation"],
                ["Defoliation", "Observation"],
                ["Bahar Treatment", "Defoliation", "Irrigation"]
            ],
            "sugarcane" =>
            [
                ["Irrigation", "Weeding"],
                ["Fertilizer application", "Observation"],
                ["Irrigation", "Fertilizer application", "Weeding"]
            ],
            "onion" =>
            [
                ["Sowing", "Sprinkler irrigation"],
                ["Observation", "Sprinkler irrigation"],
                ["Sowing", "Observation", "Sprinkler irrigation"]
            ],
            _ =>
            [
                ["Observation"]
            ]
        };
    }

    private static List<PlannedSeed> BuildPlannedSeeds(PlotCycleContext context)
    {
        var crop = Normalize(context.Seed.CropName);

        if (crop == "grapes")
        {
            return GrapeMasterPlan
                .Select(x => new PlannedSeed(x.Day, x.Stage, x.ActivityName))
                .ToList();
        }

        if (crop == "pomegranate")
        {
            return
            [
                new PlannedSeed(1, "Bahar Treatment", "Bahar Treatment"),
                new PlannedSeed(4, "Bahar Treatment", "Defoliation"),
                new PlannedSeed(8, "Fertigation", "Irrigation"),
                new PlannedSeed(12, "Fertigation", "Micronutrient spray")
            ];
        }

        if (crop == "sugarcane")
        {
            return
            [
                new PlannedSeed(1, "Planting", "Irrigation"),
                new PlannedSeed(5, "Planting", "Weeding"),
                new PlannedSeed(11, "Planting", "Fertilizer application"),
                new PlannedSeed(18, "Planting", "Irrigation")
            ];
        }

        if (crop == "onion")
        {
            return
            [
                new PlannedSeed(1, "Sowing", "Sowing"),
                new PlannedSeed(3, "Sowing", "Sprinkler irrigation"),
                new PlannedSeed(7, "Sowing", "Observation"),
                new PlannedSeed(12, "Sowing", "Sprinkler irrigation")
            ];
        }

        return [new PlannedSeed(1, context.Seed.Stage, "Observation")];
    }

    private static List<CostSeed> BuildCostSpecs()
    {
        var categoryTemplates = new[]
        {
            new { Category = "Labour", Description = "Field labour payment", BaseAmount = 900m },
            new { Category = "Seeds", Description = "Seed and nursery material", BaseAmount = 780m },
            new { Category = "Fertilizer", Description = "Nutrient input purchase", BaseAmount = 1450m },
            new { Category = "Pesticide", Description = "Crop protection spray", BaseAmount = 1180m },
            new { Category = "Equipment", Description = "Equipment repair and rentals", BaseAmount = 1600m },
            new { Category = "Fuel", Description = "Diesel and transport fuel", BaseAmount = 1020m }
        };

        var costs = new List<CostSeed>(24);

        for (var i = 0; i < 24; i++)
        {
            var template = categoryTemplates[i % categoryTemplates.Length];
            var amount = template.BaseAmount + (i / categoryTemplates.Length) * 135m + (i % 3) * 45m;
            var dayOffset = (i * 2) % 28;
            costs.Add(new CostSeed(i + 1, template.Category, $"{template.Description} #{i + 1}", amount, dayOffset));
        }

        return costs;
    }

    private static string BuildPlannedKey(Guid cropCycleId, string activityName, DateOnly plannedDate)
    {
        return $"{cropCycleId:N}|{plannedDate:yyyyMMdd}|{Normalize(activityName)}";
    }

    private static string BuildPriceConfigKey(string itemName, int version)
    {
        return $"{Normalize(itemName)}|{version}";
    }

    private static string Normalize(string value)
    {
        return value.Trim().ToLowerInvariant();
    }

    private static Guid CreateDeterministicGuid(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        Span<byte> guidBytes = stackalloc byte[16];
        hash.AsSpan(0, 16).CopyTo(guidBytes);
        return new Guid(guidBytes);
    }

    private sealed record PlotSeed(
        string Key,
        string PlotName,
        decimal AreaInAcres,
        string CropName,
        string Stage,
        int StartOffsetDays);

    private sealed record PlotCycleContext(
        PlotSeed Seed,
        Guid PlotId,
        Guid CropCycleId,
        DateOnly StartDate);

    private sealed record PlannedSeed(int DayOffset, string Stage, string ActivityName);

    private sealed record CostSeed(int Index, string Category, string Description, decimal Amount, int DayOffset);

    private sealed record CorrectionSeed(int CostIndex, decimal Multiplier, string Reason);

    private sealed record PriceSeed(string ItemName, decimal UnitPrice);

    private sealed record GrapeMasterPlanSeed(int Day, string Stage, string ActivityName);

    private sealed record TemplateSeedStats(int TemplatesAdded, int PlannedActivitiesAdded);

    private sealed record LogSeedStats(int LogsAdded, int TasksAdded, int VerificationsAdded);

    private sealed record CostSeedStats(int CostEntriesAdded, int CorrectionsAdded);

    private sealed record SeedTotals(int LogCount, int TaskCount, int CostEntryCount, int VerificationCount);
}
