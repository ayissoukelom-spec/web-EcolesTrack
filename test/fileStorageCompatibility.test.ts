import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable, Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildObjectKey,
  deleteStoredFile,
  getFileStorageConfig,
  persistUploadedFile,
  readStoredFile,
  resolveStoredLocalPath,
  streamStoredFileToResponse,
} from '../src/lib/fileStorage';

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn(),
  clientConfigs: [] as any[],
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config: any) {
      s3Mocks.clientConfigs.push(config);
    }
    send(command: any) {
      return s3Mocks.send(command);
    }
  },
  DeleteObjectCommand: class { constructor(public input: any) {} },
  GetObjectCommand: class { constructor(public input: any) {} },
  PutObjectCommand: class { constructor(public input: any) {} },
}));

describe('file storage compatibility', () => {
  const envKeys = [
    'NODE_ENV', 'FILE_STORAGE_PROVIDER', 'UPLOADS_DIR', 'S3_BUCKET', 'S3_REGION',
    'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoletrack-file-storage-'));
    process.env.NODE_ENV = 'test';
    for (const key of envKeys) delete process.env[key];
    process.env.NODE_ENV = 'test';
    s3Mocks.send.mockReset();
    s3Mocks.clientConfigs.length = 0;
  });

  afterEach(async () => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key]!;
    }

    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  const configureS3 = () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'ecoletrack-test';
    process.env.S3_REGION = 'eu-west-1';
    process.env.S3_ENDPOINT = 'https://objects.example.test';
    process.env.S3_ACCESS_KEY_ID = 'test-access';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  };

  const makeResponse = () => {
    const chunks: Buffer[] = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as Writable & Record<string, any>;
    response.download = vi.fn();
    response.send = vi.fn();
    response.setHeader = vi.fn();
    response.status = vi.fn().mockReturnThis();
    response.headersSent = false;
    response.chunks = chunks;
    return response;
  };

  it('defaults to local and resolves legacy filename-only DB rows', async () => {
    process.env.UPLOADS_DIR = tempRoot;

    const config = getFileStorageConfig();
    expect(config.mode).toBe('local');

    const dir = path.join(tempRoot, 'absence-justifications');
    await fs.mkdir(dir, { recursive: true });
    const legacyFile = 'legacy-absence.pdf';
    const fullPath = path.join(dir, legacyFile);
    await fs.writeFile(fullPath, 'legacy content');

    const resolved = await resolveStoredLocalPath('absence-justifications', legacyFile);
    expect(resolved).toBe(fullPath);
    expect(buildObjectKey('absence-justifications', legacyFile)).toBe(path.posix.join('absence-justifications', legacyFile));
  });

  it('writes a local in-memory upload and serves it from the local filesystem', async () => {
    process.env.UPLOADS_DIR = tempRoot;
    const body = Buffer.from('local upload contents');
    const persisted = await persistUploadedFile({
      originalname: 'proof.pdf',
      filename: 'proof.pdf',
      buffer: body,
      mimetype: 'application/pdf',
    }, 'absence-justifications');

    expect(persisted.storedReference).not.toBe('proof.pdf');
    expect(await fs.readFile(persisted.localPath!, 'utf8')).toBe(body.toString());

    const response = makeResponse();
    expect(await streamStoredFileToResponse(
      persisted.storedReference, 'absence-justifications', 'proof.pdf', 'application/pdf', response as any,
    )).toBe(true);
    expect(response.download).toHaveBeenCalledWith(persisted.localPath, 'proof.pdf', expect.any(Function));
  });

  it('moves an existing local Multer file into the configured storage directory', async () => {
    process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
    const sourcePath = path.join(tempRoot, 'multer.tmp');
    await fs.writeFile(sourcePath, 'disk upload');
    const persisted = await persistUploadedFile({
      originalname: 'proof.pdf',
      filename: 'stored-proof.pdf',
      path: sourcePath,
      mimetype: 'application/pdf',
    }, 'notification-attachments');

    expect(await fs.readFile(persisted.localPath!, 'utf8')).toBe('disk upload');
    await expect(fs.access(sourcePath)).rejects.toThrow();
    expect(persisted.storedReference).toBe('stored-proof.pdf');
  });

  it('uploads to the configured S3-compatible endpoint with the expected bucket, region, credentials, and path style', async () => {
    configureS3();
    process.env.S3_FORCE_PATH_STYLE = 'false';
    s3Mocks.send.mockResolvedValue({});

    const persisted = await persistUploadedFile({
      originalname: 'report.pdf',
      buffer: Buffer.from('s3 upload'),
      mimetype: 'application/pdf',
    }, 'notification-attachments');

    expect(persisted.storedReference).toMatch(/^notification-attachments\/\d+-[a-f0-9]{16}-report\.pdf$/);
    expect(s3Mocks.send).toHaveBeenCalledTimes(1);
    expect(s3Mocks.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'ecoletrack-test',
      Key: persisted.storedReference,
      ContentType: 'application/pdf',
    });
    expect(s3Mocks.clientConfigs[0]).toMatchObject({
      region: 'eu-west-1',
      endpoint: 'https://objects.example.test',
      forcePathStyle: false,
      credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
    });
  });

  it('reads a stored S3 object and falls back to a legacy local logo when the key is absent', async () => {
    configureS3();
    const body = Buffer.from('school logo bytes');
    s3Mocks.send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array(body) },
      ContentType: 'image/png',
    });

    await expect(readStoredFile('school-logos', 'school-logos/school-1-logo.png')).resolves.toEqual(body);
    expect(s3Mocks.send.mock.calls[0][0].input).toEqual({
      Bucket: 'ecoletrack-test',
      Key: 'school-logos/school-1-logo.png',
    });

    process.env.UPLOADS_DIR = tempRoot;
    const legacyDir = path.join(tempRoot, 'school-logos');
    await fs.mkdir(legacyDir, { recursive: true });
    const legacyBody = Buffer.from('legacy local logo');
    await fs.writeFile(path.join(legacyDir, 'legacy-logo.png'), legacyBody);
    s3Mocks.send.mockRejectedValueOnce(Object.assign(new Error('missing'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    }));

    await expect(readStoredFile('school-logos', 'school-logos/legacy-logo.png')).resolves.toEqual(legacyBody);
  });

  it('downloads an S3 object and sets safe attachment headers', async () => {
    configureS3();
    const body = Buffer.from('remote attachment');
    s3Mocks.send.mockResolvedValue({ Body: Readable.from([body]), ContentType: 'application/pdf' });
    const response = makeResponse();
    const key = 'absence-justifications/1790000000000-0123456789abcdef-proof.pdf';

    expect(await streamStoredFileToResponse(key, 'absence-justifications', 'proof.pdf', 'application/octet-stream', response as any)).toBe(true);
    await new Promise<void>((resolve, reject) => {
      response.once('finish', resolve);
      response.once('error', reject);
    });

    expect(Buffer.concat(response.chunks).toString()).toBe(body.toString());
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="proof.pdf"');
    expect(s3Mocks.send.mock.calls[0][0].input).toEqual({ Bucket: 'ecoletrack-test', Key: key });
  });

  it('downloads a notification attachment from its S3 object key', async () => {
    configureS3();
    s3Mocks.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('notification attachment')) },
      ContentType: 'image/png',
    });
    const response = makeResponse();
    const key = 'notification-attachments/1790000000000-0123456789abcdef-notice.png';

    expect(await streamStoredFileToResponse(key, 'notification-attachments', 'notice.png', 'image/png', response as any)).toBe(true);
    expect(response.send).toHaveBeenCalledWith(Buffer.from('notification attachment'));
    expect(s3Mocks.send.mock.calls[0][0].input).toEqual({ Bucket: 'ecoletrack-test', Key: key });
  });

  it('uses the local legacy file when S3 mode is enabled and the DB contains only an old filename', async () => {
    configureS3();
    process.env.UPLOADS_DIR = tempRoot;
    const directory = path.join(tempRoot, 'absence-justifications');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'legacy-proof.pdf'), 'legacy');
    const response = makeResponse();

    expect(await streamStoredFileToResponse('legacy-proof.pdf', 'absence-justifications', 'legacy-proof.pdf', 'application/pdf', response as any)).toBe(true);
    expect(response.download).toHaveBeenCalledWith(path.join(directory, 'legacy-proof.pdf'), 'legacy-proof.pdf');
    expect(s3Mocks.send).not.toHaveBeenCalled();
  });

  it('rejects S3 upload failures instead of returning a local reference', async () => {
    configureS3();
    s3Mocks.send.mockRejectedValue(new Error('S3 unavailable'));

    await expect(persistUploadedFile({
      originalname: 'proof.pdf',
      buffer: Buffer.from('must not be local'),
      mimetype: 'application/pdf',
    }, 'absence-justifications')).rejects.toThrow('S3 unavailable');
  });

  it('deletes an S3 object when compensating a failed DB insert', async () => {
    configureS3();
    s3Mocks.send.mockResolvedValue({});
    const key = 'notification-attachments/1790000000000-0123456789abcdef-notice.pdf';

    await deleteStoredFile(key, 'notification-attachments');

    expect(s3Mocks.send).toHaveBeenCalledTimes(1);
    expect(s3Mocks.send.mock.calls[0][0].input).toEqual({ Bucket: 'ecoletrack-test', Key: key });
  });

  it('does not request S3 for missing or unsafe references and blocks local traversal', async () => {
    configureS3();
    const response = makeResponse();

    expect(await streamStoredFileToResponse(null, 'absence-justifications', 'proof.pdf', 'application/pdf', response as any)).toBe(false);
    expect(await streamStoredFileToResponse('../notification-attachments/other.pdf', 'absence-justifications', 'other.pdf', 'application/pdf', response as any)).toBe(false);
    expect(await resolveStoredLocalPath('absence-justifications', '../secret.txt')).toBeNull();
    expect(await resolveStoredLocalPath('absence-justifications', path.join(tempRoot, 'secret.txt'))).toBeNull();
    await deleteStoredFile('../notification-attachments/other.pdf', 'absence-justifications');
    expect(s3Mocks.send).not.toHaveBeenCalled();
  });

  it('rejects incomplete or invalid S3 and production configuration', () => {
    process.env.FILE_STORAGE_PROVIDER = 's3';
    expect(() => getFileStorageConfig()).toThrow('S3_BUCKET is required');

    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ENDPOINT = 'ftp://objects.example.test';
    process.env.S3_ACCESS_KEY_ID = 'access';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    expect(() => getFileStorageConfig()).toThrow('S3_ENDPOINT must use http or https');

    delete process.env.S3_ENDPOINT;
    process.env.S3_FORCE_PATH_STYLE = 'sometimes';
    expect(() => getFileStorageConfig()).toThrow('S3_FORCE_PATH_STYLE');

    process.env.NODE_ENV = 'production';
    process.env.FILE_STORAGE_PROVIDER = 'local';
    expect(() => getFileStorageConfig()).toThrow('Production requires FILE_STORAGE_PROVIDER=s3');
  });

  it('supports a custom upload root for the local provider without changing the object key format', () => {
    const customRoot = path.join(tempRoot, 'custom-uploads');
    process.env.UPLOADS_DIR = customRoot;

    const config = getFileStorageConfig();
    expect(config.mode).toBe('local');
    expect(config.localRoot).toBe(customRoot);
    expect(buildObjectKey('notification-attachments', 'report.pdf')).toBe(path.posix.join('notification-attachments', 'report.pdf'));
  });
});
