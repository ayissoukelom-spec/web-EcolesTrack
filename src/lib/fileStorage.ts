import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type FileStorageKind = 'absence-justifications' | 'notification-attachments' | 'school-logos';

export interface FileStorageConfig {
  mode: 'local' | 's3';
  localRoot: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function getFileStorageConfig(): FileStorageConfig {
  const configuredMode = (process.env.FILE_STORAGE_PROVIDER ?? '').trim().toLowerCase();
  const localRoot = path.resolve((process.env.UPLOADS_DIR || '').trim() || path.join(process.cwd(), 'uploads'));
  const bucket = (process.env.S3_BUCKET || '').trim();
  const endpoint = (process.env.S3_ENDPOINT || '').trim();
  const region = (process.env.S3_REGION || 'us-east-1').trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const forcePathStyleValue = (process.env.S3_FORCE_PATH_STYLE || 'true').trim().toLowerCase();

  if (configuredMode && configuredMode !== 'local' && configuredMode !== 's3') {
    throw new Error('FILE_STORAGE_PROVIDER must be either "local" or "s3".');
  }
  if (process.env.NODE_ENV === 'production' && configuredMode !== 's3') {
    throw new Error('Production requires FILE_STORAGE_PROVIDER=s3; local upload storage is ephemeral on Render.');
  }

  const resolvedMode: FileStorageConfig['mode'] = configuredMode || (bucket ? 's3' : 'local');
  if (forcePathStyleValue !== 'true' && forcePathStyleValue !== 'false') {
    throw new Error('S3_FORCE_PATH_STYLE must be either "true" or "false".');
  }
  if (resolvedMode === 's3') {
    if (!bucket) throw new Error('S3_BUCKET is required when FILE_STORAGE_PROVIDER=s3.');
    if (/[\s/\\]/.test(bucket)) throw new Error('S3_BUCKET must be a bucket name, not a URL or path.');
    if (!region) throw new Error('S3_REGION cannot be empty when FILE_STORAGE_PROVIDER=s3.');
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together.');
    }
    if (endpoint) {
      let parsedEndpoint: URL;
      try {
        parsedEndpoint = new URL(endpoint);
      } catch {
        throw new Error('S3_ENDPOINT must be a valid http or https URL.');
      }
      if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
        throw new Error('S3_ENDPOINT must use http or https.');
      }
      if (parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
        throw new Error('S3_ENDPOINT must not contain credentials, a query string, or a fragment.');
      }
      if (!accessKeyId || !secretAccessKey) {
        throw new Error('S3-compatible endpoints require S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
      }
    }
  }

  return {
    mode: resolvedMode,
    localRoot,
    bucket: bucket || undefined,
    region: region || undefined,
    endpoint: endpoint || undefined,
    forcePathStyle: forcePathStyleValue === 'true',
    accessKeyId: accessKeyId || undefined,
    secretAccessKey: secretAccessKey || undefined,
  };
}

export function buildObjectKey(kind: FileStorageKind, fileName: string): string {
  const safeName = sanitizeFileName(fileName || 'upload');
  return path.posix.join(kind, safeName);
}

export function getStorageKindDirectory(kind: FileStorageKind): string {
  const config = getFileStorageConfig();
  return path.resolve(config.localRoot, kind);
}

export function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(String(fileName || 'upload'));
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized === '.' || sanitized === '..' || !sanitized ? 'upload' : sanitized;
}

export function generateStoredFileName(kind: FileStorageKind, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  const suffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return `${suffix}-${safeName}`;
}

export function buildStorageKeyForUpload(kind: FileStorageKind, fileName: string): string {
  return path.posix.join(kind, generateStoredFileName(kind, fileName));
}

export function getLocalStorageCandidates(kind: FileStorageKind): string[] {
  const config = getFileStorageConfig();
  const roots = new Set<string>();
  roots.add(path.resolve(config.localRoot, kind));
  roots.add(path.resolve(process.cwd(), 'uploads', kind));
  if (config.localRoot !== path.resolve(process.cwd(), 'uploads')) {
    roots.add(path.resolve(process.cwd(), 'uploads', kind));
  }
  return Array.from(roots);
}

