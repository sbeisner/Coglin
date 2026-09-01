/**
 * Add or edit a business the team means to approach.
 *
 * The contact fields are the point of the form: a pipeline that cannot answer
 * "who do we call" is a list of logos. They hold an adult business contact,
 * deliberately stored — see migrations/0010_sponsorship.sql for why that is a
 * different category from the student emails this app refuses to keep.
 */
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '@/lib/api';
import { formatCents, parseDollars } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SponsorProspect, SponsorshipTier } from '@/types';

export type ProspectDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; prospect: SponsorProspect }
  | null;

/** The sentinel the tier Select uses for "no tier", since '' is not a value. */
const NO_TIER = 'none';

const ERROR_COPY: Record<string, string> = {
  missing_org_name: 'Say which business this is.',
  invalid_email: 'That does not look like an email address.',
  invalid_url: 'That does not look like a web address.',
  invalid_amount: 'Enter an amount over $0.',
  invalid_tier: 'That tier belongs to another campaign. Reload the page.',
  already_committed: 'This one is already a sponsor, so it cannot be edited here.',
  forbidden: 'Viewers cannot edit the pipeline.',
  not_found: 'That prospect is already gone. Reload the page.',
};

export function ProspectDialog({
  state,
  campaignId,
  tiers,
  onOpenChange,
  onChanged,
}: {
  state: ProspectDialogState;
  campaignId: string;
  tiers: SponsorshipTier[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const editing = state?.mode === 'edit' ? state.prospect : null;

  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [tierId, setTierId] = useState<string>(NO_TIER);
  const [pledged, setPledged] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entityKey = state === null ? 'closed' : (editing?.id ?? 'create');
  useEffect(() => {
    if (state === null) return;
    setError(null);
    setPending(false);
    setOrgName(editing?.org_name ?? '');
    setContactName(editing?.contact_name ?? '');
    setContactEmail(editing?.contact_email ?? '');
    setContactPhone(editing?.contact_phone ?? '');
    setUrl(editing?.url ?? '');
    setNote(editing?.note ?? '');
    setTierId(editing?.tier_id ?? NO_TIER);
    setPledged(
      editing?.pledged_cents != null ? (editing.pledged_cents / 100).toFixed(2) : '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  const pledgedCents = pledged.trim() === '' ? null : parseDollars(pledged);
  const pledgedValid = pledged.trim() === '' || pledgedCents !== null;
  const valid = orgName.trim() !== '' && pledgedValid;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    const payload = {
      org_name: orgName.trim(),
      contact_name: contactName.trim() === '' ? null : contactName.trim(),
      contact_email: contactEmail.trim() === '' ? null : contactEmail.trim(),
      contact_phone: contactPhone.trim() === '' ? null : contactPhone.trim(),
      url: url.trim() === '' ? null : url.trim(),
      note: note.trim() === '' ? null : note.trim(),
      tier_id: tierId === NO_TIER ? null : tierId,
      pledged_cents: pledgedCents,
    };
    try {
      if (editing) await api.updateProspect(editing.id, payload);
      else await api.createProspect(campaignId, payload);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit prospect' : 'Add a business to approach'}
            </DialogTitle>
            <DialogDescription>
              Who they are and who to call. Everything except the name is
              optional — add what you know now.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="prospect-org">Business</Label>
              <Input
                id="prospect-org"
                value={orgName}
                maxLength={200}
                placeholder="Harbor Machine Works"
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prospect-contact">Contact name</Label>
                <Input
                  id="prospect-contact"
                  value={contactName}
                  maxLength={120}
                  placeholder="Dana Reyes"
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prospect-phone">Phone</Label>
                <Input
                  id="prospect-phone"
                  value={contactPhone}
                  maxLength={40}
                  inputMode="tel"
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prospect-email">Email</Label>
              <Input
                id="prospect-email"
                value={contactEmail}
                maxLength={200}
                type="email"
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prospect-url">Website</Label>
              <Input
                id="prospect-url"
                value={url}
                maxLength={500}
                type="url"
                placeholder="https://…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prospect-tier">Tier they might take</Label>
                <Select value={tierId} onValueChange={setTierId}>
                  <SelectTrigger id="prospect-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TIER}>No tier yet</SelectItem>
                    {tiers.map((tier) => (
                      <SelectItem key={tier.id} value={tier.id}>
                        {tier.name} · {formatCents(tier.amount_cents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prospect-pledged">Likely amount</Label>
                <Input
                  id="prospect-pledged"
                  value={pledged}
                  inputMode="decimal"
                  placeholder="Optional"
                  onChange={(e) => setPledged(e.target.value)}
                  className="tabular font-mono"
                />
                {!pledgedValid && (
                  <p className="text-destructive text-xs">
                    Dollars and cents, like 750.00.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prospect-note">Notes</Label>
              <Textarea
                id="prospect-note"
                value={note}
                maxLength={1000}
                rows={2}
                placeholder="Who introduced you, what they asked for, when to follow up."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? 'Saving…' : editing ? 'Save' : 'Add prospect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
