// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../contexts/AuthContext.tsx';
import AdminView from './AdminView';
import AdminModal from './AdminModal';
import type { AcademicYear, Class, Parent, School, Student, Teacher, User } from '../types';
import { readFirstExcelSheetRecords } from '../lib/excelImport';
import { apiFetch } from '../lib/api';

const renderWithAuth = (ui: JSX.Element) => render(<AuthProvider>{ui}</AuthProvider>);
const getPrimarySchoolPhoneInput = () => screen.getAllByPlaceholderText('90000000')[0] as HTMLInputElement;

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

  it('loads titular assignments in an explicit school scope', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/schools/1/homeroom-assignments')) {
        return new Response(JSON.stringify([{ classId: 10, teacherId: 22, teacherName: 'Titulaire' }]), { status: 200 });
      }
      if (url.includes('/api/classes?schoolId=1')) {
        return new Response(JSON.stringify([{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1, teacherId: 99 }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      renderWithAuth(
        <AdminView
          userRole="super_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
          yearsList={[]}
          classesList={[{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1, teacherId: 99 }]}
          teachersList={[{ id: 22, name: 'Titulaire', schoolId: 1 } as Teacher]}
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
          currentSchoolId={1}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));
      fireEvent.click(screen.getByRole('button', { name: /Assigner des enseignants titulaires/i }));
      fireEvent.change(screen.getByLabelText('Filtrer par école'), { target: { value: '1' } });

      expect(await screen.findByText('Titulaire : Titulaire')).toBeTruthy();
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/schools/1/homeroom-assignments'), expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('shows the refreshed titular in the Classes table after saving an assignment', async () => {
    const refreshedClasses: Class[] = [{
      id: 10,
      name: 'CM1',
      schoolId: 1,
      academicYearId: 1,
      teacherId: 22,
      teacherName: 'Nouveau titulaire',
    }];
    const refreshClasses = vi.fn().mockResolvedValue(refreshedClasses);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/schools/1/homeroom-assignments')) {
        return new Response(JSON.stringify([{ classId: 10, teacherId: 99 }]), { status: 200 });
      }
      if (url.includes('/api/classes?schoolId=1')) {
        return new Response(JSON.stringify([{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1, teacherId: 99, teacherName: 'Ancien titulaire' }]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      renderWithAuth(
        <AdminView
          userRole="school_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
          yearsList={[]}
          classesList={[{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1, teacherId: 99, teacherName: 'Ancien titulaire' }]}
          teachersList={[
            { id: 99, name: 'Ancien titulaire', schoolId: 1 } as Teacher,
            { id: 22, name: 'Nouveau titulaire', schoolId: 1 } as Teacher,
          ]}
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
          currentSchoolId={1}
          onRefreshClasses={refreshClasses}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));
      fireEvent.click(screen.getByRole('button', { name: /Assigner des enseignants titulaires/i }));
      expect(await screen.findByText('Titulaire : Ancien titulaire')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
      const teacherSelect = screen.getAllByRole('combobox').find((select) => select.querySelector('option[value="22"]'));
      expect(teacherSelect).toBeTruthy();
      fireEvent.change(teacherSelect!, { target: { value: '22' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      expect(await screen.findByText(/Classe mise à jour avec succès/)).toBeTruthy();
      expect(refreshClasses).toHaveBeenCalledWith(1);
      fireEvent.click(screen.getByRole('button', { name: /^Classes$/i }));
      expect(await screen.findByText('Nouveau titulaire')).toBeTruthy();
      expect(screen.queryByText('Ancien titulaire')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
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

  it('renders separate last-name and first-name fields for teacher creation', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 }, { id: 20, name: 'CM2', schoolId: 1, academicYearId: 1 }];
    const teachers: Teacher[] = [];
    const students: Student[] = [];
    const parents: Parent[] = [];
    const users: User[] = [];

    render(
      <AdminModal
        isModalOpen
        onClose={() => undefined}
        activeTab="teachers"
        handleFormSubmit={() => undefined}
        schoolForm={{ name: '', address: '', phone: '', phoneDigits: '', selectedClassNames: [], subjectNames: '', selectedSubjectNames: [] }}
        setSchoolForm={() => undefined}
        yearForm={{ name: '', isActive: false, schoolId: '' }}
        setYearForm={() => undefined}
        classForm={{ cycle: '', stream: '', section: '', group: '', schoolId: '' }}
        setClassForm={() => undefined}
        teacherForm={{ name: '', lastName: 'MASSEDA', firstNames: 'Ghislain Ikechuku', email: 'prof@ecoletrack.fr', phone: '90000000', specializations: [], schoolId: '1', assignedClassIds: [10], gender: 'M' }}
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
        newTeacherForm={{ name: '', lastName: '', firstNames: '', email: '', phone: '', specializations: [], schoolId: '1', assignedClassIds: [10], gender: '' }}
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

    expect(screen.getByDisplayValue('MASSEDA')).toBeTruthy();
    expect(screen.getByDisplayValue('Ghislain Ikechuku')).toBeTruthy();
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

  it('filters the parents list by email case-insensitively', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const parents: Parent[] = [
      { id: 55, userId: 6, name: 'Awa Mensah', email: 'awa@gmail.com', phone: '+228 90000000', schoolId: 1 },
      { id: 56, userId: 7, name: 'Kossi Doe', email: 'kossi@example.com', phone: '+228 90000001', schoolId: 1 },
      { id: 57, userId: 8, name: 'Parent sans email', email: null, phone: '+228 90000002', schoolId: 1 },
    ];

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={schools}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={parents}
        usersList={[]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
    expect(screen.getByText('Effectif total : 3 parents')).toBeTruthy();
    expect(screen.getByText('Awa Mensah')).toBeTruthy();
    expect(screen.getByText('Kossi Doe')).toBeTruthy();
    expect(screen.getByText('Parent sans email')).toBeTruthy();

    const emailSearch = screen.getByLabelText(/Rechercher par email/i);
    fireEvent.change(emailSearch, { target: { value: 'AWA@GMAIL.COM' } });
    expect(screen.getByText('Effectif total : 3 parents')).toBeTruthy();
    expect(screen.getByText('Awa Mensah')).toBeTruthy();
    expect(screen.queryByText('Kossi Doe')).toBeNull();
    expect(screen.queryByText('Parent sans email')).toBeNull();

    fireEvent.change(emailSearch, { target: { value: 'absent@example.com' } });
    expect(screen.queryByText('Awa Mensah')).toBeNull();
    expect(screen.queryByText('Kossi Doe')).toBeNull();
    expect(screen.queryByText('Parent sans email')).toBeNull();

    fireEvent.change(emailSearch, { target: { value: '' } });
    const parentSearch = screen.getByPlaceholderText('Nom, prénom ou téléphone...');
    fireEvent.change(parentSearch, { target: { value: '00 00 000' } });
    expect(screen.getByText('Awa Mensah')).toBeTruthy();
    expect(screen.queryByText('Kossi Doe')).toBeNull();
    expect(screen.queryByText('Parent sans email')).toBeNull();

    fireEvent.change(parentSearch, { target: { value: '22890000001' } });
    expect(screen.getByText('Kossi Doe')).toBeTruthy();
    expect(screen.queryByText('Awa Mensah')).toBeNull();

    fireEvent.change(parentSearch, { target: { value: 'Parent sans email' } });
    expect(screen.getByText('Parent sans email')).toBeTruthy();
    expect(screen.queryByText('Awa Mensah')).toBeNull();
  });

  it('preserves the parent country calling code when editing a stored international number', async () => {
    const onUpdateUser = vi.fn().mockResolvedValue({});
    const parent: Parent = {
      id: 55,
      userId: 6,
      name: 'Awa Mensah',
      email: 'awa@example.com',
      phone: '+229 78 23 45 67',
      schoolId: 1,
    };
    const user: User = { id: 6, uid: 'parent_6', email: 'awa@example.com', name: 'Awa Mensah', role: 'parent', schoolId: 1 };

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={[parent]}
        usersList={[user]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onUpdateUser={onUpdateUser}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));

    const editDialog = screen.getByRole('dialog');
    expect((within(editDialog).getByLabelText('Indicatif du téléphone parent') as HTMLSelectElement).value).toBe('+229');
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Enregistrer' }));

    expect(onUpdateUser).toHaveBeenCalledWith(6, expect.objectContaining({ phone: '+229 78234567' }));
  });

  it('sends updated teacher family and given names separately when editing', async () => {
    const onUpdateUser = vi.fn().mockResolvedValue({});
    const user: User = {
      id: 702,
      uid: 'teacher_702',
      email: 'teacher@example.test',
      name: 'KANGNI SOUKPE Parfait',
      lastName: 'KANGNI SOUKPE',
      firstNames: 'Parfait',
      role: 'teacher',
      schoolId: 1,
      phone: '+22890000000',
    };
    const teacher: Teacher = {
      id: 32,
      userId: 702,
      email: user.email!,
      name: user.name,
      lastName: user.lastName,
      firstNames: user.firstNames,
      schoolId: 1,
      phone: user.phone,
      classIds: [],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    try {
      renderWithAuth(
        <AdminView
          userRole="super_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
          yearsList={[]}
          classesList={[]}
          teachersList={[teacher]}
          studentsList={[]}
          parentsList={[]}
          usersList={[user]}
          onAddSchool={async () => ({})}
          onAddYear={() => undefined}
          onAddClass={async () => undefined}
          onAddTeacher={async () => ({})}
          onAddParent={async () => ({})}
          onAddStudent={() => undefined}
          onDeleteClass={() => undefined}
          onDeleteSchool={() => undefined}
          onUpdateUser={onUpdateUser}
          currentSchoolId={1}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));

      const editDialog = screen.getByRole('dialog');
      fireEvent.change(within(editDialog).getByPlaceholderText('Nom de famille'), { target: { value: 'KANGNI-SOUKPE' } });
      fireEvent.click(within(editDialog).getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        expect(onUpdateUser).toHaveBeenCalledWith(702, expect.objectContaining({
          name: 'KANGNI-SOUKPE Parfait',
          lastName: 'KANGNI-SOUKPE',
          firstNames: 'Parfait',
        }));
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('updates a parent without an email or student without calling trim on null', async () => {
    const onUpdateUser = vi.fn().mockResolvedValue({});
    const parent: Parent = {
      id: 55,
      userId: 6,
      name: 'Awa Mensah',
      email: null,
      phone: '+228 90000000',
      schoolId: 1,
    };
    const user: User = { id: 6, uid: 'parent_6', email: null, name: 'Awa Mensah', role: 'parent', schoolId: 1 };

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={[parent]}
        usersList={[user]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onUpdateUser={onUpdateUser}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    const editDialog = screen.getByRole('dialog');
    fireEvent.change(within(editDialog).getByPlaceholderText('M. Koffi'), { target: { value: 'Awa Updated' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Enregistrer' }));

    expect(onUpdateUser).toHaveBeenCalledWith(6, expect.objectContaining({
      email: '',
      name: 'Awa Updated',
      studentId: undefined,
    }));
  });

  it('recognizes a legacy full +228 number stored without a plus sign', async () => {
    const parent: Parent = {
      id: 55,
      userId: 6,
      name: 'Awa Mensah',
      email: 'awa@example.com',
      phone: '22878234567',
      schoolId: 1,
    };
    const user: User = { id: 6, uid: 'parent_6', email: 'awa@example.com', name: 'Awa Mensah', role: 'parent', schoolId: 1 };

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={[parent]}
        usersList={[user]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        onUpdateUser={async () => ({})}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));

    const editDialog = screen.getByRole('dialog');
    expect((within(editDialog).getByLabelText('Indicatif du téléphone parent') as HTMLSelectElement).value).toBe('+228');
    expect((within(editDialog).getByPlaceholderText('Numéro local') as HTMLInputElement).value).toBe('78234567');
  });

  it('sorts the visible parents list alphabetically by name in the DOM', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const parents: Parent[] = [
      { id: 55, userId: 6, name: 'tano Moussa', email: 'tano@example.com', phone: '+228 90000000', schoolId: 1 },
      { id: 56, userId: 7, name: 'Koffi Awa', email: 'koffi@example.com', phone: '+228 90000001', schoolId: 1 },
      { id: 57, userId: 8, name: 'amani Koffi', email: 'amani@example.com', phone: '+228 90000002', schoolId: 1 },
      { id: 58, userId: 9, name: 'Élodie Yao', email: 'elodie@example.com', phone: '+228 90000003', schoolId: 1 },
    ];

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={schools}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={parents}
        usersList={[]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));

    const renderedNames = Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => !row.querySelector('td[colspan]'))
      .map((row) => row.querySelector('td')?.textContent?.trim());

    expect(renderedNames).toEqual(['amani Koffi', 'Élodie Yao', 'Koffi Awa', 'tano Moussa']);
  });

  it('keeps student edit actions visible and exports the filtered roster', async () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const students: Student[] = [
      { id: 1, firstName: 'Moussa', lastName: 'Tano', schoolId: 1, classId: 11, className: 'CM2', yearName: '2024-2025', parentName: 'Parent Tano' },
      { id: 2, firstName: 'Awa', lastName: 'Amani', schoolId: 1, classId: 10, className: 'CM1', yearName: '2024-2025', parentName: 'Parent Amani' },
      { id: 3, firstName: 'Kossi', lastName: 'Ancien', schoolId: 1, classId: null, className: '', parentName: 'Parent Ancien', isActive: false, withdrawnAt: '2026-09-01T10:00:00.000Z' },
    ];
    const originalCreateObjectURL = (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
    const originalRevokeObjectURL = (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:students');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      renderWithAuth(
        <AdminView
          userRole="super_admin"
          schoolsList={schools}
          yearsList={[]}
          classesList={[]}
          teachersList={[]}
          studentsList={students}
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
          currentSchoolId={1}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Élèves/i }));
      const closeButton = screen.getByRole('button', { name: 'Clôturer' });
      const createButton = screen.getByRole('button', { name: 'Créer un élève' });
      expect(closeButton.className).toContain('shrink-0');
      expect(createButton.className).toContain('shrink-0');
      expect(closeButton.parentElement).toBe(createButton.parentElement);
      expect(closeButton.parentElement?.className).toContain('flex-wrap');
      const studentExportButton = screen.getByRole('button', { name: 'Télécharger Excel' });
      fireEvent.click(studentExportButton);
      expect(screen.getByRole('button', { name: /Téléchargement en cours…/i }).hasAttribute('disabled')).toBe(true);
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Télécharger Excel' }).hasAttribute('disabled')).toBe(false));
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      const rows = await readFirstExcelSheetRecords(await blob.arrayBuffer());

      expect(click).toHaveBeenCalled();
      expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('liste-eleves-actifs.xlsx');
      expect(rows).toEqual([
        { Nom: 'Amani', 'Prénom': 'Awa', Classe: 'CM1', 'Année scolaire': '2024-2025', Tuteur: 'Parent Amani' },
        { Nom: 'Tano', 'Prénom': 'Moussa', Classe: 'CM2', 'Année scolaire': '2024-2025', Tuteur: 'Parent Tano' },
      ]);

      fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'former' } });
      expect(screen.getByText(/Ancien élève/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Télécharger Excel' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
      const formerBlob = createObjectURL.mock.calls[1][0] as Blob;
      const formerRows = await readFirstExcelSheetRecords(await formerBlob.arrayBuffer());
      expect((click.mock.instances[1] as HTMLAnchorElement).download).toBe('liste-anciens-eleves.xlsx');
      expect(formerRows).toEqual([
        { Nom: 'Ancien', 'Prénom': 'Kossi', Classe: '', 'Année scolaire': '', Tuteur: 'Parent Ancien' },
      ]);

      fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'all' } });
      expect(screen.getByText(/Ancien élève/)).toBeTruthy();
      const allStudentRows = Array.from(document.querySelectorAll('tbody tr'))
        .filter((row) => !row.querySelector('td[colspan]'));
      expect(allStudentRows).toHaveLength(3);
      expect(allStudentRows.some((row) => row.textContent?.includes('Awa'))).toBe(true);
      expect(allStudentRows.some((row) => row.textContent?.includes('Kossi'))).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Télécharger Excel' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(3));
      const allBlob = createObjectURL.mock.calls[2][0] as Blob;
      const allRows = await readFirstExcelSheetRecords(await allBlob.arrayBuffer());
      expect((click.mock.instances[2] as HTMLAnchorElement).download).toBe('liste-eleves.xlsx');
      expect((allRows as Array<{ Nom: string }>).map((row) => row.Nom)).toEqual(expect.arrayContaining(['Amani', 'Ancien', 'Tano']));

      fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[0]);
      const studentDialog = screen.getByRole('dialog', { name: "Modifier l'élève" });
      expect(within(studentDialog).getByRole('button', { name: 'Annuler' })).toBeTruthy();
      expect(within(studentDialog).getByRole('button', { name: 'Enregistrer' })).toBeTruthy();
      expect(within(studentDialog).getByRole('button', { name: 'Retirer de la classe' })).toBeTruthy();

      const scrollBody = studentDialog.querySelector('.overflow-y-auto');
      const footer = within(studentDialog).getByRole('button', { name: 'Annuler' }).parentElement;
      expect(scrollBody?.className).toContain('min-h-0');
      expect(scrollBody?.className).toContain('flex-1');
      expect(footer?.className).toContain('flex-wrap');
      expect(footer?.className).toContain('shrink-0');
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      else delete (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
      else delete (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
      click.mockRestore();
    }
  });

  it('exports the sorted visible parents as an Excel workbook', async () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const parents: Parent[] = [
      { id: 1, userId: 1, name: 'Tano Moussa', email: 'tano@example.com', phone: '+228 90000001', address: 'Rue Tano', schoolId: 1, studentFirstName: 'Kossi', studentLastName: 'Tano', schoolName: 'École du Lac' },
      { id: 2, userId: 2, name: 'Amani Awa', email: 'amani@example.com', phone: '+228 90000002', address: 'Rue Amani', schoolId: 1, studentFirstName: 'Ali', studentLastName: 'Amani', schoolName: 'École du Lac' },
    ];
    const originalCreateObjectURL = (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
    const originalRevokeObjectURL = (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:parents');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      renderWithAuth(
        <AdminView
          userRole="school_admin"
          schoolsList={schools}
          yearsList={[]}
          classesList={[]}
          teachersList={[]}
          studentsList={[]}
          parentsList={parents}
          usersList={[]}
          onAddSchool={async () => ({})}
          onAddYear={() => undefined}
          onAddClass={async () => undefined}
          onAddTeacher={async () => ({})}
          onAddParent={async () => ({})}
          onAddStudent={() => undefined}
          onDeleteClass={() => undefined}
          onDeleteSchool={() => undefined}
          currentSchoolId={1}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Télécharger Excel' }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      const rows = await readFirstExcelSheetRecords(await blob.arrayBuffer());

      expect(click).toHaveBeenCalled();
      expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('liste-parents.xlsx');
      expect(rows).toEqual([
        {
          Nom: 'Amani Awa',
          Email: 'amani@example.com',
          Téléphone: '+228 90000002',
          Adresse: 'Rue Amani',
          'Élève associé': 'Amani Ali',
          'École de l’élève': 'École du Lac',
          'Dernière connexion': 'Jamais connecté',
        },
        {
          Nom: 'Tano Moussa',
          Email: 'tano@example.com',
          Téléphone: '+228 90000001',
          Adresse: 'Rue Tano',
          'Élève associé': 'Tano Kossi',
          'École de l’élève': 'École du Lac',
          'Dernière connexion': 'Jamais connecté',
        },
      ]);
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      else delete (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
      else delete (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
      click.mockRestore();
    }
  });

  it('counts teachers by scope and exports only the filtered visible teachers as Excel', async () => {
    const schools: School[] = [
      { id: 1, name: 'École du Lac', address: '', phone: '' },
      { id: 2, name: 'École du Nord', address: '', phone: '' },
    ];
    const teachers: Teacher[] = [
      { id: 11, userId: 101, name: 'ZOU Jean', lastName: 'ZOU', firstNames: 'Jean', email: 'jean@example.com', phone: '+22890000011', specialization: 'Mathématiques', schoolId: 1 },
      { id: 12, userId: 102, name: 'KOFFI Awa', lastName: 'KOFFI', firstNames: 'Awa', email: 'awa@example.com', phone: '+22890000012', specialization: 'Sciences', schoolId: 1 },
      { id: 21, userId: 201, name: 'YAO Kossi', lastName: 'YAO', firstNames: 'Kossi', email: 'kossi@example.com', phone: '+22890000021', specialization: 'Histoire', schoolId: 2 },
    ];
    const originalCreateObjectURL = (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
    const originalRevokeObjectURL = (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:teachers');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));

    try {
      renderWithAuth(
        <AdminView
          userRole="super_admin"
          schoolsList={schools}
          yearsList={[]}
          classesList={[]}
          teachersList={teachers}
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
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Enseignants/i }));
      expect(screen.getByTestId('teachers-total-count').textContent).toContain('3 enseignants');

      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });
      expect(screen.getByTestId('teachers-total-count').textContent).toContain('2 enseignants');

      fireEvent.click(screen.getByRole('button', { name: 'Télécharger Excel' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      const rows = await readFirstExcelSheetRecords(await blob.arrayBuffer());

      expect(click).toHaveBeenCalledTimes(1);
      expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('liste-enseignants.xlsx');
      expect(rows).toEqual([
        {
          'Nom complet': 'KOFFI Awa',
          'Adresse Email': 'awa@example.com',
          École: 'École du Lac',
          'Spécialité enseignée': 'Sciences',
          Téléphone: '+22890000012',
        },
        {
          'Nom complet': 'ZOU Jean',
          'Adresse Email': 'jean@example.com',
          École: 'École du Lac',
          'Spécialité enseignée': 'Mathématiques',
          Téléphone: '+22890000011',
        },
      ]);
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      else delete (URL as typeof URL & { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
      else delete (URL as typeof URL & { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
      click.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('counts parents by selected school for super admin', () => {
    const schools: School[] = [
      { id: 1, name: 'École du Lac', address: '', phone: '' },
      { id: 2, name: 'École du Nord', address: '', phone: '' },
    ];
    const parents: Parent[] = [
      { id: 55, userId: 6, name: 'Awa Mensah', email: 'awa@gmail.com', schoolId: 1 },
      { id: 56, userId: 7, name: 'Kossi Doe', email: 'kossi@example.com', schoolId: 2 },
    ];

    renderWithAuth(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={[]}
        classesList={[]}
        teachersList={[]}
        studentsList={[]}
        parentsList={parents}
        usersList={[]}
        onAddSchool={async () => ({})}
        onAddYear={() => undefined}
        onAddClass={async () => undefined}
        onAddTeacher={async () => ({})}
        onAddParent={async () => ({})}
        onAddStudent={() => undefined}
        onDeleteClass={() => undefined}
        onDeleteSchool={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Parents & Tuteurs/i }));
    expect(screen.getByText('Effectif total : 2 parents')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(screen.getByText('Effectif total : 1 parents')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Rechercher par email/i), { target: { value: 'awa@gmail.com' } });
    expect(screen.getByText('Effectif total : 1 parents')).toBeTruthy();
  });

  it('counts students by current scope and keeps the total stable under text search', () => {
    const schools: School[] = [
      { id: 1, name: 'École du Lac', address: '', phone: '' },
      { id: 2, name: 'École du Nord', address: '', phone: '' },
    ];
    const years: AcademicYear[] = [
      { id: 1, name: '2024-2025', isActive: true, schoolId: 1 },
      { id: 2, name: '2024-2025', isActive: true, schoolId: 2 },
    ];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 },
      { id: 11, name: 'CM2', schoolId: 1, academicYearId: 1 },
      { id: 20, name: 'CP', schoolId: 2, academicYearId: 2 },
    ];
    const students: Student[] = [
      { id: 1, firstName: 'Koffi', lastName: 'Amani', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 2, firstName: 'Awa', lastName: 'Kouassi', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 3, firstName: 'Moussa', lastName: 'Tano', schoolId: 1, classId: 11, className: 'CM2', yearId: 1, yearName: '2024-2025' },
      { id: 4, firstName: 'Sonia', lastName: 'Yao', schoolId: 2, classId: 20, className: 'CP', yearId: 2, yearName: '2024-2025' },
    ];

    renderWithAuth(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={[]}
        studentsList={students}
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
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Élèves/i }));
    expect(screen.getByTestId('students-total-count').textContent).toContain('4');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2' } });
    expect(screen.getByTestId('students-total-count').textContent).toContain('1');

    fireEvent.change(screen.getByPlaceholderText(/Rechercher parmi les étudiants/i), { target: { value: 'KOFFI' } });
    expect(screen.getByTestId('students-total-count').textContent).toContain('1');
    expect(screen.queryByText(/Amani\s+Koffi/i)).toBeNull();
    expect(screen.queryByText(/Koffi\s+Amani/i)).toBeNull();
  });

  it('respects the class filter when calculating the student total', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 },
      { id: 11, name: 'CM2', schoolId: 1, academicYearId: 1 },
    ];
    const students: Student[] = [
      { id: 1, firstName: 'Koffi', lastName: 'Amani', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 2, firstName: 'Awa', lastName: 'Kouassi', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 3, firstName: 'Moussa', lastName: 'Tano', schoolId: 1, classId: 11, className: 'CM2', yearId: 1, yearName: '2024-2025' },
      { id: 4, firstName: 'Sana', lastName: 'Sansclasse', schoolId: 1, classId: null, className: '', yearId: 1, yearName: '2024-2025' },
    ];

    renderWithAuth(
      <AdminView
        userRole="super_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={[]}
        studentsList={students}
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
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Élèves/i }));
  expect(screen.getByTestId('students-total-count').textContent).toContain('4');
  expect(screen.getByText(/Sansclasse\s+Sana/i)).toBeTruthy();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '10' } });
    expect(screen.getByTestId('students-total-count').textContent).toContain('2');
  expect(screen.queryByText(/Sansclasse\s+Sana/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Rechercher parmi les étudiants/i), { target: { value: 'KOFFI' } });
    expect(screen.getByTestId('students-total-count').textContent).toContain('2');
    expect(screen.getByText(/Amani\s+Koffi/i)).toBeTruthy();
  });

  it('sorts the visible students list alphabetically by last name then first name in the DOM', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 },
      { id: 11, name: 'CM2', schoolId: 1, academicYearId: 1 },
    ];
    const students: Student[] = [
      { id: 1, firstName: 'Moussa', lastName: 'Tano', schoolId: 1, classId: 11, className: 'CM2', yearId: 1, yearName: '2024-2025' },
      { id: 2, firstName: 'Koffi', lastName: 'Amani', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 3, firstName: 'Awa', lastName: 'Koffi', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
      { id: 4, firstName: 'Ali', lastName: 'Amani', schoolId: 1, classId: 10, className: 'CM1', yearId: 1, yearName: '2024-2025' },
    ];

    renderWithAuth(
      <AdminView
        userRole="school_admin"
        schoolsList={schools}
        yearsList={years}
        classesList={classes}
        teachersList={[]}
        studentsList={students}
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
        currentSchoolId={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Élèves/i }));

    const renderedNames = Array.from(document.querySelectorAll('tbody tr')).filter((row) => !row.querySelector('td[colspan]')).map((row) => row.querySelector('td')?.textContent?.trim());

    expect(renderedNames).toEqual(['Amani Ali', 'Amani Koffi', 'Koffi Awa', 'Tano Moussa']);
  });

  it('displays mixed and successful parent import results clearly', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const baseProps = {
      userRole: 'school_admin' as const,
      schoolsList: schools,
      yearsList: [] as AcademicYear[],
      classesList: [] as Class[],
      teachersList: [] as Teacher[],
      studentsList: [] as Student[],
      parentsList: [] as Parent[],
      usersList: [] as User[],
      onAddSchool: async () => ({}),
      onAddYear: () => undefined,
      onAddClass: async () => undefined,
      onAddTeacher: async () => ({}),
      onAddParent: async () => ({}),
      onAddStudent: () => undefined,
      onDeleteClass: () => undefined,
      onDeleteSchool: () => undefined,
      currentSchoolId: 1,
    };

    const view = renderWithAuth(
      <AdminView
        {...baseProps}
        importResult={{
          insertedCount: 1,
          errors: [
            { row: 12, name: 'AWA KOFFI', email: 'awa@gmail.com', error: 'duplicate email in this school' },
            { row: 27, name: 'JOHN DOE', email: 'john@gmail.com', error: 'Cet email est déjà utilisé et ne peut pas être importé dans cet établissement' },
          ],
        }}
      />
    );

    expect(screen.getByText('1 parent(s) importé(s).')).toBeTruthy();
    expect(screen.getByText('2 ligne(s) non importée(s).')).toBeTruthy();
    expect(screen.getByText(/Ligne 12 — AWA KOFFI — awa@gmail.com/)).toBeTruthy();
    expect(screen.getByText('duplicate email in this school')).toBeTruthy();
    expect(screen.getByText(/Ligne 27 — JOHN DOE — john@gmail.com/)).toBeTruthy();

    view.rerender(
      <AuthProvider>
        <AdminView {...baseProps} importResult={{ insertedCount: 2, errors: [] }} />
      </AuthProvider>
    );
    expect(screen.getByText('Toutes les lignes ont été importées avec succès.')).toBeTruthy();
  });

  it('downloads import credentials only for administrators and clears them after download', async () => {
    const onClearImportResult = vi.fn();
    const createObjectUrl = vi.fn(() => 'blob:temporary-credentials');
    const revokeObjectUrl = vi.fn();
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true });
    const props = {
      userRole: 'school_admin' as const,
      schoolsList: [] as School[],
      yearsList: [] as AcademicYear[],
      classesList: [] as Class[],
      teachersList: [] as Teacher[],
      studentsList: [] as Student[],
      parentsList: [] as Parent[],
      usersList: [] as User[],
      onAddSchool: async () => ({}),
      onAddYear: () => undefined,
      onAddClass: async () => undefined,
      onAddTeacher: async () => ({}),
      onAddParent: async () => ({}),
      onAddStudent: () => undefined,
      onDeleteClass: () => undefined,
      onDeleteSchool: () => undefined,
      onClearImportResult,
      importResult: {
        insertedCount: 1,
        errors: [{ row: 5, name: 'Rejected Parent', error: 'Rejected' }],
        inserted: [{
          user: { id: 1, name: 'Created Parent', email: 'created@example.test' },
          temporaryPassword: 'one-time-secret',
        }],
      },
    };

    try {
      renderWithAuth(<AdminView {...props} />);
      fireEvent.click(screen.getByRole('button', { name: /Télécharger le récapitulatif sécurisé/i }));
      await waitFor(() => expect(onClearImportResult).toHaveBeenCalledOnce());
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(clickAnchor).toHaveBeenCalledOnce();
      await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:temporary-credentials'));
    } finally {
      clickAnchor.mockRestore();
      if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor);
      else delete (URL as any).createObjectURL;
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor);
      else delete (URL as any).revokeObjectURL;
    }
  });

  it('does not expose the temporary-credentials download action to parents', () => {
    renderWithAuth(
      <AdminView
        userRole="parent"
        schoolsList={[]}
        yearsList={[]}
        classesList={[]}
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
        importResult={{
          insertedCount: 1,
          errors: [],
          inserted: [{ user: { id: 1, name: 'Created Parent', email: 'created@example.test' }, temporaryPassword: 'one-time-secret' }],
        }}
      />
    );

    expect(screen.queryByRole('button', { name: /Télécharger le récapitulatif sécurisé/i })).toBeNull();
    expect(screen.queryByText('one-time-secret')).toBeNull();
  });

  it.each([
    {
      role: 'parent' as const,
      tab: /Parents & Tuteurs/i,
      identifier: '+22890000001',
      uid: 'sim_parent_technical_uid',
      user: { id: 61, uid: 'sim_parent_technical_uid', email: null, name: 'Parent Test', role: 'parent' as const, schoolId: 1 },
      parent: { id: 71, userId: 61, name: 'Parent Test', phone: '+22890000001', schoolId: 1 } as Parent,
      teacher: undefined,
    },
    {
      role: 'teacher' as const,
      tab: /Enseignants/i,
      identifier: 'teacher@example.test',
      uid: 'teacher_technical_uid',
      user: { id: 62, uid: 'teacher_technical_uid', email: 'teacher@example.test', name: 'Teacher Test', role: 'teacher' as const, schoolId: 1 },
      parent: undefined,
      teacher: { id: 81, userId: 62, name: 'Teacher Test', email: 'teacher@example.test', schoolId: 1 } as Teacher,
    },
  ])('displays, copies, and clears the reset temporary password for $role', async ({ role, tab, identifier, uid, user, parent, teacher }) => {
    const temporaryPassword = 'K7mP4xQa';
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/set-password')) {
        return new Response(JSON.stringify({ temporaryPassword, mustReset: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      renderWithAuth(
        <AdminView
          userRole="school_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
          yearsList={[]}
          classesList={[]}
          teachersList={teacher ? [teacher] : []}
          studentsList={[]}
          parentsList={parent ? [parent] : []}
          usersList={[user]}
          onAddSchool={async () => ({})}
          onAddYear={() => undefined}
          onAddClass={async () => undefined}
          onAddTeacher={async () => ({})}
          onAddParent={async () => ({})}
          onAddStudent={() => undefined}
          onDeleteClass={() => undefined}
          onDeleteSchool={() => undefined}
          onSetPassword={async (userId) => apiFetch('/api/admin/set-password', {
            method: 'POST',
            body: JSON.stringify({ userId }),
          })}
          currentSchoolId={1}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: tab }));
      fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Réinitialiser le mot de passe' }));

      const resetDialog = await screen.findByRole('dialog', { name: 'Mot de passe réinitialisé' });
      expect(screen.queryByRole('dialog', { name: 'Modifier le compte' })).toBeNull();
      expect(resetDialog).toBeTruthy();
      expect(within(resetDialog).getByText(identifier)).toBeTruthy();
      expect(within(resetDialog).getByText(temporaryPassword)).toBeTruthy();
      expect(within(resetDialog).getByText(/devra être changé lors de la prochaine connexion/i)).toBeTruthy();
      expect(within(resetDialog).queryByText(uid)).toBeNull();
      expect(within(resetDialog).queryByText(/passwordHash|salt/i)).toBeNull();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/set-password'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: user.id }),
        }),
      );

      fireEvent.click(within(resetDialog).getByRole('button', { name: 'Copier' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(temporaryPassword));

      fireEvent.click(within(resetDialog).getByRole('button', { name: 'Fermer' }));
      await waitFor(() => expect(screen.queryByText(temporaryPassword)).toBeNull());
    } finally {
      fetchSpy.mockRestore();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else delete (navigator as any).clipboard;
    }
  });

  it('shows configured class groups and filters classes when creating a school', async () => {
    const localStorageMock = window.localStorage as any;
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'ecoletrack-class-groups:v2') {
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
      if (key === 'ecoletrack-class-groups:v2') {
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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
    fireEvent.click(screen.getByLabelText('6ème'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
    fireEvent.click(screen.getByLabelText('6ème'));
    fireEvent.click(screen.getByLabelText('Mathématiques'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

    expect(onAddSchool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'École du Lac',
      phone: '+228 90000000',
      classNames: ['6ème'],
      subjectNames: ['Mathématiques'],
    }));
  });

  it('shows school creation progress and prevents duplicate submits', async () => {
    let resolveCreation!: (school: School) => void;
    const creation = new Promise<School>((resolve) => {
      resolveCreation = resolve;
    });
    const onAddSchool = vi.fn()
      .mockReturnValue(creation);
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [{ id: 10, name: '6ème', schoolId: 1, academicYearId: 1 }];
    const subjects = [{ id: 1, name: 'Mathématiques', schoolId: 1 }];

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
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Créer une école/i }));
    fireEvent.change(screen.getByPlaceholderText('Lycée de Lomé'), { target: { value: 'École du Lac' } });
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
    fireEvent.click(screen.getByLabelText('6ème'));
    fireEvent.click(screen.getByLabelText('Mathématiques'));

    const dialog = screen.getByRole('dialog');
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    const savingButton = within(dialog).getByRole('button', { name: 'Enregistrement…' });
    expect(savingButton).toBeDisabled();
    expect(savingButton).toHaveAttribute('aria-busy', 'true');
    expect(savingButton.querySelector('.animate-spin')).not.toBeNull();
    expect(onAddSchool).toHaveBeenCalledTimes(1);

    resolveCreation({ id: 1, name: 'École du Lac' });
    await screen.findByRole('button', { name: /Créer une école/i });
    expect(screen.queryByRole('dialog')).toBeNull();
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
    fireEvent.click(within(editDialog).getByRole('button', { name: /^Enregistrer$/i }));

    expect(onUpdateSchool).toHaveBeenCalledWith(1, expect.objectContaining({
      name: 'École du Lac Modifiée',
      address: 'Ancienne adresse',
      phone: '+228 90000000',
    }));
  });

  it('hydrates school associations in the selected school scope and only submits new additions', async () => {
    const onUpdateSchool = vi.fn().mockResolvedValue({ id: 1, name: 'École du Lac' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/classes?schoolId=1')) {
        return new Response(JSON.stringify([
          { id: 10, name: '4ème', schoolId: null, academicYearId: 1, status: 'approved' },
          { id: 11, name: '5ème', schoolId: null, academicYearId: 1, status: 'approved' },
          { id: 14, name: 'CM2', schoolId: 1, academicYearId: 1 },
        ]), { status: 200 });
      }
      if (url.includes('/api/subjects?schoolId=1&approvedOnly=true')) {
        return new Response(JSON.stringify([
          { id: 20, name: 'Mathématiques', schoolId: null, status: 'approved' },
          { id: 21, name: 'Français', schoolId: null, status: 'approved' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      renderWithAuth(
        <AdminView
          userRole="super_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '+228 90000000' }]}
          yearsList={[]}
          classesList={[
            { id: 10, name: '4ème', schoolId: null, academicYearId: 1 },
            { id: 11, name: '5ème', schoolId: null, academicYearId: 1 },
            { id: 12, name: '3ème', schoolId: null, academicYearId: 1 },
            { id: 13, name: 'Classe de l’autre école', schoolId: 2, academicYearId: 1 },
            { id: 14, name: 'CM2', schoolId: 1, academicYearId: 1 },
          ]}
          teachersList={[]}
          studentsList={[]}
          parentsList={[]}
          usersList={[]}
          subjectsList={[
            { id: 20, name: 'Mathématiques', schoolId: null },
            { id: 21, name: 'Français', schoolId: null },
            { id: 22, name: 'Sciences', schoolId: null },
            { id: 23, name: 'Matière de l’autre école', schoolId: 2 },
          ]}
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
      expect(await within(editDialog).findByText('4ème')).toBeTruthy();
      expect(within(editDialog).getByText('5ème')).toBeTruthy();
      expect(within(editDialog).getByText('CM2')).toBeTruthy();
      expect(within(editDialog).getByText('Mathématiques')).toBeTruthy();
      expect(within(editDialog).getByText('Français')).toBeTruthy();
      expect(within(editDialog).queryByLabelText('4ème')).toBeNull();
      expect(within(editDialog).queryByLabelText('5ème')).toBeNull();
      expect(within(editDialog).queryByLabelText('Mathématiques')).toBeNull();
      expect(within(editDialog).queryByLabelText('Français')).toBeNull();
      expect(within(editDialog).queryByText('Classe de l’autre école')).toBeNull();
      expect(within(editDialog).queryByText('Matière de l’autre école')).toBeNull();

      fireEvent.click(within(editDialog).getByLabelText('3ème'));
      fireEvent.click(within(editDialog).getByLabelText('Sciences'));
      fireEvent.click(within(editDialog).getByRole('button', { name: /^Enregistrer$/i }));

      expect(onUpdateSchool).toHaveBeenCalledWith(1, expect.objectContaining({
        classNames: ['3ème'],
        subjectNames: ['Sciences'],
      }));
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/classes?schoolId=1'), expect.anything());
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/subjects?schoolId=1&approvedOnly=true'), expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '123' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

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
    fireEvent.change(getPrimarySchoolPhoneInput(), { target: { value: '90000000' } });
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Enregistrer$/i }));

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

  it('filters teacher students by assigned class and keeps text search combined', () => {
    const schools: School[] = [{ id: 1, name: 'École du Lac', address: '', phone: '' }];
    const years: AcademicYear[] = [{ id: 1, name: '2024-2025', isActive: true, schoolId: 1 }];
    const classes: Class[] = [
      { id: 10, name: 'CM1', schoolId: 1, academicYearId: 1 },
      { id: 20, name: 'CM2', schoolId: 1, academicYearId: 1 },
      { id: 30, name: '6ème', schoolId: 1, academicYearId: 1 },
    ];
    const teachers: Teacher[] = [{ id: 1, userId: 2, name: 'Alice Martin', email: 'alice@example.com', schoolId: 1, classIds: [10, 20] }];
    const students: Student[] = [
      { id: 101, firstName: 'Alice', lastName: 'CM1', schoolId: 1, classId: 10, className: 'CM1', parentId: 1 } as Student,
      { id: 102, firstName: 'Bob', lastName: 'CM2', schoolId: 1, classId: 20, className: 'CM2', parentId: 2 } as Student,
      { id: 103, firstName: 'Claire', lastName: 'Sixième', schoolId: 1, classId: 30, className: '6ème', parentId: 3 } as Student,
    ];
    const parents: Parent[] = [];
    const users: User[] = [{ id: 2, uid: 'u2', email: 'alice@example.com', name: 'Alice Martin', role: 'teacher', schoolId: 1 }];

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

    fireEvent.click(screen.getByRole('button', { name: /Élèves/i }));

    const classFilter = screen.getByLabelText('Classe');
    expect(within(classFilter).queryByText('6ème')).toBeNull();
    expect(screen.getByRole('option', { name: 'CM1' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'CM2' })).toBeTruthy();
    const studentRows = () => screen.getAllByRole('row').map((row) => row.textContent || '');
    expect(studentRows().some((text) => text.includes('Alice') && text.includes('CM1'))).toBe(true);
    expect(studentRows().some((text) => text.includes('Bob') && text.includes('CM2'))).toBe(true);
    expect(studentRows().some((text) => text.includes('Claire'))).toBe(false);

    fireEvent.change(classFilter, { target: { value: '10' } });
    expect(studentRows().some((text) => text.includes('Alice') && text.includes('CM1'))).toBe(true);
    expect(studentRows().some((text) => text.includes('Bob'))).toBe(false);

    const search = screen.getByPlaceholderText(/Rechercher parmi/i);
    fireEvent.change(search, { target: { value: 'Alice' } });
    expect(studentRows().some((text) => text.includes('Alice') && text.includes('CM1'))).toBe(true);
    expect(studentRows().some((text) => text.includes('Bob'))).toBe(false);
  });

  it('saves and reloads an exam mention only while the student is admitted', async () => {
    let savedResult: { resultStatus: string; mention: string | null } = {
      resultStatus: 'ADMITTED',
      mention: 'Bien',
    };
    const batchRequests: Array<{ results: Array<{ resultStatus: string; mention: string | null }> }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/class-exam-configurations')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/api/exam-results/batch') && init?.method === 'PUT') {
        const payload = JSON.parse(String(init.body));
        batchRequests.push(payload);
        savedResult = payload.results[0];
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('/api/exam-results?')) {
        return new Response(JSON.stringify([{
          id: 101,
          firstName: 'Alice',
          lastName: 'Dupont',
          result: { id: 501, ...savedResult },
        }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      renderWithAuth(
        <AdminView
          userRole="school_admin"
          schoolsList={[{ id: 1, name: 'École du Lac', address: '', phone: '' }]}
          yearsList={[{ id: 1, name: '2025-2026', isActive: true, schoolId: 1 }]}
          classesList={[{ id: 10, name: '3ème A', schoolId: 1, academicYearId: 1 }]}
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
          currentSchoolId={1}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Classes' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Année scolaire de l’examen' }), { target: { value: '1' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Classe d’examen' }), { target: { value: '10' } });

      const mentionSelect = await screen.findByRole('combobox', { name: 'Mention de Alice Dupont' }) as HTMLSelectElement;
      expect(mentionSelect.value).toBe('Bien');
      expect(within(mentionSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Mention (facultatif)',
        'Passable',
        'Assez bien',
        'Bien',
        'Très bien',
        'Excellent',
      ]);

      fireEvent.change(mentionSelect, { target: { value: 'Excellent' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sauvegarder les résultats' }));
      await waitFor(() => expect(batchRequests).toHaveLength(1));
      expect(batchRequests[0].results[0]).toMatchObject({ resultStatus: 'ADMITTED', mention: 'Excellent' });
      const refreshedMentionSelect = await screen.findByRole('combobox', { name: 'Mention de Alice Dupont' }) as HTMLSelectElement;
      await waitFor(() => expect(refreshedMentionSelect.value).toBe('Excellent'));

      fireEvent.change(screen.getByRole('combobox', { name: 'Résultat de Alice Dupont' }), { target: { value: 'NOT_ADMITTED' } });
      expect(screen.queryByRole('combobox', { name: 'Mention de Alice Dupont' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Sauvegarder les résultats' }));
      await waitFor(() => expect(batchRequests).toHaveLength(2));
      expect(batchRequests[1].results[0]).toMatchObject({ resultStatus: 'NOT_ADMITTED', mention: null });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
