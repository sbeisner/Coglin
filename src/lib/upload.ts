/**
 * Getting a photo from a phone into R2.
 *
 * Two things happen before the bytes leave the device, and both matter more
 * than they look:
 *
 *   1. The image is downscaled on a canvas. A portfolio page prints around
 *      1500px wide, so a 4032px phone photo is four times the pixels anyone
 *      will ever see — and on shop wifi that is the difference between a
 *      four-second upload and a twenty-five-second one.
 *   2. The re-encode drops EXIF as a side effect. The server strips it again
 *      anyway (never trust the client with a promise about a child's location),
 *      but doing it here means the coordinates never cross the network at all.
 */

export interface UploadedMedia {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

/** Longest edge after downscale. Comfortably above what a portfolio page uses. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

export class UnsupportedImage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImage';
  }
}

/**
 * Decode, downscale, re-encode.
 *
 * `createImageBitmap` is what fails on an iPhone HEIC in Chrome, and that
 * failure is the one worth reporting plainly: the file looks like a photo to
 * the student, no browser can decode it, and silently uploading it would store
 * something that renders as a broken image forever.
 */
export async function downscaleForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UnsupportedImage(
      file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')
        ? 'iPhone HEIC photos cannot be read here. In Settings → Camera → Formats, choose "Most Compatible", or share the photo as a JPEG.'
        : 'That file could not be read as an image.',
    );
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new UnsupportedImage('This browser cannot process images.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // PNG is kept for screenshots, where re-encoding to JPEG turns crisp text
  // into mush. Everything else becomes JPEG, which is what a camera produced
  // anyway.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, JPEG_QUALITY),
  );
  if (!blob) throw new UnsupportedImage('That image could not be prepared for upload.');
  return blob;
}

const ERROR_COPY: Record<string, string> = {
  photo_consent_required:
    'Record that the signed consent form is on file before adding a photo.',
  file_too_large: 'That photo is too large, even after shrinking it.',
  unsupported_media_type: 'That is not an image Coglin can store. Try a JPEG or PNG.',
  quota_exceeded: 'This season has used all its photo storage. A coach can clear space.',
  no_current_season: 'This team has no current season yet.',
  forbidden: 'You do not have permission to add photos.',
};

/**
 * The same codes, answered for an attachment rather than a photo.
 *
 * A separate map because several of them mean something different here:
 * file_too_large has a different limit and no "after shrinking it" to mention,
 * and the unsupported case has to name formats rather than JPEG and PNG.
 */
const FILE_ERROR_COPY: Record<string, string> = {
  file_too_large: 'That file is over the 25 MB limit.',
  unsupported_file_type:
    'Coglin can hold PDFs and CAD files — .pdf, .step, .stl, .f3d, .sldprt, .dwg and similar.',
  image_not_a_file:
    'That is a photo with a CAD file’s name. Use “Add a photo” for pictures.',
  filename_required: 'That file has no name Coglin could read.',
  filename_invalid: 'That file has no name Coglin could read.',
  quota_exceeded: 'This season has used all its storage. A coach can clear space.',
  no_current_season: 'This team has no current season yet.',
  forbidden: 'You do not have permission to add files.',
};

/**
 * Upload, reporting progress.
 *
 * The only XMLHttpRequest in the codebase, and the reason is that `fetch` has
 * no upload progress. A six-megabyte photo on pit wifi takes ten to thirty
 * seconds, and an indeterminate spinner that long is indistinguishable from a
 * hang — so the student retries, and now there are two photos.
 */
