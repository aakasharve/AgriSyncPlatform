import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

// spec: trusted-control-room-2026-11-20 (CR-3, Task A7). Built against the shapes Task A5 pins:
// the routes under `/shramsafal/admin/people` answer the founder only (403 `control_room.founder_only`).

/** One row of "who has access". The founder row has no `personId`, all ticks and no actions. */
export interface Person {
  personId: string | null;
  isFounder: boolean;
  displayName: string;
  phone: string;
  startingRole: string;
  ticks: string[];
  boundAccountName: string | null;
  lastSignedInUtc: string | null;
  keptAtUtc: string | null;
}

/** A tick the server knows. `isPersonalData` is what the console marks orange. */
export interface TickInfo {
  key: string;
  isPersonalData: boolean;
}

export interface PeopleAnswer {
  people: Person[];
  ticks: TickInfo[];
  /** Starting role key -> the tick keys it pre-fills. */
  presets: Record<string, string[]>;
}

export interface HistoryLine {
  atUtc: string;
  action: string;
  actorName: string;
  subjectName: string | null;
  details: Record<string, string | null>;
}

/** A count is a number or the reason it is not measured (P4). Never both, never a made-up zero. */
export interface MisValue {
  value: number | null;
  notMeasuredReason: string | null;
}

export interface TrustReport {
  countedAtUtc: string;
  peopleWithAccess: number;
  peopleByRole: Record<string, number>;
  phoneLooks: MisValue;
  phoneFarms: MisValue;
  phoneLookers: MisValue;
  downloads: MisValue;
  downloadFarmRows: MisValue;
  downloaders: MisValue;
  notSignedIn30Days: Person[];
  notSignedInNotMeasuredReason: string | null;
  refusedAtDoor: MisValue;
}

export interface AddPersonBody {
  displayName: string;
  phone: string;
  startingRole: string;
  ticks: string[];
}

export interface ChangePersonBody {
  displayName: string;
  startingRole: string;
  ticks: string[];
}

export interface HistoryAnswer {
  lines: HistoryLine[];
  /** True when the server's read hit its limit: the page says "Showing the newest N". */
  hitLimit: boolean;
}

const ROOT = '/shramsafal/admin/people';

/** The server's error code in an answer (`control_room.phone_invalid`, ...), or null. */
export function controlRoomErrorCode(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  const body = err.response?.data as { code?: unknown; error?: unknown } | undefined;
  if (typeof body?.code === 'string') return body.code;
  if (typeof body?.error === 'string') return body.error;
  return null;
}

/** The plain sentence for a refusal of add / change / remove / keep. Never a code, never a status. */
export function peopleErrorText(err: unknown): string {
  switch (controlRoomErrorCode(err)) {
    case 'control_room.phone_invalid':
      return 'That phone number does not look right. Enter a 10-digit mobile number.';
    case 'control_room.already_listed':
      return 'This number is already on the list.';
    case 'control_room.already_founder':
      return 'This number belongs to the founder. It cannot be added.';
    case 'control_room.role_not_allowed':
      return 'Choose Admin, Field operator or Viewer.';
    case 'control_room.tick_unknown':
      return 'One of the parts you ticked is not known to the server. Reload the page and try again.';
    case 'control_room.founder_only':
      return 'People and access is for the founder only.';
    default:
      return 'That could not be saved. Please try again in a little while.';
  }
}

export function usePeople() {
  const org = useOrgKey();
  return useQuery<PeopleAnswer>({
    queryKey: ['people', 'list', org],
    queryFn: async () => {
      const { data } = await adminApi.get<PeopleAnswer>(ROOT);
      if (!data || !Array.isArray(data.people) || !Array.isArray(data.ticks) || !data.presets) {
        throw new Error('people: the answer is not in the expected shape');
      }
      return data;
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useTrustReport() {
  const org = useOrgKey();
  return useQuery<TrustReport>({
    queryKey: ['people', 'trust-report', org],
    queryFn: async () => {
      const { data } = await adminApi.get<TrustReport>(`${ROOT}/trust-report`);
      if (!data || typeof data !== 'object') throw new Error('trust-report: no answer');
      return data;
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useHistory(days: number, action: string | null) {
  const org = useOrgKey();
  return useQuery<HistoryAnswer>({
    queryKey: ['people', 'history', org, days, action ?? 'all'],
    queryFn: async () => {
      // The query is written into the address (not `params`) so the request reads as it is sent.
      const query = `days=${days}${action ? `&action=${encodeURIComponent(action)}` : ''}`;
      const { data } = await adminApi.get<unknown>(`${ROOT}/history?${query}`);
      return readHistory(data);
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * The History answer is read from either shape: a bare list of lines, or an object holding the
 * lines (as `lines` or `items`) and whether the server's read hit its limit. A5 pins the line, not
 * the wrapper, so both are accepted; anything else is a failed load, never an empty list.
 */
export function readHistory(data: unknown): HistoryAnswer {
  if (Array.isArray(data)) return { lines: data as HistoryLine[], hitLimit: false };
  const obj = data as { lines?: unknown; items?: unknown; hitLimit?: unknown } | null | undefined;
  const lines = Array.isArray(obj?.lines) ? obj.lines : Array.isArray(obj?.items) ? obj.items : null;
  if (!lines) throw new Error('history: the answer is not in the expected shape');
  return { lines: lines as HistoryLine[], hitLimit: obj?.hitLimit === true };
}

/** Add, change, remove and keep. Each refreshes the list and the report that counts them. */
export function usePeopleActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['people'] });

  const add = useMutation({
    mutationFn: async (body: AddPersonBody) => (await adminApi.post(ROOT, body)).data,
    onSuccess: refresh,
  });
  const change = useMutation({
    mutationFn: async ({ personId, body }: { personId: string; body: ChangePersonBody }) =>
      (await adminApi.put(`${ROOT}/${personId}`, body)).data,
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (personId: string) => (await adminApi.post(`${ROOT}/${personId}/remove`, {})).data,
    onSuccess: refresh,
  });
  const keep = useMutation({
    mutationFn: async (personId: string) => (await adminApi.post(`${ROOT}/${personId}/keep`, {})).data,
    onSuccess: refresh,
  });
  return { add, change, remove, keep };
}
