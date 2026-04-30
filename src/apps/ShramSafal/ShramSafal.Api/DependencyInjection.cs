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
using ShramSafal.Application.UseCases.Farms.GetFarmDetails;
using ShramSafal.Application.UseCases.Farms.GetFarmWeather;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;
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
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;
using ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Planning.GetStagePlan;
using ShramSafal.Application.UseCases.Planning.GetTodaysPlan;
using ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Application.UseCases.Schedules.AbandonSchedule;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
using ShramSafal.Application.UseCases.Schedules.CompleteSchedule;
using ShramSafal.Application.UseCases.Schedules.MigrateSchedule;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Application.UseCases.Tests.CreateTestProtocol;
using ShramSafal.Application.UseCases.Tests.GetMissingTestsForFarm;
using ShramSafal.Application.UseCases.Tests.GetTestQueueForCycle;
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;
using ShramSafal.Application.UseCases.Tests.RecordTestCollected;
using ShramSafal.Application.UseCases.Tests.RecordTestResult;
using ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;
using ShramSafal.Application.UseCases.Tests.WaiveTestInstance;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;
using ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;
using ShramSafal.Application.UseCases.Compliance.ResolveSignal;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Application.UseCases.Work.CancelJobCard;
using ShramSafal.Application.UseCases.Work.CompleteJobCard;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;
using ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
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
        services.AddScoped<GetFarmDetailsHandler>();
        services.AddScoped<GetFarmWeatherHandler>();
        services.AddScoped<UpdateFarmBoundaryHandler>();
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
        services.AddScoped<OverridePlannedActivityHandler>();
        services.AddScoped<AddLocalPlannedActivityHandler>();
        services.AddScoped<RemovePlannedActivityHandler>();
        services.AddScoped<GetScheduleTemplatesHandler>();
        services.AddScoped<CloneScheduleTemplateHandler>();
        services.AddScoped<EditScheduleTemplateHandler>();
        services.AddScoped<PublishScheduleTemplateHandler>();
        services.AddScoped<GetScheduleLineageHandler>();
        services.AddScoped<GetAttentionBoardHandler>();
        services.AddScoped<GetCropTypesHandler>();
        services.AddScoped<GetDeviationReasonCodesHandler>();

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

        // Sub-plan 03 Task 8 — IssueFarmInvite is the POC handler wired
        // through the explicit HandlerPipeline. Validator + Authorizer +
        // LoggingBehavior run as decorators around the raw handler. The
        // endpoint resolves IHandler<IssueFarmInviteCommand, IssueFarmInviteResult>
        // and gets all three layers without HTTP-level glue.
        //
        // T-IGH-03-PIPELINE-ROLLOUT extends this pattern to additional
        // membership/auth-shaped handlers (RotateFarmInvite below).
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<IssueFarmInviteCommand>,
            IssueFarmInviteValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<IssueFarmInviteCommand>,
            IssueFarmInviteAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<IssueFarmInviteCommand, IssueFarmInviteResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<IssueFarmInviteHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<IssueFarmInviteCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<IssueFarmInviteCommand, IssueFarmInviteResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<IssueFarmInviteCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (RotateFarmInvite): same shape as
        // IssueFarmInvite — owner-only ownership check + non-empty IDs
        // validation. The endpoint resolves the pipeline-wrapped handler;
        // the raw RotateFarmInviteHandler stays registered above so any
        // legacy/direct consumer keeps working.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<RotateFarmInviteCommand>,
            RotateFarmInviteValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<RotateFarmInviteCommand>,
            RotateFarmInviteAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<RotateFarmInviteCommand, RotateFarmInviteResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<RotateFarmInviteHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<RotateFarmInviteCommand, RotateFarmInviteResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<RotateFarmInviteCommand, RotateFarmInviteResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<RotateFarmInviteCommand, RotateFarmInviteResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<RotateFarmInviteCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<RotateFarmInviteCommand, RotateFarmInviteResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<RotateFarmInviteCommand>>())));

        // Phase 6 — self-exit
        services.AddScoped<ExitMembershipHandler>();

        // Phase 6 MIS — owner farm-week report
        services.AddScoped<GetFarmWeekMisHandler>();

        // Admin ops — real-time operational health dashboard + Phase 2 paginated endpoints
        services.AddScoped<GetOpsHealthHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetOpsErrors.GetOpsErrorsHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetOpsVoice.GetOpsVoiceHandler>();

        // Admin MIS — Phase 3+ (WVFD, Farms, Users)
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetWvfdHistory.GetWvfdHistoryHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetFarmsList.GetFarmsListHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetSilentChurn.GetSilentChurnHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetSuffering.GetSufferingHandler>();
        services.AddScoped<ShramSafal.Application.UseCases.Admin.GetUsersList.GetUsersListHandler>();
        services.AddScoped<ShramSafal.Application.Ports.IAdminMisRepository,
            ShramSafal.Infrastructure.Persistence.Repositories.AdminMisRepository>();

        // Phase 3 MIS — schedule compliance evaluator
        services.AddScoped<IScheduleComplianceService, ScheduleComplianceService>();
        services.AddScoped<AdoptScheduleHandler>();
        services.AddScoped<MigrateScheduleHandler>();
        services.AddScoped<AbandonScheduleHandler>();
        services.AddScoped<CompleteScheduleHandler>();

        // CEI Phase 2 §4.5 — test-stack handlers (HTTP + sync surfaces)
        services.AddScoped<CreateTestProtocolHandler>();
        services.AddScoped<ScheduleTestDueDatesHandler>();
        services.AddScoped<RecordTestCollectedHandler>();
        services.AddScoped<RecordTestResultHandler>();
        services.AddScoped<WaiveTestInstanceHandler>();
        services.AddScoped<GetTestQueueForCycleHandler>();
        services.AddScoped<GetMissingTestsForFarmHandler>();
        services.AddScoped<MarkOverdueInstancesHandler>();

        // CEI Phase 3 §4.6 — compliance signal handlers
        services.AddScoped<EvaluateComplianceHandler>();
        services.AddScoped<GetComplianceSignalsForFarmHandler>();
        services.AddScoped<AcknowledgeSignalHandler>();
        services.AddScoped<ResolveSignalHandler>();

        // CEI Phase 4 §4.8 — Work Trust Ledger handlers
        services.AddScoped<CreateJobCardHandler>();
        services.AddScoped<AssignJobCardHandler>();
        services.AddScoped<StartJobCardHandler>();
        services.AddScoped<CompleteJobCardHandler>();
        services.AddScoped<VerifyJobCardForPayoutHandler>();
        services.AddScoped<SettleJobCardPayoutHandler>();
        services.AddScoped<CancelJobCardHandler>();
        services.AddScoped<GetJobCardsForFarmHandler>();
        services.AddScoped<GetJobCardsForWorkerHandler>();
        services.AddScoped<GetWorkerProfileHandler>();
        services.AddScoped<OnLogVerifiedAutoVerifyJobCard>();

        return services;
    }
}
