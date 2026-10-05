import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { downloadBulletinPdf, downloadBulletinsPdfBatch } from '../lib/api.ts';
import { useDownloadBulletinPDF } from './useDownloadBulletinPDF';

vi.mock('../lib/api.ts', () => ({
  downloadBulletinPdf: vi.fn(),
  downloadBulletinsPdfBatch: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('useDownloadBulletinPDF', () => {
  it('tracks individual downloads independently and ignores a duplicate click', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    vi.mocked(downloadBulletinPdf)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDownloadBulletinPDF());

    act(() => {
      void result.current.run(10);
      void result.current.run(10);
      void result.current.run(11);
    });

    expect(downloadBulletinPdf).toHaveBeenCalledTimes(2);
    expect(result.current.isDownloading(10)).toBe(true);
    expect(result.current.isDownloading(11)).toBe(true);

    await act(async () => {
      first.resolve(new Blob());
      await first.promise;
    });
    expect(result.current.isDownloading(10)).toBe(false);
    expect(result.current.isDownloading(11)).toBe(true);

    await act(async () => {
      second.resolve(new Blob());
      await second.promise;
    });
    expect(result.current.isDownloading(11)).toBe(false);
  });

  it('resets the individual and batch states after completion or failure', async () => {
    const failed = deferred<Blob>();
    vi.mocked(downloadBulletinPdf).mockReturnValueOnce(failed.promise);
    vi.mocked(downloadBulletinsPdfBatch).mockResolvedValue(new Blob());
    const { result } = renderHook(() => useDownloadBulletinPDF());

    act(() => {
      void result.current.run(10);
    });
    expect(result.current.isDownloading(10)).toBe(true);
    await act(async () => {
      failed.reject(new Error('Download failed'));
      await failed.promise.catch(() => undefined);
    });
    expect(result.current.isDownloading(10)).toBe(false);
    expect(result.current.error).toBe('Download failed');

    await act(async () => {
      await result.current.runMany([10, 11]);
    });
    expect(downloadBulletinsPdfBatch).toHaveBeenCalledWith([10, 11]);
    expect(result.current.batchLoading).toBe(false);
  });
});
