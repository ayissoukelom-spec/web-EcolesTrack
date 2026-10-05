// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationView from './NotificationView';
import { apiFetchBlob } from '../lib/api.ts';
import type { SystemNotification } from '../types.ts';

vi.mock('../lib/api.ts', () => ({
  apiFetch: vi.fn().mockResolvedValue(undefined),
  apiFetchBlob: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NotificationView attachment downloads', () => {
  it('tracks attachments independently, prevents duplicate clicks and resets after errors', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    vi.mocked(apiFetchBlob)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockRejectedValueOnce(Object.assign(new Error('Download failed'), { status: 500 }));

    class MockURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:attachment');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', MockURL);

    const notification: SystemNotification = {
      id: 15,
      userId: 5,
      title: 'Document disponible',
      body: 'Consultez le document.',
      type: 'info',
      isRead: true,
      attachments: [
        { id: 101, notificationId: 15, fileName: 'document-a.pdf', filePath: '', mimeType: 'application/pdf', fileSize: 1, uploadedBy: 1 },
        { id: 102, notificationId: 15, fileName: 'document-b.pdf', filePath: '', mimeType: 'application/pdf', fileSize: 1, uploadedBy: 1 },
      ],
    };

    render(
      <NotificationView
        userRole="school_admin"
        notificationsList={[notification]}
        usersList={[]}
        classesList={[]}
        studentsList={[]}
        onSendNotification={() => undefined}
        onMarkAllAsRead={() => undefined}
      />
    );

    const firstButton = screen.getByRole('button', { name: 'document-a.pdf' });
    const secondButton = screen.getByRole('button', { name: 'document-b.pdf' });
    fireEvent.click(firstButton);
    await waitFor(() => {
      const progressButton = screen.getAllByRole('button', { name: /Téléchargement en cours…/i })
        .find((element) => element.tagName === 'BUTTON');
      expect(progressButton?.hasAttribute('disabled')).toBe(true);
    });
    fireEvent.click(firstButton);
    fireEvent.click(secondButton);
    expect(apiFetchBlob).toHaveBeenCalledTimes(2);
    expect(secondButton.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      first.resolve(new Blob(['a']));
      second.resolve(new Blob(['b']));
      await Promise.all([first.promise, second.promise]);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'document-a.pdf' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByRole('button', { name: 'document-b.pdf' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'document-a.pdf' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'document-a.pdf' }).hasAttribute('disabled')).toBe(false);
  });
});
