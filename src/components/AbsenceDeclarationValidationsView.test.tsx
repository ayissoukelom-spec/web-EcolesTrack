import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AbsenceDeclarationValidationsView from './AbsenceDeclarationValidationsView';
import type { AbsenceDeclaration } from '../types.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const declarations: AbsenceDeclaration[] = [
  {
    id: 1,
    studentId: 10,
    studentName: 'Awa Diallo',
    parentName: 'Mariam Diallo',
    classId: 2,
    className: 'CM2 A',
    schoolId: 1,
    date: '2026-10-01',
    startTime: '08:00',
    endTime: '10:00',
    reason: 'Rendez-vous médical',
    status: 'RECEIVED',
    createdAt: '2026-09-29T09:45:00.000Z',
  },
  {
    id: 2,
    studentId: 11,
    studentName: 'Binta Sow',
    classId: 2,
    className: 'CM2 A',
    schoolId: 1,
    date: '2026-10-02',
    startTime: '08:00',
    endTime: '09:00',
    status: 'ACCEPTED',
  },
];

describe('AbsenceDeclarationValidationsView', () => {
  it('shows requested declaration details and excludes already processed declarations', () => {
    render(<AbsenceDeclarationValidationsView declarations={declarations} onReview={vi.fn()} />);

    expect(screen.getByText('Awa Diallo')).toBeInTheDocument();
    expect(screen.getByText('Mariam Diallo')).toBeInTheDocument();
    expect(screen.getByText('CM2 A')).toBeInTheDocument();
    expect(screen.getByText('Rendez-vous médical')).toBeInTheDocument();
    expect(screen.getByText('Reçue')).toBeInTheDocument();
    expect(screen.getByText('29/09/2026 09:45')).toBeInTheDocument();
    expect(screen.queryByText('Binta Sow')).toBeNull();
  });

  it('accepts a received declaration through the existing review callback', async () => {
    const onReview = vi.fn().mockResolvedValue(undefined);
    render(<AbsenceDeclarationValidationsView declarations={declarations} onReview={onReview} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));

    await waitFor(() => expect(onReview).toHaveBeenCalledWith(1, 'ACCEPTED', undefined));
  });

  it('requires a rejection reason and sends it to the existing review callback', async () => {
    const prompt = vi.fn().mockReturnValue('Document non conforme');
    vi.stubGlobal('prompt', prompt);
    const onReview = vi.fn().mockResolvedValue(undefined);
    render(<AbsenceDeclarationValidationsView declarations={declarations} onReview={onReview} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));

    await waitFor(() => expect(onReview).toHaveBeenCalledWith(1, 'REFUSED', 'Document non conforme'));
    expect(prompt).toHaveBeenCalledWith('Motif du refus :');
  });
});