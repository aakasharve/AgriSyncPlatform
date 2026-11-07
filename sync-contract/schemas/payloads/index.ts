// Barrel export for all 34 payload schemas. Imported by the frontend
// PayloadValidator and any future backend C# code-gen.
//
// All 32 are concrete Zod objects after T-IGH-02-PAYLOADS. Wired
// mutations (24) mirror the backend's *MutationPayload records or the
// matching domain Command. Three schedule mutations (adopt / migrate /
// abandon) mirror their domain Commands while the server handler still
// returns MUTATION_TYPE_UNIMPLEMENTED. Seven truly-speculative
// mutations (schedule.publish / .edit / .clone, plan.add / .override /
// .remove, add_location) use a `.passthrough()` shape so the contract
// is no longer z.unknown but doesn't lock down a future field list.
export * from './_shared.zod';
export { CreateFarmPayload } from './create_farm.zod';
export { CreatePlotPayload } from './create_plot.zod';
export { CreateCropCyclePayload } from './create_crop_cycle.zod';
export { CreateDailyLogPayload } from './create_daily_log.zod';
export { AddLogTaskPayload } from './add_log_task.zod';
// lane F1 — an edit to what Sathi understood (crop work, water, inputs, notes, …).
export { ReviseLogContentPayload } from './revise_log_content.zod';
// lane OF-S — move a saved entry's place / day, and a queued worker-count correction.
export { MoveDailyLogPayload } from './move_daily_log.zod';
export { SetRecordAudiencePayload } from './set_record_audience.zod';
// lane RATE-1 part A (founder D-72) — one change to one rate of a farm's own price and rate list.
export { SetFarmRatePayload } from './set_farm_rate.zod';
// lane BILL-1 (founder D-12) — a reviewer's मंजूर stamp on one bill: who (the sender), when (the server), which version.
export { ApproveCostEntryPayload } from './approve_cost_entry.zod';
export { CorrectLabourAssignmentPayload } from './correct_labour_assignment.zod';
export {
    LogContentSchema,
    LOG_CONTENT_BUCKETS,
    LOG_CONTENT_MAX_BYTES,
    LOG_CONTENT_SCHEMA_VERSION,
} from './_log_content.zod';
export { VerifyLogPayload } from './verify_log.zod';
export { VerifyLogV2Payload } from './verify_log_v2.zod';
export { AddCostEntryPayload, CostCategoryIdEnum } from './add_cost_entry.zod';
export { CorrectCostEntryPayload } from './correct_cost_entry.zod';
export { AllocateGlobalExpensePayload } from './allocate_global_expense.zod';
export { SetPriceConfigPayload } from './set_price_config.zod';
export { CreateAttachmentPayload } from './create_attachment.zod';
export { AddLocationPayload } from './add_location.zod';
export { PublishSchedulePayload } from './schedule_publish.zod';
export { EditSchedulePayload } from './schedule_edit.zod';
export { CloneSchedulePayload } from './schedule_clone.zod';
export { AddPlannedPayload } from './plan_add.zod';
export { OverridePlannedPayload } from './plan_override.zod';
export { RemovePlannedPayload } from './plan_remove.zod';
export { AdoptSchedulePayload } from './adopt_schedule.zod';
export { MigrateSchedulePayload } from './migrate_schedule.zod';
export { AbandonSchedulePayload } from './abandon_schedule.zod';
export { ComplianceAcknowledgePayload } from './compliance_acknowledge.zod';
export { ComplianceResolvePayload } from './compliance_resolve.zod';
export { TestInstanceCollectedPayload } from './testinstance_collected.zod';
export { TestInstanceReportedPayload } from './testinstance_reported.zod';
export { JobCardCreatePayload } from './jobcard_create.zod';
export { JobCardAssignPayload } from './jobcard_assign.zod';
export { JobCardStartPayload } from './jobcard_start.zod';
export { JobCardCompletePayload } from './jobcard_complete.zod';
export { JobCardSettlePayload } from './jobcard_settle.zod';
export { JobCardCancelPayload } from './jobcard_cancel.zod';
// Labour V2 R1 Task 3.5a — attendance.mark. The parity gate resolves
// '<payloadSchema>Payload' against this barrel and fails OPEN on a miss
// (PayloadValidator.ts), so the export name must stay exactly
// 'AttendanceMarkPayload'.
export * from './attendance_mark.zod';
