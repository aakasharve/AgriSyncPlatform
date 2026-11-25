// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// What the pull sends about the owner of a schedule speaking: `ownerMessages` (a tip, a change or a look, each with its clip), `ownerClips` (the clips' METADATA only) and
// `ownerMessageStates` (what this farm's plot did: heard, accepted, kept old, taken back, answered). Each row is read strictly: a row this build cannot read is skipped and
// counted, never stored half. The three lists are replaced IN FULL on every pull that carries them.

export type OwnerMessageKind = 'tip' | 'change' | 'look';
export type OwnerStateKind = 'heard' | 'accepted' | 'kept_old' | 'taken_back' | 'answered';
export type OwnerDecision = 'accept' | 'keep_old' | 'take_back';
export type OwnerAnswer = 'first' | 'second';

export interface OwnerMessage {
    id: string;
    chainId: string;
    /** The version the work is in: the "before" of a change is this version's work with `taskKey`. */
    scheduleVersionId: string;
    taskKey: string;
    kind: OwnerMessageKind;
    clipId: string;
    /** A change only: the CHECKED version whose work with `taskKey` is the "now". */
    newVersionId: string | null;
    answerFirst: string | null;
    answerSecond: string | null;
    followUpFirstClipId: string | null;
    followUpSecondClipId: string | null;
    sentAtUtc: string;
}

export interface OwnerClipMeta {
    id: string;
    chainId: string;
    mimeType: string;
    sizeBytes: number;
    durationMs: number;
    contentHash: string;
    createdAtUtc: string;
}

export interface OwnerMessageState {
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string | null;
    messageId: string;
    kind: OwnerStateKind;
    sequence: number;
    answer: OwnerAnswer | null;
    itemId: string | null;
    itemCreated: boolean;
    jobId: string | null;
    byUserId: string;
    atUtc: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const optText = (v: unknown): string | null => (v === null || v === undefined ? null : text(v));
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) ? v : null);

export function parseOwnerMessage(input: unknown): OwnerMessage | null {
    if (!isObj(input)) return null;
    const id = text(input.id), chainId = text(input.chainId), scheduleVersionId = text(input.scheduleVersionId), taskKey = text(input.taskKey);
    const clipId = text(input.clipId), sentAtUtc = text(input.sentAtUtc);
    const kind = input.kind;
    if (!id || !chainId || !scheduleVersionId || !taskKey || !clipId || !sentAtUtc) return null;
    if (kind !== 'tip' && kind !== 'change' && kind !== 'look') return null;
    const newVersionId = optText(input.newVersionId);
    // A change names the version of its "now"; a look names both answers in words. A message without them cannot be drawn honestly.
    if (kind === 'change' && !newVersionId) return null;
    const answerFirst = optText(input.answerFirst), answerSecond = optText(input.answerSecond);
    if (kind === 'look' && (!answerFirst || !answerSecond)) return null;
    return {
        id, chainId, scheduleVersionId, taskKey, kind, clipId, newVersionId: kind === 'change' ? newVersionId : null,
        answerFirst: kind === 'look' ? answerFirst : null, answerSecond: kind === 'look' ? answerSecond : null,
        followUpFirstClipId: kind === 'look' ? optText(input.followUpFirstClipId) : null,
        followUpSecondClipId: kind === 'look' ? optText(input.followUpSecondClipId) : null,
        sentAtUtc,
    };
}

export function parseOwnerClip(input: unknown): OwnerClipMeta | null {
    if (!isObj(input)) return null;
    const id = text(input.id), chainId = text(input.chainId), mimeType = text(input.mimeType), contentHash = text(input.contentHash), createdAtUtc = text(input.createdAtUtc);
    const sizeBytes = whole(input.sizeBytes), durationMs = whole(input.durationMs);
    if (!id || !chainId || !mimeType || !contentHash || !createdAtUtc || sizeBytes === null || durationMs === null) return null;
    return { id, chainId, mimeType, sizeBytes, durationMs, contentHash, createdAtUtc };
}

const STATE_KINDS: readonly string[] = ['heard', 'accepted', 'kept_old', 'taken_back', 'answered'];

export function parseOwnerState(input: unknown): OwnerMessageState | null {
    if (!isObj(input)) return null;
    const id = text(input.id), farmId = text(input.farmId), plotId = text(input.plotId), messageId = text(input.messageId), byUserId = text(input.byUserId), atUtc = text(input.atUtc);
    const sequence = whole(input.sequence);
    if (!id || !farmId || !plotId || !messageId || !byUserId || !atUtc || sequence === null) return null;
    if (typeof input.kind !== 'string' || !STATE_KINDS.includes(input.kind)) return null;
    const answer = input.answer === 'first' || input.answer === 'second' ? input.answer : null;
    if (input.kind === 'answered' && !answer) return null;
    return {
        id, farmId, plotId, cropCycleId: optText(input.cropCycleId), messageId, kind: input.kind as OwnerStateKind, sequence, answer,
        itemId: optText(input.itemId), itemCreated: input.itemCreated === true, jobId: optText(input.jobId), byUserId, atUtc,
    };
}

/** The plot the owner's voice is read for, and what this seat may do with it. `mayDecide` is the take's own rule (own-schedule gate AND PlanWork): the server decides every request. */
export interface OwnerVoiceHost {
    farmId: string;
    plotId: string;
    cropCycleId: string | null;
    mayDecide: boolean;
}

/** One act waiting in the outbox (or being sent) for a message. */
export interface QueuedOwnerAct {
    kind: 'heard' | 'decide' | 'answer';
    plotId: string;
    messageId: string;
    decision: OwnerDecision | null;
    answer: OwnerAnswer | null;
}

/** Everything the screens read, as this phone holds it. */
export interface OwnerVoiceView {
    messages: readonly OwnerMessage[];
    clips: ReadonlyMap<string, OwnerClipMeta>;
    states: readonly OwnerMessageState[];
    /** Clip ids whose bytes (of the CURRENT content hash) are kept on this phone. */
    keptClips: ReadonlySet<string>;
    queued: readonly QueuedOwnerAct[];
}

export const EMPTY_OWNER_VIEW: OwnerVoiceView = { messages: [], clips: new Map(), states: [], keptClips: new Set(), queued: [] };
