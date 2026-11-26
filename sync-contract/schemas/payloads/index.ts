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
// lane IT2 (founder D-92 / D-95) — his हो / नाही / फोटो answer about one product of one saved record.
export { AssertInputIdentityPayload } from './assert_input_identity.zod';
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
// lane SCH-OWN (founder D-74, D-82 = 3) - "start blank": make the farm's own schedule, empty, for a crop the farm grows.
export { CreateSchedulePayload } from './schedule_create.zod';
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
// spec: plr-d10 lane L8c-1 (founder D-24c) - planned work and reminders. The parity gate resolves '<payloadSchema>Payload'
// against this barrel, so the names stay exactly PlannedWork{Create,Edit,Seen,Accept,Cancel}Payload.
export { PlannedWorkCreatePayload } from './plannedwork_create.zod';
export { PlannedWorkEditPayload } from './plannedwork_edit.zod';
export { PlannedWorkSeenPayload } from './plannedwork_seen.zod';
export { PlannedWorkAcceptPayload } from './plannedwork_accept.zod';
export { PlannedWorkCancelPayload } from './plannedwork_cancel.zod';
// lane L8c-3 (founder D-24d): the work done through the real log, and the owner's reopen.
export { PlannedWorkCompletePayload } from './plannedwork_complete.zod';
export { PlannedWorkReopenPayload } from './plannedwork_reopen.zod';
// lane CMP-D3 (founder D-68 round 2): a reason kept on an existing record of work (logreason.set).
export { LogReasonSetPayload } from './logreason_set.zod';
// slice 3 (schedule mechanism): a farmer's own schedule built one work at a time, and "make main" (ownschedule.*).
export { OwnScheduleItemSavePayload } from './ownschedule_item_save.zod';
export { OwnScheduleItemRemovePayload } from './ownschedule_item_remove.zod';
export { OwnScheduleMakeMainPayload } from './ownschedule_make_main.zod';
// slice 5 (schedule mechanism): an own work feeds planning (ownschedule.item.plan) and an answer about a work's sign (schedule.task_event).
export { OwnScheduleItemPlanPayload } from './ownschedule_item_plan.zod';
// slice 9 (schedule mechanism): one tap takes a work of a followed schedule into the farmer's own schedule, origin kept (schedule.take_task).
export { ScheduleTakeTaskPayload } from './schedule_take_task.zod';
// slice 11 (schedule mechanism): at season end the own schedule becomes next season's, asking once (ownschedule.carry_forward).
export { OwnScheduleCarryForwardPayload } from './ownschedule_carry_forward.zod';
export { ScheduleTaskEventPayload } from './schedule_task_event.zod';
// slice 12b (schedule mechanism): the schedule owner's voice - heard, the farmer's decision on a change, his answer to a look message.
export { ScheduleOwnerMessageHeardPayload } from './schedule_owner_message_heard.zod';
export { ScheduleOwnerMessageDecidePayload } from './schedule_owner_message_decide.zod';
export { ScheduleOwnerMessageAnswerPayload } from './schedule_owner_message_answer.zod';
// repair D-9 (27 Nov): the farm's setup on the server, per farm - water sources with their motors, power times, machines, each plot's water.
export { FarmsetupWaterSourceSavePayload } from './farmsetup_water_source_save.zod';
export { FarmsetupWaterSourceRemovePayload } from './farmsetup_water_source_remove.zod';
export { FarmsetupPowerTimesSetPayload } from './farmsetup_power_times_set.zod';
export { FarmsetupMachineSavePayload } from './farmsetup_machine_save.zod';
export { FarmsetupMachineRemovePayload } from './farmsetup_machine_remove.zod';
export { FarmsetupPlotWaterSetPayload } from './farmsetup_plot_water_set.zod';
// repair D-177 (27 Nov): the farm's own-bill approval switch, primary owner only, off by default.
export { FarmOwnBillApprovalSetPayload } from './farm_own_bill_approval_set.zod';
// Labour V2 R1 Task 3.5a — attendance.mark. The parity gate resolves
// '<payloadSchema>Payload' against this barrel and fails OPEN on a miss
// (PayloadValidator.ts), so the export name must stay exactly
// 'AttendanceMarkPayload'.
export * from './attendance_mark.zod';
