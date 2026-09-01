/**
 * Submit or edit a part order request.
 *
 * Any member except a viewer may submit — capturing "we need two more servos"
 * from the student in the pit is the point. Editing is only offered while the
 * order is pending; after a decision the row is what was decided on, and the
 * server enforces that with a 409 whatever this dialog renders.
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
import { Textarea } from '@/components/ui/textarea';
import type { PartOrder } from '@/types';

export type OrderDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; order: PartOrder }
  | null;

const ERROR_COPY: Record<string, string> = {
  missing_item: 'Say what the part is.',
  invalid_qty: 'Quantity is a whole number from 1 to 999.',
  invalid_price: 'Give a rough price — approvers cannot weigh a blank.',
  invalid_url: 'That link does not look like a web address.',
  invalid_state: 'This request was already decided. Reload the page.',
  no_current_season: 'This team has no current season yet, so a request has nowhere to live.',
  forbidden: 'You cannot edit this request.',
  not_found: 'That request is already gone. Reload the page.',
};

export function OrderDialog({
  state,
  onOpenChange,
  onChanged,
}: {
  state: OrderDialogState;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const editing = state?.mode === 'edit' ? state.order : null;

  const [item, setItem] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [vendor, setVendor] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entityKey = state === null ? 'closed' : (editing?.id ?? 'create');
  useEffect(() => {
    if (state === null) return;
    setError(null);
    setPending(false);
    setItem(editing?.item ?? '');
    setDescription(editing?.description ?? '');
    setUrl(editing?.url ?? '');
    setVendor(editing?.vendor ?? '');
    setQty(String(editing?.qty ?? 1));
    setPrice(editing ? (editing.unit_price_cents / 100).toFixed(2) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  const priceCents = parseDollars(price);
  const qtyNumber = /^\d+$/.test(qty.trim()) ? parseInt(qty.trim(), 10) : null;
  const valid =
    item.trim() !== '' &&
    priceCents !== null &&
    qtyNumber !== null &&
    qtyNumber >= 1 &&
    qtyNumber <= 999;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || priceCents === null || qtyNumber === null) return;
    setPending(true);
    setError(null);
    const payload = {
      item: item.trim(),
      description: description.trim() === '' ? null : description.trim(),
      url: url.trim() === '' ? null : url.trim(),
      vendor: vendor.trim() === '' ? null : vendor.trim(),
      qty: qtyNumber,
      unit_price_cents: priceCents,
    };
    try {
      if (editing) await api.updatePartOrder(editing.id, payload);
      else await api.createPartOrder(payload);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  const estimate =
    priceCents !== null && qtyNumber !== null ? priceCents * qtyNumber : null;

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit the request' : 'Request a part'}
            </DialogTitle>
            <DialogDescription>
              An approver decides on what you write here, so a link and a rough
              price get you a faster yes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="order-item">What is it?</Label>
              <Input
                id="order-item"
                value={item}
                maxLength={200}
                placeholder="goBILDA 5203 servo"
                onChange={(e) => setItem(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="order-qty">Quantity</Label>
                <Input
                  id="order-qty"
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="tabular font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-price">Price each</Label>
                <Input
                  id="order-price"
                  inputMode="decimal"
                  value={price}
                  placeholder="39.99"
                  onChange={(e) => setPrice(e.target.value)}
                  className="tabular font-mono"
                />
              </div>
            </div>
            {estimate !== null && (
              <p className="text-muted-foreground text-xs">
                Estimate:{' '}
                <span className="tabular font-mono">{formatCents(estimate)}</span>
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="order-url">Link</Label>
              <Input
                id="order-url"
                type="url"
                value={url}
                maxLength={500}
                placeholder="https://www.gobilda.com/…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="order-vendor">Vendor</Label>
              <Input
                id="order-vendor"
                value={vendor}
                maxLength={120}
                placeholder="goBILDA"
                onChange={(e) => setVendor(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="order-why">Why we need it</Label>
              <Textarea
                id="order-why"
                value={description}
                maxLength={1000}
                rows={2}
                placeholder="Optional — what broke, what it unblocks."
                onChange={(e) => setDescription(e.target.value)}
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
              {pending ? 'Saving…' : editing ? 'Save' : 'Submit request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
