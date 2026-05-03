/**
 * Mirror of ShramSafal.Domain.Organizations.ModuleKey (C#).
 *
 * Every admin endpoint gates on one of these keys server-side via
 * AdminScopeHelper.RequireReadAsync. This TS file is the client-side
 * single source of truth — use ModuleKeys.X when calling EntitlementGuard
 * or checking scope.canRead(X).
 *
 * MUST STAY IN SYNC with src/apps/ShramSafal/ShramSafal.Domain/Organizations/ModuleKey.cs.
 * A future CI gate (W0-B T-W0B-04 "module-key-drift-guard") will fail the
 * build if the two diverge.
 */
export const ModuleKeys = {
  AdminSelf: 'admin.self',
  AdminOrgsRead: 'admin.orgs.read',
  AdminOrgsWrite: 'admin.orgs.write',
  AdminUsers: 'admin.users',

  OpsLive: 'ops.live',
  OpsErrors: 'ops.errors',
  OpsVoice: 'ops.voice',
  OpsAlerts: 'ops.alerts',

  MetricsNsm: 'metrics.nsm',
  MetricsRetention: 'metrics.retention',
  MetricsFunnel: 'metrics.funnel',
  MetricsEngagement: 'metrics.engagement',

  FarmsList: 'farms.list',
  FarmsDetail: 'farms.detail',
  FarmsSilentChurn: 'farms.silent-churn',
  FarmsSuffering: 'farms.suffering',

  CeiW1Deviation: 'cei.w1.deviation',
  CeiW1DeviationReasons: 'cei.w1.deviation.reasons',
  CeiW1Lineage: 'cei.w1.lineage',
  CeiW1Authorship: 'cei.w1.authorship',
  CeiW1Attention: 'cei.w1.attention',
  CeiW1Overrides: 'cei.w1.overrides',

  CeiW2Tests: 'cei.w2.tests',
  CeiW2Recommendations: 'cei.w2.recommendations',
  CeiW2Roles: 'cei.w2.roles',
  CeiW2Lab: 'cei.w2.lab',

  CeiW3Compliance: 'cei.w3.compliance',
  CeiW3ServiceProof: 'cei.w3.service-proof',

  CeiW4Jobs: 'cei.w4.jobs',
  CeiW4Workers: 'cei.w4.workers',
  CeiW4Labour: 'cei.w4.labour',

  OrgSettings: 'org.settings',
  OrgMembers: 'org.members',
  OrgFarmScope: 'org.farm-scope',

  // DWC v2 §3.6 / §3.7 — Daily Work Closure farmer-health module.
  // Mode A = per-farmer drilldown; Mode B = cohort patterns. Same
  // module key gates both endpoints; the redactor matrix differentiates
  // FarmerHealth-specific column-level policy (PII fields, sync/AI ops
  // sub-blocks gated by ops:read claim).
  FarmerHealth: 'farmer.health',
} as const;

export type ModuleKey = (typeof ModuleKeys)[keyof typeof ModuleKeys];