export function uploadImage(
  file: File | Blob,
  onProgress?: (fraction: number) => void,
  /**
   * Roster photos post to a different endpoint — one that carries the consent
   * check — but must go through exactly this preparation, or one of the two
   * upload paths becomes the one that forgot to strip EXIF.
   */
  url = '/api/media',
  /**
   * Attachments send their name here, because the body is raw bytes and there
   * is no form field to put it in. Percent-encoded by the caller: headers are
   * latin-1, and `Motörhalterung_v2.step` throws in setRequestHeader untouched.
   */
  options?: { filename?: string; copy?: Record<string, string>; fallback?: string },
): Promise<UploadedMedia> {
  const copy = options?.copy ?? ERROR_COPY;
  const fallback = options?.fallback ?? 'That photo could not be uploaded.';
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.withCredentials = true;
    // The server ignores this entirely for attachments and decides the stored
    // type from the bytes and the extension (worker/lib/files.ts). Do not
    // "fix" the server to trust it.
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (options?.filename) {
      request.setRequestHeader('X-Filename', encodeURIComponent(options.filename));
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as UploadedMedia);
        return;
      }
      let code = `upload_failed_${request.status}`;
      try {
        code = (JSON.parse(request.responseText) as { error?: string }).error ?? code;
      } catch {
        // A non-JSON body means something upstream failed; the status is enough.
      }
      reject(new Error(copy[code] ?? fallback));
    };

    request.onerror = () =>
      reject(new Error('The connection dropped during the upload.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));

    request.send(file);
  });
}

/** Downscale then upload, which is what every entry point actually wants. */
export async function prepareAndUpload(
  file: File,
  onProgress?: (fraction: number) => void,
  url?: string,
): Promise<UploadedMedia> {
  const blob = await downscaleForUpload(file);
  return uploadImage(blob, onProgress, url);
}

/** Server-side cap, mirrored so a PDF can be refused before it uploads. */
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * Receipts accept PDFs, which the canvas pipeline cannot touch —
 * `createImageBitmap` throws on one. A PDF is passed through unchanged (the
 * server has nothing to strip from it — see sniffReceipt in worker/lib/images)
 * and only images take the downscale path.
 */
export async function prepareReceiptAndUpload(
  file: File,
  transactionId: string,
  onProgress?: (fraction: number) => void,
): Promise<UploadedMedia> {
  const url = `/api/finance/transactions/${transactionId}/receipts`;
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    if (file.size > MAX_RECEIPT_BYTES) {
      throw new UnsupportedImage('That PDF is over the 10 MB limit.');
    }
    return uploadImage(file, onProgress, url);
  }
  const blob = await downscaleForUpload(file);
  return uploadImage(blob, onProgress, url);
}

/** Intrinsic size, so the editor can reserve the box before the upload lands. */
export async function measure(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- attachments

/**
 * What can be attached to a note besides a photo, mirrored from the server.
 *
 * A mirror, not the authority: worker/lib/files.ts decides what is accepted, and
 * this list exists only so the file picker filters sensibly and a wrong file can
 * be refused before 25 MB crosses pit wifi. If the two ever disagree, the server
 * wins and the user sees a 415.
 */
export const FILE_EXTENSIONS = [
  'pdf',
  'step',
  'stp',
  'stl',
  'f3d',
  'sldprt',
  'sldasm',
  'dwg',
  'dxf',
  '3mf',
  'gcode',
  'ipt',
  'iam',
] as const;

/** The `accept` string for the attachment picker. */
export const FILE_ACCEPT = FILE_EXTENSIONS.map((e) => `.${e}`).join(',');

/** Server-side cap, mirrored so a huge assembly is refused before it uploads. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Distinct from UnsupportedImage, which stays exactly as it is — receipts and
 * roster photos still depend on its message and on being able to tell "this
 * browser cannot decode that" apart from "we do not accept that".
 */
export class UnsupportedFile extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFile';
  }
}

export interface UploadedFile extends UploadedMedia {
  filename: string;
}

/**
 * Check and upload an attachment.
 *
 * Deliberately NOT routed through prepareAndUpload, whose entire contract and
 * docstring is "downscale then upload". A CAD file has nothing to downscale and
 * `createImageBitmap` would throw on it; sending one through the image path
 * would mean weakening the guarantee the image path exists to make.
 */
export async function prepareFileAndUpload(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedFile> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new UnsupportedFile(
      'Coglin can hold PDFs and CAD files. That is not one Coglin recognises.',
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new UnsupportedFile('That file is over the 25 MB limit.');
  }
  const uploaded = await uploadImage(file, onProgress, '/api/media/files', {
    filename: file.name,
    copy: FILE_ERROR_COPY,
    fallback: 'That file could not be uploaded.',
  });
  return uploaded as UploadedFile;
}
