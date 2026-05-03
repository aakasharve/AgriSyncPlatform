using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
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
using ShramSafal.Application.Abstractions.Sync;
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

        // Sub-plan 05 Task 2a (T-IGH-05-FAIL-PUSHES-WIRING): production default —
        // never forces push failures. The Bootstrapper re-registers an adapter over
        // E2eFailPushesToggle when ALLOW_E2E_SEED=true (that registration must land
        // AFTER this one in DI ordering so it wins via Replace).
        services.AddSingleton<IE2eFailPushesProbe>(NoOpFailPushesProbe.Instance);

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

        // T-IGH-03-PIPELINE-ROLLOUT (ClaimJoin): validation-only pipeline
        // — the token IS the authorization artifact for the worker-side
        // claim, so no IAuthorizationCheck<ClaimJoinCommand> is wired.
        // The AuthorizationBehavior still runs as a no-op decorator
        // (zero registered checks ⇒ pass-through) for consistency with
        // the other rolled-out handlers; if a future task adds a
        // ClaimJoinAuthorizer, only the registration line needs to land.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<ClaimJoinCommand>,
            ClaimJoinValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<ClaimJoinCommand, ClaimJoinResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<ClaimJoinHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<ClaimJoinCommand, ClaimJoinResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<ClaimJoinCommand, ClaimJoinResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<ClaimJoinCommand, ClaimJoinResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<ClaimJoinCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<ClaimJoinCommand, ClaimJoinResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<ClaimJoinCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): caller-shape
        // validation (incl. labour-payout routing rule) +
        // farm-existence + farm-membership authorization. The endpoint
        // (POST /finance/cost-entry) gets the canonical
        // InvalidCommand → UseSettleJobCardForLabourPayout →
        // FarmNotFound → Forbidden ordering through the pipeline.
        // PushSyncBatchHandler intentionally still resolves the RAW
        // AddCostEntryHandler in this rollout pass — sync has its own
        // pre-flight membership check; migrating without adding sync
        // integration tests for empty IDs / missing farm / non-member
        // is held per the "only-with-tests" guardrail.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand>,
            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand>,
            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand,
            ShramSafal.Application.Contracts.Dtos.AddCostEntryResultDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<AddCostEntryHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand,
                    ShramSafal.Application.Contracts.Dtos.AddCostEntryResultDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand,
                            ShramSafal.Application.Contracts.Dtos.AddCostEntryResultDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand,
                    ShramSafal.Application.Contracts.Dtos.AddCostEntryResultDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand,
                    ShramSafal.Application.Contracts.Dtos.AddCostEntryResultDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Finance.AddCostEntry.AddCostEntryCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CreateDailyLog): caller-shape
        // validation + farm-existence + farm-membership authorization.
        // The endpoint (POST /logs) gets the canonical
        // InvalidCommand → FarmNotFound → Forbidden ordering through
        // the pipeline. PushSyncBatchHandler intentionally still
        // resolves the RAW CreateDailyLogHandler in this rollout pass
        // — its HandleCreateDailyLogAsync runs a pre-flight membership
        // check before invoking the body, and migrating sync without
        // adding sync integration tests for empty IDs / missing farm /
        // non-member would only document a sync-pipeline interaction
        // that lacks coverage. Tracked as a follow-up under
        // PIPELINE-ROLLOUT.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand>,
            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand>,
            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand,
            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CreateDailyLogHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand,
                            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Logs.CreateDailyLog.CreateDailyLogCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): caller-shape validation
        // + log-lookup-plus-membership authorization. The endpoint
        // (/logs/{id}/tasks) gets the canonical InvalidCommand →
        // DailyLogNotFound → Forbidden ordering through the pipeline.
        // PushSyncBatchHandler also resolves the pipeline-wrapped handler,
        // but its HandleAddLogTaskAsync pre-flight check still runs
        // GetDailyLogByIdAsync + IsUserMemberOfFarmAsync BEFORE the
        // pipeline (pre-rollout behaviour, intentionally preserved here),
        // so on the sync path an empty DailyLogId surfaces as
        // DailyLogNotFound rather than the pipeline's InvalidCommand.
        // The pipeline's incremental contribution on sync is caller-
        // shape validation (blank ActivityType / explicit-empty LogTaskId)
        // for commands where the log exists and the caller is a member.
        // The authorizer takes IShramSafalRepository directly (no
        // IAuthorizationEnforcer method exactly matches "any member of
        // the log's farm"; adding one would cascade to ~5 test stubs
        // and is deferred).
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand>,
            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand>,
            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand,
            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<AddLogTaskHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand,
                            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Logs.AddLogTask.AddLogTaskCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): caller-shape validation
        // + role-tier authorization. The endpoint AND the sync-batch
        // caller (PushSyncBatchHandler) both resolve the pipeline-wrapped
        // handler so the strict EnsureCanVerify owner-tier check runs on
        // every entry path. The raw VerifyLogHandler stays registered
        // above for legacy/test direct construction; those callers fall
        // back to the body's defense-in-depth membership check.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand>,
            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand>,
            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand,
            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<VerifyLogHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand,
                            ShramSafal.Application.Contracts.Dtos.DailyLogDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand,
                    ShramSafal.Application.Contracts.Dtos.DailyLogDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Logs.VerifyLog.VerifyLogCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CreatePlot): caller-shape validation
        // + farm-existence + owner-tier authorization. Endpoint
        // (POST /farms/{id}/plots) gets canonical
        // InvalidCommand → FarmNotFound → Forbidden ordering.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand>,
            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand>,
            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand,
            ShramSafal.Application.Contracts.Dtos.PlotDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CreatePlotHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand,
                    ShramSafal.Application.Contracts.Dtos.PlotDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand,
                            ShramSafal.Application.Contracts.Dtos.PlotDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand,
                    ShramSafal.Application.Contracts.Dtos.PlotDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand,
                    ShramSafal.Application.Contracts.Dtos.PlotDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Farms.CreatePlot.CreatePlotCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CreateCropCycle): caller-shape +
        // farm-existence + plot-existence-on-farm + farm-membership.
        // Endpoint (POST /cropcycles) gets canonical
        // InvalidCommand → FarmNotFound → PlotNotFound → Forbidden.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand>,
            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand>,
            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand,
            ShramSafal.Application.Contracts.Dtos.CropCycleDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CreateCropCycleHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand,
                    ShramSafal.Application.Contracts.Dtos.CropCycleDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand,
                            ShramSafal.Application.Contracts.Dtos.CropCycleDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand,
                    ShramSafal.Application.Contracts.Dtos.CropCycleDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand,
                    ShramSafal.Application.Contracts.Dtos.CropCycleDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.CropCycles.CreateCropCycle.CreateCropCycleCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (UpdateFarmBoundary): caller-shape +
        // payload-shape (GeoJSON) validation + farm-existence + owner.
        // Endpoint (PUT /farms/{id}/boundary) gets canonical
        // InvalidCommand → FarmNotFound → Forbidden ordering.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand>,
            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand>,
            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand,
            ShramSafal.Application.Contracts.Dtos.FarmDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<UpdateFarmBoundaryHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand,
                    ShramSafal.Application.Contracts.Dtos.FarmDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand,
                            ShramSafal.Application.Contracts.Dtos.FarmDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand,
                    ShramSafal.Application.Contracts.Dtos.FarmDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand,
                    ShramSafal.Application.Contracts.Dtos.FarmDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary.UpdateFarmBoundaryCommand>>())));

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
        services.AddScoped<IHandler<WaiveTestInstanceCommand>>(sp =>
            HandlerPipeline.Build(
                sp.GetRequiredService<WaiveTestInstanceHandler>(),
                new LoggingBehavior<WaiveTestInstanceCommand>(
                    sp.GetRequiredService<ILogger<LoggingBehavior<WaiveTestInstanceCommand>>>())));
        services.AddScoped<IHandler<MarkOverdueInstancesCommand, int>>(sp =>
            HandlerPipeline.Build(
                sp.GetRequiredService<MarkOverdueInstancesHandler>(),
                new LoggingBehavior<MarkOverdueInstancesCommand, int>(
                    sp.GetRequiredService<ILogger<LoggingBehavior<MarkOverdueInstancesCommand, int>>>())));

        // CEI Phase 3 §4.6 — compliance signal handlers
        services.AddScoped<EvaluateComplianceHandler>();
        services.AddScoped<GetComplianceSignalsForFarmHandler>();
        services.AddScoped<AcknowledgeSignalHandler>();
        services.AddScoped<ResolveSignalHandler>();
        services.AddScoped<IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>>(sp =>
            HandlerPipeline.Build(
                sp.GetRequiredService<EvaluateComplianceHandler>(),
                new LoggingBehavior<EvaluateComplianceCommand, EvaluateComplianceResult>(
                    sp.GetRequiredService<ILogger<LoggingBehavior<EvaluateComplianceCommand, EvaluateComplianceResult>>>())));
        services.AddScoped<IHandler<AcknowledgeSignalCommand>>(sp =>
            HandlerPipeline.Build(
                sp.GetRequiredService<AcknowledgeSignalHandler>(),
                new LoggingBehavior<AcknowledgeSignalCommand>(
                    sp.GetRequiredService<ILogger<LoggingBehavior<AcknowledgeSignalCommand>>>())));
        services.AddScoped<IHandler<ResolveSignalCommand>>(sp =>
            HandlerPipeline.Build(
                sp.GetRequiredService<ResolveSignalHandler>(),
                new LoggingBehavior<ResolveSignalCommand>(
                    sp.GetRequiredService<ILogger<LoggingBehavior<ResolveSignalCommand>>>())));

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

        // T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): caller-shape
        // validation + job-card-existence + farm-membership authorization.
        // The endpoint (POST /job-cards/{id}/complete) AND the sync entry
        // path (PushSyncBatchHandler.HandleJobCardCompleteAsync) both
        // resolve the pipeline-wrapped handler — sync's own pre-flight
        // gate is just empty-id checks, so the pipeline's
        // InvalidCommand → JobCardNotFound → Forbidden ordering is the
        // canonical entry path on both surfaces.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand,
            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CompleteJobCardHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand,
                            ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.CompleteJobCard.CompleteJobCardCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): caller-shape
        // + payout-amount + currency-code validation + job-card-existence
        // + Owner-tier (PrimaryOwner/SecondaryOwner) authorization. The
        // status-machine gate (must be VerifiedForPayout) stays in the
        // body because it's an aggregate-state invariant. Endpoint
        // (POST /job-cards/{id}/settle) AND sync
        // (PushSyncBatchHandler.HandleJobCardSettleAsync) both resolve
        // the pipeline-wrapped handler — sync's pre-flight (empty-id,
        // amount > 0, non-empty currency) overlaps the validator
        // exactly, so the pipeline ordering is canonical on both
        // surfaces.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand>,
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand>,
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand,
            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<SettleJobCardPayoutHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand,
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand,
                            ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand,
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand,
                    ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.SettleJobCardPayout.SettleJobCardPayoutCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): caller-shape +
        // non-empty-Reason validation + job-card-existence + farm-
        // membership authorization. The role-tier check (who may cancel
        // from which state) stays inside JobCard.Cancel because it
        // depends on the aggregate's current status. Endpoint
        // (POST /job-cards/{id}/cancel) AND sync
        // (PushSyncBatchHandler.HandleJobCardCancelAsync) both resolve
        // the pipeline-wrapped handler — sync's pre-flight is just
        // empty-id + non-empty-Reason; same guards as the validator,
        // so the pipeline ordering is canonical on both surfaces.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand,
            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CancelJobCardHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand,
                            ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.CancelJobCard.CancelJobCardCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): caller-shape
        // validation (empty IDs, empty LineItems) + Owner-tier
        // authorization (PrimaryOwner / SecondaryOwner / Mukadam).
        // Endpoint (POST /job-cards) AND sync entry path
        // (PushSyncBatchHandler.HandleJobCardCreateAsync) both resolve
        // the pipeline-wrapped handler — sync's pre-flight is just an
        // empty-ids + non-empty-LineItems shape check, the same gates
        // as the validator, so the pipeline ordering is canonical on
        // both surfaces. Domain construction failures (currency, money,
        // JobCard.CreateDraft argument validation) still surface via
        // the body's catch blocks as InvalidCommand.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand>,
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand,
            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CreateJobCardHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand,
                            ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand,
                    ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): caller-shape
        // validation (empty IDs) + job-card-existence + caller-role-tier
        // (Mukadam-or-Owner) authorization. Endpoint
        // (POST /job-cards/{id}/assign) AND sync entry path
        // (PushSyncBatchHandler.HandleJobCardAssignAsync) both resolve
        // the pipeline-wrapped handler — sync's pre-flight is just
        // empty-id checks on JobCardId / WorkerUserId, the same gates
        // as the validator with no overlapping role lookup, so the
        // pipeline ordering is canonical on both surfaces. The worker-
        // membership lookup (JobCardWorkerNotMember) and the domain
        // state-machine gate (JobCardInvalidState) stay in the body.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand>,
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand>,
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand,
            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<AssignJobCardHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand,
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand,
                            ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand,
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand,
                    ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.AssignJobCard.AssignJobCardCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (StartJobCard): caller-shape
        // validation (empty IDs) + job-card-existence + farm-membership
        // authorization. The strict assigned-worker rule stays inside
        // JobCard.Start (aggregate-state-dependent). Endpoint
        // (POST /job-cards/{id}/start) AND sync entry path
        // (PushSyncBatchHandler.HandleJobCardStartAsync) both resolve
        // the pipeline-wrapped handler — sync's pre-flight is just an
        // empty-id check, no overlapping membership lookup, so the
        // pipeline's InvalidCommand → JobCardNotFound → Forbidden
        // ordering is canonical on both surfaces. Same-timestamp
        // idempotency and the assigned-worker invariant stay in the
        // body.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand>,
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand>,
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand,
            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<StartJobCardHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand,
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand,
                            ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand,
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand,
                    ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.StartJobCard.StartJobCardCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (VerifyJobCardForPayout):
        // caller-shape validation (empty IDs) + job-card-existence +
        // role-tier authorization (PrimaryOwner / SecondaryOwner /
        // Agronomist / FpcTechnicalManager). The aggregate-state
        // checks stay in the body. Endpoint
        // (POST /job-cards/{id}/verify-for-payout) resolves the
        // pipeline-wrapped handler. NOTE: there is no PushSync entry
        // path for this command — verify-for-payout is NOT in the
        // SyncMutationCatalog (only create/assign/start/complete/
        // settle/cancel are), so this is endpoint-only. The
        // PushSyncBatchHandler ctor is intentionally NOT modified.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand>,
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand>,
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand,
            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<VerifyJobCardForPayoutHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand,
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand,
                            ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand,
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand,
                    ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout.VerifyJobCardForPayoutCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CloneScheduleTemplate): caller-shape
        // validation (3 IDs + non-blank Reason) + source-template
        // existence + per-scope role gate. Endpoint
        // (POST /schedule-templates/{id}/clone) gets canonical
        // InvalidCommand → ScheduleTemplateNotFound → Forbidden ordering.
        // PushSync NOT migrated: schedule.clone is registered in
        // mutation-types.json but its server dispatch in
        // PushSyncBatchHandler returns MUTATION_TYPE_UNIMPLEMENTED, so
        // the sync entry path never reaches this handler.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand,
            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CloneScheduleTemplateHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand,
                            ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate.CloneScheduleTemplateCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (EditScheduleTemplate): caller-shape
        // validation (3 IDs) + source-template existence + (Private-author
        // OR per-scope role gate). Endpoint
        // (POST /schedule-templates/{id}/edit) gets canonical
        // InvalidCommand → ScheduleTemplateNotFound → Forbidden ordering.
        // PushSync NOT migrated: schedule.edit dispatch in
        // PushSyncBatchHandler returns MUTATION_TYPE_UNIMPLEMENTED.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand,
            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<EditScheduleTemplateHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand,
                            ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Planning.EditScheduleTemplate.EditScheduleTemplateCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (PublishScheduleTemplate): caller-shape
        // validation (2 IDs) + template existence + author-only +
        // per-scope role gate. The aggregate-state guard (already-
        // published) stays in the body because it is a domain invariant
        // on the loaded aggregate, not a command-shape gate. Endpoint
        // (POST /schedule-templates/{id}/publish) gets canonical
        // InvalidCommand → ScheduleTemplateNotFound → Forbidden ordering.
        // PushSync NOT migrated: schedule.publish dispatch in
        // PushSyncBatchHandler returns MUTATION_TYPE_UNIMPLEMENTED.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand>,
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand,
            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateResult>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<PublishScheduleTemplateHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateResult>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand,
                            ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateResult>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand,
                    ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateResult>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate.PublishScheduleTemplateCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (SetPriceConfigVersion): caller-shape
        // validation only — no authorizer is registered because the
        // existing handler has no domain-knowledge authz gate (no
        // membership / role check in the body). Endpoint
        // (POST /finance/price-config) relies on the authenticated
        // principal alone; price-config admin tier is not modelled in
        // IEntitlementPolicy. Documented gap; pipeline still benefits
        // from validator-side caller-shape gating.
        //
        // PushSync MIGRATED: set_price_config is registered in
        // mutation-types.json (sinceVersion 0.6.0) and dispatched in
        // PushSyncBatchHandler.HandleSetPriceConfigAsync. Sync's pre-
        // flight (payload-shape + GetFarmIdsForUserAsync membership
        // check) runs BEFORE the pipeline-wrapped handler; the pipeline
        // adds the validator's caller-shape gate (blank ItemName,
        // non-positive Version, etc.) on the sync entry path.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand>,
            ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand,
            ShramSafal.Application.Contracts.Dtos.PriceConfigDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<SetPriceConfigVersionHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand,
                    ShramSafal.Application.Contracts.Dtos.PriceConfigDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand,
                            ShramSafal.Application.Contracts.Dtos.PriceConfigDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand,
                    ShramSafal.Application.Contracts.Dtos.PriceConfigDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand,
                    ShramSafal.Application.Contracts.Dtos.PriceConfigDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion.SetPriceConfigVersionCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (CreateAttachment): caller-shape
        // validation (IDs + non-blank fileName/mimeType + known
        // linkedEntityType) + farm-membership authorization. The link-
        // target existence + cross-farm guard (per-type) stays in the
        // body — multi-outcome (FarmNotFound / DailyLogNotFound /
        // CostEntryNotFound / Forbidden) and not a pure command-shape
        // gate. Endpoint (POST /attachments) gets canonical
        // InvalidCommand → Forbidden → (body link-target) ordering.
        //
        // PushSync MIGRATED: create_attachment is registered in
        // mutation-types.json (sinceVersion 0.4.0) and dispatched in
        // PushSyncBatchHandler.HandleCreateAttachmentAsync. Sync's pre-
        // flight runs payload-shape + IsUserMemberOfFarmAsync BEFORE the
        // pipeline — the membership pre-check overlaps the authorizer
        // and masks the canonical Forbidden ordering on sync (same
        // caveat as AddLogTask / VerifyLog). The HTTP endpoint gets the
        // canonical ordering. Removing the sync pre-check would require
        // sync integration tests probing Forbidden via the pipeline;
        // tracked as a follow-up under PIPELINE-ROLLOUT.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand>,
            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand>,
            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand,
            ShramSafal.Application.Contracts.Dtos.AttachmentDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<CreateAttachmentHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand,
                            ShramSafal.Application.Contracts.Dtos.AttachmentDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Attachments.CreateAttachment.CreateAttachmentCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (UploadAttachment): caller-shape
        // validation (IDs + FileStream presence — NO stream read) +
        // attachment-existence + farm-membership authorization. The
        // aggregate-state guard (AttachmentAlreadyFinalized) and mime-
        // type matching stay in the body — both depend on the loaded
        // aggregate, not the command shape. Endpoint
        // (PUT /attachments/{id}/content) gets canonical
        // InvalidCommand → AttachmentNotFound → Forbidden → (body)
        // ordering.
        //
        // PushSync NOT migrated: upload_attachment is NOT in
        // mutation-types.json — binary uploads bypass the sync queue
        // entirely (the multipart body would not survive JSON
        // serialization). Endpoint-only.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand>,
            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand>,
            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand,
            ShramSafal.Application.Contracts.Dtos.AttachmentDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<UploadAttachmentHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand,
                            ShramSafal.Application.Contracts.Dtos.AttachmentDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand,
                    ShramSafal.Application.Contracts.Dtos.AttachmentDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        ShramSafal.Application.UseCases.Attachments.UploadAttachment.UploadAttachmentCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): caller-shape
        // validation (incl. non-blank Reason for the audit trail) +
        // planned-activity existence + Mukadam-tier authorization. The
        // endpoint (POST /planned-activities/{id}/override) gets the
        // canonical InvalidCommand → PlannedActivityNotFound → Forbidden
        // ordering through the pipeline. PushSyncBatchHandler is NOT
        // migrated: its dispatch case for "plan.override" still returns
        // MutationTypeUnimplementedCode (Sub-plan 03 follow-up); there
        // is no sync integration test for plan.override, so the
        // "only-with-tests" guardrail keeps this rollout endpoint-only.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            OverridePlannedActivityCommand>,
            OverridePlannedActivityValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            OverridePlannedActivityCommand>,
            OverridePlannedActivityAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<OverridePlannedActivityCommand>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<OverridePlannedActivityHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<OverridePlannedActivityCommand>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<OverridePlannedActivityCommand>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<OverridePlannedActivityCommand>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<OverridePlannedActivityCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<OverridePlannedActivityCommand>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<OverridePlannedActivityCommand>>())));

        // T-IGH-03-PIPELINE-ROLLOUT (GeneratePlanFromTemplate): caller-shape
        // validation (incl. non-empty Activities + per-activity blank-
        // name guard) + crop-cycle existence + farm-membership
        // authorization. The endpoint (POST /plan/generate) gets the
        // canonical InvalidCommand → CropCycleNotFound → Forbidden
        // ordering through the pipeline. There is NO sync mutation type
        // for plan.generate_from_template (HTTP-only flow), so
        // PushSyncBatchHandler is not affected by this rollout — the
        // "only-with-tests" guardrail is satisfied vacuously.
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
            GeneratePlanFromTemplateCommand>,
            GeneratePlanFromTemplateValidator>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
            GeneratePlanFromTemplateCommand>,
            GeneratePlanFromTemplateAuthorizer>();
        services.AddScoped<AgriSync.BuildingBlocks.Application.IHandler<
            GeneratePlanFromTemplateCommand,
            ShramSafal.Application.Contracts.Dtos.PlanGenerationResultDto>>(sp =>
            AgriSync.BuildingBlocks.Application.HandlerPipeline.Build(
                sp.GetRequiredService<GeneratePlanFromTemplateHandler>(),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                    GeneratePlanFromTemplateCommand,
                    ShramSafal.Application.Contracts.Dtos.PlanGenerationResultDto>(
                    sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<
                        AgriSync.BuildingBlocks.Application.PipelineBehaviors.LoggingBehavior<
                            GeneratePlanFromTemplateCommand,
                            ShramSafal.Application.Contracts.Dtos.PlanGenerationResultDto>>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.ValidationBehavior<
                    GeneratePlanFromTemplateCommand,
                    ShramSafal.Application.Contracts.Dtos.PlanGenerationResultDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IValidator<
                        GeneratePlanFromTemplateCommand>>()),
                new AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior<
                    GeneratePlanFromTemplateCommand,
                    ShramSafal.Application.Contracts.Dtos.PlanGenerationResultDto>(
                    sp.GetServices<AgriSync.BuildingBlocks.Application.PipelineBehaviors.IAuthorizationCheck<
                        GeneratePlanFromTemplateCommand>>())));

        return services;
    }
}
