import { Plus, Trash2 } from 'lucide-react';

export interface TeachingAssignmentDraft {
  classId: number | null;
  subjectId: number | null;
}

interface TeachingAssignmentsEditorProps {
  classes: Array<{ id: number; name: string }>;
  subjects: Array<{ id: number; name: string }>;
  value: TeachingAssignmentDraft[];
  onChange: (value: TeachingAssignmentDraft[]) => void;
}

export default function TeachingAssignmentsEditor({ classes, subjects, value, onChange }: TeachingAssignmentsEditorProps) {
  const update = (index: number, field: keyof TeachingAssignmentDraft, rawValue: string) => {
    const next = value.map((assignment, assignmentIndex) => assignmentIndex === index
      ? { ...assignment, [field]: rawValue ? Number(rawValue) : null }
      : assignment);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {value.map((assignment, index) => (
          <div key={`${index}-${assignment.classId ?? 'class'}-${assignment.subjectId ?? 'subject'}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2">
            <select
              aria-label={`Classe de l’affectation ${index + 1}`}
              className="min-w-0 rounded border border-slate-300 bg-white px-2 py-2 text-sm"
              value={assignment.classId ?? ''}
              onChange={(event) => update(index, 'classId', event.target.value)}
            >
              <option value="">Classe</option>
              {classes.map((classOption) => <option key={classOption.id} value={classOption.id}>{classOption.name}</option>)}
            </select>
            <select
              aria-label={`Matière de l’affectation ${index + 1}`}
              className="min-w-0 rounded border border-slate-300 bg-white px-2 py-2 text-sm"
              value={assignment.subjectId ?? ''}
              onChange={(event) => update(index, 'subjectId', event.target.value)}
            >
              <option value="">Matière</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
            <button
              type="button"
              aria-label={`Supprimer l’affectation ${index + 1}`}
              title="Supprimer l’affectation"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
              onClick={() => onChange(value.filter((_, assignmentIndex) => assignmentIndex !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        onClick={() => onChange([...value, { classId: null, subjectId: null }])}
      >
        <Plus className="h-4 w-4" />
        Ajouter une affectation
      </button>
    </div>
  );
}