import { SUB_TEAMS, type SubTeam } from '@/types';

/**
 * The sub-team chips, in one place.
 *
 * Lifted out of InviteDialog when the roster gained the ability to change
 * sub-teams after somebody has joined. Two copies of a seven-chip toggle would
 * have drifted the first time a sub-team was added, and the pair of them is
 * precisely where a drift shows up as "the invite offers Drive but the roster
 * does not".
 */
export function SubTeamPicker({
  value,
  disabled,
  onChange,
  legend = 'Sub-teams',
}: {
  value: string[];
  disabled?: boolean;
  onChange: (next: SubTeam[]) => void;
  legend?: string;
}) {
  function toggle(id: SubTeam) {
    onChange(
      value.includes(id)
        ? (value.filter((x) => x !== id) as SubTeam[])
        : ([...value, id] as SubTeam[]),
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {SUB_TEAMS.map((st) => {
          const on = value.includes(st.id);
          return (
            <button
              key={st.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(st.id)}
              className={
                on
                  ? 'bg-primary text-primary-foreground rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50'
                  : 'bg-muted text-muted-foreground hover:bg-accent rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50'
              }
            >
              {st.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
