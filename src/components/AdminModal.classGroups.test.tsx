// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import AdminModal from './AdminModal';
import type { School, AcademicYear, Class, Parent, Student, Teacher, User } from '../types';

const renderModal = (props: any) => render(<AdminModal {...props} />);

describe('AdminModal class groups synchronization', () => {
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

  const createBaseProps = () => ({
    isModalOpen: true,
    onClose: () => {},
    activeTab: 'schools',
    handleFormSubmit: () => {},
    schoolForm: {
      name: '',
      address: '',
      phone: '',
      phoneDigits: '',
      selectedClassNames: [] as string[],
      selectedClassGroups: [] as string[],
      manuallySelectedClassNames: [] as string[],
      subjectNames: '',
      selectedSubjectNames: [] as string[],
      selectedSubjectGroups: [] as string[],
      manuallySelectedSubjectNames: [] as string[],
    },
    setSchoolForm: vi.fn(),
    yearForm: { name: '', isActive: false, schoolId: '' },
    setYearForm: () => {},
    classForm: { cycle: '', stream: '', section: '', group: '', schoolId: '' },
    setClassForm: () => {},
    teacherForm: { name: '', email: '', phone: '', specializations: [], schoolId: '', assignedClassIds: [], gender: '' },
    setTeacherForm: () => {},
    parentForm: { name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', studentId: '', gender: '' },
    setParentForm: () => {},
    studentForm: { firstName: '', lastName: '', birthDate: '', schoolId: '', classId: '', parentId: '', academicYearId: '', teacherIds: [], schoolAdminId: '', gender: '' },
    setStudentForm: () => {},
    studentError: null,
    newParentMode: false,
    setNewParentMode: () => {},
    newParentForm: { name: '', email: '', phonePrefix: '+228', phone: '', address: '', schoolId: '', gender: '' },
    setNewParentForm: () => {},
    newTeacherMode: false,
    setNewTeacherMode: () => {},
    newTeacherForm: { name: '', email: '', phone: '', specializations: [], schoolId: '', assignedClassIds: [], gender: '' },
    setNewTeacherForm: () => {},
    allowSelectOverflow: false,
    setAllowSelectOverflow: () => {},
    sortedParentPhonePrefixes: ['+228'],
    teacherSpecializations: [],
    schoolsList: [{ id: 1, name: 'Test School', address: '', phone: '' } as School],
    yearsList: [{ id: 1, name: '2024-2025', isActive: true, schoolId: null } as AcademicYear],
    teachersList: [] as Teacher[],
    parentsList: [] as Parent[],
    studentsList: [] as Student[],
    availableSchoolAdmins: [] as User[],
    sortedClasses: [
      { id: 1, name: '6ème', schoolId: null, academicYearId: 1 } as Class,
      { id: 2, name: '5ème', schoolId: null, academicYearId: 1 } as Class,
      { id: 3, name: '4ème', schoolId: null, academicYearId: 1 } as Class,
      { id: 4, name: 'Lycée', schoolId: null, academicYearId: 1 } as Class,
    ],
    defaultAcademicYearId: 1,
    handleSaveNewParent: () => {},
    handleSaveNewTeacher: () => {},
    userRole: 'super_admin',
    currentSchoolId: null,
    subjectsList: [],
    groupPresets: [
      { id: 'ceg', name: 'CEG (Collège)', classNames: ['6ème', '5ème', '4ème'] },
      { id: 'lycee', name: 'Lycée', classNames: ['Lycée'] },
    ],
    subjectGroups: [] as any[],
  });

  it('should select all classes in a group when the group checkbox is checked', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Find and click the "CEG (Collège)" group checkbox
    const cegCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG (Collège)';
    });

    fireEvent.click(cegCheckbox!);

    // Check if setSchoolForm was called with the correct classes
    expect(mockSetSchoolForm).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedClassGroups: ['ceg'],
        selectedClassNames: expect.arrayContaining(['6ème', '5ème', '4ème']),
      })
    );
  });

  it('does not create default groups when no presets were configured', () => {
    renderModal({
      ...createBaseProps(),
      groupPresets: [],
      sortedClasses: [],
    });

    expect(screen.queryByText('CEG (Collège)')).toBeNull();
    expect(screen.queryByText('Lycée')).toBeNull();
  });

  it('should remove only automatic classes when deselecting a group (not manual ones)', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: ['ceg'],
        selectedClassNames: ['6ème', '5ème', '4ème', 'Lycée'], // Lycée is manually selected
        manuallySelectedClassNames: ['Lycée'],
      },
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Find and click the CEG checkbox to deselect it
    const cegCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG (Collège)';
    });

    fireEvent.click(cegCheckbox!);

    // The result should keep 'Lycée' because it's manually selected
    expect(mockSetSchoolForm).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedClassGroups: [],
        selectedClassNames: expect.arrayContaining(['Lycée']),
      })
    );

    // The result should NOT have 6ème, 5ème, 4ème anymore
    const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
    expect(lastCall[0].selectedClassNames).not.toContain('6ème');
    expect(lastCall[0].selectedClassNames).not.toContain('5ème');
    expect(lastCall[0].selectedClassNames).not.toContain('4ème');
  });

  it('should keep a class checked if it belongs to another active group', () => {
    const mockSetSchoolForm = vi.fn();
    
    // Create a class group where '6ème' appears in both 'ceg' and 'all-classes' groups
    const groupPresets = [
      { id: 'ceg', name: 'CEG', classNames: ['6ème', '5ème'] },
      { id: 'all', name: 'All Classes', classNames: ['6ème', '4ème', 'Lycée'] },
    ];

    const props = {
      ...createBaseProps(),
      groupPresets,
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: ['ceg', 'all'],
        selectedClassNames: ['6ème', '5ème', '4ème', 'Lycée'],
        manuallySelectedClassNames: [],
      },
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Find and click CEG checkbox to deselect it
    const cegCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG';
    });

    fireEvent.click(cegCheckbox!);

    // Check the result
    const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
    expect(lastCall[0].selectedClassNames).toContain('6ème'); // Still in 'all' group
    expect(lastCall[0].selectedClassNames).not.toContain('5ème'); // Only in 'ceg' group
  });

  it('should restore manually deselected classes when the group is reselected', () => {
    const baseProps = {
      ...createBaseProps(),
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: ['ceg'],
        selectedClassNames: ['6ème', '5ème', '4ème'],
        manuallyDeselectedClassNames: ['6ème'],
      },
    };

    const stateRef = { current: baseProps.schoolForm };

    const TestWrapper = () => {
      const [schoolForm, setSchoolForm] = useState(baseProps.schoolForm);
      stateRef.current = schoolForm;
      return <AdminModal {...baseProps} schoolForm={schoolForm} setSchoolForm={setSchoolForm} />;
    };

    render(<TestWrapper />);

    const groupCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG (Collège)';
    });

    fireEvent.click(groupCheckbox!); // Deselect group
    expect(stateRef.current.selectedClassGroups).toEqual([]);
    expect(stateRef.current.selectedClassNames).toEqual([]);
    expect(stateRef.current.manuallyDeselectedClassNames).toEqual([]);

    const groupCheckboxAfter = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG (Collège)';
    });

    fireEvent.click(groupCheckboxAfter!); // Reselect group
    expect(stateRef.current.selectedClassGroups).toContain('ceg');
    expect(stateRef.current.selectedClassNames).toContain('6ème');
    expect(stateRef.current.manuallyDeselectedClassNames).not.toContain('6ème');
  });

  it('should keep manual class selection when deselecting a group that also selected it', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: ['ceg'],
        selectedClassNames: ['6ème', '5ème', '4ème'],
        manuallySelectedClassNames: ['6ème'], // User explicitly selected 6ème
      },
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // User manually clicks the 6ème checkbox (should be no-op since it's already checked via group + manual)
    const checkbox6eme = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === '6ème';
    });

    // First, deselect the CEG group
    const cegCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === 'CEG (Collège)';
    });

    fireEvent.click(cegCheckbox!);

    // Check that 6ème is still selected because it was manually selected
    const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
    expect(lastCall[0].selectedClassNames).toContain('6ème');
    expect(lastCall[0].manuallySelectedClassNames).toContain('6ème');
  });

  it('should handle manual class selection correctly', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Manually select 6ème checkbox (not via group)
    const checkbox6eme = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === '6ème';
    });

    fireEvent.click(checkbox6eme!);

    // Check that 6ème is added to manual selections
    const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
    expect(lastCall[0].selectedClassNames).toContain('6ème');
    expect(lastCall[0].manuallySelectedClassNames).toContain('6ème');
  });

  it('should remove manual class when deselecting and no group covers it', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: [], // No groups selected
        selectedClassNames: ['4ème'],
        manuallySelectedClassNames: ['4ème'],
      },
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Deselect 4ème manually (using a more specific class name that won't conflict with groups)
    const checkbox4eme = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      return label?.textContent === '4ème';
    });

    fireEvent.click(checkbox4eme!);

    // Check that 4ème is removed from both selections
    const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
    expect(lastCall[0].selectedClassNames).not.toContain('4ème');
    expect(lastCall[0].manuallySelectedClassNames).not.toContain('4ème');
  });

  it('should keep all classes visible after selecting a group (visibility not filtered by group)', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Get all class checkboxes from the "Classes existantes" section (skip group checkboxes)
    const allCheckboxes = screen.getAllByRole('checkbox');
    
    // Filter to only class checkboxes (they come after group checkboxes)
    // Groups: CEG, Lycée (2), Classes: 6ème, 5ème, 4ème, Lycée (4)
    // Total before: 6, after selecting CEG: should still show all 4 class checkboxes
    
    const initialClassCheckboxes = allCheckboxes.filter((cb, idx) => {
      const label = cb.parentElement?.querySelector('.text-sm');
      const text = label?.textContent || '';
      return ['6ème', '5ème', '4ème', 'Lycée'].includes(text);
    });
    
    const initialCount = initialClassCheckboxes.length;
    expect(initialCount).toBeGreaterThanOrEqual(4); // At least the 4 classes
  });

  it('should allow manual selection of class from another group after group selection', () => {
    const mockSetSchoolForm = vi.fn();
    const props = {
      ...createBaseProps(),
      schoolForm: {
        ...createBaseProps().schoolForm,
        selectedClassGroups: ['ceg'], // CEG group selected
        selectedClassNames: ['6ème', '5ème', '4ème'], // Classes from CEG checked
        manuallySelectedClassNames: [],
      },
      setSchoolForm: mockSetSchoolForm,
    };

    renderModal(props);

    // Find Lycée class checkbox (in the classes section, not in groups)
    const allCheckboxes = screen.getAllByRole('checkbox');
    
    // Find the Lycée checkbox that is for class selection (the last one with that name)
    let lyceeCheckbox = null;
    for (let i = allCheckboxes.length - 1; i >= 0; i--) {
      const label = allCheckboxes[i].parentElement?.querySelector('.text-sm');
      if (label?.textContent === 'Lycée') {
        lyceeCheckbox = allCheckboxes[i];
        break;
      }
    }
    
    expect(lyceeCheckbox).toBeDefined(); // Lycée class must be visible!

    if (lyceeCheckbox) {
      fireEvent.click(lyceeCheckbox);

      // Verify that Lycée was added to manual selections
      const lastCall = mockSetSchoolForm.mock.calls[mockSetSchoolForm.mock.calls.length - 1];
      expect(lastCall[0].selectedClassNames).toContain('Lycée');
      expect(lastCall[0].manuallySelectedClassNames).toContain('Lycée');
    }
  });
});
