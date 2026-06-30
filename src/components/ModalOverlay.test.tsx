import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModalOverlay from './ModalOverlay';

describe('ModalOverlay', () => {
  it('closes on backdrop click and Escape, but not on inner content click', () => {
    const onClose = vi.fn();

    render(
      <ModalOverlay isOpen={true} onClose={onClose}>
        <div>Inner content</div>
      </ModalOverlay>,
    );

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    onClose.mockClear();
    fireEvent.mouseDown(screen.getByText('Inner content'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
