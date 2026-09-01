import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    const subjectsTable = screen.getByRole('table');
    expect(within(subjectsTable).getByText('Mathématiques')).toBeDefined();
    expect(within(subjectsTable).getByText('Français')).toBeDefined();

    fireEvent.change(screen.getByLabelText(/filtrer par établissement/i), {
      target: { value: '2' },
    });

    expect(within(subjectsTable).queryByText('Mathématiques')).toBeNull();
    expect(within(subjectsTable).getByText('Français')).toBeDefined();
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

  it('n’affiche que les matières assignées au school admin', () => {
    render(
      <SubjectsView
        subjectsList={[
          { id: 1, schoolId: null as any, name: 'Mathématiques', code: 'MATH', status: 'approved' },
          { id: 2, schoolId: null as any, name: 'Historique', code: 'HIST', status: 'pending' },
          { id: 3, schoolId: null as any, name: 'Latin', code: 'LAT' },
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
    expect(screen.getByText('Historique')).toBeDefined();
    expect(screen.queryByText('Latin')).toBeNull();
  });

  it('gère une matière globale approuvée sans type sans la faire disparaître', () => {
    const onUpdateSubject = vi.fn();

    render(
      <SubjectsView
        subjectsList={[
          { id: 1, schoolId: null, name: 'Mathématique', status: 'approved', subjectTypeId: null },
        ]}
        subjectTypesList={[{ id: 7, schoolId: 54, name: 'Scientifique', sortOrder: 0 }]}
        userRole="school_admin"
        schoolId={54}
        onAddSubject={vi.fn()}
        onUpdateSubject={onUpdateSubject}
        onDeleteSubject={vi.fn()}
      />
    );

    expect(screen.getByText('Mathématique')).toBeDefined();
    expect(screen.getByText('Aucun type')).toBeDefined();
    expect(screen.getByRole('button', { name: /modifier/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /modifier/i }));

    const typeSelect = screen.getByLabelText(/type de matière/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe('');
    fireEvent.change(typeSelect, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /mettre à jour/i }));

    expect(onUpdateSubject).toHaveBeenCalledWith(1, {
      name: 'Mathématique',
      code: undefined,
      subjectTypeId: 7,
    });
    expect(screen.getByText('Mathématique')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /modifier/i }));
    fireEvent.change(screen.getByLabelText(/type de matière/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /mettre à jour/i }));

    expect(onUpdateSubject).toHaveBeenLastCalledWith(1, {
      name: 'Mathématique',
      code: undefined,
      subjectTypeId: null,
    });
    expect(screen.getByText('Mathématique')).toBeDefined();
    expect(screen.getByText('Aucun type')).toBeDefined();
  });

  it('ne considère pas une matière globale non attribuée comme approuvée', () => {
    render(
      <SubjectsView
        subjectsList={[]}
        userRole="school_admin"
        schoolId={54}
        onAddSubject={vi.fn()}
        onUpdateSubject={vi.fn()}
        onDeleteSubject={vi.fn()}
      />
    );

    expect(screen.queryByText('Mathématique')).toBeNull();
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
