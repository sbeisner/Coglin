import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Bookmark, BookmarkCheck } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { clearDraft, readDraft, useDocSync } from '@/lib/useDocSync';
import { toMarkdown } from '@/lib/docText';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { DocTree } from '@/components/notes/DocTree';
import { SaveIndicator } from '@/components/notes/SaveIndicator';
import type { NoteDocSummary } from '@/types';

/**
 * Notes: a tree of documents, some belonging to a meeting and some standing on
 * their own.
 *
 * One component serves /notes and /notes/:docId so the tree stays mounted across
 * document switches rather than refetching and re-collapsing on every navigation.
 */

/* TipTap plus @tiptap/pm is ~50-65KB gzipped, and the dashboard, board and roster
   paths have no business paying for it on shop wifi. */
const DocEditor = lazy(() =>
  import('@/components/notes/DocEditor').then((m) => ({ default: m.DocEditor })),
);

const ERROR_COPY: Record<string, string> = {
  cycle: 'A page cannot go inside itself.',
  too_deep: 'That would nest the pages too deeply.',
  too_many_docs: 'This season has as many documents as Coglin can hold.',
  content_too_large: 'That page is too long to save. Split it into two.',
  forbidden: 'Viewers can read notes but not change them.',
  no_current_season: 'Set up a season before taking notes.',
};

