import React, { useEffect, useRef } from 'react';

interface ModalSurfaceProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  overlayClassName?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  disablePadding?: boolean;
  ariaLabel?: string;
}

export default function ModalSurface({
  isOpen,
  onClose,
  children,
  className,
  contentClassName,
  overlayClassName,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  disablePadding = false,
  ariaLabel,
}: ModalSurfaceProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-x-hidden ${overlayClassName || ''}`.trim()}
      onMouseDown={(event) => {
        if (!closeOnOverlayClick) return;
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={contentRef}
        className={`bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto ${disablePadding ? '' : 'p-6'} ${contentClassName || ''}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}
