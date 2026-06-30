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
});
