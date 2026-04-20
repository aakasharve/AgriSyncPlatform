using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;
using ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;
using ShramSafal.Application.UseCases.Attachments.ListAttachmentsForEntity;
using ShramSafal.Application.UseCases.Attachments.UploadAttachment;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.AI.CreateDocumentSession;
using ShramSafal.Application.UseCases.AI.ExtractPattiImage;
using ShramSafal.Application.UseCases.AI.ExtractReceipt;
using ShramSafal.Application.UseCases.AI.GetAiDashboard;
using ShramSafal.Application.UseCases.AI.GetAiJobStatus;
using ShramSafal.Application.UseCases.AI.GetDocumentSession;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Application.UseCases.AI.UpdateProviderConfig;
using ShramSafal.Application.UseCases.Export.ExportDailySummary;
using ShramSafal.Application.UseCases.Export.ExportMonthlyCost;
using ShramSafal.Application.UseCases.Export.ExportVerificationReport;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.GetFinanceSummary;
using ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Application.UseCases.Memberships.GetMyFarms;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Planning.GetStagePlan;
using ShramSafal.Application.UseCases.Planning.GetTodaysPlan;
using ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Application.UseCases.Schedules.AbandonSchedule;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
using ShramSafal.Application.UseCases.Schedules.CompleteSchedule;
using ShramSafal.Application.UseCases.Schedules.MigrateSchedule;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Infrastructure;

namespace ShramSafal.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddShramSafalApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddShramSafalInfrastructure(configuration);
        services.AddAuthorization();
        services.AddScoped<ExportDailySummaryHandler>();
        services.AddScoped<ExportMonthlyCostHandler>();
        services.AddScoped<ExportVerificationReportHandler>();

        services.AddScoped<CreateFarmHandler>();
        services.AddScoped<CreatePlotHandler>();
        services.AddScoped<CreateCropCycleHandler>();

        services.AddScoped<CreateDailyLogHandler>();
        services.AddScoped<AddLogTaskHandler>();
        services.AddScoped<VerifyLogHandler>();

        services.AddScoped<SetPriceConfigVersionHandler>();
        services.AddScoped<AddCostEntryHandler>();
        services.AddScoped<AllocateGlobalExpenseHandler>();
        services.AddScoped<CorrectCostEntryHandler>();
        services.AddScoped<GetFinanceSummaryHandler>();
        services.AddScoped<CreateAttachmentHandler>();
        services.AddScoped<UploadAttachmentHandler>();
        services.AddScoped<GetAttachmentMetadataHandler>();
        services.AddScoped<GetAttachmentFileHandler>();
        services.AddScoped<ListAttachmentsForEntityHandler>();

        services.AddScoped<GeneratePlanFromTemplateHandler>();
        services.AddScoped<ComputePlannedVsExecutedDeltaHandler>();
        services.AddScoped<GetTodaysPlanHandler>();
        services.AddScoped<GetStagePlanHandler>();
        services.AddScoped<GetScheduleTemplatesHandler>();
        services.AddScoped<GetCropTypesHandler>();

        services.AddScoped<ParseVoiceInputHandler>();
        services.AddScoped<ExtractReceiptHandler>();
        services.AddScoped<ExtractPattiImageHandler>();
        services.AddScoped<CreateDocumentSessionHandler>();
        services.AddScoped<GetDocumentSessionHandler>();
        services.AddScoped<GetAiJobStatusHandler>();
        services.AddScoped<UpdateProviderConfigHandler>();
        services.AddScoped<GetAiDashboardHandler>();

        services.AddScoped<PushSyncBatchHandler>();
        services.AddScoped<PullSyncChangesHandler>();

        // Phase 4 — QR invitation + join
        services.AddScoped<IssueFarmInviteHandler>();
        services.AddScoped<RotateFarmInviteHandler>();
        services.AddScoped<ClaimJoinHandler>();
        services.AddScoped<GetMyFarmsHandler>();

        // Phase 6 — self-exit
        services.AddScoped<ExitMembershipHandler>();

        // Phase 6 MIS — owner farm-week report
        services.AddScoped<GetFarmWeekMisHandler>();

        // Phase 3 MIS — schedule compliance evaluator
        services.AddScoped<IScheduleComplianceService, ScheduleComplianceService>();
        services.AddScoped<AdoptScheduleHandler>();
        services.AddScoped<MigrateScheduleHandler>();
        services.AddScoped<AbandonScheduleHandler>();
        services.AddScoped<CompleteScheduleHandler>();

        return services;
    }
}
