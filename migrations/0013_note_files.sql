-- Attachments that are not photographs (COG feedback, Sep 2026).
--
-- Teams asked to put CAD files and PDFs in a meeting note, alongside the photos
-- that already work. The existing media pipeline cannot carry one: it sniffs
-- magic bytes, strips EXIF and reads dimensions, all of which are image
-- operations, and it stores nothing that would let a chip say what the file is.
--
-- Two columns close that gap. Both are nullable because every existing row
-- predates them, and both are backfilled below so the new serving code never
-- reads a NULL it would have to guess about.

-- The name the uploader gave, sanitised at ingest (worker/lib/files.ts).
--
-- Required for files, because a CAD file's identity IS its name — there is
-- nothing to render, so the chip shows the filename and nothing else. It cannot
-- be recovered from r2_key, which is a uuid plus an extension by design.
--
-- Deliberately NOT folded into `caption`. PATCH /api/media/:id lets any member
-- rewrite a caption, so overloading it would let somebody change a stored
-- download name to `invoice.html` after the fact, long past the ingest
-- sanitiser. A filename is provenance; a caption is commentary.
ALTER TABLE media ADD COLUMN filename TEXT;

-- The content type to serve, decided at ingest and owned by D1.
--
-- Until now the served type came from R2's httpMetadata, which was safe only
-- because sniff() guaranteed the type from the bytes and EXTENSIONS was 1:1
-- with it. For an extension-validated CAD file that guarantee does not exist,
-- and the serving route's own rule — "D1 first, always; R2 is never consulted
-- with a key the tenancy check has not already approved" — should extend to the
-- type as well as the key. The tenancy-checked row is the authority.
ALTER TABLE media ADD COLUMN content_type TEXT;

-- Backfill, so the column never lies about a row written before it existed.
-- Every historical r2_key ends in one of the five extensions EXTENSIONS could
-- produce (worker/lib/images.ts), so this is exhaustive rather than a guess.
UPDATE media
   SET content_type = CASE
     WHEN r2_key LIKE '%.jpg'  THEN 'image/jpeg'
     WHEN r2_key LIKE '%.png'  THEN 'image/png'
     WHEN r2_key LIKE '%.gif'  THEN 'image/gif'
     WHEN r2_key LIKE '%.webp' THEN 'image/webp'
     WHEN r2_key LIKE '%.pdf'  THEN 'application/pdf'
     ELSE 'application/octet-stream'
   END
 WHERE content_type IS NULL;

-- `kind` needs no DDL: it is plain TEXT with no CHECK (0001_init.sql), so it
-- gains 'file' as a TypeScript change in worker/routes/media.ts. The four places
-- that branch on kind were audited when this landed. Three were already correct
-- — the library list is a positive filter on 'photo', the roster-photo viewer
-- gate names its kind, the quota sums every kind and should. The fourth,
-- sourceExists in routes/candidates.ts, was a NEGATIVE filter (kind <> 
-- 'roster_photo') and would have made attachments silently flaggable as
-- portfolio evidence; it was rewritten to name the kinds it means.
