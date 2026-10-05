import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ParentNotesView from './ParentNotesView';

vi.mock('../contexts/AuthContext.tsx', () => ({
  useAuth: () => ({ user: { email: 'parent@example.test', uid: 'parent_10' } }),
}));

describe('ParentNotesView', () => {
  afterEach(() => cleanup());

  it('continues to render the parent notes screen without owning the shared WhatsApp button', () => {
    render(
      <ParentNotesView
        currentRole="parent"
        studentsList={[{
          id: 71,
          schoolId: 9,
          classId: 4,
          className: '6ème A',
          firstName: 'Alice',
          lastName: 'Akakpo',
          parentId: 3,
        }]}
        parentsList={[{
          id: 3,
          userId: 10,
          name: 'Parent',
          email: 'parent@example.test',
          phone: '+22899999999',
        }]}
        gradesList={[]}
        evaluationsList={[]}
      />,
    );

    expect(screen.getByText('Eleve selectionne')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).toBeNull();
  });
});
