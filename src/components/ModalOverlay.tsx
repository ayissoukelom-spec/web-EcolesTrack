import React, { useEffect, useRef } from 'react';

interface ModalOverlayProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  backdropClassName?: string;
  disableBackdropClose?: boolean;
  closeOnEscape?: boolean;
  role?: string;
}

export default function ModalOverlay({
  isOpen,
  onClose,
  children,
  className,
  contentClassName,
  backdropClassName,
  disableBackdropClose = false,
  closeOnEscape = true,
  role = 'dialog',
}: ModalOverlayProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${backdropClassName ?? 'bg-black/40'} ${className ?? ''}`.trim()}
      onMouseDown={(event) => {
        if (!disableBackdropClose && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
      role="presentation"
    >
      <div
        ref={contentRef}
        className={`w-full max-w-3xl max-h-[90vh] overflow-auto ${contentClassName ?? ''}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role={role}
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
