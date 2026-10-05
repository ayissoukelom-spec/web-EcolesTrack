import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { Student, UserRole } from '../types.ts';
import { apiFetch, getUiErrorMessage } from '../lib/api.ts';

interface ParentWhatsAppButtonProps {
  currentRole: UserRole;
  studentsList: Student[];
}

const isWhatsAppUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'wa.me'
      && /^\/[1-9]\d{1,14}$/.test(url.pathname);
  } catch {
    return false;
  }
};

export default function ParentWhatsAppButton({ currentRole, studentsList }: ParentWhatsAppButtonProps) {
  const [whatsAppUrl, setWhatsAppUrl] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const studentId = studentsList.find((student) => Number.isInteger(student.id))?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setWhatsAppUrl(null);
    setContactError(null);
    if (currentRole !== 'parent' || studentId == null) return () => { cancelled = true; };

    apiFetch(`/api/parent/whatsapp-contact?studentId=${encodeURIComponent(String(studentId))}`)
      .then((payload) => {
        if (cancelled) return;
        const candidate = payload && typeof payload === 'object'
          ? (payload as { whatsappUrl?: unknown }).whatsappUrl
          : null;
        setWhatsAppUrl(isWhatsAppUrl(candidate) ? candidate : null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWhatsAppUrl(null);
        setContactError(getUiErrorMessage(error, 'Impossible de charger le contact WhatsApp de l’établissement.'));
      });

    return () => { cancelled = true; };
  }, [currentRole, studentId]);

  if (currentRole !== 'parent') return null;

  return (
    <div className="w-[94%] max-w-[1920px] mx-auto px-4 pt-3 sm:px-6 lg:px-8">
      {contactError && (
        <p role="alert" className="mb-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {contactError}
        </p>
      )}
      {whatsAppUrl && (
        <a
          href={whatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          WhatsApp — Contacter l&apos;administration
        </a>
      )}
    </div>
  );
}
