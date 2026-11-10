import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import TeachingAssignmentsEditor, { type TeachingAssignmentDraft } from './TeachingAssignmentsEditor';

function AssignmentEditorHarness() {
  const [value, setValue] = useState<TeachingAssignmentDraft[]>([]);
  return (
    <TeachingAssignmentsEditor
      classes={[{ id: 53, name: '5ème' }, { id: 54, name: '4ème' }]}
      subjects={[{ id: 10, name: 'Dessin' }, { id: 11, name: 'Mathématiques' }]}
      value={value}
      onChange={setValue}
    />
  );
}

describe('TeachingAssignmentsEditor', () => {
  it('keeps each class paired only with the subject selected on its own row', () => {
    render(<AssignmentEditorHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une affectation' }));
    fireEvent.change(screen.getByLabelText('Classe de l’affectation 1'), { target: { value: '53' } });
    fireEvent.change(screen.getByLabelText('Matière de l’affectation 1'), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une affectation' }));
    fireEvent.change(screen.getByLabelText('Classe de l’affectation 2'), { target: { value: '54' } });
    fireEvent.change(screen.getByLabelText('Matière de l’affectation 2'), { target: { value: '11' } });

    expect((screen.getByLabelText('Classe de l’affectation 1') as HTMLSelectElement).value).toBe('53');
    expect((screen.getByLabelText('Matière de l’affectation 1') as HTMLSelectElement).value).toBe('10');
    expect((screen.getByLabelText('Classe de l’affectation 2') as HTMLSelectElement).value).toBe('54');
    expect((screen.getByLabelText('Matière de l’affectation 2') as HTMLSelectElement).value).toBe('11');
  });
});
