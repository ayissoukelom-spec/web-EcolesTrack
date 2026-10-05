// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BulletinDetail from './BulletinDetail';

describe('BulletinDetail PDF download action', () => {
  it('shows progress and disables the button while the PDF is downloading', () => {
    const onDownloadPdf = vi.fn();
    render(
      <BulletinDetail
        detail={null}
        loading={false}
        error={null}
        selectedId={3}
        liveNotes={[]}
        pdfLoading
        onDownloadPdf={onDownloadPdf}
      />
    );

    const button = screen.getByRole('button', { name: 'Téléchargement en cours…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
    fireEvent.click(button);
    expect(onDownloadPdf).not.toHaveBeenCalled();
  });
});
