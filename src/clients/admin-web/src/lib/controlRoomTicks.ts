/**
 * LABELS FOR THE CONTROL ROOM'S TICKS (CR-3, D-155).
 *
 * The server owns WHICH ticks exist, WHICH are personal data and WHAT each starting role pre-fills:
 * `GET /shramsafal/admin/people` answers all three (`ticks`, `isPersonalData`, `presets`), and the
 * People screen renders from that answer. This file only holds the words: a plain label and a
 * one-line description per tick key, and the names of the four starting roles. A key the server
 * sends that has no words here is shown by its key (never dropped), so a newer server cannot hide
 * a tick from the founder.
 */

export interface TickWords {
  label: string;
  description: string;
}

export const TICK_WORDS: Readonly<Record<string, TickWords>> = {
  company_numbers: { label: 'Company numbers', description: 'The seven Company MIS pages and WVFD' },
  server_health: { label: 'Server health', description: 'Live health and app versions' },
  api_errors: { label: 'API errors', description: 'The list of server errors' },
  all_farms: { label: 'All farms', description: 'The farm list' },
  farms_to_call: { label: 'Farms that need a call', description: 'Silent churn and suffering' },
  farmer_health: { label: 'Farmer health', description: "And each farm's own page" },
  schedules: { label: 'Schedules', description: 'Templates and the schedule check' },
  users: { label: 'Users', description: 'The list of app users' },
  farmer_phones: {
    label: "Farmers' phone numbers",
    description: "Lets them see and call farmers' numbers. Off until you tick it. Each look is recorded.",
  },
  downloads: {
    label: 'Downloads',
    description:
      "Download the day sheet. Every sheet carries the downloader's name and the time, and every download is written in History.",
  },
  give_visits: { label: 'Give visits to operators', description: 'Give farms to a field operator as visits.' },
  my_visits: {
    label: 'My visits',
    description: 'Only their own visits: the place, a call button, the day sheet, and Done.',
  },
};

/**
 * K20: field visits arrive about 5-8 Dec (Release 1b). Until then these three ticks can be given
 * but do nothing yet, and every place that shows one says so.
 */
export const VISIT_TICKS: ReadonlySet<string> = new Set(['give_visits', 'my_visits', 'downloads']);
export const VISITS_LATER_NOTE = 'Works when field visits arrive (about 5-8 Dec)';

/** The trust report's download block (K20): never a zero, because nothing is counted yet. */
export const DOWNLOADS_START_NOTE = 'Downloads start with field visits';

export function tickLabel(key: string): string {
  return TICK_WORDS[key]?.label ?? key;
}

export function tickDescription(key: string): string {
  return TICK_WORDS[key]?.description ?? '';
}

export const ROLE_WORDS: Readonly<Record<string, { label: string; blurb: string }>> = {
  founder: { label: 'Founder', blurb: 'Everything. Set up on the server, never in this screen.' },
  admin: {
    label: 'Admin',
    blurb:
      "Every page, giving visits to operators, farmers' phone numbers, download lists. Runs the room. Not People and access.",
  },
  field_operator: {
    label: 'Field operator',
    blurb:
      'Their own visits only, calling those farmers, downloading their own day sheet, marking visits done. No company numbers.',
  },
  viewer: { label: 'Viewer', blurb: 'Company numbers and server health. No phone numbers, no downloads.' },
};

/** The three roles a person can be given. The founder is never selectable. */
export const SELECTABLE_ROLES = ['admin', 'field_operator', 'viewer'] as const;

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'No role';
  return ROLE_WORDS[role]?.label ?? role;
}
