// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminView from './AdminView';
import type { AcademicYear, Class, Parent, School, Student, Teacher, User } from '../types';

describe('AdminView create-user teacher form', () => {
  it('shows immediate class-selection feedback when a teacher class is checked', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Créer un compte/i }));

    const roleSelect = screen.getByLabelText(/Rôle/i);
    fireEvent.change(roleSelect, { target: { value: 'teacher' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /CM1/i }));

    expect(screen.getByText(/Les classes sélectionnées seront directement associées à l’enseignant/i)).toBeTruthy();
    expect(screen.getAllByText(/CM1/i).length).toBeGreaterThan(0);
  });
});
