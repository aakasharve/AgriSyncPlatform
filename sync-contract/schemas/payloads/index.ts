// Barrel export for all 32 payload schemas. Imported by the frontend
// PayloadValidator and any future backend C# code-gen.
//
// PayloadValidator looks up schemas by `${descriptor.payloadSchema}Payload`
// against this barrel. The catalog (mutation-types.json) is the single
// source of truth for payloadSchema names, so for mutations whose
// historical filename / export differs from the catalog spelling
// (e.g. file `jobcard_create.zod.ts` exports `JobcardCreatePayload`,
// catalog calls it `JobCardCreate`) we add a catalog-spelled alias
// (`JobCardCreatePayload`) here so the validator's lookup succeeds.
// T-IGH-02-PAYLOADS hardened all 32 schemas; this barrel makes them
// reachable via the canonical catalog name as well as the file-named
// export.
export * from './_shared.zod';
export { CreateFarmPayload } from './create_farm.zod';
export { CreatePlotPayload } from './create_plot.zod';
export { CreateCropCyclePayload } from './create_crop_cycle.zod';
export { CreateDailyLogPayload } from './create_daily_log.zod';
export { AddLogTaskPayload } from './add_log_task.zod';
export { VerifyLogPayload } from './verify_log.zod';
export { VerifyLogV2Payload } from './verify_log_v2.zod';
export { AddCostEntryPayload } from './add_cost_entry.zod';
export { CorrectCostEntryPayload } from './correct_cost_entry.zod';
export { AllocateGlobalExpensePayload } from './allocate_global_expense.zod';
export { SetPriceConfigPayload } from './set_price_config.zod';
export { CreateAttachmentPayload } from './create_attachment.zod';
export { AddLocationPayload } from './add_location.zod';

// Schedule template payloads — file/export names use Schedule* prefix,
// catalog uses *Schedule suffix (PublishSchedule / EditSchedule /
// CloneSchedule). Re-export under both names.
export { SchedulePublishPayload } from './schedule_publish.zod';
export { SchedulePublishPayload as PublishSchedulePayload } from './schedule_publish.zod';
export { ScheduleEditPayload } from './schedule_edit.zod';
export { ScheduleEditPayload as EditSchedulePayload } from './schedule_edit.zod';
export { ScheduleClonePayload } from './schedule_clone.zod';
export { ScheduleClonePayload as CloneSchedulePayload } from './schedule_clone.zod';

// Planned-activity payloads — file/export names use Plan* prefix,
// catalog uses *Planned suffix (AddPlanned / OverridePlanned /
// RemovePlanned). Re-export under both names.
export { PlanAddPayload } from './plan_add.zod';
export { PlanAddPayload as AddPlannedPayload } from './plan_add.zod';
export { PlanOverridePayload } from './plan_override.zod';
export { PlanOverridePayload as OverridePlannedPayload } from './plan_override.zod';
export { PlanRemovePayload } from './plan_remove.zod';
export { PlanRemovePayload as RemovePlannedPayload } from './plan_remove.zod';

export { AdoptSchedulePayload } from './adopt_schedule.zod';
export { MigrateSchedulePayload } from './migrate_schedule.zod';
export { AbandonSchedulePayload } from './abandon_schedule.zod';
export { ComplianceAcknowledgePayload } from './compliance_acknowledge.zod';
export { ComplianceResolvePayload } from './compliance_resolve.zod';

// TestInstance — file uses lowercase `testinstance_*`, catalog uses
// PascalCase `TestInstance*`. Re-export under both names.
export { TestinstanceCollectedPayload } from './testinstance_collected.zod';
export { TestinstanceCollectedPayload as TestInstanceCollectedPayload } from './testinstance_collected.zod';
export { TestinstanceReportedPayload } from './testinstance_reported.zod';
export { TestinstanceReportedPayload as TestInstanceReportedPayload } from './testinstance_reported.zod';

// JobCard — file uses lowercase `jobcard_*`, catalog uses PascalCase
// `JobCard*`. Re-export under both names.
export { JobcardCreatePayload } from './jobcard_create.zod';
export { JobcardCreatePayload as JobCardCreatePayload } from './jobcard_create.zod';
export { JobcardAssignPayload } from './jobcard_assign.zod';
export { JobcardAssignPayload as JobCardAssignPayload } from './jobcard_assign.zod';
export { JobcardStartPayload } from './jobcard_start.zod';
export { JobcardStartPayload as JobCardStartPayload } from './jobcard_start.zod';
export { JobcardCompletePayload } from './jobcard_complete.zod';
export { JobcardCompletePayload as JobCardCompletePayload } from './jobcard_complete.zod';
export { JobcardSettlePayload } from './jobcard_settle.zod';
export { JobcardSettlePayload as JobCardSettlePayload } from './jobcard_settle.zod';
export { JobcardCancelPayload } from './jobcard_cancel.zod';
export { JobcardCancelPayload as JobCardCancelPayload } from './jobcard_cancel.zod';
