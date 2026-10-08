import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import AccountingView from './AccountingView.tsx';
import type { AcademicYear, Class, School, Student } from '../types.ts';
import { apiFetch, apiFetchBlob } from '../lib/api.ts';
import { generateClassSituationPdf } from '../lib/classSituationPdf.ts';

vi.mock('../lib/api.ts', () => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
}));

const school: School = { id: 1, name: 'École test' };
const secondSchool: School = { id: 2, name: 'École test 2' };
const year: AcademicYear = { id: 4, schoolId: 1, name: '2026-2027', isActive: true };
const schoolClass: Class = { id: 2, schoolId: 1, academicYearId: 4, name: '6e' };
const globalClass: Class = { id: 3, schoolId: null, academicYearId: 4, name: '3ème A', status: 'approved' };
const student: Student = {
  id: 10,
  schoolId: 1,
  classId: 2,
  className: '6e',
  firstName: 'Afi',
  lastName: 'Doe',
};
const studentsForSituation: Student[] = [
  student,
  { ...student, id: 11, classId: 3, className: '3ème A', firstName: 'Binta' },
  { ...student, id: 12, firstName: 'Kossi' },
  { ...student, id: 13, firstName: 'Ama' },
];
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

const studentFinance = {
  student: { id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', className: '6e', classId: 2 },
  totals: { due: 150000, paid: 0 },
  categories: [{
    id: 8,
    label: 'Scolarité',
    tariffId: 41,
    due: 150000,
    paid: 0,
    remaining: 150000,
    status: 'unpaid',
    obligations: [],
  }],
  payments: [{
    id: 23,
    amount: 2500,
    method: 'cash',
    paidAt: '2026-10-06',
    receiptId: 66,
    receiptNumber: 'REC-2026-000066',
  }],
};

const mountView = (
  userRole: 'school_admin' | 'super_admin' = 'school_admin',
  schools: School[] = [school],
  classRows: Class[] = [schoolClass],
  yearRows: AcademicYear[] = [year],
  studentRows: Student[] = [student],
) => render(
  <AccountingView
    userRole={userRole}
    currentSchoolId={userRole === 'school_admin' ? 1 : null}
    schools={schools}
    years={yearRows}
    classes={classRows}
    students={studentRows}
  />,
);

const selectStudent = async () => {
  fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Situation des élèves' }));
  fireEvent.change(screen.getByLabelText('Élève'), { target: { value: '10' } });
  await screen.findByText('Afi Doe');
};

beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
    if (path.includes('/api/accounting/tariffs')) return [{
      id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
      categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
    }];
    if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
    if (path.includes('/api/accounting/situation')) return { rows: [{
      studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
      categoryId: 8, categoryCode: 'tuition', tariffId: 41, categoryLabel: 'Scolarité',
      due: 150000, paid: 0, remaining: 150000, status: 'unpaid',
    }] };
    if (path.includes('/api/accounting/students/10')) return studentFinance;
    if (path.includes('/api/accounting/fees')) return [];
    if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
    if (path.includes('/api/accounting/payments')) {
      return { receipt: { id: 55, receiptNumber: 'REC-2026-000055' } };
    }
    if (path.includes('/api/accounting/obligations')) return { id: 21 };
    if (options?.method === 'POST') return {};
    return [];
  });
  vi.mocked(apiFetchBlob).mockResolvedValue(new Blob(['receipt']));
});

