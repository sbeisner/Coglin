/**
 * The files attached to a ledger line, plus the way to add one.
 *
 * Images render as thumbnails and PDFs as a labelled chip — both open the real
 * file at /media/:id in a new tab, where the browser's own viewer does the
 * work. Upload goes through prepareReceiptAndUpload, which is the one client
 * path that may hand the server a PDF.
 */
import { useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import * as api from '@/lib/api';
import { prepareReceiptAndUpload, UnsupportedImage } from '@/lib/upload';
import type { Receipt } from '@/types';

const ERROR_COPY: Record<string, string> = {
  file_too_large: 'That file is over the 10 MB limit.',
  unsupported_media_type: 'Receipts can be a photo (JPEG, PNG) or a PDF.',
  quota_exceeded: 'This season has used all its file storage. A coach can clear space.',
  not_found: 'That ledger line is gone. Reload the page.',
  forbidden: 'Only coaches and mentors can attach receipts.',
};

export function ReceiptChips({
  transactionId,
  receipts,
  canManage,
  onChanged,
}: {
  transactionId: string;
  receipts: Receipt[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setProgress(0);
    try {
      await prepareReceiptAndUpload(file, transactionId, setProgress);
      onChanged();
    } catch (err) {
      if (err instanceof UnsupportedImage) setError(err.message);
      else if (err instanceof Error) setError(ERROR_COPY[err.message] ?? err.message);
      else setError('That file could not be uploaded.');
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(receipt: Receipt) {
    setError(null);
    try {
      await api.deleteReceipt(transactionId, receipt.id);
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? (ERROR_COPY[err.message] ?? 'Could not remove that receipt.')
          : 'Could not remove that receipt.',
      );
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {receipts.map((receipt) => (
          <span key={receipt.id} className="group relative inline-flex">
            <a
              href={`/media/${receipt.id}`}
              target="_blank"
              rel="noreferrer"
              className="focus-visible:ring-ring border-border hover:bg-accent flex items-center gap-1.5 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
            >
              {receipt.is_pdf === 1 ? (
                <span className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <FileText className="size-4" aria-hidden />
                  PDF receipt
                </span>
              ) : (
                <img
                  src={`/media/${receipt.id}`}
                  alt="Receipt"
                  loading="lazy"
                  className="h-11 w-16 object-cover md:h-9"
                />
              )}
            </a>
            {canManage && (
              <button
                type="button"
                aria-label="Remove receipt"
                onClick={() => void remove(receipt)}
                className="bg-background border-border text-muted-foreground hover:text-destructive absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}

        {canManage && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              disabled={progress !== null}
              onClick={() => fileInput.current?.click()}
              className="focus-visible:ring-ring border-border text-muted-foreground hover:bg-accent flex min-h-11 items-center gap-1.5 rounded-md border border-dashed px-2.5 text-xs focus-visible:ring-2 focus-visible:outline-none md:min-h-9"
            >
              <Paperclip className="size-4" aria-hidden />
              {progress !== null
                ? `Uploading ${Math.round(progress * 100)}%`
                : 'Attach receipt'}
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
