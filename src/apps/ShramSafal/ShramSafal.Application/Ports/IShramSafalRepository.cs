using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Ports;

public interface IShramSafalRepository
{
    Task AddFarmAsync(Farm farm, CancellationToken ct = default);
    Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default);

    Task AddPlotAsync(Plot plot, CancellationToken ct = default);
    Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default);

    Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default);
    Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default);

    Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default);
    Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default);
    Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default);

    Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default);
    Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default);
    Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default);

    Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default);

    Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default);
    Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);
    Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default);

    Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default);

    Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);
    Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