afterEach(() => {
  cleanup();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AccountingView', () => {
  it('uses the financial dashboard color hierarchy for amounts and indicators', async () => {
    mountView();

    const cashCard = await screen.findByText('Caisse totale');
    const expectedCard = screen.getByText('Total attendu');
    const remainingCard = screen.getByText('Reste à recouvrer');
    const overdueCard = screen.getByText('Échéances impayées');
    const studentCountCard = screen.getByText('Élèves concernés');

    expect(cashCard.closest('article')?.className).toContain('from-emerald-50');
    expect(expectedCard.closest('article')?.className).toContain('from-indigo-600');
    expect(remainingCard.closest('article')?.className).toContain('from-amber-50');
    expect(overdueCard.closest('article')?.className).toContain('from-rose-50');
    expect(studentCountCard.closest('article')?.className).toContain('from-violet-50');
    expect(screen.getByText('Total encaissé filtré').closest('article')?.className).toContain('from-emerald-50');
    expect(screen.getByText('Dû').closest('article')?.className).toContain('from-indigo-600');
  });
  it('shows individual and range tariffs loaded after a full page initialization', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/tariffs')) return [
        {
          id: 41,
          schoolId: 1,
          academicYearId: 4,
          classId: 2,
          className: '6e',
          classFromId: null,
          classToId: null,
          categoryId: 8,
          categoryCode: 'tuition',
          categoryLabel: 'Scolarité',
          amount: 150000,
        },
        {
          id: 42,
          schoolId: 1,
          academicYearId: 4,
          classId: null,
          className: '6e à 3e',
          classFromId: 2,
          classFromName: '6e',
          classToId: 5,
          classToName: '3e',
          categoryId: 18,
          categoryCode: 'custom:transport',
          categoryLabel: 'Transport',
          amount: 120000,
        },
      ];
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/accounting/tariffs?schoolId=1&academicYearId=4',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    expect(await screen.findByText('Scolarité')).toBeTruthy();
    expect(screen.getByText('Transport')).toBeTruthy();
    expect(screen.getByText('6e · 2026-2027')).toBeTruthy();
    expect(screen.getByText('6e à 3e · 2026-2027')).toBeTruthy();
  });

  it('filters the student situation by year class and global financial status, then resets both filters', async () => {
    const situationRows = [
      { studentId: 10, classId: 2, studentStatus: 'unpaid' },
      { studentId: 11, classId: 3, studentStatus: 'partial' },
      { studentId: 12, classId: 2, studentStatus: 'paid' },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/situation')) {
        const query = new URLSearchParams(path.split('?')[1]);
        const status = query.get('status');
        const classId = query.get('classId');
        return {
          rows: status
            ? situationRows.filter((row) => row.studentStatus === status
              && (classId == null || row.classId === Number(classId)))
            : [],
        };
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView('school_admin', [school], [schoolClass, globalClass], [year], studentsForSituation);
    fireEvent.click(screen.getByRole('button', { name: 'Situation des élèves' }));

    const classFilter = screen.getByLabelText('Filtrer par classe');
    const statusFilter = screen.getByLabelText('Filtrer par statut financier');
    const studentFilter = screen.getByLabelText('Élève');
    expect(within(classFilter).getByRole('option', { name: 'Toutes les classes' })).toBeTruthy();
    expect(within(classFilter).getByRole('option', { name: '3ème A' })).toBeTruthy();
    expect(within(statusFilter).getByRole('option', { name: 'Tous' })).toBeTruthy();

    fireEvent.change(classFilter, { target: { value: '3' } });
    expect(within(studentFilter).getByRole('option', { name: 'Doe Binta' })).toBeTruthy();
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Afi' })).toBeNull();

    fireEvent.change(classFilter, { target: { value: '' } });
    fireEvent.change(statusFilter, { target: { value: 'paid' } });
    await waitFor(() => expect(within(studentFilter).getByRole('option', { name: 'Doe Kossi' })).toBeTruthy());
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Afi' })).toBeNull();

    fireEvent.change(statusFilter, { target: { value: 'partial' } });
    await waitFor(() => expect(within(studentFilter).getByRole('option', { name: 'Doe Binta' })).toBeTruthy());
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Kossi' })).toBeNull();

    fireEvent.change(statusFilter, { target: { value: 'unpaid' } });
    await waitFor(() => expect(within(studentFilter).getByRole('option', { name: 'Doe Afi' })).toBeTruthy());
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Binta' })).toBeNull();

    fireEvent.change(classFilter, { target: { value: '2' } });
    fireEvent.change(statusFilter, { target: { value: 'paid' } });
    await waitFor(() => expect(within(studentFilter).getByRole('option', { name: 'Doe Kossi' })).toBeTruthy());
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Afi' })).toBeNull();

    fireEvent.change(classFilter, { target: { value: '3' } });
    fireEvent.change(statusFilter, { target: { value: 'partial' } });
    await waitFor(() => expect(within(studentFilter).getByRole('option', { name: 'Doe Binta' })).toBeTruthy());

    fireEvent.change(classFilter, { target: { value: '3' } });
    fireEvent.change(statusFilter, { target: { value: 'unpaid' } });
    await waitFor(() => expect(
      apiFetch,
    ).toHaveBeenCalledWith(expect.stringContaining('classId=3&status=unpaid')));
    expect(within(studentFilter).queryByRole('option', { name: 'Doe Binta' })).toBeNull();
    expect(within(studentFilter).getAllByRole('option')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }));
    expect((classFilter as HTMLSelectElement).value).toBe('');
    expect((statusFilter as HTMLSelectElement).value).toBe('');
    expect(within(studentFilter).getByRole('option', { name: 'Doe Afi' })).toBeTruthy();
    expect(within(studentFilter).getByRole('option', { name: 'Doe Ama' })).toBeTruthy();
  });

  it('displays and downloads the class situation using the active class and status filters', async () => {
    const rows = [
      { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, className: '6e', studentDue: 100, studentPaid: 100, studentRemaining: 0, studentStatus: 'paid' },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial' },
      { studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 2, className: '6e', studentDue: 100, studentPaid: 0, studentRemaining: 100, studentStatus: 'unpaid' },
    ];
    const categoryRows = [
      { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', due: 100, paid: 100, studentDue: 100, studentPaid: 100, studentRemaining: 0, studentStatus: 'paid' },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', due: 60, paid: 40, studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial' },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', categoryId: 2, categoryCode: 'enrollment', categoryLabel: 'Inscription', due: 40, paid: 0, studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial' },
      { studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', due: 100, paid: 0, studentDue: 100, studentPaid: 0, studentRemaining: 100, studentStatus: 'unpaid' },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/situation')) {
        const query = new URLSearchParams(path.split('?')[1]);
        const status = query.get('status');
        if (query.get('includeAllCategories') === 'true') {
          return { rows: categoryRows.filter((row) => status == null || row.studentStatus === status) };
        }
        return {
          rows: rows.filter((row) => status == null || row.studentStatus === status),
        };
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:class-situation');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    mountView('school_admin', [school], [schoolClass], [year], studentsForSituation);
    fireEvent.click(screen.getByRole('button', { name: 'Situation des élèves' }));
    const classFilter = screen.getByLabelText('Filtrer par classe');
    const statusFilter = screen.getByLabelText('Filtrer par statut financier');
    const viewClassButton = screen.getByRole('button', { name: 'Voir la situation de la classe' });
    const pdfButton = screen.getByRole('button', { name: 'Télécharger PDF' });
    expect(viewClassButton).toBeDisabled();
    expect(pdfButton).toBeDisabled();

    fireEvent.change(classFilter, { target: { value: '2' } });
    expect(viewClassButton).toBeEnabled();
    fireEvent.click(viewClassButton);
    const report = await screen.findByRole('region', { name: 'Situation financière de la classe' });
    expect(await within(report).findByText('Doe Afi')).toBeTruthy();
    expect(within(report).getByText('Doe Binta')).toBeTruthy();
    expect(within(report).getByText('Doe Kossi')).toBeTruthy();
    expect(within(report).getByText('300 FCFA')).toBeTruthy();
    expect(within(report).getByText('140 FCFA')).toBeTruthy();
    expect(within(report).getByText('160 FCFA')).toBeTruthy();

    fireEvent.change(statusFilter, { target: { value: 'partial' } });
    await waitFor(() => expect(within(report).getByText('Doe Binta')).toBeTruthy());
    expect(within(report).queryByText('Doe Afi')).toBeNull();
    expect(within(report).queryByText('Doe Kossi')).toBeNull();
    const partialRow = within(report).getByText('Doe Binta').closest('tr');
    expect(partialRow).not.toBeNull();
    expect(within(partialRow!).getByText('100 FCFA')).toBeTruthy();
    expect(within(partialRow!).getByText('40 FCFA')).toBeTruthy();
    expect(within(partialRow!).getByText('60 FCFA')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('classId=2&aggregate=student&includeInactive=true&status=partial'));

    fireEvent.click(pdfButton);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(
      /classId=2&includeInactive=true&status=partial&includeAllCategories=true/,
    ));
    const pdfBlob = createObjectURL.mock.calls[0][0] as Blob;
    const loadedPdf = await PDFDocument.load(await pdfBlob.arrayBuffer());
    expect(loadedPdf.getPageCount()).toBe(1);
    expect(loadedPdf.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  });

  it('shows zero totals for a class with no students in the financial situation', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/situation') && path.includes('aggregate=student')) return { rows: [] };
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });
    mountView('school_admin', [school], [schoolClass, globalClass], [year], []);
    fireEvent.click(screen.getByRole('button', { name: 'Situation des élèves' }));
    fireEvent.change(screen.getByLabelText('Filtrer par classe'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voir la situation de la classe' }));

    const report = await screen.findByRole('region', { name: 'Situation financière de la classe' });
    expect(await within(report).findByText('Aucun élève ne correspond à cette classe et aux filtres sélectionnés.')).toBeTruthy();
    expect(within(report).getAllByText('0 FCFA')).toHaveLength(3);
    expect(within(report).getByText('0 élève(s)')).toBeTruthy();
  });

  it('reuses the payment idempotency key when retrying after a receipt request error', async () => {
    vi.mocked(apiFetchBlob)
      .mockRejectedValueOnce(new Error('Receipt request failed'))
      .mockResolvedValueOnce(new Blob(['receipt']));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:receipt'),
      revokeObjectURL: vi.fn(),
    });

    mountView();
    await screen.findByText('Caisse totale');
    await selectStudent();
    expect(screen.getByText(/Paiement 2026-10-06/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    const submit = screen.getByRole('button', { name: /Encaisser et générer le reçu/i });

    fireEvent.click(submit);
    await screen.findByRole('alert');
    fireEvent.click(submit);
    await screen.findByRole('status');

    const paymentRequests = vi.mocked(apiFetch).mock.calls
      .filter(([path]) => path.includes('/api/accounting/payments'))
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(paymentRequests).toHaveLength(2);
    expect(paymentRequests[0].idempotencyKey).toBeTruthy();
    expect(paymentRequests[1].idempotencyKey).toBe(paymentRequests[0].idempotencyKey);
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/55');
    expect(screen.getByRole('link', { name: /Reçu REC-2026-000055/ })).toBeTruthy();
  });

  it('exposes the sidebar finance page only to school and super administrators', () => {
    const { rerender } = render(
      <AccountingView userRole="teacher" currentSchoolId={1} schools={[school]} years={[year]} classes={[]} students={[student]} />,
    );
    expect(screen.queryByRole('region', { name: 'Comptabilité scolaire' })).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();

    rerender(
      <AccountingView userRole="parent" currentSchoolId={1} schools={[school]} years={[year]} classes={[]} students={[student]} />,
    );
    expect(screen.queryByRole('region', { name: 'Comptabilité scolaire' })).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('loads and exposes historical receipt PDFs from the student statement', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:historical-receipt'),
      revokeObjectURL: vi.fn(),
    });
    mountView();
    await selectStudent();
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger le reçu PDF' }));

    const link = await screen.findByRole('link', { name: 'Voir / imprimer le reçu' });
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/66');
    expect(link.getAttribute('href')).toBe('blob:historical-receipt');
  });

  it('lets a super administrator select a school and loads that school’s accounting data', async () => {
    mountView('super_admin', [school, secondSchool]);
    await screen.findByText('Sélectionnez un établissement pour accéder à ses données financières.');

    fireEvent.change(screen.getByLabelText('Établissement'), { target: { value: '2' } });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/accounting/categories?schoolId=2');
    });
    expect(screen.getByRole('heading', { name: 'Comptabilité' })).toBeTruthy();
  });

  it('shows configured tuition as unpaid before any payment and opens the selected student situation', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Scolarité/ }));
    expect((await screen.findAllByText(/150.000 FCFA/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Scolarité').length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Doe\s+Afi/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Encaisser' }));

    expect(await screen.findByRole('button', { name: /Encaisser et générer le reçu/i })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(screen.getByText(/Montant attendu : 150.000 FCFA · Déjà payé : 0 FCFA · Reste à payer : 150.000 FCFA/)).toBeTruthy();
    expect(screen.getByLabelText('Montant pour Scolarité').getAttribute('max')).toBe('150000');
    expect(screen.getByLabelText('Mode de paiement')).toBeTruthy();
    expect(screen.getByLabelText('Référence facultative')).toBeTruthy();
  });

  it('selects the active school year but leaves every configured fee unselected initially', async () => {
    const inactiveYear: AcademicYear = { id: 3, schoolId: 1, name: '2025-2026', isActive: false };
    mountView('school_admin', [school], [schoolClass], [inactiveYear, year]);
    await waitFor(() => expect((screen.getByLabelText('Année scolaire') as HTMLSelectElement).value).toBe('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Frais scolaires' }));

    const tuition = await screen.findByRole('checkbox', { name: /Scolarité/ });
    expect((tuition as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull();

    fireEvent.click(tuition);
    expect(await screen.findByText(/Doe\s+Afi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeTruthy();
  });

  it('keeps the total and all 100 selected-fee payments while collapsing only the payment list', async () => {
    const allocations = Array.from({ length: 100 }, (_, index) => ({
      allocationId: index + 1,
      paidAt: '2026-10-07',
      studentName: `Élève ${index + 1}`,
      categoryLabel: 'Scolarité',
      method: 'cash',
      amount: 3870,
    }));
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) {
        return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      }
      if (path.includes('/api/accounting/tariffs')) {
        return [{
          id: 41,
          academicYearId: 4,
          classId: 2,
          className: '6e',
          categoryId: 8,
          categoryCode: 'tuition',
          categoryLabel: 'Scolarité',
          amount: 150000,
        }];
      }
      if (path.includes('/api/accounting/situation')) {
        return { rows: [{
          studentId: 10,
          firstName: 'Afi',
          lastName: 'Doe',
          matricule: 'A10',
          classId: 2,
          className: '6e',
          categoryId: 8,
          categoryCode: 'tuition',
          tariffId: 41,
          categoryLabel: 'Scolarité',
          due: 150000,
          paid: 0,
          remaining: 150000,
          status: 'unpaid',
        }] };
      }
      if (path.includes('/api/accounting/cash')) return { total: 387000, allocations };
      if (path.includes('/api/accounting/dashboard')) {
        return { total: 387000, categories: {}, expected: 150000, remaining: 0, methods: {} };
      }
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Scolarité/ }));

    const toggle = await screen.findByTestId('selected-fee-payments-toggle');
    expect(toggle).toHaveTextContent('Paiements correspondant aux frais sélectionnés');
    expect(toggle).toHaveTextContent('Total encaissé : 387 000 FCFA');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const paymentRows = () => document.getElementById('selected-fee-payments-details')?.querySelectorAll('tbody tr');
    expect(document.getElementById('selected-fee-payments-details')).toBeNull();
    expect(paymentRows()).toBeUndefined();
    expect(screen.getByText(/Doe\s+Afi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeTruthy();
    expect(screen.getByLabelText('Date des paiements des frais sélectionnés')).toBeTruthy();
    expect(screen.getByLabelText('Classe des paiements des frais sélectionnés')).toHaveValue('');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Total encaissé : 387 000 FCFA');
    expect(document.getElementById('selected-fee-payments-details')).not.toBeNull();
    expect(paymentRows()).toHaveLength(100);
    expect(screen.getByText('Élève 1')).toBeTruthy();
    expect(screen.getByText('Élève 100')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Total encaissé : 387 000 FCFA');
    expect(document.getElementById('selected-fee-payments-details')).toBeNull();
    expect(paymentRows()).toBeUndefined();
    expect(screen.getByText(/Doe\s+Afi/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeTruthy();
  });

  it('filters selected-fee payments by payment date and student class and recalculates the total', async () => {
    const alternateClass: Class = { id: 3, schoolId: 1, academicYearId: 4, name: '3ème' };
    const allocations = [
      { allocationId: 1, paidAt: new Date(2026, 9, 7, 12).toISOString(), studentName: 'Élève 6e', classId: 2, categoryLabel: 'Scolarité', method: 'cash', amount: 12000 },
      { allocationId: 2, paidAt: new Date(2026, 9, 7, 12).toISOString(), studentName: 'Élève 3ème A', classId: 3, categoryLabel: 'Scolarité', method: 'cash', amount: 8000 },
      { allocationId: 3, paidAt: new Date(2026, 9, 8, 12).toISOString(), studentName: 'Élève 3ème B', classId: 3, categoryLabel: 'Scolarité', method: 'cash', amount: 5000 },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) {
        return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      }
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/cash')) return { total: 25000, allocations };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView('school_admin', [school], [schoolClass, alternateClass]);
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Scolarité/ }));
    const toggle = await screen.findByTestId('selected-fee-payments-toggle');
    fireEvent.click(toggle);
    const table = () => within(screen.getAllByRole('table')[0]);

    expect(toggle).toHaveTextContent('Total encaissé : 25 000 FCFA');
    expect(table().getByText('Élève 6e')).toBeTruthy();
    expect(table().getByText('Élève 3ème A')).toBeTruthy();
    expect(table().getByText('Élève 3ème B')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Date des paiements des frais sélectionnés'), {
      target: { value: 'specific' },
    });
    fireEvent.change(screen.getByLabelText('Date précise des paiements'), {
      target: { value: '2026-10-07' },
    });
    expect(toggle).toHaveTextContent('Total encaissé : 20 000 FCFA');
    expect(table().getByText('Élève 6e')).toBeTruthy();
    expect(table().getByText('Élève 3ème A')).toBeTruthy();
    expect(table().queryByText('Élève 3ème B')).toBeNull();

    fireEvent.change(screen.getByLabelText('Classe des paiements des frais sélectionnés'), {
      target: { value: '3' },
    });
    expect(toggle).toHaveTextContent('Total encaissé : 8 000 FCFA');
    expect(table().queryByText('Élève 6e')).toBeNull();
    expect(table().getByText('Élève 3ème A')).toBeTruthy();
    expect(table().queryByText('Élève 3ème B')).toBeNull();

    fireEvent.change(screen.getByLabelText('Date des paiements des frais sélectionnés'), {
      target: { value: 'all' },
    });
    expect(toggle).toHaveTextContent('Total encaissé : 13 000 FCFA');
    expect(table().getByText('Élève 3ème A')).toBeTruthy();
    expect(table().getByText('Élève 3ème B')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Classe des paiements des frais sélectionnés'), {
      target: { value: '' },
    });
    expect(toggle).toHaveTextContent('Total encaissé : 25 000 FCFA');

    fireEvent.change(screen.getByLabelText('Date des paiements des frais sélectionnés'), {
      target: { value: 'specific' },
    });
    fireEvent.change(screen.getByLabelText('Date précise des paiements'), {
      target: { value: '2026-10-08' },
    });
    fireEvent.change(screen.getByLabelText('Classe des paiements des frais sélectionnés'), {
      target: { value: '2' },
    });
    expect(toggle).toHaveTextContent('Total encaissé : 0 FCFA');
    expect(table().getByText('Aucun paiement ne correspond aux filtres sélectionnés.')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Total encaissé : 0 FCFA');
    expect(document.getElementById('selected-fee-payments-details')).toBeNull();
    expect(screen.getByLabelText('Date des paiements des frais sélectionnés')).toBeTruthy();
    expect(screen.getByLabelText('Classe des paiements des frais sélectionnés')).toHaveValue('2');
  });

  it('filters available tariffs by multiple configured labels and class, then removes unavailable labels on year change', async () => {
    const nextYear: AcademicYear = { id: 5, schoolId: 1, name: '2027-2028', isActive: false };
    const tariffs = [
      { id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8, categoryCode: 'canteen', categoryLabel: 'Cantine', amount: 15000 },
      { id: 42, academicYearId: 4, classId: 3, className: '5e', categoryId: 8, categoryCode: 'canteen', categoryLabel: 'Cantine', amount: 14000 },
      { id: 43, academicYearId: 4, classId: 2, className: '6e', categoryId: 9, categoryCode: 'uniform', categoryLabel: 'Uniforme', amount: 20000 },
      { id: 44, academicYearId: 4, classId: 3, className: '5e', categoryId: 10, categoryCode: 'custom:inscription 2', categoryLabel: 'Inscription 2', amount: 12000 },
      { id: 45, academicYearId: 4, classId: 3, className: '5e', categoryId: 12, categoryCode: 'custom:equipement', categoryLabel: 'Équipement', amount: 9000 },
      { id: 46, academicYearId: 4, classId: 2, className: '6e', categoryId: 13, categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000 },
      { id: 51, academicYearId: 5, classId: 4, className: '4e', categoryId: 11, categoryCode: 'custom:transport', categoryLabel: 'Transport', amount: 10000 },
      { id: 52, academicYearId: 5, classId: 4, className: '4e', categoryId: 8, categoryCode: 'canteen', categoryLabel: 'Cantine', amount: 15000 },
    ];
    const yearClasses: Class[] = [
      schoolClass,
      { id: 3, schoolId: 1, academicYearId: 4, name: '5e' },
      { id: 4, schoolId: 1, academicYearId: 5, name: '4e' },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/tariffs')) {
        const requestedYear = Number(new URL(`http://localhost${path}`).searchParams.get('academicYearId'));
        return tariffs.filter((tariff) => !requestedYear || tariff.academicYearId === requestedYear);
      }
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView('school_admin', [school], yearClasses, [year, nextYear]);
    await waitFor(() => expect((screen.getByLabelText('Année scolaire') as HTMLSelectElement).value).toBe('4'));
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));

    const labelFilter = screen.getByRole('button', { name: 'Libellé des tarifs disponibles' });
    const classFilter = screen.getByRole('combobox', { name: 'Classe des tarifs disponibles' });
    const feeTariffs = () => screen.getByRole('group', { name: 'Frais de l’année sélectionnée' });
    expect(labelFilter).toHaveTextContent('Tous les libellés');
    expect(labelFilter).toHaveAttribute('aria-expanded', 'false');
    expect(within(feeTariffs()).getByLabelText(/Cantine.*6e/)).toBeTruthy();
    expect(within(feeTariffs()).getByLabelText(/Cantine.*5e/)).toBeTruthy();
    expect(within(feeTariffs()).getAllByRole('checkbox', { name: /Cantine.*[56]e/ })).toHaveLength(2);
    expect(within(feeTariffs()).getByLabelText(/Uniforme/)).toBeTruthy();
    expect(within(feeTariffs()).getByLabelText(/Scolarité/)).toBeTruthy();
    expect(within(feeTariffs()).getByLabelText(/Inscription 2/)).toBeTruthy();
    expect(within(feeTariffs()).getByLabelText(/Équipement/)).toBeTruthy();
    expect(within(feeTariffs()).getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(labelFilter);
    expect(labelFilter).toHaveAttribute('aria-expanded', 'true');
    let labelOptions = screen.getByRole('group', { name: 'Sélectionner les libellés' });
    expect(within(labelOptions).getAllByRole('checkbox', { name: 'Cantine' })).toHaveLength(1);
    expect(within(labelOptions).getByRole('checkbox', { name: 'Uniforme' })).toBeTruthy();
    expect(within(labelOptions).getByRole('checkbox', { name: 'Scolarité' })).toBeTruthy();
    expect(within(labelOptions).getByRole('checkbox', { name: 'Inscription 2' })).toBeTruthy();
    expect(within(labelOptions).getByRole('checkbox', { name: 'Équipement' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(labelFilter).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(labelFilter);
    expect(labelFilter).toHaveAttribute('aria-expanded', 'true');
    labelOptions = screen.getByRole('group', { name: 'Sélectionner les libellés' });
    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Cantine' }));
    expect(within(labelOptions).getByRole('checkbox', { name: 'Cantine' })).toBeChecked();
    expect(labelFilter).toHaveTextContent('Cantine');
    expect(within(feeTariffs()).getAllByRole('checkbox', { name: /Cantine.*[56]e/ })).toHaveLength(2);
    expect(within(feeTariffs()).getByLabelText(/Cantine.*5e/)).toBeTruthy();
    expect(within(feeTariffs()).queryByLabelText(/Uniforme/)).toBeNull();
    expect(within(feeTariffs()).queryByLabelText(/Inscription 2/)).toBeNull();

    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Uniforme' }));
    expect(within(labelOptions).getByRole('checkbox', { name: 'Cantine' })).toBeChecked();
    expect(within(labelOptions).getByRole('checkbox', { name: 'Uniforme' })).toBeChecked();
    expect(labelFilter).toHaveTextContent('Cantine, Uniforme');
    expect(within(feeTariffs()).getAllByRole('checkbox', { name: /Cantine.*[56]e/ })).toHaveLength(2);
    expect(within(feeTariffs()).getByLabelText(/Uniforme.*6e/)).toBeTruthy();
    expect(within(feeTariffs()).queryByLabelText(/Inscription 2/)).toBeNull();

    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Cantine' }));
    expect(within(labelOptions).getByRole('checkbox', { name: 'Cantine' })).not.toBeChecked();
    expect(labelFilter).toHaveTextContent('Uniforme');
    expect(within(feeTariffs()).queryByLabelText(/Cantine/)).toBeNull();
    expect(within(feeTariffs()).getByLabelText(/Uniforme.*6e/)).toBeTruthy();

    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Cantine' }));
    fireEvent.change(classFilter, { target: { value: '2' } });
    expect(within(feeTariffs()).getAllByLabelText(/Cantine.*6e/)).toHaveLength(1);
    expect(within(feeTariffs()).getByLabelText(/Uniforme.*6e/)).toBeTruthy();
    expect(within(feeTariffs()).queryByLabelText(/Cantine.*5e/)).toBeNull();
    fireEvent.change(classFilter, { target: { value: '3' } });
    expect(within(feeTariffs()).getByLabelText(/Cantine.*5e/)).toBeTruthy();
    expect(within(feeTariffs()).queryByLabelText(/Uniforme/)).toBeNull();
    expect(within(feeTariffs()).queryByLabelText(/Cantine.*6e/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tous les libellés' }));
    expect(labelFilter).toHaveTextContent('Tous les libellés');
    expect(within(feeTariffs()).getByLabelText(/Inscription 2/)).toBeTruthy();
    expect(within(feeTariffs()).getByLabelText(/Équipement/)).toBeTruthy();
    fireEvent.change(classFilter, { target: { value: '' } });
    expect(within(feeTariffs()).getByLabelText(/Uniforme/)).toBeTruthy();
    expect(within(feeTariffs()).getAllByLabelText(/Cantine/)).toHaveLength(2);

    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Cantine' }));
    fireEvent.click(within(labelOptions).getByRole('checkbox', { name: 'Uniforme' }));
    fireEvent.change(classFilter, { target: { value: '2' } });

    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '5' } });
    await waitFor(() => expect((screen.getByLabelText('Année scolaire') as HTMLSelectElement).value).toBe('5'));
    expect(screen.getByRole('button', { name: 'Libellé des tarifs disponibles' })).toHaveTextContent('Cantine');
    expect((screen.getByRole('combobox', { name: 'Classe des tarifs disponibles' }) as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Libellé des tarifs disponibles' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Sélectionner les libellés' }))
      .queryByRole('checkbox', { name: 'Uniforme' })).toBeNull());
    expect(within(screen.getByRole('group', { name: 'Sélectionner les libellés' }))
      .getByRole('checkbox', { name: 'Cantine' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Sélectionner les libellés' }))
      .getByRole('checkbox', { name: 'Transport' })).not.toBeChecked();
    expect(within(feeTariffs()).getByLabelText(/Cantine.*4e/)).toBeTruthy();
    expect(within(feeTariffs()).queryByLabelText(/Transport.*4e/)).toBeNull();
    expect((within(feeTariffs()).getByLabelText(/Cantine.*4e/) as HTMLInputElement).checked).toBe(false);
  });

  it('filters configured fee payments by selected tariff id and keeps class-specific labels', async () => {
    const alternateClass: Class = { id: 3, schoolId: 1, academicYearId: 4, name: '5e' };
    const classTariffs = [
      {
        id: 31, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Frais de scolarité', amount: 150000,
      },
      {
        id: 32, academicYearId: 4, classId: 3, className: '5e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Contribution scolaire', amount: 120000,
      },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) {
        return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      }
      if (path.includes('/api/accounting/tariffs')) return classTariffs;
      if (path.includes('/api/accounting/situation')) return { rows: [
        {
          studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
          categoryId: 8, categoryCode: 'tuition', tariffId: 31, categoryLabel: 'Frais de scolarité',
          due: 150000, paid: 0, remaining: 150000, status: 'unpaid',
        },
        {
          studentId: 11, firstName: 'Ama', lastName: 'Doe', matricule: 'A11', classId: 3, className: '5e',
          categoryId: 8, categoryCode: 'tuition', tariffId: 32, categoryLabel: 'Contribution scolaire',
          due: 120000, paid: 0, remaining: 120000, status: 'unpaid',
        },
      ] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: { tuition: 0 }, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) {
        const hasFirst = path.includes('tariffId=31');
        const hasSecond = path.includes('tariffId=32');
        return {
          total: hasFirst ? 12000 : hasSecond ? 8000 : 20000,
          allocations: [
            ...(hasFirst ? [{ allocationId: 1, paidAt: '2026-10-01', studentName: 'Afi Doe', categoryLabel: 'Frais de scolarité', method: 'cash', amount: 12000 }] : []),
            ...(hasSecond ? [{ allocationId: 2, paidAt: '2026-10-02', studentName: 'Ama Doe', categoryLabel: 'Contribution scolaire', method: 'cash', amount: 8000 }] : []),
          ],
        };
      }
      return [];
    });

    mountView('school_admin', [school], [schoolClass, alternateClass]);
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    expect(await screen.findByLabelText(/Frais de scolarité/)).toBeTruthy();
    expect(await screen.findByLabelText(/Contribution scolaire/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Frais de scolarité/));
    fireEvent.click(screen.getByLabelText(/Contribution scolaire/));
    fireEvent.click(screen.getByTestId('selected-fee-payments-toggle'));
    const paymentTable = () => within(screen.getAllByRole('table')[0]);
    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) =>
        path.includes('/api/accounting/cash?') && path.includes('tariffId=31') && path.includes('tariffId=32'))).toBe(true);
      expect(paymentTable().getByText('Afi Doe')).toBeTruthy();
      expect(paymentTable().getByText('Ama Doe')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText(/Frais de scolarité/));
    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) =>
        path.includes('/api/accounting/cash?') && path.includes('tariffId=32') && !path.includes('tariffId=31'))).toBe(true);
      expect(paymentTable().getByText('Ama Doe')).toBeTruthy();
      expect(paymentTable().queryByText('Afi Doe')).toBeNull();
    });
    fireEvent.click(screen.getByLabelText(/Frais de scolarité/));
    fireEvent.click(screen.getByLabelText(/Contribution scolaire/));
    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) =>
        path.includes('/api/accounting/cash?') && path.includes('tariffId=31') && !path.includes('tariffId=32'))).toBe(true);
      expect(paymentTable().getByText('Afi Doe')).toBeTruthy();
      expect(paymentTable().queryByText('Ama Doe')).toBeNull();
    });
    expect(screen.getAllByText('Frais de scolarité').length).toBeGreaterThan(0);
    expect(screen.queryByText('Scolarité')).toBeNull();
  });

  it.each([
    { feeLabel: 'Cantine', tariffId: 61, categoryId: 9, categoryCode: 'canteen' },
    { feeLabel: 'Uniforme', tariffId: 62, categoryId: 10, categoryCode: 'uniform' },
    { feeLabel: 'Frais de scolarité', tariffId: 63, categoryId: 8, categoryCode: 'tuition' },
  ])('$feeLabel seul permet un encaissement affecté au tarif sélectionné', async ({
    feeLabel,
    tariffId,
    categoryId,
    categoryCode,
  }) => {
    const feeTariff = {
      id: tariffId, academicYearId: 4, classId: 2, className: '6e', categoryId,
      categoryCode, categoryLabel: feeLabel, amount: 50000,
    };
    const finance = {
      ...studentFinance,
      categories: [{
        id: categoryId, tariffId, label: feeLabel, due: 50000, paid: 0, remaining: 50000,
        status: 'unpaid', obligations: [],
      }],
    };
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:single-fee'), revokeObjectURL: vi.fn() });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: categoryId, code: categoryCode, label: feeLabel, isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [feeTariff];
      if (path.includes('/api/accounting/situation')) return { rows: [{
        studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
        categoryId, categoryCode, tariffId, categoryLabel: feeLabel, due: 50000, paid: 0,
        remaining: 50000, status: 'unpaid',
      }] };
      if (path.includes('/api/accounting/students/10')) return finance;
      if (path.includes('/api/accounting/payments')) return { receipt: { id: 56, receiptNumber: 'REC-2026-000056' } };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 50000, remaining: 50000, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return options?.method === 'POST' ? {} : [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    const checkbox = await screen.findByLabelText(new RegExp(feeLabel));
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText(/Doe\s+Afi/)).toBeTruthy();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) =>
      path.includes('/api/accounting/situation?') && path.includes(`tariffId=${tariffId}`))).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Encaisser' }));
    expect(await screen.findByLabelText(`Montant pour ${feeLabel}`)).toBeTruthy();
    expect(screen.queryByLabelText("Montant payé aujourd'hui")).toBeNull();
    fireEvent.change(screen.getByLabelText(`Montant pour ${feeLabel}`), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    await screen.findByRole('link', { name: /Reçu REC-2026-000056/ });
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls
      .find(([path]) => path.includes('/api/accounting/payments'))?.[1]?.body));
    expect(body.allocations).toEqual([{ tariffId, amount: 12000 }]);
  });

  it('starts with a collapsed configuration form, creates a custom fee, and edits it without duplicating', async () => {
    let tariff: any = null;
    let customCategory: any = null;
    const tariffRequests: Array<{ path: string; method: string; body: any }> = [];
    const alternateClass: Class = { id: 3, schoolId: 1, academicYearId: 4, name: '5e' };
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) {
        return [
          { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
          ...(customCategory ? [customCategory] : []),
        ];
      }
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        tariffRequests.push({ path, method: 'POST', body });
        customCategory = { id: 18, code: 'custom:transport', label: body.label, isEnabled: true };
        tariff = {
          id: 31, schoolId: body.schoolId, academicYearId: body.academicYearId, classId: body.classId,
          className: '6e', categoryId: 18, categoryCode: 'custom:transport',
          categoryLabel: body.label, amount: body.amount,
        };
        return tariff;
      }
      if (path === '/api/accounting/tariffs/31' && options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        tariffRequests.push({ path, method: 'PUT', body });
        tariff = {
          ...tariff,
          amount: body.amount,
          classId: body.classId,
          className: body.classId === alternateClass.id ? alternateClass.name : schoolClass.name,
          categoryLabel: body.label,
        };
        customCategory = { ...customCategory, label: body.label };
        return tariff;
      }
      if (path.includes('/api/accounting/tariffs')) return tariff ? [tariff] : [];
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView('school_admin', [school], [schoolClass, alternateClass]);
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    await waitFor(() => expect((screen.getByLabelText('Année scolaire') as HTMLSelectElement).value).toBe('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));

    expect(screen.getByRole('button', { name: '+ Créer un frais' })).toBeTruthy();
    expect(screen.queryByLabelText('Libellé')).toBeNull();
    expect(screen.queryByLabelText('Classe du frais')).toBeNull();
    expect(screen.queryByText('Type de frais')).toBeNull();
    expect(screen.queryByText('Frais supplémentaires')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    expect(screen.getByLabelText('Libellé')).toBeTruthy();
    expect(screen.getByLabelText('Classe du frais')).toBeTruthy();
    expect(screen.getByLabelText('Montant')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Transport' } });
    fireEvent.change(screen.getByLabelText('Classe du frais'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByRole('status');
    expect(tariffRequests[0]).toEqual({
      path: '/api/accounting/tariffs',
      method: 'POST',
      body: { schoolId: 1, academicYearId: 4, classId: 2, label: 'Transport', amount: 15000 },
    });
    expect(screen.getAllByText('Transport').length).toBeGreaterThan(0);
    expect(screen.getByText('6e · 2026-2027')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeTruthy();
    expect(screen.queryByLabelText('Libellé')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: ' transport ' } });
    fireEvent.change(screen.getByLabelText('Classe du frais'), { target: { value: '2' } });
    expect(screen.getByText(/Ce frais existe déjà/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le frais existant' }));
    expect((screen.getByLabelText('Libellé') as HTMLInputElement).value).toBe('Transport');
    expect((screen.getByLabelText('Montant') as HTMLInputElement).value).toBe('15000');
    expect((screen.getByLabelText('Classe du frais') as HTMLSelectElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Transport scolaire' } });
    fireEvent.change(screen.getByLabelText('Classe du frais'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(tariffRequests).toHaveLength(2));
    expect(tariffRequests[1]).toEqual({
      path: '/api/accounting/tariffs/31',
      method: 'PUT',
      body: { schoolId: 1, academicYearId: 4, classId: 3, amount: 20000, label: 'Transport scolaire' },
    });
    expect(screen.getAllByText('Transport scolaire').length).toBeGreaterThan(0);
    expect(screen.getByText('5e · 2026-2027')).toBeTruthy();
    expect(screen.getByText(/20.?000 FCFA/)).toBeTruthy();
  });

  it('confirms tariff deletion, refreshes the list, and leaves other tariffs intact', async () => {
    let deleted = false;
    const configuredTariffs = [
      { id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8, categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000, isEnabled: true },
      { id: 42, academicYearId: 4, classId: 2, className: '6e', categoryId: 9, categoryCode: 'uniform', categoryLabel: 'Uniforme', amount: 20000, isEnabled: true },
    ];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path === '/api/accounting/tariffs/41?schoolId=1' && options?.method === 'DELETE') {
        deleted = true;
        return { success: true, archived: true };
      }
      if (path.includes('/api/accounting/tariffs')) return deleted
        ? configuredTariffs.filter((tariff) => tariff.id !== 41)
        : configuredTariffs;
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView();
    await waitFor(() => expect(screen.getByLabelText('Année scolaire')).toHaveValue('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    expect(screen.getByText('Scolarité')).toBeTruthy();
    expect(screen.getByText('Uniforme')).toBeTruthy();
    const deleteButtons = screen.getAllByRole('button', { name: 'Supprimer' });

    fireEvent.click(deleteButtons[0]);
    expect(confirm).toHaveBeenCalledWith('Supprimer le tarif « Scolarité — 6e » ?');
    expect(deleted).toBe(false);

    confirm.mockReturnValue(true);
    fireEvent.click(deleteButtons[0]);
    await screen.findByText('Tarif archivé car il est lié à l’historique comptable.');
    expect(screen.queryByText('Scolarité')).toBeNull();
    expect(screen.getByText('Uniforme')).toBeTruthy();
    expect(vi.mocked(apiFetch).mock.calls.some(([path, options]) =>
      path === '/api/accounting/tariffs/41?schoolId=1' && options?.method === 'DELETE')).toBe(true);
  });

  it('creates an ordered class-range tariff and uses it for student situation, payment, and receipt', async () => {
    const rangeClasses: Class[] = [
      { id: 6, schoolId: 1, academicYearId: 4, levelId: 2, name: '2nde' },
      { id: 5, schoolId: 1, academicYearId: 4, levelId: 3, name: '3ème' },
      { id: 2, schoolId: 1, academicYearId: 4, levelId: 6, name: '6ème' },
      { id: 4, schoolId: 1, academicYearId: 4, levelId: 4, name: '4ème' },
      { id: 3, schoolId: 1, academicYearId: 4, levelId: 5, name: '5ème' },
    ];
    const levelRows = [
      { id: 6, orderIndex: 1 }, { id: 5, orderIndex: 2 }, { id: 4, orderIndex: 3 },
      { id: 3, orderIndex: 4 }, { id: 2, orderIndex: 5 },
    ];
    const tariffRequests: Array<{ classFromId: number; classToId: number; label: string; amount: number }> = [];
    const createdTariffs: any[] = [];
    let paymentRequest: any = null;
    const feeLabel = 'Frais période';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:range-receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/education/levels') return levelRows;
      if (path.includes('/api/accounting/categories')) return [];
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        tariffRequests.push({
          classFromId: body.classFromId,
          classToId: body.classToId,
          label: body.label,
          amount: body.amount,
        });
        const startClass = rangeClasses.find((item) => item.id === body.classFromId)!;
        const endClass = rangeClasses.find((item) => item.id === body.classToId)!;
        const tariff = {
          id: 501,
          schoolId: body.schoolId,
          academicYearId: body.academicYearId,
          classId: null,
          classFromId: body.classFromId,
          classFromName: startClass.name,
          classToId: body.classToId,
          classToName: endClass.name,
          className: `${startClass.name} à ${endClass.name}`,
          categoryId: 18,
          categoryCode: 'custom:frais période',
          categoryLabel: body.label,
          amount: body.amount,
        };
        createdTariffs.push(tariff);
        return tariff;
      }
      if (path.includes('/api/accounting/tariffs')) return createdTariffs;
      if (path.includes('/api/accounting/situation')) {
        const requestedTariffIds = new URLSearchParams(path.split('?')[1] ?? '').getAll('tariffId').map(Number);
        const tariff = createdTariffs[0];
        return {
          rows: tariff && requestedTariffIds.includes(tariff.id) ? [{
            studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10',
            classId: 4, className: '4ème', categoryId: 18, categoryCode: tariff.categoryCode,
            tariffId: tariff.id, categoryLabel: feeLabel, due: 120000, paid: 0,
            remaining: 120000, status: 'unpaid',
          }] : [],
        };
      }
      if (path.includes('/api/accounting/students/10')) {
        const tariff = createdTariffs[0];
        return {
          student: { id: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', className: '4ème', classId: 4 },
          totals: { due: 120000, paid: 0 },
          categories: tariff ? [{
            id: 18, label: feeLabel, tariffId: tariff.id, due: 120000, paid: 0,
            remaining: 120000, status: 'unpaid', obligations: [],
          }] : [],
          payments: [],
        };
      }
      if (path.includes('/api/accounting/payments') && options?.method === 'POST') {
        paymentRequest = JSON.parse(String(options.body));
        return { receipt: { id: 70, receiptNumber: 'REC-2026-000070' } };
      }
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView('school_admin', [school], rangeClasses);
    await waitFor(() => expect(screen.getByLabelText('Année scolaire')).toHaveValue('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: feeLabel } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '5' } });
    expect(screen.getByText('Classes concernées : 6ème, 5ème, 4ème, 3ème')).toBeTruthy();
    const startOptions = Array.from((screen.getByLabelText('Classe de début') as HTMLSelectElement).options)
      .map((option) => option.textContent);
    expect(startOptions.slice(1)).toEqual(['6ème', '5ème', '4ème', '3ème', '2nde']);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Un tarif a été configuré pour toute la plage de classes.');

    expect(tariffRequests).toEqual([{
      classFromId: 2,
      classToId: 5,
      label: feeLabel,
      amount: 120000,
    }]);
    expect(createdTariffs).toHaveLength(1);
    expect(screen.getByText(/6ème à 3ème · 2026-2027/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Frais scolaires' }));
    const tariffClassFilter = screen.getByLabelText('Classe des tarifs disponibles');
    fireEvent.change(tariffClassFilter, { target: { value: '6' } });
    expect(await screen.findByText('Aucun frais ne correspond aux filtres sélectionnés.')).toBeTruthy();
    fireEvent.change(tariffClassFilter, { target: { value: '4' } });
    const configuredTariffCheckbox = await screen.findByRole('checkbox', { name: /Frais période.*6ème à 3ème/ });
    fireEvent.click(configuredTariffCheckbox);
    await screen.findByText(/Doe\s+Afi/);
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }));
    fireEvent.change(await screen.findByLabelText(`Montant pour ${feeLabel}`), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser et générer le reçu' }));
    await screen.findByText(/Paiement enregistré — reçu REC-2026-000070/);
    expect(paymentRequest.allocations).toEqual([{ tariffId: 501, amount: 120000 }]);
    expect(paymentRequest.academicYearId).toBe(4);
    expect(screen.getByRole('link', { name: /Reçu REC-2026-000070 — ouvrir \/ imprimer le PDF/ })).toBeTruthy();
  });

  it('stores class ranges once, supports one-class ranges, and rejects inverted ranges', async () => {
    const rangeClasses: Class[] = [
      { id: 2, schoolId: 1, academicYearId: 4, levelId: 6, name: '6ème' },
      { id: 3, schoolId: 1, academicYearId: 4, levelId: 5, name: '5ème' },
      { id: 4, schoolId: 1, academicYearId: 4, levelId: 4, name: '4ème' },
    ];
    const existingTariff = {
      id: 103, schoolId: 1, academicYearId: 4, classId: 3, className: '5ème',
      categoryId: 18, categoryCode: 'custom:transport', categoryLabel: 'Transport', amount: 10000,
    };
    const createdRanges: Array<{ classFromId: number; classToId: number; label: string }> = [];
    const levels = [{ id: 6, orderIndex: 1 }, { id: 5, orderIndex: 2 }, { id: 4, orderIndex: 3 }];
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/education/levels') return levels;
      if (path.includes('/api/accounting/categories')) return [];
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        createdRanges.push({
          classFromId: body.classFromId,
          classToId: body.classToId,
          label: body.label,
        });
        const startClass = rangeClasses.find((item) => item.id === body.classFromId)!;
        const endClass = rangeClasses.find((item) => item.id === body.classToId)!;
        return {
          ...existingTariff,
          id: 200 + createdRanges.length,
          classId: null,
          classFromId: body.classFromId,
          classFromName: startClass.name,
          classToId: body.classToId,
          classToName: endClass.name,
          className: `${startClass.name} à ${endClass.name}`,
          amount: body.amount,
          categoryLabel: body.label,
        };
      }
      if (path.includes('/api/accounting/tariffs')) return [
        existingTariff,
        ...createdRanges.map((range, index) => {
          const startClass = rangeClasses.find((item) => item.id === range.classFromId)!;
          const endClass = rangeClasses.find((item) => item.id === range.classToId)!;
          return {
            ...existingTariff,
            id: 201 + index,
            classId: null,
            ...range,
            className: `${startClass.name} à ${endClass.name}`,
          };
        }),
      ];
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView('school_admin', [school], rangeClasses);
    await waitFor(() => expect(screen.getByLabelText('Année scolaire')).toHaveValue('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Transport' } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Un tarif a été configuré pour toute la plage de classes.');
    expect(createdRanges).toEqual([{ classFromId: 2, classToId: 4, label: 'Transport' }]);

    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Frais ponctuel' } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '5000' } });
    expect(screen.getByText('Classes concernées : 5ème')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Un tarif a été configuré pour toute la plage de classes.');
    expect(createdRanges).toEqual([
      { classFromId: 2, classToId: 4, label: 'Transport' },
      { classFromId: 3, classToId: 3, label: 'Frais ponctuel' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Plage inversée' } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '5000' } });
    expect(screen.getByRole('alert')).toHaveTextContent('La classe de fin doit être égale ou après');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(createdRanges).toHaveLength(2);
  });

  it('creates, lists, and collects a new fee with its configured tariff id', async () => {
    let createdTariff: any = null;
    const feeLabel = 'Frais d’inscription';
    const tariffId = 88;
    const feeCategory = {
      id: 18,
      code: 'custom:frais d’inscription',
      label: feeLabel,
      isEnabled: true,
    };
    const finance = {
      ...studentFinance,
      categories: [{
        id: feeCategory.id,
        label: feeLabel,
        tariffId,
        due: 25000,
        paid: 0,
        remaining: 25000,
        status: 'unpaid',
        obligations: [],
      }],
    };
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:new-fee-receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) {
        return [
          { id: 5, code: 'enrollment', label: feeLabel, isEnabled: true },
          ...(createdTariff ? [feeCategory] : []),
        ];
      }
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        createdTariff = {
          id: tariffId,
          schoolId: body.schoolId,
          academicYearId: body.academicYearId,
          classId: body.classId,
          className: '6e',
          categoryId: feeCategory.id,
          categoryCode: feeCategory.code,
          categoryLabel: body.label,
          amount: body.amount,
        };
        return createdTariff;
      }
      if (path.includes('/api/accounting/tariffs')) return createdTariff ? [createdTariff] : [];
      if (path.includes('/api/accounting/situation')) return {
        rows: createdTariff ? [{
          studentId: 10,
          firstName: 'Afi',
          lastName: 'Doe',
          matricule: 'A10',
          classId: 2,
          className: '6e',
          categoryId: feeCategory.id,
          categoryCode: feeCategory.code,
          tariffId,
          categoryLabel: feeLabel,
          due: 25000,
          paid: 0,
          remaining: 25000,
          status: 'unpaid',
        }] : [],
      };
      if (path.includes('/api/accounting/students/10')) return finance;
      if (path.includes('/api/accounting/payments')) return { receipt: { id: 88, receiptNumber: 'REC-2026-000088' } };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 25000, remaining: 25000, methods: {} };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return options?.method === 'POST' ? {} : [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: feeLabel } });
    fireEvent.change(screen.getByLabelText('Classe du frais'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Frais enregistré.');

    const feeCreateRequest = vi.mocked(apiFetch).mock.calls.find(([path, options]) =>
      path === '/api/accounting/tariffs' && options?.method === 'POST');
    expect(JSON.parse(String(feeCreateRequest?.[1]?.body))).toEqual({
      schoolId: 1,
      academicYearId: 4,
      classId: 2,
      label: feeLabel,
      amount: 25000,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(feeLabel) }));
    expect((await screen.findAllByText(/Doe\s+Afi/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Encaisser' }));
    fireEvent.change(await screen.findByLabelText(`Montant pour ${feeLabel}`), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    await screen.findByRole('link', { name: /Reçu REC-2026-000088/ });
    const paymentRequest = JSON.parse(String(vi.mocked(apiFetch).mock.calls
      .find(([path]) => path.includes('/api/accounting/payments'))?.[1]?.body));
    expect(paymentRequest.allocations).toEqual([{ tariffId, amount: 12000 }]);
    expect(paymentRequest).not.toHaveProperty('categoryId');
    expect(paymentRequest).not.toHaveProperty('enrollmentId');
    expect(paymentRequest).not.toHaveProperty('chargeId');
    expect(paymentRequest).not.toHaveProperty('enrollmentChargeId');
    expect(createdTariff).toMatchObject({
      academicYearId: 4,
      classId: 2,
      categoryId: feeCategory.id,
      id: tariffId,
    });
  });

  it.each([
    { feeLabel: 'Frais de scolarité', code: 'tuition', categoryId: 8, baseTariffId: 41 },
    { feeLabel: 'Cantine', code: 'canteen', categoryId: 9, baseTariffId: 51 },
    { feeLabel: 'Uniforme', code: 'uniform', categoryId: 10, baseTariffId: 61 },
  ])('affiche immédiatement les élèves de $feeLabel et filtre les classes', async ({
    feeLabel,
    code,
    categoryId,
    baseTariffId,
  }) => {
    const classTariffs = [
      { id: baseTariffId, academicYearId: 4, classId: 2, className: '6e', categoryId, categoryCode: code, categoryLabel: feeLabel, amount: 30000 },
      { id: baseTariffId + 1, academicYearId: 4, classId: 3, className: '5e', categoryId, categoryCode: code, categoryLabel: feeLabel, amount: 25000 },
    ];
    const allTariffs = [
      ...classTariffs,
      { id: 70, academicYearId: 4, classId: 2, className: '6e', categoryId: 20, categoryCode: 'other', categoryLabel: 'Autre frais', amount: 10000 },
    ];
    const situations = [
      ...classTariffs.map((tariff, index) => ({
        studentId: index === 0 ? 10 : 11,
        firstName: index === 0 ? 'Afi' : 'Ama',
        lastName: 'Doe',
        matricule: `A${index}`,
        classId: tariff.classId,
        className: tariff.className,
        categoryId,
        categoryCode: code,
        tariffId: tariff.id,
        categoryLabel: feeLabel,
        due: tariff.amount,
        paid: 0,
        remaining: tariff.amount,
        status: 'unpaid',
      })),
      {
        studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A0',
        classId: 2, className: '6e', categoryId: 20, categoryCode: 'other',
        tariffId: 70, categoryLabel: 'Autre frais', due: 10000, paid: 0, remaining: 10000, status: 'unpaid',
      },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/tariffs')) return allTariffs;
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: situations };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView('school_admin', [school], [schoolClass, { id: 3, schoolId: 1, academicYearId: 4, name: '5e' }]);
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    const checkboxes = await screen.findAllByRole('checkbox');
    for (const checkbox of checkboxes) {
      const parentLabel = checkbox.closest('label');
      if (parentLabel?.textContent?.includes(feeLabel)) fireEvent.click(checkbox);
    }
    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([path]) =>
        path.includes('/api/accounting/situation?')
        && path.includes(`tariffId=${baseTariffId}`)
        && path.includes(`tariffId=${baseTariffId + 1}`))).toBe(true);
      const situationTable = within(screen.getAllByRole('table')[0]);
      expect(situationTable.getByText(/Doe\s+Afi/)).toBeTruthy();
      expect(situationTable.getByText(/Doe\s+Ama/)).toBeTruthy();
      expect(situationTable.queryByText('Autre frais')).toBeNull();
    });
    expect(screen.getAllByRole('button', { name: 'Encaisser' }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Classe des frais sélectionnés'), { target: { value: '3' } });
    const situationTable = within(screen.getAllByRole('table')[0]);
    expect(situationTable.getByText(/Doe\s+Ama/)).toBeTruthy();
    expect(situationTable.queryByText(/Doe\s+Afi/)).toBeNull();
    expect(situationTable.getAllByText(feeLabel).length).toBeGreaterThan(0);
  });

  it('shows the combined totals for all fee categories in the student situation', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/students/10')) return {
        student: studentFinance.student,
        totals: { due: 225000, paid: 100000 },
        categories: [
          { id: 8, label: 'Scolarité', due: 150000, paid: 50000, remaining: 100000, status: 'partial', obligations: [] },
          { id: 9, label: 'Cantine', due: 50000, paid: 25000, remaining: 25000, status: 'partial', obligations: [] },
          { id: 10, label: 'Uniforme', due: 25000, paid: 25000, remaining: 0, status: 'paid', obligations: [] },
        ],
        payments: [],
      };
      return [];
    });
    mountView();
    await selectStudent();
    expect(screen.getByText(/Total à payer.*225.*000 FCFA.*Déjà payé.*100.*000 FCFA.*Reste.*125.*000 FCFA/)).toBeTruthy();
    expect(screen.getAllByText('Scolarité').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cantine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Uniforme').length).toBeGreaterThan(0);
  });

  it.each([
    { amountToPay: 40000, expectedPaid: 40000, expectedRemaining: 110000 },
    { amountToPay: 150000, expectedPaid: 150000, expectedRemaining: 0 },
  ])('records a payment of $amountToPay XOF, updates the balance, and generates the receipt', async ({
    amountToPay,
    expectedPaid,
    expectedRemaining,
  }) => {
    let paymentRecorded = 0;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:paid-receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: paymentRecorded, categories: {}, expected: 150000, remaining: 150000 - paymentRecorded, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [{
        studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
        categoryId: 8, categoryCode: 'tuition', tariffId: 41, categoryLabel: 'Scolarité',
        due: 150000, paid: paymentRecorded, remaining: 150000 - paymentRecorded,
        status: paymentRecorded === 0 ? 'unpaid' : paymentRecorded === 150000 ? 'paid' : 'partial',
      }] };
      if (path.includes('/api/accounting/students/10')) return paymentRecorded ? {
        ...studentFinance,
        totals: { due: 150000, paid: paymentRecorded },
        categories: [{
          ...studentFinance.categories[0],
          due: 150000,
          paid: paymentRecorded,
          remaining: 150000 - paymentRecorded,
          status: paymentRecorded === 150000 ? 'paid' : 'partial',
        }],
      } : studentFinance;
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/payments')) {
        const body = JSON.parse(String(options?.body));
        paymentRecorded = body.allocations.reduce((sum: number, allocation: { amount: number }) => sum + allocation.amount, 0);
        return { receipt: { id: 55, receiptNumber: 'REC-2026-000055' } };
      }
      return [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Scolarité/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Encaisser' }));
    await screen.findByRole('button', { name: /Encaisser et générer le reçu/i });
    fireEvent.change(screen.getByLabelText('Montant pour Scolarité'), { target: { value: String(amountToPay) } });
    fireEvent.change(screen.getByLabelText('Mode de paiement'), { target: { value: 'tmoney' } });
    fireEvent.change(screen.getByLabelText('Référence facultative'), { target: { value: 'TX-123' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    expect(await screen.findByRole('link', { name: /Reçu REC-2026-000055/ })).toBeTruthy();
    expect((await screen.findAllByText(new RegExp(`${expectedPaid.toString().slice(0, -3)}.*${expectedPaid.toString().slice(-3)} FCFA`))).length).toBeGreaterThan(0);
    if (expectedRemaining > 0) {
      expect(screen.getAllByText(new RegExp(`${expectedRemaining.toString().slice(0, -3)}.*${expectedRemaining.toString().slice(-3)} FCFA`)).length).toBeGreaterThan(0);
    }
    const paymentRequest = JSON.parse(String(vi.mocked(apiFetch).mock.calls
      .find(([path]) => path.includes('/api/accounting/payments'))?.[1]?.body));
    expect(paymentRequest).toMatchObject({
      allocations: [{ tariffId: 41, amount: amountToPay }],
      method: 'tmoney',
      reference: 'TX-123',
    });
    expect(paymentRequest).not.toHaveProperty('amount');
    expect(paymentRequest).not.toHaveProperty('categoryId');
    expect(paymentRequest).not.toHaveProperty('due');
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/55');
  });

  it('submits one payment with separate tariff allocations for selected canteen and uniform fees', async () => {
    const multiStudentFinance = {
      ...studentFinance,
      totals: { due: 130000, paid: 0 },
      categories: [
        { id: 8, tariffId: 41, label: 'Frais de scolarité', due: 100000, paid: 0, remaining: 100000, status: 'unpaid', obligations: [] },
        { id: 9, tariffId: 42, label: 'Cantine', due: 30000, paid: 0, remaining: 30000, status: 'unpaid', obligations: [] },
        { id: 10, tariffId: 43, label: 'Uniforme', due: 25000, paid: 0, remaining: 25000, status: 'unpaid', obligations: [] },
      ],
    };
    const configuredFees = [
      { id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8, categoryCode: 'tuition', categoryLabel: 'Frais de scolarité', amount: 100000 },
      { id: 42, academicYearId: 4, classId: 2, className: '6e', categoryId: 9, categoryCode: 'canteen', categoryLabel: 'Cantine', amount: 30000 },
      { id: 43, academicYearId: 4, classId: 2, className: '6e', categoryId: 10, categoryCode: 'uniform', categoryLabel: 'Uniforme', amount: 25000 },
    ];
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:multi-fee-receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/tariffs')) return configuredFees;
      if (path.includes('/api/accounting/students/10')) return multiStudentFinance;
      if (path.includes('/api/accounting/payments')) return { receipt: { id: 55, receiptNumber: 'REC-2026-000055' } };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 130000, remaining: 130000, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: configuredFees.slice(1).map((fee) => ({
        studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
        categoryId: fee.categoryId, categoryCode: fee.categoryCode, tariffId: fee.id,
        categoryLabel: fee.categoryLabel, due: fee.amount, paid: 0, remaining: fee.amount, status: 'unpaid',
      })) };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return options?.method === 'POST' ? {} : [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Cantine/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Uniforme/ }));
    expect((await screen.findAllByText(/Doe\s+Afi/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cantine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Uniforme').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Encaisser' })[0]);
    fireEvent.change(await screen.findByLabelText('Montant pour Cantine'), { target: { value: '15000' } });
    fireEvent.change(await screen.findByLabelText('Montant pour Uniforme'), { target: { value: '20000' } });
    expect(screen.queryByLabelText('Montant pour Frais de scolarité')).toBeNull();
    expect(screen.getByText(/Total du paiement : 35\s*000 FCFA/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    await screen.findByRole('link', { name: /Reçu REC-2026-000055/ });
    const paymentRequest = JSON.parse(String(vi.mocked(apiFetch).mock.calls
      .find(([path]) => path.includes('/api/accounting/payments'))?.[1]?.body));
    expect(paymentRequest.allocations).toEqual([
      { tariffId: 42, amount: 15000 },
      { tariffId: 43, amount: 20000 },
    ]);
    expect(paymentRequest).not.toHaveProperty('categoryId');
    expect(paymentRequest).not.toHaveProperty('amount');
  });

  it('does not expose the legacy additional-fee workflow in fee configuration', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'other', label: 'Autres frais', isEnabled: true }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [{
        id: 12, academicYearId: 4, classId: null, studentId: null, categoryId: 8,
        label: 'Transport', amount: 5000, status: 'pending',
      }];
      return [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));

    expect(screen.getByRole('button', { name: '+ Créer un frais' })).toBeTruthy();
    expect(screen.queryByText(/Transport.*PENDING|Transport.*pending/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Frais supplémentaires' })).toBeNull();
  });

  it('shows active custom fees for obligation creation when the student has no tariff', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'other', label: 'Autres frais', isEnabled: true }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/students/10')) return studentFinance;
      if (path.includes('/api/accounting/fees')) return [{
        id: 12, academicYearId: 4, classId: null, studentId: null, categoryId: 8,
        label: 'Transport', amount: 5000, status: 'active',
      }];
      if (path.includes('/api/accounting/obligations')) return { id: 21 };
      if (options?.method === 'POST') return {};
      return [];
    });

    mountView();
    await selectStudent();
    const feeButton = await screen.findByRole('button', { name: /^Ajouter Transport/ });
    fireEvent.click(feeButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/accounting/obligations', expect.objectContaining({
        method: 'POST',
      }));
    });
  });
});
