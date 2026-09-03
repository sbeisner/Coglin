/**
 * Who gets the team's updates.
 *
 * An opt-in list of adult business and community contacts — the same category
 * as a prospect's contact details, never a student's. Somebody who opts out
 * stays on the list marked as opted out, which is what stops the one-click
 * sponsor import from quietly putting them back.
 */
import { useCallback, useState } from 'react';
import { Check, Download, Plus, Trash2, X } from 'lucide-react';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { isSubscribed, type ExternalContact } from '@/types';

const ERROR_COPY: Record<string, string> = {
  missing_email: 'An address is the one thing a contact needs.',
  invalid_email: 'That does not look like an email address.',
  duplicate_email: 'That address is already on the list.',
  no_current_season: 'This team has no current season yet.',
  forbidden: 'Viewers cannot change the contact list.',
  not_found: 'That contact is already gone.',
};

export function ContactsSection({
  contacts,
  canEdit,
  onChanged,
}: {
  contacts: ExternalContact[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setPending(true);
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      } finally {
        setPending(false);
      }
    },
    [onChanged],
  );

  const subscribed = contacts.filter(isSubscribed);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          <span className="tabular font-mono">{subscribed.length}</span> of{' '}
          <span className="tabular font-mono">{contacts.length}</span> will receive
          updates.
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {/* One click, idempotent, and it never re-adds somebody who left. */}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  const result = await api.importSponsorContacts();
                  setImported(
                    result.imported === 0
                      ? 'Everyone with an address is already on the list.'
                      : `Added ${result.imported} sponsor ${result.imported === 1 ? 'contact' : 'contacts'}.`,
                  );
                })
              }
            >
              <Download className="size-4" aria-hidden />
              Import from sponsors
            </Button>
            {!adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                Add a contact
              </Button>
            )}
          </div>
        )}
      </div>

      {imported && <p className="text-muted-foreground text-xs">{imported}</p>}

      {adding && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={org}
            maxLength={200}
            placeholder="Harbor Machine Works"
            aria-label="Business or person"
            onChange={(e) => setOrg(e.target.value)}
            className="min-h-11 min-w-40 flex-1 md:min-h-9"
          />
          <Input
            value={email}
            type="email"
            maxLength={200}
            placeholder="dana@example.com"
            aria-label="Email address"
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 min-w-48 flex-1 md:min-h-9"
          />
          <Button
            size="sm"
            disabled={pending || email.trim() === ''}
            onClick={() =>
              void act(async () => {
                await api.createContact({
                  email: email.trim(),
                  org_name: org.trim() === '' ? null : org.trim(),
                });
                setOrg('');
                setEmail('');
                setAdding(false);
              })
            }
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      {contacts.length === 0 ? (
        <EmptyState
          title="Nobody on the update list yet."
          aside="Import the sponsors who gave you an address, or add a community contact by hand. Nothing is ever mailed to somebody who is not on this list."
        />
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {contacts.map((contact) => {
            const on = isSubscribed(contact);
            return (
              <li key={contact.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {contact.org_name ?? contact.contact_name ?? contact.email}
                    </span>
                    {contact.sponsor_id !== null && (
                      <span className="text-muted-foreground shrink-0 text-[10px]">
                        sponsor
                      </span>
                    )}
                    {!on && (
                      <span className="text-muted-foreground border-border shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]">
                        not subscribed
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {contact.contact_name && contact.org_name
                      ? `${contact.contact_name} · `
                      : ''}
                    {contact.email}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={
                        on
                          ? `Stop sending updates to ${contact.email}`
                          : `Send updates to ${contact.email}`
                      }
                      title={on ? 'Subscribed' : 'Not subscribed'}
                      disabled={pending}
                      onClick={() =>
                        void act(() => api.setContactSubscribed(contact.id, !on))
                      }
                      className={cn(
                        'focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7',
                        on
                          ? 'border-primary bg-primary/10 text-primary-ink border'
                          : 'text-muted-foreground hover:text-primary-ink',
                      )}
                    >
                      {on ? (
                        <Check className="size-4" aria-hidden />
                      ) : (
                        <X className="size-4" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${contact.email}`}
                      disabled={pending}
                      onClick={() => void act(() => api.deleteContact(contact.id))}
                      className="focus-visible:ring-ring text-muted-foreground hover:text-destructive flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
