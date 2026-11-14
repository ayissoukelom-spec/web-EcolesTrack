import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
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
    status: 'posted',
  }],
};
const formatTestMoney = (amount: number) => `${amount.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} FCFA`;

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

const dashboardCategoryCards = (label: string) => screen.queryAllByText(label, { exact: true })
  .map((element) => element.closest('article'))
  .filter((article): article is HTMLElement => article !== null);

const expectDashboardMetric = (label: string, amount: number) => {
  const article = screen.getAllByText(label, { exact: true })[0].closest('article');
  expect(article).not.toBeNull();
  const displayedValue = article!.querySelector('p:last-child')?.textContent ?? '';
  const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
  expect(normalizeWhitespace(displayedValue))
    .toBe(normalizeWhitespace(`${amount.toLocaleString('fr-FR')} FCFA`));
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
  it('does not send global reminders automatically and loads candidates only when the manual tab opens', async () => {
    mountView();
    await screen.findByText('Total encaissé net');

    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/accounting/notifications/overdue'),
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rappels de paiement' }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/accounting/reminders/candidates?'),
      );
    });
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/accounting/notifications/overdue'),
      expect.anything(),
    );
  });

  it('does not show a precreated category without an active tariff or custom fee', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/dashboard')) {
        return { total: 0, categories: { tuition: 25000 }, expected: 50000, remaining: 25000, methods: {} };
      }
      if (path.includes('/api/accounting/tariffs') || path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Scolarité')).toHaveLength(0);
    expect(screen.getByText('Total attendu')).toBeTruthy();
    expect(screen.getByText('Reste à recouvrer')).toBeTruthy();
  });

  it('displays the financial obligation totals returned by the dashboard', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
      ];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/dashboard')) return {
        total: 16000,
        categories: { tuition: 16000 },
        expected: 30000,
        paid: 9000,
        remaining: 21000,
        methods: {},
      };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total attendu');
    expectDashboardMetric('Total encaissé net', 16000);
    expectDashboardMetric('Total attendu', 30000);
    expectDashboardMetric('Reste à recouvrer', 21000);
    expectDashboardMetric('Frais de scolarité', 16000);
    const primaryMetrics = screen.getByText('Total encaissé net').closest('div.grid');
    if (!(primaryMetrics instanceof HTMLElement)) {
      throw new Error('Dashboard metrics container was not found.');
    }
    expect(within(primaryMetrics).getByText('Total attendu', { exact: true })).toBeTruthy();
    expect(within(primaryMetrics).getByText('Reste à recouvrer', { exact: true })).toBeTruthy();
    expect(within(primaryMetrics).queryByText('Payé net', { exact: true })).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/accounting/dashboard?'));
  });

  it('previews tuition generation, requires explicit confirmation, and refreshes the dashboard', async () => {
    const preview = {
      previewToken: 'a'.repeat(64),
      selectionByTariffId: { 41: [10] },
      tuitionReductionsByTariffId: {},
      tuitionInstallmentAmountsByTariffId: {},
      rows: [{
        key: '10:8:41',
        studentId: 10,
        studentName: 'Doe Afi',
        classId: 2,
        className: '6e',
        categoryId: 8,
        categoryCode: 'tuition',
        categoryLabel: 'Frais de scolarité',
        tariffId: 41,
        referenceAmount: 150000,
        discountAmount: 0,
        individualizationReason: null,
        canIndividualize: true,
        amount: 150000,
        state: 'eligible' as const,
        selected: true,
        reason: null,
        installments: [{ label: 'Tranche 1', dueDate: '2026-10-01', amount: 150000, orderIndex: 1 }],
      }],
      studentsExamined: 1,
      studentsEligible: 1,
      newObligationCount: 1,
      existingObligationCount: 0,
      excludedCount: 0,
      estimatedTotal: 150000,
      configurationIssues: [],
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/obligation-generation/preview')) return preview;
      if (path.includes('/api/accounting/obligation-generation/confirm')) return { createdCount: 1, totalAmount: 150000 };
      return [];
    });

    mountView();
    await screen.findByText('Total encaissé net');
    fireEvent.click(screen.getByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(screen.getByRole('button', { name: 'Générer les frais' }));
    fireEvent.click(await screen.findByLabelText('Toutes les classes de 2026-2027'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Frais de scolarité/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser la génération' }));

    expect(await screen.findByText('Aperçu — aucune donnée n’a encore été enregistrée')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Personnaliser la scolarité de Doe Afi' })).toBeTruthy();
    const generationSearch = screen.getByLabelText('Rechercher un élève dans l’aperçu');
    fireEvent.change(generationSearch, { target: { value: 'absent' } });
    expect(await screen.findByText('Aucun élève ne correspond à cette recherche.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect((screen.getByRole('checkbox', { name: 'Inclure Frais de scolarité pour Doe Afi' }) as HTMLInputElement).checked).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith('/api/accounting/obligation-generation/preview', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        schoolId: 1,
        academicYearId: 4,
        classIds: [2],
        categoryIds: [8],
        tuitionReductionsByTariffId: {},
        tuitionInstallmentAmountsByTariffId: {},
      }),
    }));
    expect(vi.mocked(apiFetch).mock.calls
      .some(([path]) => path === '/api/accounting/obligation-generation/confirm')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la génération de 1 obligation/ }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/accounting/obligation-generation/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          schoolId: 1,
          academicYearId: 4,
          classIds: [2],
          categoryIds: [8],
          selectedStudentIdsByTariffId: { 41: [10] },
          tuitionReductionsByTariffId: {},
          tuitionInstallmentAmountsByTariffId: {},
          previewToken: 'a'.repeat(64),
        }),
      }),
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('1 obligation(s) créée(s)');
    expect(vi.mocked(apiFetch).mock.calls
      .filter(([path]) => path.includes('/api/accounting/dashboard')).length).toBeGreaterThan(1);
  });

  it('previews an individual tuition reduction again before allowing confirmation', async () => {
    const basePreview = {
      previewToken: 'a'.repeat(64),
      selectionByTariffId: { 41: [10] },
      tuitionReductionsByTariffId: {},
      tuitionInstallmentAmountsByTariffId: {},
      rows: [{
        key: '10:8:41',
        studentId: 10,
        studentName: 'Doe Afi',
        classId: 2,
        className: '6e',
        categoryId: 8,
        categoryCode: 'tuition',
        categoryLabel: 'Frais de scolarité',
        tariffId: 41,
        referenceAmount: 150000,
        discountAmount: 0,
        individualizationReason: null,
        canIndividualize: true,
        amount: 150000,
        state: 'eligible' as const,
        selected: true,
        reason: null,
        installments: [{ label: 'Tranche 1', dueDate: '2026-10-01', amount: 150000, orderIndex: 1 }],
      }],
      studentsExamined: 1,
      studentsEligible: 1,
      newObligationCount: 1,
      existingObligationCount: 0,
      excludedCount: 0,
      estimatedTotal: 150000,
      configurationIssues: [],
    };
    const reducedPreview = {
      ...basePreview,
      previewToken: 'b'.repeat(64),
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [120000] },
      },
      rows: [{
        ...basePreview.rows[0],
        discountAmount: 30000,
        individualizationReason: 'Bourse accordée',
        amount: 120000,
        installments: [{ label: 'Tranche 1', dueDate: '2026-10-01', amount: 120000, orderIndex: 1 }],
      }],
      estimatedTotal: 120000,
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/obligation-generation/preview')) {
        const body = JSON.parse(String(options?.body));
        return Object.keys(body.tuitionReductionsByTariffId ?? {}).length ? reducedPreview : basePreview;
      }
      if (path.includes('/api/accounting/obligation-generation/confirm')) return { createdCount: 1, totalAmount: 120000 };
      return [];
    });

    mountView();
    await screen.findByText('Total encaissé net');
    fireEvent.click(screen.getByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(screen.getByRole('button', { name: 'Générer les frais' }));
    fireEvent.click(await screen.findByLabelText('Toutes les classes de 2026-2027'));
    fireEvent.click(screen.getByRole('checkbox', { name: /Frais de scolarité/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser la génération' }));
    expect(await screen.findByRole('button', { name: 'Personnaliser la scolarité de Doe Afi' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Personnaliser la scolarité de Doe Afi' }));
    const discountInput = screen.getByRole('spinbutton', { name: 'Montant de la réduction pour Doe Afi' });
    const applyReductionButton = screen.getByRole('button', { name: 'Appliquer la réduction' });
    fireEvent.change(discountInput, {
      target: { value: '150000' },
    });
    expect(screen.getByText(/montant final de 0 FCFA/)).toBeTruthy();
    expect(applyReductionButton).toBeDisabled();
    fireEvent.change(discountInput, {
      target: { value: '30000' },
    });
    expect(screen.getByText('Le motif est obligatoire pour toute réduction.')).toBeTruthy();
    expect(applyReductionButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Motif de la réduction pour Doe Afi' }), {
      target: { value: 'Bourse accordée' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Montant personnalisé de Tranche 1 pour Doe Afi' }), {
      target: { value: '120000' },
    });
    fireEvent.click(applyReductionButton);

    const confirmButton = screen.getByRole('button', { name: /Confirmer la génération de 1 obligation/ });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Cet aperçu ne peut plus être confirmé');
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser l’aperçu' }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) =>
      path === '/api/accounting/obligation-generation/preview')).toHaveLength(2));
    const refreshedPreviewRequest = vi.mocked(apiFetch).mock.calls
      .filter(([path]) => path === '/api/accounting/obligation-generation/preview')[1];
    expect(JSON.parse(String(refreshedPreviewRequest[1]?.body))).toMatchObject({
      tuitionReductionsByTariffId: {
        41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
      },
      tuitionInstallmentAmountsByTariffId: {
        41: { 10: [120000] },
      },
    });
    const personalizeButton = await screen.findByRole('button', { name: 'Personnaliser la scolarité de Doe Afi' });
    const tuitionRow = personalizeButton.closest('tr');
    expect(personalizeButton).toHaveTextContent('Modifier');
    expect(tuitionRow).toHaveTextContent(/120/);
    expect(tuitionRow).toHaveTextContent(/30/);
    expect(screen.getByText('Montant prévisionnel').parentElement).toHaveTextContent(/120/);

    fireEvent.click(screen.getByRole('button', { name: /Confirmer la génération de 1 obligation/ }));
    await waitFor(() => {
      const confirmationCall = vi.mocked(apiFetch).mock.calls.find(([path]) =>
        path === '/api/accounting/obligation-generation/confirm');
      expect(confirmationCall).toBeDefined();
      const confirmationBody = JSON.parse(String(confirmationCall?.[1]?.body));
      expect(confirmationBody).toMatchObject({
        tuitionReductionsByTariffId: {
          41: { 10: { discountAmount: 30000, reason: 'Bourse accordée' } },
        },
        tuitionInstallmentAmountsByTariffId: {
          41: { 10: [120000] },
        },
        previewToken: 'b'.repeat(64),
      });
    });
  });

  it('saves an explicitly configured uneven tuition schedule without saving on display', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 71000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.startsWith('/api/accounting/schedules?')) return null;
      if (path === '/api/accounting/schedules' && options?.method === 'PUT') {
        return JSON.parse(String(options.body));
      }
      return [];
    });

    mountView();
    await screen.findByText('Total encaissé net');
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.change(screen.getByLabelText('Classe de l’échéancier'), { target: { value: '2' } });

    const saveButton = await screen.findByRole('button', { name: 'Enregistrer l’échéancier' });
    expect(vi.mocked(apiFetch).mock.calls
      .some(([path, options]) => path === '/api/accounting/schedules' && options?.method === 'PUT')).toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Nombre de tranches')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Nombre de tranches'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Nombre de tranches'), { target: { value: '3' } });
    const trancheValues = [
      { label: 'Première tranche', date: '2026-10-01', amount: '36000' },
      { label: 'Deuxième tranche', date: '2027-01-01', amount: '25000' },
      { label: 'Troisième tranche', date: '2027-04-01', amount: '10000' },
    ];
    trancheValues.forEach((tranche, index) => {
      fireEvent.change(screen.getByLabelText(`Libellé de la tranche ${index + 1}`), {
        target: { value: tranche.label },
      });
      fireEvent.change(screen.getByLabelText(`Date d’exigibilité de la tranche ${index + 1}`), {
        target: { value: tranche.date },
      });
      fireEvent.change(screen.getByLabelText(`Montant de la tranche ${index + 1}`), {
        target: { value: tranche.amount },
      });
    });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/accounting/schedules',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          schoolId: 1,
          academicYearId: 4,
          classId: 2,
          categoryId: 8,
          periodType: 'trimester',
          installments: [
            { label: 'Première tranche', dueDate: '2026-10-01', amount: 36000 },
            { label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 25000 },
            { label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000 },
          ],
        }),
      }),
    ));
    expect(await screen.findByText(/Échéancier de scolarité enregistré/)).toBeTruthy();
  });

  it('shows one fixed dashboard card for each standard fee category', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
        { id: 9, code: 'enrollment', label: 'Inscription', isEnabled: true },
      ];
      if (path.includes('/api/accounting/tariffs')) return [
        { id: 41, schoolId: 1, academicYearId: 4, classId: 2, className: '6e', categoryId: 8, categoryCode: 'tuition', categoryLabel: 'Scolarité — 6e', amount: 150000, isEnabled: true },
        { id: 42, schoolId: 1, academicYearId: 4, classId: 3, className: '5e', categoryId: 8, categoryCode: 'tuition', categoryLabel: 'Scolarité — 5e', amount: 160000, isEnabled: true },
        { id: 43, schoolId: 1, academicYearId: 4, classId: 2, className: '6e', categoryId: 9, categoryCode: 'enrollment', categoryLabel: 'Inscription — 6e', amount: 10000, isEnabled: true },
      ];
      if (path.includes('/api/accounting/dashboard')) return {
        total: 0,
        categories: { tuition: 1000, enrollment: 200 },
        expected: 0,
        remaining: 0,
        methods: {},
      };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Frais de scolarité')).toHaveLength(1);
    expect(dashboardCategoryCards("Frais d'inscription")).toHaveLength(1);
    expect(dashboardCategoryCards('Scolarité — 6e')).toHaveLength(0);
    expect(dashboardCategoryCards('Inscription — 6e')).toHaveLength(0);
  });

  it('shows categories configured for the selected year and their union for all years', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
        { id: 9, code: 'other', label: 'Autres frais', isEnabled: true },
      ];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, schoolId: 1, academicYearId: 5, classId: 2, className: '6e', categoryId: 9,
        categoryCode: 'other', categoryLabel: 'Autres frais', amount: 5000, isEnabled: true,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView('school_admin', [school], [schoolClass], [
      year,
      { id: 5, schoolId: 1, name: '2025-2026', isActive: false },
    ]);
    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Autres frais')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '' } });
    await waitFor(() => expect(dashboardCategoryCards('Autres frais')).toHaveLength(1));
  });

  it('does not show disabled tariffs or inactive custom fees as configured categories', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, schoolId: 1, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000, isEnabled: false,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return ['pending', 'rejected', 'disabled'].map((status, index) => ({
        id: index + 1, schoolId: 1, academicYearId: 4, classId: null, studentId: null, categoryId: 8,
        label: 'Frais', amount: 5000, status,
      }));
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Scolarité')).toHaveLength(0);
  });

  it('does not use active configurations belonging to another school', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, schoolId: 2, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000, isEnabled: true,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [{
        id: 12, schoolId: 2, academicYearId: 4, classId: null, studentId: null, categoryId: 8,
        label: 'Frais actif', amount: 5000, status: 'active',
      }];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Scolarité')).toHaveLength(0);
  });

  it('shows active applicable custom fees without duplicating categories with multiple tariffs', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [2, 3].map((classId, index) => ({
        id: 41 + index, schoolId: 1, academicYearId: 4, classId, className: 'Classe', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000, isEnabled: true,
      }));
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [{
        id: 12, schoolId: 1, academicYearId: 4, classId: 2, studentId: 10, categoryId: 8,
        label: 'Frais actif', amount: 5000, status: 'active',
      }];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();

    await screen.findByText('Total encaissé net');
    expect(dashboardCategoryCards('Frais de scolarité')).toHaveLength(1);
  });

  it('uses the financial dashboard color hierarchy for amounts and indicators', async () => {
    mountView();

    const cashCard = await screen.findByText('Total encaissé net');
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
      { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, className: '6e', obligationClassNames: ['6e'], studentDue: 100, studentPaid: 100, studentRemaining: 0, studentStatus: 'paid', overdueInstallmentCount: 0, overdueInstallmentAmount: 0, punctualityStatus: 'paid_on_time', nextInstallment: null },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', obligationClassNames: ['4e'], studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial', overdueInstallmentCount: 1, overdueInstallmentAmount: 60, punctualityStatus: 'undetermined', nextInstallment: { label: 'Tranche 1', dueDate: '2026-10-01', remaining: 60, isOverdue: true } },
      { studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 2, className: '6e', obligationClassNames: [], studentDue: 100, studentPaid: 0, studentRemaining: 100, studentStatus: 'unpaid', overdueInstallmentCount: 0, overdueInstallmentAmount: 0, punctualityStatus: 'not_applicable', nextInstallment: null },
    ];
    const categoryRows = [
      { studentId: 10, firstName: 'Afi', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', obligationClassNames: ['6e'], due: 100, paid: 100, studentDue: 100, studentPaid: 100, studentRemaining: 0, studentStatus: 'paid' },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', obligationClassNames: ['4e'], due: 60, paid: 40, studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial' },
      { studentId: 11, firstName: 'Binta', lastName: 'Doe', classId: 2, className: '6e', categoryId: 2, categoryCode: 'enrollment', categoryLabel: 'Inscription', due: 40, paid: 0, studentDue: 100, studentPaid: 40, studentRemaining: 60, studentStatus: 'partial' },
      { studentId: 12, firstName: 'Kossi', lastName: 'Doe', classId: 2, className: '6e', categoryId: 1, categoryCode: 'tuition', categoryLabel: 'Scolarité', due: 100, paid: 0, studentDue: 100, studentPaid: 0, studentRemaining: 100, studentStatus: 'unpaid' },
    ];
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/situation')) {
        const query = new URLSearchParams(path.split('?')[1]);
        const status = query.get('status');
        if (query.get('includeInstallmentDetails') === 'true') {
          return {
            rows: rows.filter((row) => status == null || row.studentStatus === status).map((row) => ({
              ...row,
              installmentDetails: row.studentId === 11 ? [{
                studentId: row.studentId,
                obligationId: 81,
                className: '4e',
                categoryLabel: 'Scolarité',
                label: 'Tranche 1',
                dueDate: '2026-10-01',
                amount: 100,
                paid: 40,
                remaining: 60,
                currentStatus: 'overdue',
                punctualityStatus: 'undetermined',
                settledAt: null,
              }] : [],
            })),
          };
        }
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
    const excelButton = screen.getByRole('button', { name: 'Exporter Excel' });
    expect(viewClassButton).toBeDisabled();
    expect(pdfButton).toBeDisabled();
    expect(excelButton).toBeDisabled();

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
    const partialCells = partialRow!.querySelectorAll('td');
    expect(partialCells[6]).toHaveTextContent('60 FCFA');
    expect(partialCells[9]).toHaveTextContent('60 FCFA');
    expect(partialCells[10]).toHaveTextContent('Tranche 1');
    expect(within(partialRow!).getByText('4e')).toBeTruthy();
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

    fireEvent.click(excelButton);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(
      /classId=2&aggregate=student&includeInactive=true&status=partial&includeInstallmentDetails=true/,
    ));
    const excelBlob = createObjectURL.mock.calls[1][0] as Blob;
    expect(excelBlob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await excelBlob.arrayBuffer()));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Situation des élèves',
      'Détail des échéances',
      'Synthèse',
    ]);
    expect(workbook.getWorksheet('Situation des élèves')?.rowCount).toBe(2);
    expect(workbook.getWorksheet('Situation des élèves')?.getCell('B2').value).toBe('Doe Binta');
    expect(workbook.getWorksheet('Détail des échéances')?.rowCount).toBe(2);
    expect(workbook.getWorksheet('Synthèse')?.getCell('B6').value).toBe(100);
  });

  it('preserves the eight class columns and opens the selected student installment details', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const financeWithInstallments = {
      ...studentFinance,
      totals: { due: 60000, paid: 10000, remaining: 50000, overpayment: 0 },
      categories: [{
        ...studentFinance.categories[0],
        due: 60000,
        paid: 10000,
        remaining: 50000,
        status: 'partial',
        obligations: [{
          id: 901,
          label: 'Scolarité réduite — 2nde G2',
          className: '2nde G2',
          amount: 60000,
          paid: 10000,
          remaining: 50000,
          installments: [
            { id: 1001, label: 'Première tranche', dueDate: yesterday, amount: 30000, paid: 10000, remaining: 20000, status: 'partial', punctualityStatus: 'overdue', settledAt: null, punctualityReason: null },
            { id: 1002, label: 'Deuxième tranche', dueDate: tomorrow, amount: 30000, paid: 0, remaining: 30000, status: 'pending', punctualityStatus: 'upcoming', settledAt: null, punctualityReason: null },
          ],
        }],
      }],
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/students/10')) return financeWithInstallments;
      if (path.includes('/api/accounting/situation')) return { rows: [{
        studentId: 10,
        firstName: 'Afi',
        lastName: 'Doe',
        classId: 2,
        className: '6e',
        obligationClassNames: ['2nde G2'],
        studentDue: 60000,
        studentPaid: 10000,
        studentRemaining: 50000,
        studentStatus: 'partial',
        overdueInstallmentCount: 1,
        overdueInstallmentAmount: 20000,
        punctualityStatus: 'overdue',
        punctualityReason: null,
        nextInstallment: {
          label: 'Deuxième tranche',
          dueDate: tomorrow,
          remaining: 30000,
        },
      }] };
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView('school_admin', [school], [schoolClass], [year], studentsForSituation);
    fireEvent.click(screen.getByRole('button', { name: 'Situation des élèves' }));
    fireEvent.change(screen.getByLabelText('Filtrer par classe'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voir la situation de la classe' }));

    const report = await screen.findByRole('region', { name: 'Situation financière de la classe' });
    const table = within(report).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual([
      'N°',
      'Élève',
      'Classe courante',
      'Classe de l’obligation',
      'Montant dû',
      'Montant payé',
      'Reste à payer',
      'Statut',
      'Échéances échues',
      'Montant en retard',
      'Prochaine échéance et date',
      'Respect des délais',
      'Détail',
    ]);
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    expect(table).toHaveClass('min-w-[1540px]');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    const row = within(table).getByRole('row', { name: /Doe Afi/ });
    expect(row).toHaveTextContent('1');
    expect(row).toHaveTextContent(/20\s?000\s?FCFA/);
    expect(row).toHaveTextContent('Deuxième tranche');
    expect(row).toHaveTextContent('En retard');
    expect(within(report).getByText(/Un remboursement antérieur à la date limite/)).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Voir les échéances de Afi Doe' }));
    const schedules = await screen.findByRole('region', { name: 'Échéanciers des obligations' });
    expect(within(schedules).getByText(/Scolarité réduite — 2nde G2/)).toBeTruthy();
    expect(within(schedules).getByText('Première tranche')).toBeTruthy();
    expect(within(schedules).getByText('Deuxième tranche')).toBeTruthy();
    expect(within(schedules).getByText('Respect des délais')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(
      /\/api\/accounting\/students\/10\?schoolId=1&academicYearId=4/,
    ));
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
    expect(within(report).getAllByText('0 FCFA')).toHaveLength(4);
    expect(within(report).getByText('0 élève(s)')).toBeTruthy();
  });

  it('displays stored installments, API payment states, reduced obligations, and obligations without installments', async () => {
    const financeWithInstallments = {
      ...studentFinance,
      totals: { due: 65000, paid: 30000, remaining: 35000, overpayment: 0 },
      categories: [
        {
          ...studentFinance.categories[0],
          label: 'Scolarité',
          due: 60000,
          paid: 30000,
          remaining: 30000,
          status: 'partial',
          obligations: [{
            id: 901,
            label: 'Scolarité — 2nde G2',
            className: '2nde G2',
            amount: 60000,
            paid: 30000,
            remaining: 30000,
            installments: [
              { id: 1001, label: 'Première tranche', dueDate: '2026-10-01', amount: 30000, paid: 10000, remaining: 20000, status: 'overdue', punctualityStatus: 'undetermined', settledAt: null, punctualityReason: 'Date manquante.' },
              { id: 1002, label: 'Deuxième tranche', dueDate: '2027-01-01', amount: 20000, paid: 20000, remaining: 0, status: 'paid', punctualityStatus: 'paid_on_time', settledAt: '2026-12-15', punctualityReason: null },
              { id: 1003, label: 'Troisième tranche', dueDate: '2027-04-01', amount: 10000, paid: 0, remaining: 10000, status: 'pending', punctualityStatus: 'upcoming', settledAt: null, punctualityReason: null },
            ],
          }],
        },
        {
          id: 9,
          code: 'custom:transport',
          label: 'Transport',
          due: 5000,
          paid: 0,
          remaining: 5000,
          overpayment: 0,
          status: 'unpaid',
          obligations: [{
            id: 902,
            label: 'Transport',
            className: '2nde G2',
            amount: 5000,
            paid: 0,
            remaining: 5000,
            installments: [],
          }],
        },
      ],
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
        { id: 9, code: 'custom:transport', label: 'Transport', isEnabled: true },
      ];
      if (path.includes('/api/accounting/students/10')) return financeWithInstallments;
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();
    await selectStudent();
    const schedules = await screen.findByRole('region', { name: 'Échéanciers des obligations' });
    expect(within(schedules).getByText(/Total des tranches enregistrées/)).toHaveTextContent(/60\s?000\s?FCFA/);
    expect(within(schedules).getByText(/Solde global de l’élève/)).toHaveTextContent(/35\s?000\s?FCFA/);

    const tuitionObligation = within(schedules).getByRole('article', { name: 'Obligation Scolarité 901' });
    expect(within(tuitionObligation).getByText(/Montant total dû/)).toHaveTextContent(/60\s?000\s?FCFA/);
    expect(within(tuitionObligation).getByText(/Total des tranches/)).toHaveTextContent(/60\s?000\s?FCFA/);
    const installmentTable = within(tuitionObligation).getByRole('table', {
      name: 'Échéances de Scolarité, obligation 901',
    });
    const partialRow = within(installmentTable).getByRole('row', { name: /Première tranche/ });
    expect(partialRow).toHaveTextContent('01/10/2026');
    expect(partialRow).toHaveTextContent(/30\s?000\s?FCFA/);
    expect(partialRow).toHaveTextContent(/10\s?000\s?FCFA/);
    expect(partialRow).toHaveTextContent(/20\s?000\s?FCFA/);
    expect(partialRow).toHaveTextContent('En retard');
    expect(partialRow).toHaveTextContent('Non déterminé');
    const paidRow = within(installmentTable).getByRole('row', { name: /Deuxième tranche/ });
    expect(paidRow).toHaveTextContent('Soldée');
    expect(paidRow).toHaveTextContent('Payée à temps');
    expect(paidRow).toHaveTextContent('15/12/2026');
    const upcomingRow = within(installmentTable).getByRole('row', { name: /Troisième tranche/ });
    expect(upcomingRow).toHaveTextContent('À venir');
    expect(within(installmentTable).getByRole('columnheader', { name: 'Respect des délais' })).toBeTruthy();

    const transportObligation = within(schedules).getByRole('article', { name: 'Obligation Transport 902' });
    expect(within(transportObligation).getByText('Aucune échéance enregistrée pour cette obligation.')).toBeTruthy();
    expect(screen.getByText(/Paiement 2026-10-06/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réimprimer le reçu' })).toBeTruthy();
  });

  it('sends an explicitly reduced initial tuition amount and justification with the first payment', async () => {
    const tuitionFinance = {
      ...studentFinance,
      totals: { due: 0, paid: 0, remaining: 0, overpayment: 0 },
      categories: [{
        id: 8,
        code: 'tuition',
        label: 'Scolarité',
        tariffId: 41,
        due: 0,
        paid: 0,
        remaining: 0,
        indicativeTariffAmount: 120000,
        status: 'unconfigured',
        obligations: [],
      }],
      payments: [],
    };
    let paymentRequest: Record<string, unknown> | null = null;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:individualized-tuition'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 120000,
      }];
      if (path.includes('/api/accounting/students/10')) return tuitionFinance;
      if (path.includes('/api/accounting/payments')) {
        paymentRequest = JSON.parse(String(options?.body));
        return { receipt: { id: 55, receiptNumber: 'REC-2026-000055' } };
      }
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, paid: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Montant initial de scolarité'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Justification du montant initial de scolarité'), {
      target: { value: 'Arrivée en cours d’année' },
    });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    expect(await screen.findByRole('link', { name: /Reçu REC-2026-000055/ })).toBeTruthy();
    expect(paymentRequest).toMatchObject({
      categoryId: 8,
      amount: 10000,
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    });
  });

  it('allows constituting individualized tuition without recording a payment', async () => {
    const tuitionFinance = {
      ...studentFinance,
      totals: { due: 0, paid: 0, remaining: 0, overpayment: 0 },
      categories: [{
        id: 8,
        code: 'tuition',
        label: 'Scolarité',
        tariffId: 41,
        due: 0,
        paid: 0,
        remaining: 0,
        indicativeTariffAmount: 120000,
        status: 'unconfigured',
        obligations: [],
      }],
      payments: [],
    };
    let obligationRequest: Record<string, unknown> | null = null;
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 120000,
      }];
      if (path.includes('/api/accounting/students/10')) return tuitionFinance;
      if (path.includes('/api/accounting/obligations')) {
        obligationRequest = JSON.parse(String(options?.body));
        return { id: 21 };
      }
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Montant initial de scolarité'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Justification du montant initial de scolarité'), {
      target: { value: 'Arrivée en cours d’année' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Constituer l’obligation sans encaissement' }));

    await waitFor(() => expect(obligationRequest).toMatchObject({
      tariffId: 41,
      initialTuitionAmount: 60000,
      initialTuitionJustification: 'Arrivée en cours d’année',
    }));
    expect(apiFetch).not.toHaveBeenCalledWith('/api/accounting/payments', expect.anything());
  });

  it('keeps the successful payment and closes the form when receipt loading fails', async () => {
    vi.mocked(apiFetchBlob)
      .mockRejectedValueOnce(new Error('Receipt request failed'))
      .mockResolvedValue(new Blob(['receipt']));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:receipt'),
      revokeObjectURL: vi.fn(),
    });

    mountView();
    await screen.findByText('Total encaissé net');
    await selectStudent();
    expect(screen.getByText(/Paiement 2026-10-06/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    const submit = screen.getByRole('button', { name: /Encaisser et générer le reçu/i });

    fireEvent.click(submit);
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmation de paiement' });

    const paymentRequests = vi.mocked(apiFetch).mock.calls
      .filter(([path]) => path.includes('/api/accounting/payments'))
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(paymentRequests).toHaveLength(1);
    expect(paymentRequests[0].idempotencyKey).toBeTruthy();
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/55');
    expect(within(confirmation).getByRole('heading', { name: 'Paiement enregistré avec succès' })).toBeTruthy();
    expect(within(confirmation).getByRole('status')).toHaveTextContent('Le paiement est confirmé');
    expect(screen.queryByRole('button', { name: /Encaisser et générer le reçu/i })).toBeNull();
    expect(screen.getByLabelText('Type de frais à encaisser')).toHaveValue('');
    expect(screen.queryByLabelText("Montant payé aujourd'hui")).toBeNull();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    expect(screen.getByLabelText("Montant payé aujourd'hui")).toHaveValue(null);
    expect(screen.getByLabelText('Mode de paiement')).toHaveValue('cash');
    expect(screen.getByLabelText('Référence facultative')).toHaveValue('');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Terminer' }));
    expect(screen.queryByRole('dialog', { name: 'Confirmation de paiement' })).toBeNull();
  });

  it('recovers an uncertain payment with the same idempotency key', async () => {
    let paymentRequestCount = 0;
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/payments')) {
        paymentRequestCount += 1;
        if (paymentRequestCount === 1) throw new TypeError('Failed to fetch');
        return { receipt: { id: 55, receiptNumber: 'REC-2026-000055' } };
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/students/10')) return studentFinance;
      if (path.includes('/api/accounting/fees') || path.includes('/api/accounting/cash')) return [];
      return [];
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:recovered-payment'),
      revokeObjectURL: vi.fn(),
    });
    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La connexion n’a pas permis de confirmer le résultat');
    expect(screen.getByLabelText("Montant payé aujourd'hui")).toHaveValue(1000);
    expect(screen.getByLabelText("Montant payé aujourd'hui")).toBeDisabled();
    expect(screen.getByRole('button', { name: /Encaisser et générer le reçu/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Vérifier le résultat' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmation de paiement' });
    expect(within(confirmation).getByRole('heading', { name: 'Paiement enregistré avec succès' })).toBeTruthy();
    expect(paymentRequestCount).toBe(2);
    const paymentRequests = vi.mocked(apiFetch).mock.calls
      .filter(([path]) => path.includes('/api/accounting/payments'))
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(paymentRequests[1].idempotencyKey).toBe(paymentRequests[0].idempotencyKey);
    expect(screen.queryByRole('button', { name: /Encaisser et générer le reçu/i })).toBeNull();
  });

  it('keeps form values after a confirmed payment rejection', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/payments')) {
        throw Object.assign(new Error('Montant invalide'), { status: 400 });
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/students/10')) return studentFinance;
      if (path.includes('/api/accounting/fees') || path.includes('/api/accounting/cash')) return [];
      return [];
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Référence facultative'), { target: { value: 'TX-ERR' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Montant invalide');
    expect(screen.getByLabelText("Montant payé aujourd'hui")).toHaveValue(1000);
    expect(screen.getByLabelText('Référence facultative')).toHaveValue('TX-ERR');
    expect(screen.getByRole('button', { name: /Encaisser et générer le reçu/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Vérifier le résultat' })).toBeNull();
  });

  it('disables the encashment button while the backend request is pending', async () => {
    let resolvePayment!: (value: unknown) => void;
    const pendingPayment = new Promise((resolve) => {
      resolvePayment = resolve;
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/payments')) return pendingPayment;
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/students/10')) return studentFinance;
      if (path.includes('/api/accounting/fees') || path.includes('/api/accounting/cash')) return [];
      return [];
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pending-payment'),
      revokeObjectURL: vi.fn(),
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    const submit = screen.getByRole('button', { name: /Encaisser et générer le reçu/i });
    fireEvent.click(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Traitement…');
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path.includes('/api/accounting/payments'))).toHaveLength(1);

    await act(async () => {
      resolvePayment({ receipt: { id: 55, receiptNumber: 'REC-2026-000055' } });
    });
    expect(await screen.findByRole('dialog', { name: 'Confirmation de paiement' })).toBeTruthy();
  });

  it('keeps the confirmation and omits the balance when financial refresh fails', async () => {
    let paymentConfirmed = false;
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/payments')) {
        paymentConfirmed = true;
        return {
          payment: { id: 55, amount: 1000, paidAt: '2026-10-07T12:00:00.000Z' },
          receipt: {
            id: 55,
            receiptNumber: 'REC-2026-000055',
            snapshot: {
              payment: { amount: 1000, paidAt: '2026-10-07T12:00:00.000Z' },
              student: { firstName: 'Afi', lastName: 'Doe' },
              allocations: [{ tariffLabel: 'Frais de scolarité', amount: 1000 }],
            },
          },
        };
      }
      if (path.includes('/api/accounting/students/10')) {
        if (paymentConfirmed) throw new Error('Financial refresh failed');
        return studentFinance;
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees') || path.includes('/api/accounting/cash')) return [];
      return [];
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:confirmed-payment'),
      revokeObjectURL: vi.fn(),
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /Encaisser et générer le reçu/i }));

    const confirmation = await screen.findByRole('dialog', { name: 'Confirmation de paiement' });
    expect(within(confirmation).getByText(formatTestMoney(1000))).toBeTruthy();
    expect(within(confirmation).getByText('Afi Doe')).toBeTruthy();
    expect(within(confirmation).getByText('Frais de scolarité')).toBeTruthy();
    await waitFor(() => expect(within(confirmation).getByRole('status')).toHaveTextContent(
      'la situation et l’historique de l’élève n’ont pas pu être actualisés',
    ));
    expect(within(confirmation).queryByText('Reste à payer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Encaisser et générer le reçu/i })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Confirmation de paiement' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Réimprimer le reçu' }));

    const link = await screen.findByRole('link', { name: 'Réimprimer le reçu' });
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/66');
    expect(link.getAttribute('href')).toBe('blob:historical-receipt');
    expect(screen.getByRole('link', { name: 'Télécharger le reçu PDF' })).toHaveAttribute(
      'download',
      'REC-2026-000066.pdf',
    );
  });

  it('does not expose receipt reprinting for a cancelled student payment', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/students/10')) {
        return {
          ...studentFinance,
          payments: [{ ...studentFinance.payments[0], status: 'cancelled' }],
        };
      }
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (options?.method === 'POST') return {};
      return [];
    });

    mountView();
    await selectStudent();

    expect(screen.getByText('Paiement annulé — reçu non réimprimable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Réimprimer le reçu' })).toBeNull();
  });

  it('exposes reprint and download actions in the selected-fee payment history', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:cash-history-receipt'),
      revokeObjectURL: vi.fn(),
    });
    const allocation = {
      allocationId: 91,
      paymentId: 45,
      paidAt: '2026-10-07T12:00:00.000Z',
      studentName: 'Doe Afi',
      categoryLabel: 'Scolarité',
      method: 'cash',
      amount: 12000,
      receiptId: 55,
      receiptNumber: 'REC-2026-000055',
      classId: 2,
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/cash')) return { total: 12000, allocations: [allocation] };
      if (path.includes('/api/accounting/dashboard')) return { total: 12000, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      return [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Scolarité/ }));
    fireEvent.click(await screen.findByTestId('selected-fee-payments-toggle'));

    fireEvent.click(await screen.findByRole('button', { name: 'Réimprimer le reçu' }));
    expect(apiFetchBlob).toHaveBeenCalledWith('/api/accounting/receipts/55');
    expect(await screen.findByRole('link', { name: 'Télécharger le reçu PDF' })).toHaveAttribute(
      'download',
      'REC-2026-000055.pdf',
    );
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

  it('shows a tariff without an obligation as indicative and allows payment to create the obligation', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const indicativeFinance = {
      ...studentFinance,
      totals: { due: 0, paid: 0 },
      categories: [{
        ...studentFinance.categories[0],
        due: 0,
        paid: 0,
        remaining: 0,
        status: 'unconfigured',
        indicativeTariffAmount: 150000,
        obligations: [],
      }],
    };
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 41, academicYearId: 4, classId: 2, className: '6e', categoryId: 8,
        categoryCode: 'tuition', categoryLabel: 'Scolarité', amount: 150000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [{
        studentId: 10, firstName: 'Afi', lastName: 'Doe', matricule: 'A10', classId: 2, className: '6e',
        categoryId: 8, categoryCode: 'tuition', tariffId: 41, categoryLabel: 'Scolarité',
        due: 0, indicativeTariffAmount: 150000, paid: 0, remaining: 0, status: 'unconfigured',
      }] };
      if (path.includes('/api/accounting/students/10')) return indicativeFinance;
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/obligations')) return { id: 21 };
      return [];
    });
    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Frais scolaires' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Scolarité/ }));
    expect(await screen.findByText(/Tarif indicatif/)).toBeTruthy();
    expect(screen.getAllByText('Scolarité').length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Doe\s+Afi/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: /Encaisser \(crée l’obligation\)/ }));

    expect(await screen.findByRole('button', { name: /Encaisser et générer le reçu/i })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(screen.getByText(/Montant attendu : 0 FCFA · Déjà payé : 0 FCFA · Reste à payer : 0 FCFA/)).toBeTruthy();
    expect(screen.getByText(/Il ne constitue pas encore une dette/)).toBeTruthy();
    expect(screen.getByLabelText('Montant pour Scolarité').getAttribute('max')).toBe('150000');
    expect(screen.getByLabelText('Mode de paiement')).toBeTruthy();
    expect(screen.getByLabelText('Référence facultative')).toBeTruthy();
  });

  it('requires and sends an enrollment kind only while a new enrollment obligation is needed', async () => {
    let paymentRecorded = false;
    const newEnrollmentFinance = {
      ...studentFinance,
      totals: { due: 0, paid: 0, remaining: 0 },
      categories: [{
        id: 9,
        code: 'enrollment',
        label: 'Inscription',
        tariffId: 88,
        due: 0,
        paid: 0,
        remaining: 0,
        indicativeTariffAmount: 25000,
        status: 'unconfigured',
        obligations: [],
      }],
    };
    const existingEnrollmentFinance = {
      ...newEnrollmentFinance,
      totals: { due: 25000, paid: 12000, remaining: 13000 },
      categories: [{
        ...newEnrollmentFinance.categories[0],
        due: 25000,
        paid: 12000,
        remaining: 13000,
        indicativeTariffAmount: null,
        status: 'partial',
        obligations: [{ id: 100, amount: 25000, installments: [] }],
      }],
    };
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:enrollment-receipt'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 9, code: 'enrollment', label: 'Inscription', isEnabled: true },
      ];
      if (path.includes('/api/accounting/tariffs')) return [{
        id: 88, academicYearId: 4, classId: 2, className: '6e', categoryId: 9,
        categoryCode: 'enrollment', categoryLabel: 'Inscription', amount: 25000,
      }];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/students/10')) {
        return paymentRecorded ? existingEnrollmentFinance : newEnrollmentFinance;
      }
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      if (path.includes('/api/accounting/payments') && options?.method === 'POST') {
        paymentRecorded = true;
        return { receipt: { id: 89, receiptNumber: 'REC-2026-000089' } };
      }
      return [];
    });

    mountView();
    await selectStudent();
    fireEvent.change(screen.getByLabelText('Type de frais à encaisser'), { target: { value: '9' } });
    expect(await screen.findByLabelText('Type d’inscription')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Montant payé aujourd'hui"), { target: { value: '12000' } });
    const submit = screen.getByRole('button', { name: /Encaisser et générer le reçu/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type d’inscription'), { target: { value: 're_enrollment' } });
    fireEvent.click(submit);

    await screen.findByRole('link', { name: /Reçu REC-2026-000089/ });
    const paymentRequest = JSON.parse(String(vi.mocked(apiFetch).mock.calls
      .find(([path]) => path.includes('/api/accounting/payments'))?.[1]?.body));
    expect(paymentRequest).toMatchObject({
      categoryId: 9,
      amount: 12000,
      enrollmentKind: 're_enrollment',
    });
    await waitFor(() => expect(screen.queryByLabelText('Type d’inscription')).toBeNull());
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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

  it('creates a standard tariff by category id without sending a free-form label', async () => {
    const tariffRequests: Array<{ body: any }> = [];
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.includes('/api/accounting/categories')) return [
        { id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true },
        { id: 9, code: 'enrollment', label: 'Inscription', isEnabled: true },
      ];
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        tariffRequests.push({ body: JSON.parse(String(options.body)) });
        return {
          id: 51, schoolId: 1, academicYearId: 4, classId: 2, className: '6e',
          categoryId: 8, categoryCode: 'tuition', categoryLabel: 'Frais de scolarité', amount: 150000,
        };
      }
      if (path.includes('/api/accounting/tariffs')) return [];
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView();
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    await waitFor(() => expect(screen.getByLabelText('Année scolaire')).toHaveValue('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'tuition' } });
    expect(screen.queryByLabelText('Libellé')).toBeNull();
    expect(screen.getByText('Libellé fixe : Frais de scolarité')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Classe du frais'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText('Frais enregistré.');
    expect(tariffRequests).toEqual([{
      body: { schoolId: 1, academicYearId: 4, classId: 2, categoryId: 8, amount: 150000 },
    }]);
  });

  it('orders parallel classes by name when selecting an inclusive class range', async () => {
    const parallelClasses: Class[] = [
      { id: 23, schoolId: 1, academicYearId: 4, levelId: 6, name: '6e C' },
      { id: 21, schoolId: 1, academicYearId: 4, levelId: 6, name: '6e A' },
      { id: 22, schoolId: 1, academicYearId: 4, levelId: 6, name: '6e B' },
    ];
    let tariffRequest: any = null;
    vi.mocked(apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/api/education/levels') return [{ id: 6, orderIndex: 1 }];
      if (path.includes('/api/accounting/categories')) {
        return [{ id: 8, code: 'tuition', label: 'Scolarité', isEnabled: true }];
      }
      if (path === '/api/accounting/tariffs' && options?.method === 'POST') {
        tariffRequest = JSON.parse(String(options.body));
        return {};
      }
      if (path.includes('/api/accounting/tariffs') || path.includes('/api/accounting/fees')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/situation')) return { rows: [] };
      if (path.includes('/api/accounting/cash')) return { total: 0, allocations: [] };
      return [];
    });

    mountView('school_admin', [school], parallelClasses);
    fireEvent.change(screen.getByLabelText('Année scolaire'), { target: { value: '4' } });
    await waitFor(() => expect(screen.getByLabelText('Année scolaire')).toHaveValue('4'));
    fireEvent.click(screen.getByRole('button', { name: 'Configuration des frais' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'tuition' } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '22' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '150000' } });

    expect(screen.getByText('Classes concernées : 6e A, 6e B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Un tarif a été configuré pour toute la plage de classes.');
    expect(tariffRequest).toEqual({
      schoolId: 1,
      academicYearId: 4,
      classFromId: 21,
      classToId: 22,
      categoryId: 8,
      amount: 150000,
    });
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmation de paiement' });
    expect(within(confirmation).getByRole('heading', { name: 'Paiement enregistré avec succès' })).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Transport' } });
    fireEvent.change(screen.getByLabelText('Classe de début'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Classe de fin'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Un tarif a été configuré pour toute la plage de classes.');
    expect(createdRanges).toEqual([{ classFromId: 2, classToId: 4, label: 'Transport' }]);

    fireEvent.click(screen.getByRole('button', { name: '+ Créer un frais' }));
    fireEvent.change(screen.getByLabelText('Mode de configuration'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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
    const feeLabel = 'Frais de dossier';
    const tariffId = 88;
    const feeCategory = {
      id: 18,
      code: 'custom:frais de dossier',
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
    fireEvent.change(screen.getByLabelText('Type de frais'), { target: { value: 'custom' } });
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
    const nameSearch = screen.getByLabelText('Rechercher un élève par nom ou prénom');
    fireEvent.change(nameSearch, { target: { value: 'mÁ' } });
    expect(situationTable.getByText(/Doe\s+Ama/)).toBeTruthy();
    expect(situationTable.queryByText(/Doe\s+Afi/)).toBeNull();
    fireEvent.change(nameSearch, { target: { value: 'afi' } });
    expect(situationTable.getByText('Aucun élève ne correspond à cette recherche et aux filtres sélectionnés.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(situationTable.getByText(/Doe\s+Ama/)).toBeTruthy();
  });

  it('shows the combined totals for all fee categories in the student situation', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/api/accounting/categories')) return [];
      if (path.includes('/api/accounting/dashboard')) return { total: 0, categories: {}, expected: 0, remaining: 0, methods: {} };
      if (path.includes('/api/accounting/students/10')) return {
        student: studentFinance.student,
        totals: { due: 225000, paid: 120000, remaining: 125000, overpayment: 20000 },
        categories: [
          { id: 8, label: 'Scolarité', due: 100000, paid: 120000, remaining: 0, overpayment: 20000, status: 'paid', obligations: [] },
          { id: 9, label: 'Cantine', due: 100000, paid: 0, remaining: 100000, overpayment: 0, status: 'unpaid', obligations: [] },
          { id: 10, label: 'Uniforme', due: 25000, paid: 0, remaining: 25000, overpayment: 0, status: 'unpaid', obligations: [] },
        ],
        payments: [],
      };
      return [];
    });
    mountView();
    await selectStudent();
    expect(screen.getByText(/Total à payer.*225.*000 FCFA.*Payé net.*120.*000 FCFA.*Trop-perçu.*20.*000 FCFA.*Reste exigible.*125.*000 FCFA/)).toBeTruthy();
    expect(screen.getAllByText(/20.*000 FCFA/).length).toBeGreaterThan(0);
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
        totals: { due: 150000, paid: paymentRecorded, remaining: 150000 - paymentRecorded },
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
        return {
          payment: { id: 55, amount: paymentRecorded, paidAt: '2026-10-07T12:00:00.000Z' },
          receipt: {
            id: 55,
            receiptNumber: 'REC-2026-000055',
            snapshot: {
              payment: { amount: paymentRecorded, paidAt: '2026-10-07T12:00:00.000Z' },
              student: { firstName: 'Afi', lastName: 'Doe' },
              allocations: [{ tariffLabel: 'Frais de scolarité', amount: paymentRecorded }],
            },
          },
        };
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
    expect(screen.getByRole('link', { name: 'Télécharger le reçu PDF' })).toHaveAttribute(
      'download',
      'REC-2026-000055.pdf',
    );
    const confirmation = screen.getByRole('dialog', { name: 'Confirmation de paiement' });
    expect(within(confirmation).getByRole('heading', { name: 'Paiement enregistré avec succès' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Encaisser et générer le reçu/i })).toBeNull();
    expect(screen.queryByLabelText('Montant pour Scolarité')).toBeNull();
    expect(within(confirmation).getByText(formatTestMoney(expectedPaid))).toBeTruthy();
    expect(within(confirmation).getByText('Afi Doe')).toBeTruthy();
    expect(within(confirmation).getByText('Frais de scolarité')).toBeTruthy();
    expect(within(confirmation).getByText('07/10/2026')).toBeTruthy();
    expect(within(confirmation).getByText('REC-2026-000055')).toBeTruthy();
    await waitFor(() => expect(within(confirmation).getByText(formatTestMoney(expectedRemaining))).toBeTruthy());
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
      if (path.includes('/api/accounting/payments')) return {
        payment: { id: 55, amount: 35000, paidAt: '2026-10-07T12:00:00.000Z' },
        receipt: {
          id: 55,
          receiptNumber: 'REC-2026-000055',
          snapshot: {
            payment: { amount: 35000, paidAt: '2026-10-07T12:00:00.000Z' },
            student: { firstName: 'Afi', lastName: 'Doe' },
            allocations: [
              { tariffLabel: 'Cantine', amount: 15000 },
              { tariffLabel: 'Uniforme', amount: 20000 },
            ],
          },
        },
      };
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
    const confirmation = screen.getByRole('dialog', { name: 'Confirmation de paiement' });
    expect(within(confirmation).getByText(formatTestMoney(35000))).toBeTruthy();
    expect(within(confirmation).getByText('Cantine, Uniforme')).toBeTruthy();
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