export default function Notes() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { member } = useSession();
  const canEdit = member.role !== 'viewer';

  const [reloadKey, setReloadKey] = useState(0);
  const tree = useAsync(() => api.listDocs(), [reloadKey]);
  const meetings = useAsync(() => api.listMeetings());
  const [error, setError] = useState<string | null>(null);

  /** Optimistic tree, so a drag lands before the round trip. */
  const [docs, setDocs] = useState<NoteDocSummary[]>([]);
  useEffect(() => {
    if (tree.data) setDocs(tree.data.docs);
  }, [tree.data]);

  const flagged = useMemo(
    () => new Set(tree.data?.flagged ?? []),
    [tree.data],
  );

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const onMove = useCallback(
    async (
      id: string,
      input: { parent_doc_id?: string | null; meeting_id?: string | null },
    ) => {
      const before = docs;
      // Applied locally first so the drag feels instant.
      setDocs((prev) =>
        prev.map((doc) => (doc.id === id ? { ...doc, ...input } : doc)),
      );
      setError(null);
      try {
        await api.moveDoc(id, input);
        reload();
      } catch (err) {
        /* Rolled back, unlike Boards, which admits in api.ts that it does not.
           A move that silently did not persist means a student cannot find their
           notes — and `cycle` and `too_deep` are 409s this will actually hit. */
        setDocs(before);
        setError(err instanceof Error ? err.message : '');
      }
    },
    [docs, reload],
  );

  const onCreate = useCallback(
    async (input: { parent_doc_id?: string; meeting_id?: string }) => {
      setError(null);
      try {
        const doc = await api.createDoc({ ...input, title: 'Untitled' });
        reload();
        navigate(`/app/notes/${doc.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      }
    },
    [navigate, reload],
  );

  /**
   * Rename opens the page and puts the caret in its title.
   *
   * Not a window.prompt: there is already exactly one rename affordance — the
   * inline title in the editor pane — and a second one would be a second thing to
   * keep working. A browser dialog is also miserable on a phone.
   */
  const onRename = useCallback(
    (doc: NoteDocSummary) => {
      navigate(`/app/notes/${doc.id}?rename=1`);
    },
    [navigate],
  );

  const onDelete = useCallback(
    async (doc: NoteDocSummary) => {
      setError(null);
      try {
        const result = await api.deleteDoc(doc.id);
        reload();
        if (docId && result.deleted.includes(docId)) navigate('/app/notes');
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      }
    },
    [docId, navigate, reload],
  );

  const sidebar = (
    <>
      {tree.status === 'loading' && <Skeleton className="h-64" />}
      {tree.status === 'error' && (
        <p role="alert" className="text-destructive px-2 text-sm">
          Could not load your notes. Reload the page.
        </p>
      )}
      {tree.status === 'ready' && docs.length === 0 ? (
        <EmptyState
          title="No notes yet."
          aside="A document can stand on its own or belong to a meeting. Everything you type is saved as you go."
          action={
            canEdit ? (
              <Button size="sm" onClick={() => void onCreate({})}>
                New document
              </Button>
            ) : undefined
          }
        />
      ) : (
        tree.status === 'ready' && (
          <DocTree
            docs={docs}
            meetings={meetings.data ?? []}
            flagged={flagged}
            activeDocId={docId ?? null}
            canEdit={canEdit}
            onMove={(id, input) => void onMove(id, input)}
            onCreate={(input) => void onCreate(input)}
            onRename={onRename}
            onDelete={(doc) => void onDelete(doc)}
          />
        )
      )}
      {error && (
        <p role="alert" className="text-destructive mt-3 px-2 text-sm">
          {ERROR_COPY[error] ?? 'That did not work. Try again.'}
        </p>
      )}
    </>
  );

  return (
    <>
      {/* On a phone this is one pane at a time: the tree at /notes, the editor at
          /notes/:docId with a back link. Deliberately not a Sheet — a sheet over an
          editor loses most of the viewport the moment the keyboard opens. */}
      <div className={docId ? 'hidden md:block' : ''}>
        <PageHeader title="Notes">
          {canEdit && docs.length > 0 && (
            <Button size="sm" onClick={() => void onCreate({})}>
              New document
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="md:flex md:items-start">
        <aside
          className={[
            'border-border px-4 py-4 md:w-72 md:shrink-0 md:border-r md:py-6',
            docId ? 'hidden md:block' : 'block',
          ].join(' ')}
        >
          {sidebar}
        </aside>

        <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
          {docId ? (
            <DocPane
              key={docId}
              docId={docId}
              canEdit={canEdit}
              flagged={flagged.has(docId)}
              onRenamed={reload}
              onFlagChanged={reload}
            />
          ) : (
            <p className="text-muted-foreground hidden text-sm md:block">
              Pick a document, or start a new one.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function DocPane({
  docId,
  canEdit,
  flagged,
  onRenamed,
  onFlagChanged,
}: {
  docId: string;
  canEdit: boolean;
  flagged: boolean;
  onRenamed: () => void;
  onFlagChanged: () => void;
}) {
  const doc = useAsync(() => api.getDoc(docId), [docId]);
  const [params, setParams] = useSearchParams();
  const { state, enqueue, flushNow, setBaseRev, keepMine, discardMine } = useDocSync(
    docId,
    canEdit,
  );
  const [title, setTitle] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const [draftOffer, setDraftOffer] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const editorApi = useRef<{ setContent: (content: string) => void } | null>(null);
  /** The body as the editor currently holds it, for Copy and for conflicts. */
  const latest = useRef<(() => string) | null>(null);

  /**
   * The fetch is the starting point, not a subscription.
   *
   * Same rule the block editor documented: anything else and a debounced save
   * fights the refetch it triggered. setContent is reserved for explicit user acts
   * — restoring a draft, or choosing the server's copy — because it also destroys
   * the caret and the undo history.
   */
  useEffect(() => {
    if (!doc.data) return;
    setTitle(doc.data.title);
    setBaseRev(doc.data.rev);
    const draft = readDraft(docId);
    if (draft && draft.savedAt > doc.data.updated_at * 1000) {
      setDraftOffer(draft.content);
    }
  }, [doc.data, docId, setBaseRev]);

  /** The tree's Rename lands here: open the page, select the title, drop the flag. */
  useEffect(() => {
    if (!doc.data || params.get('rename') !== '1') return;
    titleInput.current?.focus();
    titleInput.current?.select();
    const next = new URLSearchParams(params);
    next.delete('rename');
    setParams(next, { replace: true });
  }, [doc.data, params, setParams]);

  const onChange = useCallback(
    (getJSON: () => string, immediate?: boolean) => {
      latest.current = getJSON;
      enqueue(getJSON, immediate);
    },
    [enqueue],
  );

  const onToggleFlag = useCallback(async () => {
    if (!doc.data) return;
    // Flushed BEFORE the flag so the server has the document's current state to
    // attach to, and so a flag never lands on a page whose first save failed.
    flushNow();
    try {
      if (flagged) {
        await api.unflagCandidate('note_doc', docId);
      } else {
        await api.flagCandidate({ source_type: 'note_doc', source_id: docId });
      }
      onFlagChanged();
    } catch {
      // The tree reload below re-reads the truth either way.
      onFlagChanged();
    }
  }, [doc.data, docId, flagged, flushNow, onFlagChanged]);

  const saveTitle = useCallback(async () => {
    if (!doc.data || title.trim() === '' || title === doc.data.title) return;
    try {
      await api.renameDoc(docId, title.trim());
      onRenamed();
    } catch {
      setTitle(doc.data.title);
    }
  }, [doc.data, docId, onRenamed, title]);

  if (doc.status === 'loading') {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (doc.status === 'error' || !doc.data) {
    return (
      <EmptyState
        title="That document is not here."
        aside="It may have been deleted, or it belongs to another team."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/app/notes">Back to notes</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <Link
        to="/app/notes"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-sm md:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Notes
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* A column, not the first node of the document: inside the content a
            rename would be a content write (and a clobber risk), and the sidebar
            could not show a name without parsing JSON. */}
        <input
          ref={titleInput}
          value={title}
          aria-label="Page name"
          readOnly={!canEdit}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="u-display min-w-0 flex-1 bg-transparent text-2xl focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={flagged}
            aria-label={
              flagged
                ? 'Flagged for portfolio — tap to remove'
                : 'Flag this for the portfolio'
            }
            onClick={() => void onToggleFlag()}
            className="focus-visible:ring-ring text-muted-foreground flex size-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-9"
          >
            {flagged ? (
              <BookmarkCheck className="text-primary-ink size-4" aria-hidden />
            ) : (
              <Bookmark className="size-4" aria-hidden />
            )}
          </button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const content = latest.current?.() ?? doc.data.content;
              void navigator.clipboard.writeText(toMarkdown(content));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <SaveIndicator
        status={state.status}
        savedAt={state.savedAt}
        onRetry={flushNow}
        onKeepMine={() => {
          // Re-read the server's rev, then write over it. The person asked.
          void api.getDoc(docId).then((server) => keepMine(server.rev));
        }}
        onLoadTheirs={() => {
          void api.getDoc(docId).then((server) => {
            discardMine(server.rev);
            editorApi.current?.setContent(server.content);
          });
        }}
      />

      {draftOffer !== null && (
        <div
          role="alert"
          className="border-border bg-card flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>You have unsaved changes from last time.</span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => {
              editorApi.current?.setContent(draftOffer);
              enqueue(() => draftOffer, true);
              setDraftOffer(null);
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="text-muted-foreground underline underline-offset-2"
            onClick={() => {
              clearDraft(docId);
              setDraftOffer(null);
            }}
          >
            Discard
          </button>
        </div>
      )}

      <Suspense fallback={<Skeleton className="h-40" />}>
        <DocEditor
          docId={docId}
          initialContent={doc.data.content}
          editable={canEdit}
          onChange={onChange}
          onReady={(instance) => {
            editorApi.current = instance;
          }}
        />
      </Suspense>
    </div>
  );
}
