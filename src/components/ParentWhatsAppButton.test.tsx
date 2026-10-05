import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParentWhatsAppButton from './ParentWhatsAppButton';

const { apiFetchMock, mockIsNativePlatform } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

vi.mock('../lib/api.ts', () => ({
  apiFetch: apiFetchMock,
  getUiErrorMessage: (error: unknown, fallback?: string) => error instanceof Error ? error.message : fallback ?? null,
}));

const children = [
  { id: 71, schoolId: 9, classId: 4, className: '6ème A', firstName: 'Alice', lastName: 'Akakpo', parentId: 3 },
  { id: 72, schoolId: 10, classId: 5, className: '5ème A', firstName: 'Bob', lastName: 'Akakpo', parentId: 3 },
];

describe('ParentWhatsAppButton', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    mockIsNativePlatform.mockReset().mockReturnValue(false);
  });
  afterEach(() => cleanup());

  it('uses the existing contact API for an authorized child and opens only its returned WhatsApp link', async () => {
    apiFetchMock.mockResolvedValue({ whatsappUrl: 'https://wa.me/22890000001?text=Bonjour' });

    render(
      <ParentWhatsAppButton currentRole="parent" studentsList={children} />,
    );

    const button = await screen.findByRole('link', { name: "WhatsApp — Contacter l'administration" });
    expect(button.getAttribute('href')).toBe('https://wa.me/22890000001?text=Bonjour');
    expect(button.getAttribute('href')).not.toContain('22899999999');
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/parent/whatsapp-contact?studentId=71');
  });

  it('uses normal external-link navigation in Capacitor so the operating system can open WhatsApp', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    apiFetchMock.mockResolvedValue({ whatsappUrl: 'https://wa.me/22890000001?text=Bonjour' });

    render(<ParentWhatsAppButton currentRole="parent" studentsList={children} />);

    const button = await screen.findByRole('link', { name: "WhatsApp — Contacter l'administration" });
    expect(button.getAttribute('href')).toBe('https://wa.me/22890000001?text=Bonjour');
    expect(button.getAttribute('target')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('href')).toBe('https://wa.me/22890000001?text=Bonjour');
  });

  it('hides the button when the API has no usable administrator phone', async () => {
    apiFetchMock.mockResolvedValue({ whatsappUrl: null });
    render(<ParentWhatsAppButton currentRole="parent" studentsList={children} />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/parent/whatsapp-contact?studentId=71'));
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
  });

  it('hides links that are not valid wa.me destinations', async () => {
    apiFetchMock.mockResolvedValue({ whatsappUrl: 'https://wa.me.evil.test/22890000001' });
    render(<ParentWhatsAppButton currentRole="parent" studentsList={children} />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
  });

  it('shows a readable error when the contact API fails', async () => {
    apiFetchMock.mockRejectedValue(new Error('Service indisponible'));
    render(<ParentWhatsAppButton currentRole="parent" studentsList={children} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Service indisponible');
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
  });

  it('does not request a contact without an accessible child or for another role', () => {
    const { rerender } = render(<ParentWhatsAppButton currentRole="parent" studentsList={[]} />);
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();

    rerender(<ParentWhatsAppButton currentRole="school_admin" studentsList={children} />);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
  });
});
