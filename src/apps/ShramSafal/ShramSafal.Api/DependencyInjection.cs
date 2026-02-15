using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.GetFinanceSummary;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure;

namespace ShramSafal.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddShramSafalApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddShramSafalInfrastructure(configuration);

        services.AddScoped<CreateFarmHandler>();
        services.AddScoped<CreatePlotHandler>();
        services.AddScoped<CreateCropCycleHandler>();

        services.AddScoped<CreateDailyLogHandler>();
        services.AddScoped<AddLogTaskHandler>();
        services.AddScoped<VerifyLogHandler>();

        services.AddScoped<SetPriceConfigVersionHandler>();
        services.AddScoped<AddCostEntryHandler>();
        services.AddScoped<CorrectCostEntryHandler>();
        services.AddScoped<GetFinanceSummaryHandler>();

        services.AddScoped<GeneratePlanFromTemplateHandler>();
        services.AddScoped<ComputePlannedVsExecutedDeltaHandler>();

        services.AddScoped<PushSyncBatchHandler>();
        services.AddScoped<PullSyncChangesHandler>();

        return services;
    }
}
