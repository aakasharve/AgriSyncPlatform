// Day log → the state of each node around the "मला किती समजलं" ring. Pure (no React, no I/O).
//
// told    = the farmer said it today (an item exists in the day's log)
// missed  = there is EVIDENCE it applied today but it was not told (e.g. a spray was planned, nothing about inputs)
// neutral = nothing says it applied → grey, never red. Doctrine: never charge the farmer for work that was not done.
//
// The rolling number is NOT computed here – it is always the server's Day Understanding Score (useDayUnderstanding).
// These states only decide which orbs light up, which show ✗ and what the reward card invites him to add.
//
// The types below are structural subsets of the app's DailyLog (domain/types/log.types.ts), so the app's own
// DailyLog[] can be passed straight in without this file importing from the app.
import type { CategoryId, NodeState } from './categories';

interface Verifiable { provenanceVerified?: boolean }
interface WithIssue extends Verifiable { issue?: unknown }
export interface IrrigationLike extends WithIssue {
  id?: string; role?: 'spray-carrier' | 'irrigation' | 'fertigation';
  durationHours?: number; waterVolumeLitres?: number; method?: string; source?: string; sourceText?: string;
}
export interface LabourLike extends WithIssue { type?: 'HIRED' | 'CONTRACT' | 'SELF'; totalCost?: number; wagePerPerson?: number; rate?: number }
export interface ObservationLike extends Verifiable { noteType?: 'observation' | 'issue' | 'tip' | 'reminder' | 'unknown' }
export interface PlannedTaskLike extends Verifiable { status?: string }
export interface DayLogLike {
  date: string;
  deletion?: unknown;
  cropActivities?: WithIssue[];
  irrigation?: IrrigationLike[];
  labour?: LabourLike[];
  inputs?: (WithIssue & { cost?: number })[];
  machinery?: (WithIssue & { rentalCost?: number; fuelCost?: number })[];
  activityExpenses?: Verifiable[];
  observations?: ObservationLike[];
  plannedTasks?: PlannedTaskLike[];
  disturbance?: { blockedSegments?: readonly string[] } | null;
  manualTotalCost?: number;
}

/** The app's scheduler buckets (shared/utils/dayState.ts OperationCategory). */
export type PlannedCategory = 'IRRIGATION' | 'FERTIGATION' | 'FOLIAR_SPRAY' | 'ACTIVITY';

export interface CoverageExtras {
  /** Attendance marked for the day counts as labour told. getLocalAttendanceMarks(farmId) is async – resolve it in an
   *  effect and pass the boolean (see README). */
  attendanceMarkedToday?: boolean;
  /** What the schedule planned for the day (derivePlannedItemsForDay → bucket category). Evidence for "missed". */
  plannedCategories?: ReadonlySet<PlannedCategory>;
  /** Pass the app's isCompletedIrrigationEvent (core/domain/services/IrrigationCompletionService.ts). Method syntax on
   *  purpose: it accepts the app's (event: IrrigationEvent) => boolean under strictFunctionTypes. */
  isCompletedIrrigation?(event: IrrigationLike): boolean;
  /** Categories worth inviting on any day with work, even without other evidence. Default: पीक निरीक्षण + आठवणीत
   *  ठेवायची कामे – a working day always has a crop to look at and a tomorrow to plan. Pass [] to invite nothing. */
  inviteOnWorkDay?: readonly CategoryId[];
}

const DEFAULT_INVITES: readonly CategoryId[] = ['cropNote', 'reminders'];

/** Anti-fabrication: items the backend could not verify against the voice transcript do not count (undefined = verified). */
const ok = <T extends Verifiable>(xs?: T[] | null): T[] => (xs ?? []).filter((x) => x.provenanceVerified !== false);

/** Fallback when the app's predicate is not passed: water actually delivered, not an issue-only row. */
const deliveredWater = (e: IrrigationLike): boolean =>
  (e.durationHours ?? 0) > 0 || (e.waterVolumeLitres ?? 0) > 0 || (!e.issue && Boolean(e.method || e.source || e.sourceText));

