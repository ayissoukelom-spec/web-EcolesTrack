import ExcelJS from 'exceljs';

export interface TemporaryCredentialRow {
  name: string;
  identifier: string;
  temporaryPassword: string;
}

export interface TemporaryCredentialAccount {
  user?: {
    name?: string | null;
    role?: string | null;
    phone?: string | null;
    email?: string | null;
    uid?: string | null;
  } | null;
  temporaryPassword: string;
}

export function mapTemporaryCredentialAccounts(accounts: TemporaryCredentialAccount[]): TemporaryCredentialRow[] {
  return accounts.map(({ user, temporaryPassword }) => ({
    name: String(user?.name || user?.email || ''),
    identifier: String(user?.role === 'parent' ? user.phone || '' : user?.email || ''),
    temporaryPassword,
  }));
}

export async function buildTemporaryCredentialsWorkbook(rows: TemporaryCredentialRow[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Comptes créés');

  worksheet.addRow(['Nom du compte', 'Identifiant de connexion (téléphone ou email)', 'Mot de passe temporaire initial', 'Changement obligatoire']);
  worksheet.getCell('B1').note = 'Pour un parent, utilisez le numéro de téléphone pour vous connecter. Si un email a été enregistré, le parent peut également utiliser son email.';
  for (const row of rows) {
    worksheet.addRow([row.name, row.identifier, row.temporaryPassword, 'Oui']);
  }

  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = [
    { width: 30 },
    { width: 36 },
    { width: 34 },
    { width: 28 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