function isSafeRelativeReference(reference: string, kind: FileStorageKind): boolean {
  const normalized = reference.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  if (segments[0].toLowerCase() === 'uploads') segments.shift();
  if (segments[0] === kind) segments.shift();
  return segments.length === 1 && sanitizeFileName(segments[0]) === segments[0];
}

function isSafeObjectKey(reference: string, kind: FileStorageKind): boolean {
  const normalized = reference.replace(/\\/g, '/');
  const prefix = `${kind}/`;
  if (!normalized.startsWith(prefix)) return false;
  const fileName = normalized.slice(prefix.length);
  return !fileName.includes('/') && isSafeRelativeReference(fileName, kind);
}

function normalizeStoredReference(reference: string, kind: FileStorageKind): string {
  const normalized = reference.trim().replace(/\\/g, '/');
  if (normalized.startsWith(`/uploads/${kind}/`)) return normalized.slice(1);
  if (normalized.startsWith(`/${kind}/`)) return normalized.slice(1);
  return normalized;
}

export async function resolveStoredLocalPath(kind: FileStorageKind, storedReference: string | null | undefined): Promise<string | null> {
  const safeReference = typeof storedReference === 'string' ? normalizeStoredReference(storedReference, kind) : '';
  if (!safeReference || !isSafeRelativeReference(safeReference, kind)) return null;

  const basename = safeReference.replace(/\\/g, '/').split('/').pop()!;
  for (const root of getLocalStorageCandidates(kind)) {
    const candidate = path.resolve(root, basename);
    const relative = path.relative(path.resolve(root), candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const [realRoot, realCandidate] = await Promise.all([fs.realpath(root), fs.realpath(candidate)]);
      const realRelative = path.relative(realRoot, realCandidate);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
      return realCandidate;
    } catch {
      // keep checking other valid candidates
    }
  }

  return null;
}

export function getS3Client(): S3Client | null {
  const config = getFileStorageConfig();
  if (config.mode !== 's3') return null;

  return new S3Client({
    region: config.region || 'us-east-1',
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined,
  });
}

export async function readStoredFile(
  kind: FileStorageKind,
  storedReference: string | null | undefined,
): Promise<Buffer | null> {
  const reference = typeof storedReference === 'string'
    ? normalizeStoredReference(storedReference, kind)
    : '';
  if (!reference) return null;

  const storage = getFileStorageConfig();
  if (storage.mode === 's3' && isSafeObjectKey(reference, kind)) {
    const client = getS3Client();
    if (!client || !storage.bucket) {
      throw new Error('S3 storage is not available for object retrieval.');
    }

    try {
      const result = await client.send(new GetObjectCommand({
        Bucket: storage.bucket,
        Key: reference,
      }));
      if (!result.Body) return null;
      if (typeof (result.Body as any).transformToByteArray === 'function') {
        return Buffer.from(await (result.Body as any).transformToByteArray());
      }
      if (typeof (result.Body as any)[Symbol.asyncIterator] === 'function') {
        const chunks: Buffer[] = [];
        for await (const chunk of result.Body as any) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      }
      return Buffer.from(result.Body as Uint8Array);
    } catch (error: any) {
      const statusCode = error?.$metadata?.httpStatusCode;
      if (statusCode !== 404 && error?.name !== 'NoSuchKey' && error?.name !== 'NotFound') {
        throw error;
      }
    }
  }

  const localPath = await resolveStoredLocalPath(kind, reference);
  return localPath ? fs.readFile(localPath) : null;
}