export function dayCategoryStates(dayLogs: readonly DayLogLike[], date: string | undefined, x: CoverageExtras = {}): Partial<Record<CategoryId, NodeState>> {
  if (!date) return {};
  const logs = dayLogs.filter((l) => l.date === date && !l.deletion);
  const crop = ok(logs.flatMap((l) => l.cropActivities ?? []));
  const lab = ok(logs.flatMap((l) => l.labour ?? []));
  const inp = ok(logs.flatMap((l) => l.inputs ?? []));
  const isDone = x.isCompletedIrrigation ?? deliveredWater;
  const water = ok(logs.flatMap((l) => l.irrigation ?? []));
  const irr = water.filter((e) => e.role !== 'spray-carrier' && isDone(e));
  const waterIssue = water.filter((e) => e.role !== 'spray-carrier' && !isDone(e));   // tried, but no water went out
  const sprayWater = water.some((e) => e.role === 'spray-carrier');   // water for a spray tank → a spray happened
  const mach = ok(logs.flatMap((l) => l.machinery ?? []));
  const exp = ok(logs.flatMap((l) => l.activityExpenses ?? []));
  const obs = ok(logs.flatMap((l) => l.observations ?? []));
  const tasks = ok(logs.flatMap((l) => l.plannedTasks ?? [])).filter((t) => t.status !== 'cancelled');

  const planned = x.plannedCategories ?? new Set<PlannedCategory>();
  const invites = new Set(x.inviteOnWorkDay ?? DEFAULT_INVITES);
  const workDay = crop.length + inp.length + irr.length + mach.length + lab.length > 0 || sprayWater;
  const paidHelp = lab.some((e) => e.type === 'HIRED' || e.type === 'CONTRACT');
  // work that was stopped (a disturbance, or an item told with its problem) is never marked missed
  const blocked = new Set<string>(logs.flatMap((l) => l.disturbance?.blockedSegments ?? []));
  if (waterIssue.length || water.some((e) => e.issue)) blocked.add('irrigation');
  if (crop.some((e) => e.issue)) blocked.add('crop_activity');
  if (inp.some((e) => e.issue)) blocked.add('input');
  if (lab.some((e) => e.issue)) blocked.add('labour');

  const told = {
    work: crop.length > 0,
    labour: lab.length > 0 || Boolean(x.attendanceMarkedToday),
    inputs: inp.length > 0,
    water: irr.length > 0,
    machinery: mach.length > 0,
    cropNote: obs.some((o) => o.noteType === 'observation'),
    expenses: exp.length > 0 || (logs.some((l) => (l.manualTotalCost ?? 0) > 0))
      || lab.some((e) => e.totalCost || e.wagePerPerson || e.rate) || inp.some((e) => e.cost) || mach.some((e) => e.rentalCost || e.fuelCost),
    observations: obs.some((o) => o.noteType === 'tip' || o.noteType === 'unknown'),
    reminders: tasks.length > 0 || obs.some((o) => o.noteType === 'reminder'),
    blockers: logs.some((l) => l.disturbance) || obs.some((o) => o.noteType === 'issue') || waterIssue.length > 0
      || [...crop, ...water, ...inp, ...mach, ...lab].some((e) => e.issue),
  } satisfies Record<CategoryId, boolean>;

  // Evidence that a category applied today although nothing was told about it.
  const applies: Record<CategoryId, boolean> = {
    work: (planned.has('ACTIVITY') || lab.length > 0 || mach.length > 0) && !blocked.has('crop_activity'),
    labour: crop.length > 0 && !blocked.has('labour'),
    inputs: (planned.has('FOLIAR_SPRAY') || planned.has('FERTIGATION') || sprayWater) && !blocked.has('input'),
    water: (planned.has('IRRIGATION') || planned.has('FERTIGATION')) && !blocked.has('irrigation'),
    machinery: false,                       // a tractor is never implied by anything else in the log
    cropNote: false,
    expenses: paidHelp,                     // hired / contract help was told, but not what it cost
    observations: false,
    reminders: false,
    blockers: false,                        // अडथळे / अडचणी: shown only when told, never "missed"
  };

  const states: Partial<Record<CategoryId, NodeState>> = {};
  for (const id of Object.keys(told) as CategoryId[]) {
    if (id === 'blockers') { if (told.blockers) states.blockers = 'told'; continue; }
    const invited = workDay && invites.has(id);
    states[id] = told[id] ? 'told' : applies[id] || invited ? 'missed' : 'neutral';
  }
  return states;
}
