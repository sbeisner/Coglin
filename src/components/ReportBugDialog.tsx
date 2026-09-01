/**
 * Report a bug from anywhere in the app (COG-0xx, alpha).
 *
 * The diagnostics block is not a nicety. This dialog attaches the reporter's
 * route, build, browser and window size, and a product used by 12-18 year olds
 * does not get to attach anything to an outgoing message without showing what
 * it is. That promise is only meaningful while the list stays short enough to
 * read, which is the real reason there is no screenshot here — see the header
 * of migrations/0008_bug_reports.sql.
 *
 * Open state is owned by AppShell rather than by this component, because the
 * button that opens it lives in SidebarFoot, which renders twice.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import * as api from '@/lib/api';
import {
  collectDiagnostics,
  diagnosticLines,
  type Diagnostics,
} from '@/lib/diagnostics';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Kind = 'bug' | 'confusing' | 'idea';

/**
 * Alpha testers will file feature requests through a bug button no matter what
 * the label says. Naming the third option costs one line and saves sorting
 * them out of the bug pile later.
 */
const KINDS: { id: Kind; label: string }[] = [
  { id: 'bug', label: "Something's broken" },
  { id: 'confusing', label: "Something's confusing" },
  { id: 'idea', label: 'I have an idea' },
];

export function ReportBugDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { pathname, search } = useLocation();
  const [kind, setKind] = useState<Kind>('bug');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.BugReportResult | null>(null);

  // Snapshot on open, not on submit: what is listed below has to be what goes
  // out, and the route can change under a dialog that is left open.
  useEffect(() => {
    if (open) setDiag(collectDiagnostics(`${pathname}${search}`));
  }, [open, pathname, search]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      setResult(
        await api.submitBugReport({
          body: String(data.get('body') ?? ''),
          kind,
          ...(diag ?? {}),
        }),
      );
    } catch (err) {
      // Codes cross the api boundary, sentences are written here.
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'too_many_bug_reports'
          ? "That's a lot of reports in one hour. The ones you already sent went through — give it a little while before sending more."
          : code === 'missing_description'
            ? 'Tell us what happened first.'
            : 'Could not send the report. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setResult(null);
          setError(null);
          setKind('bug');
        }
      }}
    >
      {/* The tallest dialog in the app, and the one most likely to be opened on
          a phone held sideways in a pit. The shared DialogContent has no height
          bound, so without this the Send button ends up off-screen with no way
          to reach it. Scoped here rather than in the primitive: every other
          dialog is short enough not to need it. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {result ? (
          <Sent result={result} onDone={() => onOpenChange(false)} />
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Report a bug</DialogTitle>
              <DialogDescription>
                Goes straight to the person who builds Coglin. Rough notes are
                fine — it's more useful sent than polished.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="bug_kind">What kind of thing is this?</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                  <SelectTrigger id="bug_kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="body">What happened?</Label>
                <Textarea
                  id="body"
                  name="body"
                  required
                  rows={5}
                  maxLength={4000}
                  placeholder="What you were doing, what you expected, and what happened instead."
                />
              </div>

              {diag && (
                <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs font-medium">
                    Sent with your report
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {diagnosticLines(diag).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground text-[11px]">
                          {label}
                        </dt>
                        <dd
                          className="truncate font-mono text-[11px]"
                          title={value}
                        >
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-muted-foreground text-[11px]">
                    No screenshot, and nothing from the page you were on.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="text-destructive mb-4 text-sm">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Sending…' : 'Send report'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Honest about a failed send, the same way InviteDialog's Sent view is. The
 * report is filed either way — what changes is whether anyone has been told
 * about it yet, and the reporter is the only one who can route around that.
 */
function Sent({
  result,
  onDone,
}: {
  result: api.BugReportResult;
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{result.sent ? 'Report sent' : 'Report saved'}</DialogTitle>
        <DialogDescription>
          {result.sent
            ? "Thanks — it landed. Nothing else to do."
            : "It's saved, but the notification email didn't go out. If it's blocking you, mention it in the alpha channel."}
        </DialogDescription>
      </DialogHeader>

      <p className="text-muted-foreground py-4 font-mono text-xs">
        Report {result.id.slice(0, 8)}
      </p>

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
