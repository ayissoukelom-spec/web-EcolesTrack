// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../contexts/AuthContext.tsx';
import AdminView from './AdminView';
import AdminModal from './AdminModal';
import type { AcademicYear, Class, Parent, School, Student, Teacher, User } from '../types';

const renderWithAuth = (ui: JSX.Element) => render(<AuthProvider>{ui}</AuthProvider>);

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
    if (!window.location?.origin) {
      Object.defineProperty(window, 'location', {
        value: new URL('http://localhost/'),
        configurable: true,
      });
    }
  });

  it('renders birth date options in a portal so they stay visible inside the student modal', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminModal
        isModalOpen
        onClose={() => undefined}
        activeTab="students"
        handleFormSubmit={() => undefined}
        schoolForm={{ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [], subjectNames: '', selectedSubjectNames: [] }}
        setSchoolForm={() => undefined}
        yearForm={{ name: '', isActive: false, schoolId: '' }}
        setYearForm={() => undefined}
        classForm={{ cycle: '', stream: '', section: '', group: '', schoolId: '' }}
        setClassForm={() => undefined}
        teacherForm={{ name: '', email: '', phone: '', specializations: [], schoolId: '', assignedClassIds: [], gender: '' }}
        setTeacherForm={() => undefined}
        parentForm={{ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', studentId: '', gender: '' }}
        setParentForm={() => undefined}
        studentForm={{ firstName: '', lastName: '', birthDate: '', schoolId: '1', classId: '10', parentId: '', academicYearId: '1', teacherIds: [], schoolAdminId: '', gender: '' }}
        setStudentForm={() => undefined}
        studentError={null}
        newParentMode={false}
        setNewParentMode={() => undefined}
        newParentForm={{ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '1', gender: '' }}
        setNewParentForm={() => undefined}
        newTeacherMode={false}
        setNewTeacherMode={() => undefined}
        newTeacherForm={{ name: '', email: '', phone: '', specializations: [], schoolId: '1', assignedClassIds: [], gender: '' }}
        setNewTeacherForm={() => undefined}
        allowSelectOverflow={false}
        setAllowSelectOverflow={() => undefined}
        sortedParentPhonePrefixes={['+228']}
        teacherSpecializations={[]}
        schoolsList={schools}
        yearsList={years}
        teachersList={teachers}
        parentsList={parents}
        studentsList={students}
        availableSchoolAdmins={users}
        sortedClasses={classes}
        defaultAcademicYearId={1}
        handleSaveNewParent={() => undefined}
        handleSaveNewTeacher={() => undefined}
        userRole="school_admin"
        currentSchoolId={1}
      />
    );

    const dialog = document.querySelector('[role="dialog"]');
    fireEvent.click(screen.getByRole('button', { name: /Jour/i }));
    const dayOption = screen.getByText('01');

    expect(dialog?.contains(dayOption)).toBe(false);
    expect(document.body.contains(dayOption)).toBe(true);
  });

  it('shows school-level parents even when they are not attached to the selected class', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }, { id: 20, name: 'CM2', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [{ id: 55, userId: 6, name: 'Jean Attiogbe', email: 'jean@example.com', phone: '+228 90000000', schoolId: 1, studentSchoolId: 1, studentClassId: 20 }];
    const users: User[] = [];

    render(
      <AdminModal
        isModalOpen
        onClose={() => undefined}
        activeTab="students"
        handleFormSubmit={() => undefined}
        schoolForm={{ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [], subjectNames: '', selectedSubjectNames: [] }}
        setSchoolForm={() => undefined}
        yearForm={{ name: '', isActive: false, schoolId: '' }}
        setYearForm={() => undefined}
        classForm={{ cycle: '', stream: '', section: '', group: '', schoolId: '' }}
        setClassForm={() => undefined}
        teacherForm={{ name: '', email: '', phone: '', specializations: [], schoolId: '', assignedClassIds: [], gender: '' }}
        setTeacherForm={() => undefined}
        parentForm={{ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', studentId: '', gender: '' }}
        setParentForm={() => undefined}
        studentForm={{ firstName: '', lastName: '', birthDate: '', schoolId: '1', classId: '10', parentId: '', academicYearId: '1', teacherIds: [], schoolAdminId: '', gender: '' }}
        setStudentForm={() => undefined}
        studentError={null}
        newParentMode={false}
        setNewParentMode={() => undefined}
        newParentForm={{ name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '1', gender: '' }}
        setNewParentForm={() => undefined}
        newTeacherMode={false}
        setNewTeacherMode={() => undefined}
        newTeacherForm={{ name: '', email: '', phone: '', specializations: [], schoolId: '1', assignedClassIds: [], gender: '' }}
        setNewTeacherForm={() => undefined}
        allowSelectOverflow={false}
        setAllowSelectOverflow={() => undefined}
        sortedParentPhonePrefixes={['+228']}
        teacherSpecializations={[]}
        schoolsList={schools}
        yearsList={years}
        teachersList={teachers}
        parentsList={parents}
        studentsList={students}
        availableSchoolAdmins={users}
        sortedClasses={classes}
        defaultAcademicYearId={1}
        handleSaveNewParent={() => undefined}
        handleSaveNewTeacher={() => undefined}
        userRole="super_admin"
        currentSchoolId={1}
      />
    );

    expect(screen.getByText('Jean Attiogbe')).toBeTruthy();
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

    renderWithAuth(
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

  it('shows configured class groups and filters classes when creating a school', async () => {
    const localStorageMock = window.localStorage as any;
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'ecoletrack-class-groups') {
        return JSON.stringify([{ id: 'ceg', name: 'CEG', classNames: ['6ème', '5ème', '3ème'] }]);
      }
      return null;
    });

    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: '6ème', schoolId: 1, academicYearId: 1 },
      { id: 11, name: '5ème', schoolId: 1, academicYearId: 1 },
      { id: 12, name: '3ème', schoolId: 1, academicYearId: 1 },
      { id: 13, name: '2nde', schoolId: 1, academicYearId: 1 },
    ];

    renderWithAuth(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={[]}
        studentsList={[]}
        parentsList={[]}
        usersList={[]}
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

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    const cegCheckbox = screen.getByRole('checkbox', { name: 'CEG' });
    fireEvent.click(cegCheckbox);

    const sixieme = screen.getByLabelText('6ème') as HTMLInputElement;
    const cinquieme = screen.getByLabelText('5ème') as HTMLInputElement;
    const troisieme = screen.getByLabelText('3ème') as HTMLInputElement;
    const seconde = screen.getByLabelText('2nde') as HTMLInputElement;

    expect(sixieme.checked).toBe(true);
    expect(cinquieme.checked).toBe(true);
    expect(troisieme.checked).toBe(true);
    expect(seconde.checked).toBe(false);
  });

  it('allows selecting multiple class groups at once', async () => {
    const localStorageMock = window.localStorage as any;
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'ecoletrack-class-groups') {
        return JSON.stringify([
          { id: 'ceg', name: 'CEG', classNames: ['6ème', '5ème', '3ème'] },
          { id: 'lycee', name: 'Lycée', classNames: ['2nde', '1ère', 'Tle'] },
        ]);
      }
      return null;
    });

    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: '6ème', schoolId: 1, academicYearId: 1 },
      { id: 11, name: '5ème', schoolId: 1, academicYearId: 1 },
      { id: 12, name: '3ème', schoolId: 1, academicYearId: 1 },
      { id: 13, name: '2nde', schoolId: 1, academicYearId: 1 },
      { id: 14, name: '1ère', schoolId: 1, academicYearId: 1 },
      { id: 15, name: 'Tle', schoolId: 1, academicYearId: 1 },
    ];

    renderWithAuth(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={[]}
        studentsList={[]}
        parentsList={[]}
        usersList={[]}
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

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    const cegCheckbox = screen.getByRole('checkbox', { name: 'CEG' });
    const lyceeCheckbox = screen.getByRole('checkbox', { name: 'Lycée' });
    fireEvent.click(cegCheckbox);
    fireEvent.click(lyceeCheckbox);

    expect(screen.getByLabelText('6ème')).toBeTruthy();
    expect(screen.getByLabelText('2nde')).toBeTruthy();
    expect(screen.getByLabelText('1ère')).toBeTruthy();
    expect(screen.getByLabelText('Tle')).toBeTruthy();
  });

  it('shows an error when creating a school without classes', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    renderWithAuth(
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
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Veuillez sélectionner au moins une classe.');
    expect(onAddSchool).not.toHaveBeenCalled();
  });

  it('shows an error when creating a school without subjects', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: '6ème', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    renderWithAuth(
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
    fireEvent.click(screen.getByLabelText('6ème'));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Veuillez sélectionner au moins une matière.');
    expect(onAddSchool).not.toHaveBeenCalled();
  });

  it('submits a school with required classes and subjects', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: '6ème', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];
    const subjects = [{ id: 1, name: 'Mathématiques', schoolId: 1 }];

    renderWithAuth(
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
    fireEvent.click(screen.getByLabelText('6ème'));
    fireEvent.click(screen.getByLabelText('Mathématiques'));
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect(onAddSchool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'École du Lac',
      phone: '+228 90000000',
      classNames: ['6ème'],
      subjectNames: ['Mathématiques'],
    }));
  });

  it('updates an existing school while preserving the current phone when unchanged', async () => {
    const onUpdateSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: 'Ancienne adresse', phone: '+228 90000000' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    renderWithAuth(
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
        onUpdateSchool={onUpdateSchool}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    fireEvent.click(screen.getByTitle('Éditer'));

    const editDialog = screen.getByRole('dialog', { name: /Modifier l'école/ });
    fireEvent.change(within(editDialog).getByPlaceholderText('C.S LE SAVOIR'), { target: { value: 'École du Lac Modifiée' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: /Enregistrer/i }));

    expect(onUpdateSchool).toHaveBeenCalledWith(1, expect.objectContaining({
      name: 'École du Lac Modifiée',
      address: 'Ancienne adresse',
      phone: '+228 90000000',
    }));
  });

  it('shows an error when creating a school without a name', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    renderWithAuth(
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
    fireEvent.change(screen.getByPlaceholderText('90000000'), { target: { value: '90000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect((await screen.findByRole('alert')).textContent).toContain("Le nom de l'établissement est requis.");
    expect(onAddSchool).not.toHaveBeenCalled();
  });

  it('shows an error when creating a school with an invalid phone number', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    renderWithAuth(
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
    fireEvent.change(screen.getByPlaceholderText('90000000'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Le numéro de téléphone doit contenir exactement 8 chiffres.');
    expect(onAddSchool).not.toHaveBeenCalled();
  });

  it('forwards selected existing subjects when creating a school', async () => {
    const onAddSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: '6ème', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];
    const subjects = [{ id: 1, name: 'Mathématiques', schoolId: 1 }, { id: 2, name: 'Physique', schoolId: 1 }];

    renderWithAuth(
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
    fireEvent.click(screen.getByLabelText('6ème'));

    const subjectPanels = screen.getAllByText('Matières existantes');
    expect(subjectPanels.length).toBeGreaterThan(0);
    const createSchoolPanel = subjectPanels.find((node) => {
      return node.parentElement?.parentElement?.parentElement?.querySelector('input[placeholder="90000000"]');
    });
    expect(createSchoolPanel).toBeTruthy();
    if (createSchoolPanel) {
      const section = createSchoolPanel.closest('div');
      expect(section).toBeTruthy();
      if (section) {
        fireEvent.click(within(section).getByLabelText('Mathématiques'));
      }
    }
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    expect(onAddSchool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'École du Lac',
      phone: '+228 90000000',
      classNames: ['6ème'],
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

    renderWithAuth(
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

  it('shows the creation date column and filters accounts by creation date', () => {
    const currentYear = new Date().getFullYear();
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [
      { id: 1, uid: 'u1', email: 'alice@example.com', name: 'Alice Martin', role: 'teacher', schoolId: 1, createdAt: new Date(currentYear, 5, 1, 12, 0, 0).toISOString() },
      { id: 2, uid: 'u2', email: 'bob@example.com', name: 'Bob Durand', role: 'parent', schoolId: 1, createdAt: new Date(currentYear - 1, 5, 1, 12, 0, 0).toISOString() },
    ];

    renderWithAuth(
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
        onDeleteUser={() => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Comptes/i }));

    expect(screen.getByText('Date de création')).toBeTruthy();
    expect(screen.getByText((content, element) => content.startsWith(`01/06/${currentYear}`))).toBeTruthy();

    const dateFilter = screen.getByLabelText(/Filtrer par date de création/i);
    fireEvent.change(dateFilter, { target: { value: 'thisYear' } });

    expect(screen.getByText((content, element) => content.startsWith(`01/06/${currentYear}`))).toBeTruthy();
    expect(screen.queryByText((content, element) => content.startsWith(`01/06/${currentYear - 1}`))).toBeNull();
  });

  it('hides the edit button for teachers in the teachers list', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [{ id: 1, userId: 2, name: 'Alice Martin', email: 'alice@example.com', schoolId: 1, classIds: [10] }];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [{ id: 2, uid: 'u2', email: 'alice@example.com', name: 'Alice Martin', role: 'teacher', schoolId: 1 }];

    renderWithAuth(
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

    renderWithAuth(
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

    renderWithAuth(
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
