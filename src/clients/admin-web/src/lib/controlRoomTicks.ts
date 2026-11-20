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
  company_numbers: {
    label: 'Company numbers',
    description: 'The company pages: sign-ups, activity, retention, quality and operations.',
  },
  server_health: {
    label: 'Server health',
    description: 'Live Health and the counts on App Versions.',
  },
  api_errors: {
    label: 'API errors',
    description: 'The list of requests that failed or ran slow.',
  },
  all_farms: {
    label: 'All farms',
    description: 'Every farm with its owner, and the farm names shown on other pages.',
  },
  farms_to_call: {
    label: 'Farms that need a call',
    description: 'Silent Churn and Suffering: the farms to phone today.',
  },
  farmer_health: {
    label: 'Farmer health',
    description: 'How each farmer is doing, farm by farm.',
  },
  schedules: {
    label: 'Schedules',
    description: 'ShramSafal’s schedule templates and the schedule check.',
  },
  users: {
    label: 'Users',
    description: 'The list of people who use the app.',
  },
  farmer_phones: {
    label: 'Farmers’ phone numbers',
    description: 'See farmers’ phone numbers. Without this tick a number reads "Hidden for you".',
  },
  downloads: {
    label: 'Downloads',
    description: 'Download or print the day sheet of farms to visit.',
  },
  give_visits: {
    label: 'Give field visits',
    description: 'Give a farm visit to a field operator.',
  },
  my_visits: {
    label: 'My field visits',
    description: 'See the visits given to you and mark each one done.',
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
  admin: { label: 'Admin', blurb: 'The company pages, the farms and users, and the farm-visit tools.' },
  field_operator: { label: 'Field operator', blurb: 'Their own farm visits, with the phone numbers and downloads they need.' },
  viewer: { label: 'Viewer', blurb: 'The company numbers and server health, to read.' },
};

/** The three roles a person can be given. The founder is never selectable. */
export const SELECTABLE_ROLES = ['admin', 'field_operator', 'viewer'] as const;

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'No role';
  return ROLE_WORDS[role]?.label ?? role;
}
