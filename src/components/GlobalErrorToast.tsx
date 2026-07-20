import React from 'react';

interface GlobalErrorToastProps {
  message: string;
  onClose: () => void;
}

export default function GlobalErrorToast({ message, onClose }: GlobalErrorToastProps) {
  return (
    <div
      role="alert"
      className="fixed top-5 right-5 z-50 w-full max-w-sm rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-lg shadow-slate-900/5 text-slate-900"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-rose-600">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.373 0 0 5.373 0 12c0 6.627 5.373 12 12 12 6.628 0 12-5.373 12-12C24 5.373 18.628 0 12 0Zm0 18a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm1.125-6.75h-2.25V6.75h2.25v4.5Z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 text-sm sm:text-base leading-6 text-rose-800">
          {message}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/90 p-2 text-rose-600 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
          aria-label="Fermer l’alerte"
        >
          <span className="text-lg font-bold">×</span>
        </button>
      </div>
    </div>
  );
}
