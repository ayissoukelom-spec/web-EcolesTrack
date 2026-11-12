// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileParentView from './MobileParentView';
import type { SystemNotification } from '../types.ts';

vi.mock('../contexts/AuthContext.tsx', () => ({
  useAuth: () => ({
    user: { uid: 'parent_10', email: 'parent@example.test', name: 'Parent Test' },
    role: 'parent',
  }),
}));

vi.mock('../lib/api.ts', () => ({
  apiFetch: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => cleanup());

describe('MobileParentView parent notification categories', () => {
  it('shows grouped homework under Devoirs, not Notes or Informations', () => {
    const notifications: SystemNotification[] = [
      {
        id: 21,
        userId: 10,
        title: 'Nouveau programme de devoirs',
        body: 'Matières concernées : Mathématiques. Encouragez votre enfant à se préparer !',
        type: 'grade',
        isRead: true,
      },
      {
        id: 22,
        userId: 10,
        title: 'Note publiée',
        body: 'Une note est disponible.',
        type: 'grade',
        isRead: true,
      },
      {
        id: 23,
        userId: 10,
        title: 'Information générale',
        body: 'Message de l’établissement.',
        type: 'info',
        isRead: true,
      },
      {
        id: 24,
        userId: 10,
        title: 'Nouveau programme d’examens',
        body: 'Un programme de composition est prévu en novembre.',
        type: 'grade',
        isRead: true,
      },
      {
        id: 25,
        userId: 10,
        title: 'Nouveau programme de compositions',
        body: 'Un programme de compositions est prévu en novembre.',
        type: 'grade',
        isRead: true,
      },
    ];

    render(
      <MobileParentView
        studentsList={[{
          id: 1,
          schoolId: 1,
          classId: 1,
          className: '3ème A',
          firstName: 'Élève',
          lastName: 'Test',
          parentId: 1,
        }]}
        parentsList={[{
          id: 1,
          userId: 10,
          name: 'Parent Test',
          email: 'parent@example.test',
        }]}
        absencesList={[]}
        gradesList={[]}
        notificationsList={notifications}
        onJustifyAbsence={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alertes' }));

    expect(screen.getByText('Note publiée')).toBeTruthy();
    expect(screen.queryByText('Nouveau programme de devoirs')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Devoirs/ }));
    expect(screen.getByText('Nouveau programme de devoirs')).toBeTruthy();
    expect(screen.getByText('Nouveau programme d’examens')).toBeTruthy();
    expect(screen.getByText('Nouveau programme de compositions')).toBeTruthy();
    expect(screen.queryByText('Note publiée')).toBeNull();
    expect(screen.queryByText('Information générale')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Informations/ }));
    expect(screen.getByText('Information générale')).toBeTruthy();
    expect(screen.queryByText('Nouveau programme de devoirs')).toBeNull();
  });
});
