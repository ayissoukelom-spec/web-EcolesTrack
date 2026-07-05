// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminView from './AdminView';
import type { AcademicYear, Class, Parent, School, Student, Teacher, User } from '../types';

describe('AdminView create-user teacher form', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
    });
  });

  it('keeps the reject action available for approved classes', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1, status: 'approved' },
    ];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminView
        userRole="school_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
        onApproveClass={async () => undefined}
        onRejectClass={async () => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Classes/i }));

    expect(screen.getByRole('button', { name: /Refuser/i })).toBeTruthy();
  });

  it('forwards entered subject names when creating a school', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={onAddSchool}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    fireEvent.change(screen.getByPlaceholderText('Lycée de Lomé'), { target: { value: 'École du Lac' } });
    fireEvent.change(screen.getByPlaceholderText('90000000'), { target: { value: '90000000' } });
    fireEvent.change(screen.getByLabelText(/Matières à créer/i), { target: { value: 'Mathématiques\nPhysique' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect(onAddSchool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'École du Lac',
      phone: '+228 90000000',
      subjectNames: ['Mathématiques', 'Physique'],
    }));
  });

  it('forwards selected existing subjects when creating a school', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];
    const subjects = [{ id: 1, name: 'Mathématiques', schoolId: 1 }, { id: 2, name: 'Physique', schoolId: 1 }];

    render(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        subjectsList={subjects}
        onAddSchool={onAddSchool}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    fireEvent.change(screen.getByPlaceholderText('Lycée de Lomé'), { target: { value: 'École du Lac' } });
    fireEvent.change(screen.getByPlaceholderText('90000000'), { target: { value: '90000000' } });
    fireEvent.click(screen.getByLabelText('Mathématiques'));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect(onAddSchool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'École du Lac',
      phone: '+228 90000000',
      subjectNames: ['Mathématiques'],
    }));
  });

  it('does not show the create account button in the accounts tab', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 },
      { id: 11, name: 'CM2', schoolId: 1, academicYearId: 1 },
    ];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Comptes/i }));

    expect(screen.queryByRole('button', { name: /Créer un compte/i })).toBeNull();
  });

  it('hides the edit button for teachers in the teachers list', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [{ id: 1, userId: 2, name: 'Alice Martin', email: 'alice@example.com', schoolId: 1, classIds: [10] }];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [{ id: 2, uid: 'u2', email: 'alice@example.com', name: 'Alice Martin', role: 'teacher', schoolId: 1 }];

    render(
      <AdminView
        userRole="teacher"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));

    expect(screen.queryByRole('button', { name: /Modifier/i })).toBeNull();
  });

  it('hides the parents and tutors tab for the teacher role', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminView
        userRole="teacher"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    expect(screen.queryByRole('button', { name: /Parents & Tuteurs/i })).toBeNull();
  });

  it('shows only teachers from the same class for a teacher role', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }, { id: 20, name: 'CM2', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [
      { id: 1, userId: 2, name: 'Alice Martin', email: 'alice@example.com', schoolId: 1, classIds: [10] },
      { id: 2, userId: 3, name: 'Bob Durand', email: 'bob@example.com', schoolId: 1, classIds: [20] },
    ];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [
      { id: 2, uid: 'u2', email: 'alice@example.com', name: 'Alice Martin', role: 'teacher', schoolId: 1 },
    ];

    const storage = window.localStorage as any;
    storage.getItem.mockImplementation((key: string) => {
      if (key === 'ecoletrack_simulated_role') return 'teacher';
      if (key === 'ecoletrack_simulated_user') return JSON.stringify({ uid: 'u2', email: 'alice@example.com', name: 'Alice Martin', schoolId: 1 });
      return null;
    });

    render(
      <AdminView
        userRole="teacher"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={teachers}
        studentsList={students}
        parentsList={parents}
        usersList={users}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onCreateUser={async () => ({})}
        onUpdateUser={async () => ({})}
        onSetPassword={async () => ({})}
        onDeleteUser={async () => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));

    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(screen.queryByText('Bob Durand')).toBeNull();
  });
});
