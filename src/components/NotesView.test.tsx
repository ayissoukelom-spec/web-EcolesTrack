import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotesView from './NotesView';
import type { Class, Evaluation, Grade, Student } from '../types';

afterEach(() => {
  cleanup();
});

describe('NotesView school admin editing', () => {
  it('keeps the local input value while saving and locks the field after the first save', async () => {
    const student: Student = {
      id: 1,
      firstName: 'Ada',
      lastName: 'Lovelace',
      classId: 10,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 10,
      name: '6e A',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 55,
      classId: 10,
      subject: 'Mathématiques',
      title: 'Devoir 1',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-01',
      teacherId: 2,
      createdAt: '2024-02-01',
    } as Evaluation;

    const initialGrade: Grade = {
      id: 99,
      evaluationId: 55,
      studentId: 1,
      score: '12',
      remarks: 'À améliorer',
      editCount: 0,
    } as Grade;

    function Wrapper() {
      const [grades, setGrades] = useState<Grade[]>([initialGrade]);

      return (
        <NotesView
          userRole="school_admin"
          evaluationsList={[evaluation]}
          gradesList={grades}
          studentsList={[student]}
          classesList={[schoolClass]}
          schoolsList={[]}
          onAddEvaluation={() => undefined}
          onAddGrade={async (data) => {
            setGrades((prev) => prev.map((grade) =>
              grade.studentId === data.studentId && grade.evaluationId === data.evaluationId
                ? { ...grade, score: data.score, remarks: data.remarks, editCount: 1 }
                : grade
            ));
          }}
        />
      );
    }

    render(<Wrapper />);

    const scoreInput = screen.getByPlaceholderText('ex. 12.5');
    expect(scoreInput.hasAttribute('readonly')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /modifier les notes/i }));
    expect(scoreInput.hasAttribute('readonly')).toBe(false);

    fireEvent.change(scoreInput, { target: { value: '14' } });
    expect((scoreInput as HTMLInputElement).value).toBe('14');

    fireEvent.click(screen.getByRole('button', { name: /enregistrer tout/i }));

    await waitFor(() => expect(screen.getByPlaceholderText('ex. 12.5').hasAttribute('readonly')).toBe(true));
    expect((screen.getByPlaceholderText('ex. 12.5') as HTMLInputElement).value).toBe('14');
  });
});

