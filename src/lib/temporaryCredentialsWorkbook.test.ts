import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemporaryCredentialsWorkbook, mapTemporaryCredentialAccounts } from './temporaryCredentialsWorkbook';

describe('temporary credentials workbook', () => {
  it('uses parent phone and non-parent email as login identifiers without exposing technical UIDs', async () => {
    const rows = mapTemporaryCredentialAccounts([
      {
        user: { name: 'Parent sans email', role: 'parent', phone: '+22890000001', uid: 'sim_parent_1' },
        temporaryPassword: 'parent-phone-secret',
      },
      {
        user: { name: 'Parent avec email', role: 'parent', phone: '+22890000002', email: 'parent@example.test', uid: 'sim_parent_2' },
        temporaryPassword: 'parent-email-secret',
      },
      {
        user: { name: 'Teacher Created', role: 'teacher', phone: '+22890000003', email: 'teacher@example.test', uid: 'teacher-internal-id' },
        temporaryPassword: 'teacher-secret',
      },
    ]);

    expect(rows.map(({ identifier }) => identifier)).toEqual([
      '+22890000001',
      '+22890000002',
      'teacher@example.test',
    ]);
    expect(JSON.stringify(rows)).not.toContain('sim_parent_');
    expect(JSON.stringify(rows)).not.toContain('teacher-internal-id');

    const buffer = await buildTemporaryCredentialsWorkbook(rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer));

    const worksheet = workbook.getWorksheet('Comptes créés');
    expect(worksheet).toBeDefined();
    expect(worksheet?.rowCount).toBe(4);
    expect(['A1', 'B1', 'C1', 'D1'].map((cell) => worksheet?.getCell(cell).value)).toEqual([
      'Nom du compte',
      'Identifiant de connexion (téléphone ou email)',
      'Mot de passe temporaire initial',
      'Changement obligatoire',
    ]);
    expect(worksheet?.getCell('B1').note).toContain('Pour un parent, utilisez le numéro de téléphone');
    expect(['A2', 'B2', 'C2', 'D2'].map((cell) => worksheet?.getCell(cell).value)).toEqual([
      'Parent sans email',
      '+22890000001',
      'parent-phone-secret',
      'Oui',
    ]);
    expect(['A3', 'B3', 'C3', 'D3'].map((cell) => worksheet?.getCell(cell).value)).toEqual([
      'Parent avec email',
      '+22890000002',
      'parent-email-secret',
      'Oui',
    ]);
    expect(['A4', 'B4', 'C4', 'D4'].map((cell) => worksheet?.getCell(cell).value)).toEqual([
      'Teacher Created',
      'teacher@example.test',
      'teacher-secret',
      'Oui',
    ]);
  });
});
