import { useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  peopleErrorText,
  usePeopleActions,
  type PeopleAnswer,
  type Person,
} from '@/hooks/useControlRoomPeople';
import {
  ROLE_WORDS,
  SELECTABLE_ROLES,
  VISIT_TICKS,
  VISITS_LATER_NOTE,
  roleLabel,
  tickDescription,
  tickLabel,
} from '@/lib/controlRoomTicks';

/** The pinned note (D-155) shown wherever an orange tick can be ticked. */
export const PERSONAL_DATA_NOTE =
  "Orange ticks are actions with farmers' personal data. Each use of them is written in History with the person's name and the time.";

const FIELD_CLASS =
  'glass-quiet w-full rounded-chip border-control-edge px-4 py-3 text-body font-medium text-text-1 transition-colors focus:border-brand';

/** The tick keys of a role's preset, in the order the server lists the ticks. */
function presetFor(answer: PeopleAnswer, role: string): string[] {
  const keys = new Set(answer.presets[role] ?? []);
  return answer.ticks.map((t) => t.key).filter((k) => keys.has(k));
}

/**
 * ADD A PERSON, OR CHANGE ONE (CR-3, D-155).
 *
 * A starting role only PRE-FILLS the ticks; every tick stays editable, and nothing is sent until
 * "Give access" (or "Save changes"). The ticks, which of them are personal data and what each role
 * pre-fills all come from the server's answer (`answer`), so this screen cannot drift from the
 * server's own list. Personal-data ticks are orange and say so. The founder is never a choice.
 */
export function PersonPanel({
  mode,
  person,
  answer,
  onClose,
}: {
  mode: 'add' | 'edit';
  person?: Person;
  answer: PeopleAnswer;
  onClose: () => void;
}) {
  const { add, change } = usePeopleActions();
  const [name, setName] = useState(person?.displayName ?? '');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string | null>(person?.startingRole ?? null);
  const [ticks, setTicks] = useState<Set<string>>(new Set(person?.ticks ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasPersonalData = answer.ticks.some((t) => t.isPersonalData);

  function pickRole(next: string) {
    setRole(next);
    // Pre-fill only: what is ticked can still be changed one by one before anything is saved.
    setTicks(new Set(presetFor(answer, next)));
  }

  function toggle(key: string) {
    setTicks((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const orderedTicks = answer.ticks.map((t) => t.key).filter((k) => ticks.has(k));
  const ready = name.trim() !== '' && role !== null && (mode === 'edit' || phone.trim() !== '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || saving || role === null) return;
    setError(null);
    setSaving(true);
    try {
      if (mode === 'add') {
        await add.mutateAsync({
          displayName: name.trim(),
          phone: phone.trim(),
          startingRole: role,
          ticks: orderedTicks,
        });
      } else if (person?.personId) {
        await change.mutateAsync({
          personId: person.personId,
          body: { displayName: name.trim(), startingRole: role, ticks: orderedTicks },
        });
      }
      onClose();
    } catch (err) {
      setError(peopleErrorText(err));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={mode === 'add' ? 'Add a person' : `Change ${person?.displayName ?? 'a person'}`}
      className="glass-panel flex flex-col gap-5 rounded-panel p-6"
    >
      <h2 className="text-h2 font-bold text-text-1">
        {mode === 'add' ? 'Add a person' : `Change ${person?.displayName ?? ''}`}
      </h2>

      <label className="block">
        <span className="mb-2 block text-caption font-semibold text-text-1">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className={FIELD_CLASS}
        />
      </label>

      {mode === 'add' ? (
        <div>
          <label className="block">
            <span className="mb-2 block text-caption font-semibold text-text-1">Phone number</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10 digits"
              className={FIELD_CLASS}
            />
          </label>
          <p className="mt-1 text-caption text-text-2">
            Nothing is texted when you add someone. They sign in with a code sent to this number.
          </p>
        </div>
      ) : (
        <p className="text-body text-text-2">
          Phone number: <span className="font-semibold tabular-nums text-text-1">{person?.phone}</span>. To
          change a number, remove the person and add them again.
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption font-semibold text-text-1">Starting role</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SELECTABLE_ROLES.map((r) => {
            const preset = presetFor(answer, r);
            const visitsLater = preset.some((k) => VISIT_TICKS.has(k));
            return (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                data-role={r}
                onClick={() => pickRole(r)}
                className={`rounded-panel border p-3 text-left transition-colors ${
                  role === r
                    ? 'border-brand bg-brand-wash'
                    : 'glass-quiet border-control-edge hover:bg-wash'
                }`}
              >
                <span className="block text-body font-bold text-text-1">{ROLE_WORDS[r].label}</span>
                <span className="mt-0.5 block text-caption text-text-2">{ROLE_WORDS[r].blurb}</span>
                <span className="mt-1 block text-caption text-text-2">
                  {preset.length > 0 ? preset.map(tickLabel).join(', ') : 'No parts ticked'}
                </span>
                {visitsLater && (
                  <span data-visits-later="true" className="mt-1 block text-caption font-semibold text-text-1">
                    {VISITS_LATER_NOTE}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-caption text-text-2">
          A role only ticks the boxes below to start with. You can change any of them.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption font-semibold text-text-1">Parts this person can open</legend>
        {hasPersonalData && (
          <p className="rounded-chip bg-tint-amber px-3 py-2 text-caption text-text-1">
            {PERSONAL_DATA_NOTE}
          </p>
        )}
        {answer.ticks.map((t) => {
          const id = `tick-${t.key}`;
          return (
            <label
              key={t.key}
              htmlFor={id}
              data-tick={t.key}
              data-personal-data={t.isPersonalData ? 'true' : undefined}
              className={`flex cursor-pointer items-start gap-3 rounded-chip border px-3 py-2 ${
                t.isPersonalData ? 'border-amber bg-tint-amber' : 'border-control-edge'
              }`}
            >
              <input
                id={id}
                type="checkbox"
                checked={ticks.has(t.key)}
                onChange={() => toggle(t.key)}
                className="mt-1 size-4 flex-none"
              />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-text-1">{tickLabel(t.key)}</span>
                <span className="block text-caption text-text-2">{tickDescription(t.key)}</span>
                {VISIT_TICKS.has(t.key) && (
                  <span data-visits-later="true" className="block text-caption font-semibold text-text-1">
                    {VISITS_LATER_NOTE}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-chip bg-tint-red px-4 py-3 text-body font-medium text-text-1"
        >
          <TriangleAlert size={18} className="mt-0.5 flex-none text-red" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!ready || saving}>
          {saving ? 'Saving…' : mode === 'add' ? 'Give access' : 'Save changes'}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        {mode === 'edit' && person && (
          <span className="text-caption text-text-2">Role now: {roleLabel(person.startingRole)}</span>
        )}
      </div>
    </form>
  );
}