describe('NotesView grade input regression guards', () => {
  it('shows a modified-grade badge for grades marked as modified', async () => {
    const student: Student = {
      id: 6,
      firstName: 'Margaret',
      lastName: 'Hamilton',
      classId: 14,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 14,
      name: '4e A',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 60,
      classId: 14,
      subject: 'Mathématiques',
      title: 'Devoir 3',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-20',
      teacherId: 42,
      createdAt: '2024-02-20',
    } as Evaluation;

    render(
      <NotesView
        userRole="teacher"
        teacherId={42}
        teacherClassIds={[14]}
        evaluationsList={[evaluation]}
        gradesList={[
          {
            id: 101,
            evaluationId: 60,
            studentId: 6,
            score: '12',
            remarks: 'Initial',
            editCount: 1,
            createdAt: '2024-02-20T10:00:00.000Z',
            updatedAt: '2024-02-20T11:30:00.000Z',
          } as Grade,
        ]}
        studentsList={[student]}
        classesList={[schoolClass]}
        schoolsList={[]}
        onAddEvaluation={() => undefined}
        onAddGrade={async () => undefined}
      />
    );

    expect(screen.getByText(/note modifiée/i)).toBeTruthy();
  });

  it('shows a new-grade badge for grades not marked as modified', async () => {
    const student: Student = {
      id: 7,
      firstName: 'Katherine',
      lastName: 'Johnson',
      classId: 15,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 15,
      name: '3e B',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 61,
      classId: 15,
      subject: 'Mathématiques',
      title: 'Devoir 4',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-25',
      teacherId: 42,
      createdAt: '2024-02-25',
    } as Evaluation;

    render(
      <NotesView
        userRole="teacher"
        teacherId={42}
        teacherClassIds={[15]}
        evaluationsList={[evaluation]}
        gradesList={[
          {
            id: 102,
            evaluationId: 61,
            studentId: 7,
            score: '13',
            remarks: 'Initial',
            editCount: 0,
            createdAt: '2024-02-25T10:00:00.000Z',
            updatedAt: '2024-02-25T10:00:00.000Z',
            isModified: false,
          } as Grade,
        ]}
        studentsList={[student]}
        classesList={[schoolClass]}
        schoolsList={[]}
        onAddEvaluation={() => undefined}
        onAddGrade={async () => undefined}
      />
    );

    expect(screen.getByText(/nouvelle note/i)).toBeTruthy();
  });

  it('allows the teacher to type a new grade and save it for own evaluation', async () => {
    const student: Student = {
      id: 2,
      firstName: 'Alan',
      lastName: 'Turing',
      classId: 10,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 10,
      name: '6e A',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 56,
      classId: 10,
      subject: 'Mathématiques',
      title: 'Devoir 2',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-05',
      teacherId: 42,
      createdAt: '2024-02-05',
    } as Evaluation;

    let savedPayload: any = null;

    render(
      <NotesView
        userRole="teacher"
        teacherId={42}
        teacherClassIds={[10]}
        evaluationsList={[evaluation]}
        gradesList={[]}
        studentsList={[student]}
        classesList={[schoolClass]}
        schoolsList={[]}
        onAddEvaluation={() => undefined}
        onAddGrade={async (data) => {
          savedPayload = data;
        }}
      />
    );

    const scoreInput = screen.getByPlaceholderText('ex. 12.5');
    expect(scoreInput.hasAttribute('readonly')).toBe(false);
    expect(screen.queryByRole('button', { name: /modifier les notes/i })).toBeNull();

    fireEvent.change(scoreInput, { target: { value: '17' } });
    expect((scoreInput as HTMLInputElement).value).toBe('17');

    fireEvent.click(screen.getByRole('button', { name: /enregistrer tout/i }));

    await waitFor(() => expect(savedPayload).not.toBeNull());
    expect(savedPayload.score).toBe('17');
  });

  it('keeps super admin typed value after an unrelated rerender with school filter active', () => {
    const student: Student = {
      id: 3,
      firstName: 'Grace',
      lastName: 'Hopper',
      classId: 11,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const evaluation: Evaluation = {
      id: 57,
      classId: 11,
      subject: 'Français',
      title: 'Dictée',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-10',
      teacherId: 7,
      createdAt: '2024-02-10',
    } as Evaluation;

    function Wrapper() {
      const [tick, setTick] = useState(0);
      const classesList: Class[] = [
        { id: 11, name: '5e B', schoolId: 1, academicYearId: 1 } as Class,
      ];

      return (
        <div>
          <button type="button" onClick={() => setTick((v) => v + 1)}>rerender-{tick}</button>
          <NotesView
            userRole="super_admin"
            schoolFilterId={1}
            onSchoolFilterChange={() => undefined}
            evaluationsList={[evaluation]}
            gradesList={[]}
            studentsList={[student]}
            classesList={classesList}
            schoolsList={[{ id: 1, name: 'Ecole 1' }]}
            onAddEvaluation={() => undefined}
            onAddGrade={async () => undefined}
          />
        </div>
      );
    }

    render(<Wrapper />);

    const scoreInput = screen.getByPlaceholderText('ex. 12.5');
    expect(scoreInput.hasAttribute('readonly')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /modifier les notes/i }));
    expect(scoreInput.hasAttribute('readonly')).toBe(false);

    fireEvent.change(scoreInput, { target: { value: '18' } });
    expect((scoreInput as HTMLInputElement).value).toBe('18');

    fireEvent.click(screen.getByRole('button', { name: /rerender-/i }));
    expect((screen.getByPlaceholderText('ex. 12.5') as HTMLInputElement).value).toBe('18');
  });

  it('accepts only numeric values during typing and allows one decimal separator', () => {
    const student: Student = {
      id: 4,
      firstName: 'Marie',
      lastName: 'Curie',
      classId: 12,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 12,
      name: '4e C',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 58,
      classId: 12,
      subject: 'Mathématiques',
      title: 'Contrôle',
      coefficient: 1,
      maxScore: 20,
      date: '2024-02-12',
      teacherId: 42,
      createdAt: '2024-02-12',
    } as Evaluation;

    render(
      <NotesView
        userRole="teacher"
        teacherId={42}
        teacherClassIds={[12]}
        evaluationsList={[evaluation]}
        gradesList={[]}
        studentsList={[student]}
        classesList={[schoolClass]}
        schoolsList={[]}
        onAddEvaluation={() => undefined}
        onAddGrade={async () => undefined}
      />
    );

    const scoreInput = screen.getByPlaceholderText('ex. 12.5') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '1a' } });
    expect(scoreInput.value).toBe('');

    fireEvent.change(scoreInput, { target: { value: '12,5' } });
    expect(scoreInput.value).toBe('12,5');
  });

  it('rejects out-of-range values before save with a clear message', async () => {
    const student: Student = {
      id: 5,
      firstName: 'Isaac',
      lastName: 'Newton',
      classId: 13,
      schoolId: 1,
      enrolledAt: '2024-01-01',
    } as Student;

    const schoolClass: Class = {
      id: 13,
      name: '3e A',
      schoolId: 1,
      academicYearId: 1,
    } as Class;

    const evaluation: Evaluation = {
      id: 59,
      classId: 13,
      subject: 'Mathématiques',
      title: 'Test',
      coefficient: 1,
      maxScore: 10,
      date: '2024-02-15',
      teacherId: 42,
      createdAt: '2024-02-15',
    } as Evaluation;

    let saveCalls = 0;

    render(
      <NotesView
        userRole="teacher"
        teacherId={42}
        teacherClassIds={[13]}
        evaluationsList={[evaluation]}
        gradesList={[]}
        studentsList={[student]}
        classesList={[schoolClass]}
        schoolsList={[]}
        onAddEvaluation={() => undefined}
        onAddGrade={async () => {
          saveCalls += 1;
        }}
      />
    );

    const scoreInput = screen.getByPlaceholderText('ex. 12.5') as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer tout/i }));

    await waitFor(() => expect(screen.getByText(/comprise entre 0 et 10/i)).not.toBeNull());
    expect(saveCalls).toBe(0);
  });
});
