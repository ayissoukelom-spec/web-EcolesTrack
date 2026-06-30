import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ModalSurface from './ModalSurface';

describe('ModalSurface', () => {
  it('closes on overlay click and Escape', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalSurface isOpen={true} onClose={onClose} ariaLabel="Test modal">
        <div>Contenu</div>
      </ModalSurface>
    );

    fireEvent.mouseDown(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps inner interactions active', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalSurface isOpen={true} onClose={onClose} ariaLabel="Test modal">
        <button type="button">Action</button>
      </ModalSurface>
    );

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.mouseDown(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
