import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SubjectsView from './SubjectsView';

afterEach(() => {
  cleanup();
});

describe('SubjectsView', () => {
  it('filtre les matières par établissement pour le super admin', () => {
    render(
      <SubjectsView
        subjectsList={[
          { id: 1, schoolId: 1, name: 'Mathématiques', code: 'MATH' },
          { id: 2, schoolId: 2, name: 'Français', code: 'FR' },
        ]}
        userRole="super_admin"
        schoolsList={[
          { id: 1, name: 'École A' },
          { id: 2, name: 'École B' },
        ]}
        onAddSubject={vi.fn()}
        onUpdateSubject={vi.fn()}
        onDeleteSubject={vi.fn()}
      />
    );

    expect(screen.getByText('Mathématiques')).toBeDefined();
    expect(screen.getByText('Français')).toBeDefined();

    fireEvent.change(screen.getByLabelText(/filtrer par établissement/i), {
      target: { value: '2' },
    });

    expect(screen.queryByText('Mathématiques')).toBeNull();
    expect(screen.getByText('Français')).toBeDefined();
  });

  it('affiche les actions d’approbation pour un school admin', () => {
    render(
      <SubjectsView
        subjectsList={[
          { id: 1, schoolId: null as any, name: 'Mathématiques', code: 'MATH', status: 'pending' },
        ]}
        userRole="school_admin"
        schoolId={54}
        schoolsList={[]}
        onAddSubject={vi.fn()}
        onUpdateSubject={vi.fn()}
        onDeleteSubject={vi.fn()}
      />
    );

    expect(screen.getByText('Mathématiques')).toBeDefined();
    expect(screen.getByText('En attente')).toBeDefined();
    expect(screen.getByRole('button', { name: /approuver/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /refuser/i })).toBeDefined();
  });

  it('permet au super admin de créer une matière globale sans choisir d’établissement', async () => {
    const onAddSubject = vi.fn();

    render(
      <SubjectsView
        subjectsList={[]}
        userRole="super_admin"
        schoolsList={[
          { id: 1, name: 'École A' },
          { id: 2, name: 'École B' },
        ]}
        onAddSubject={onAddSubject}
        onUpdateSubject={vi.fn()}
        onDeleteSubject={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: /ajouter une matière/i })[0]);

    expect(screen.queryByText(/sélectionner un établissement/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/nom de la matière/i), {
      target: { value: 'Français' },
    });
    fireEvent.change(screen.getByLabelText(/code/i), {
      target: { value: 'FR' },
    });

    fireEvent.click(screen.getByRole('button', { name: /créer/i }));

    await waitFor(() => {
      expect(onAddSubject).toHaveBeenCalledWith({
        name: 'Français',
        code: 'FR',
        schoolId: undefined,
      });
    });
  });
});