export async function persistUploadedFile(
  file: {
    originalname?: string;
    filename?: string;
    path?: string;
    buffer?: Buffer | Uint8Array;
    mimetype?: string;
    size?: number;
  },
  kind: FileStorageKind,
): Promise<{ storedReference: string; localPath?: string | null }> {
  const storage = getFileStorageConfig();

  if (storage.mode === 'local') {
    const directory = getStorageKindDirectory(kind);
    await fs.mkdir(directory, { recursive: true });
    const finalName = sanitizeFileName(file.path
      ? (file.filename || file.originalname || 'upload')
      : generateStoredFileName(kind, file.originalname || file.filename || 'upload'));
    const localPath = path.join(directory, finalName);
    const sourcePath = file.path ? path.resolve(file.path) : null;

    if (sourcePath && sourcePath !== path.resolve(localPath)) {
      try {
        await fs.rename(sourcePath, localPath);
      } catch (error: any) {
        if (error?.code !== 'EXDEV') throw error;
        await fs.copyFile(sourcePath, localPath);
        await fs.unlink(sourcePath);
      }
    } else if (!sourcePath) {
      if (!file.buffer) throw new Error('No file content was provided for local upload.');
      await fs.writeFile(localPath, file.buffer, { flag: 'wx' });
    } else {
      await fs.access(localPath);
    }

    return { storedReference: finalName, localPath };
  }

  const bucket = storage.bucket;
  if (!bucket) throw new Error('S3 bucket is not configured. Set S3_BUCKET and FILE_STORAGE_PROVIDER=s3.');

  const client = getS3Client();
  if (!client) {
    throw new Error('S3 storage is not available.');
  }

  const objectKey = buildStorageKeyForUpload(kind, file.originalname || file.filename || 'upload');
  const buffer = file.buffer ?? (file.path ? await fs.readFile(file.path) : null);
  if (!buffer) {
    throw new Error('No file content was provided for upload.');
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${sanitizeFileName(file.originalname || file.filename || 'upload')}"`,
  }));

  if (file.path) {
    await fs.unlink(file.path).catch(() => undefined);
  }

  return { storedReference: objectKey };
}

export async function deleteStoredFile(storedReference: string | null | undefined, kind: FileStorageKind): Promise<void> {
  const reference = typeof storedReference === 'string' ? storedReference.trim() : '';
  if (!reference) return;
  const storage = getFileStorageConfig();

  if (storage.mode === 's3') {
    if (!isSafeObjectKey(reference, kind)) return;
    const client = getS3Client();
    if (!client || !storage.bucket) throw new Error('S3 storage is not available for object cleanup.');
    await client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: reference }));
    return;
  }

  const localPath = await resolveStoredLocalPath(kind, reference);
  if (localPath) await fs.unlink(localPath);
}

export async function streamStoredFileToResponse(
  storedReference: string | null | undefined,
  kind: FileStorageKind,
  fileName: string,
  mimeType: string,
  res: { download: Function; sendFile: Function; setHeader: Function; headersSent: boolean; status: Function; send: Function; end: Function; },
): Promise<boolean> {
  const storage = getFileStorageConfig();
  const reference = typeof storedReference === 'string' ? storedReference.trim() : '';

  if (storage.mode === 's3') {
    if (!reference) return false;

    // Historical database rows contain only a local filename; never assume they exist in S3.
    if (!reference.includes('/')) {
      const legacyPath = await resolveStoredLocalPath(kind, reference);
      if (!legacyPath) return false;
      res.download(legacyPath, sanitizeFileName(fileName));
      return true;
    }

    if (!isSafeObjectKey(reference, kind)) return false;

    const client = getS3Client();
    if (!client || !storage.bucket) {
      return false;
    }

    try {
      const data = await client.send(new GetObjectCommand({
        Bucket: storage.bucket,
        Key: reference,
      }));

      if (!data.Body) {
        return false;
      }

      res.setHeader('Content-Type', data.ContentType || mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFileName(fileName)}"`);

      if (typeof (data.Body as any).pipe === 'function') {
        (data.Body as any).on('error', (error: unknown) => {
          console.error('Failed while streaming S3 attachment:', error);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        (data.Body as any).pipe(res);
        return true;
      }

      const buffer = Buffer.from(await (data.Body as any).transformToByteArray());
      res.send(buffer);
      return true;
    } catch (error: any) {
      const statusCode = error?.$metadata?.httpStatusCode;
      if (statusCode === 404 || error?.name === 'NoSuchKey' || error?.name === 'NotFound') return false;
      console.error('Failed to retrieve S3 attachment:', error);
      throw error;
    }
  }

  const localPath = await resolveStoredLocalPath(kind, storedReference);
  if (!localPath) {
    return false;
  }

  res.download(localPath, fileName, (err: any) => {
    if (err && !res.headersSent) {
      console.error('Failed to send local attachment download:', err);
    }
  });
  return true;
}
