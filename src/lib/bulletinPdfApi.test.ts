import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
import {
  registerBulletinPdfRoute,
  createBulletinPdfDocument,
  BULLETIN_FINAL_AVERAGE_LABEL,
  formatStudentStatusForPdf,
  resolveStudentStatusForAcademicYear,
  calculateStudentSubjectTypeAverages,
  type BulletinPdfActor,
  type BulletinPdfData,
  type BulletinPdfDataProvider,
} from './bulletinPdfApi';
import { resolveSubjectCoefficientFromPublishedComposition } from './bulletinService';

const actor: BulletinPdfActor = {
  role: 'school_admin',
  schoolId: 1,
};

const snapshotData: BulletinPdfData = {
  id: 1,
  studentId: 10,
  studentName: 'Alice Dupont',
  studentMatricule: '00001N',
  studentGender: 'F',
  studentStatus: 'Doublant',
  classId: 3,
  className: '3ème A',
  classStudentCount: 42,
  schoolName: 'C.S LE SAVOIR',
  school: {
    name: 'C.S LE SAVOIR',
    officialName: 'COLLEGE LE SAVOIR',
    abbreviation: 'CLS',
    motto: 'Le travail et la reussite',
    address: 'Lome',
    postalBox: 'BP 12',
    phone: '+228 90000000',
    email: 'contact@lessavoir.test',
    city: 'Lome',
    region: 'Maritime',
    educationDirection: 'Direction regionale Maritime',
  },
  schoolYearId: 100,
  schoolYearName: '2025-2026',
  termId: 7,
  termName: 'Trimestre 1',
  average: 14.5,
  totalPoints: 58,
  totalCoefficients: 4,
  rank: 2,
  mention: 'SNAPSHOT_MENTION',
  appreciation: 'SNAPSHOT_APPRECIATION',
  generatedAt: '2026-06-26T08:00:00.000Z',
  lines: [
    {
      id: 1,
      bulletinId: 1,
      subjectId: null,
      subjectName: 'Mathématiques',
      coefficient: 2,
      average: 15,
      teacherComment: 'Bon niveau',
      rank: null,
    },
  ],
};

const extractPdfText = (pdfBytes: Uint8Array): string => {
  const raw = Buffer.from(pdfBytes).toString('latin1');
  const streams: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      streams.push(match[1]);
    }
  }
  return streams.join('\n').replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
};

const createApp = (
  provider: BulletinPdfDataProvider,
  pdfGenerator?: (data: BulletinPdfData) => Promise<Uint8Array>,
  options?: { detailAccessAllowed?: boolean; actor?: BulletinPdfActor },
) => {
  const app = express();

  const detailAccessAllowed = options?.detailAccessAllowed ?? true;
  const currentActor = options?.actor ?? actor;

  registerBulletinPdfRoute(app, {
    verifyMiddleware: (req: any, _res, next) => {
      req.user = { uid: 'test-user' };
      next();
    },
    detailAccessMiddleware: (_req: any, res: any, next: any) => {
      if (!detailAccessAllowed) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
    resolveActor: async () => currentActor,
    dataProvider: provider,
    pdfGenerator,
  });

  return app;
};

let activeServer: any = null;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    activeServer = null;
  }
});

const withServer = async (app: express.Express): Promise<string> => {
  await new Promise<void>((resolve) => {
    activeServer = app.listen(0, () => resolve());
  });
  const address = activeServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
};

describe('bulletin PDF API', () => {
  it('calcule la Moy. interro uniquement avec les notes de l élève demandé', () => {
    const rows = [
      [22, 10], [23, 11], [24, 8], [25, 12], [26, 9], [29, 14], [30, 9],
    ].map(([studentId, score]) => ({
      subject: 'Phylosophie',
      studentId,
      type: 'interrogation',
      coefficient: 2,
      maxScore: 20,
      score,
    }));

    const breakdown = calculateStudentSubjectTypeAverages(rows, 26, 'Phylosophie');

    expect(breakdown.interrogation).toBe(9);
    expect(breakdown.interrogation).not.toBeCloseTo(10.428571, 5);
  });

  it('pondère plusieurs interrogations du même élève avec leurs coefficients', () => {
    const rows = [
      { subject: 'Phylosophie', studentId: 26, type: 'interrogation', coefficient: 2, maxScore: 20, score: 9 },
      { subject: 'Phylosophie', studentId: 26, type: 'interrogation', coefficient: 1, maxScore: 20, score: 15 },
      { subject: 'Phylosophie', studentId: 22, type: 'interrogation', coefficient: 2, maxScore: 20, score: 20 },
    ];

    const breakdown = calculateStudentSubjectTypeAverages(rows, 26, 'Phylosophie');

    expect(breakdown.interrogation).toBe(11);
  });

  it('prend le coefficient de la composition publiée, jamais la somme des évaluations', () => {
    const rows = [
      { subject: 'Mathématique', type: 'interrogation', coefficient: 3, maxScore: 20, score: '12' },
      { subject: 'Mathématique', type: 'interrogation', coefficient: 2, maxScore: 20, score: '19' },
      { subject: 'Mathématique', type: 'devoir', coefficient: 4, maxScore: 20, score: '13' },
      { subject: 'Mathématique', type: 'devoir', coefficient: 2, maxScore: 20, score: '19' },
      { subject: 'Mathématique', type: 'composition', coefficient: 3, maxScore: 20, score: '11' },
    ];

    const subjectCoefficient = resolveSubjectCoefficientFromPublishedComposition(
      rows.map((row) => ({ ...row, countInBulletin: true })),
      'Mathématique',
    );

    expect(subjectCoefficient).toBe(3);
    expect(subjectCoefficient).not.toBe(14);
  });

  it.each([
    ['Nouveau', 'N'],
    ['Doublant', 'D'],
    ['Triplant', 'T'],
    ['Quadruplant', 'Q'],
    ['Quintuplant', '5'],
    ['Sextuplant', '6'],
  ])('convertit %s en %s uniquement pour le rendu PDF', (status, abbreviation) => {
    expect(formatStudentStatusForPdf(status)).toBe(abbreviation);
  });

  it('ne produit aucune étiquette de statut lorsqu il est absent', () => {
    expect(formatStudentStatusForPdf(null)).toBeNull();
  });

  it('conserve les statuts distincts du même élève selon chaque année scolaire', () => {
    const rows = [
      { studentId: 10, academicYearId: 100, status: 'Nouveau' },
      { studentId: 10, academicYearId: 101, status: 'Doublant' },
    ];
    expect(resolveStudentStatusForAcademicYear(rows, 10, 100)).toBe('Nouveau');
    expect(resolveStudentStatusForAcademicYear(rows, 10, 101)).toBe('Doublant');
    expect(resolveStudentStatusForAcademicYear(rows, 10, 999)).toBeNull();
  });

  it('affiche le statut sur la ligne du nom et au-dessus du sexe dans le PDF', async () => {
    const pdfBytes = await createBulletinPdfDocument(snapshotData);
    const raw = Buffer.from(pdfBytes).toString('latin1');
    const streams: string[] = [];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
      } catch {
        streams.push(match[1]);
      }
    }
    const text = streams.join('\n').replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    expect(text).toContain('STATUT :');
    expect(text).toMatch(/STATUT :[\s\S]*SEXE :/);
  });

  it('affiche le libellé Moy. Général dans l en-tête du tableau PDF', async () => {
    const pdfBytes = await createBulletinPdfDocument(snapshotData);
    const raw = Buffer.from(pdfBytes).toString('latin1');
    const streams: string[] = [];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
      } catch {
        streams.push(match[1]);
      }
    }
    const text = streams.join('\n').replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    expect(BULLETIN_FINAL_AVERAGE_LABEL).toBe('Moy. Général');
    expect(text).not.toContain('Note /20');
    expect(text).toContain('Devoir');
  });

  it('affiche les groupes de matières dans l ordre littéraire puis scientifique', async () => {
    const literaryLine = { ...snapshotData.lines[0], subjectName: 'Français', subjectTypeName: 'Littéraire', average: 14 };
    const historyLine = { ...snapshotData.lines[0], id: 2, subjectName: 'Histoire', subjectTypeName: 'Littéraire', average: 12 };
    const mathLine = { ...snapshotData.lines[0], id: 3, subjectName: 'Mathématiques', subjectTypeName: 'Scientifique', average: 16 };
    const scienceLine = { ...snapshotData.lines[0], id: 4, subjectName: 'Sciences', subjectTypeName: 'Scientifique', average: 15 };
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [literaryLine, historyLine, mathLine, scienceLine],
      matieres_litteraires: [literaryLine, historyLine],
      matieres_scientifiques: [mathLine, scienceLine],
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));

    const normalizedText = text.replace(/\s+/g, '');
    expect(normalizedText).toContain('MATIERESLITTERAIRES');
    expect(normalizedText).toContain('MATIERESSCIENTIFIQUES');
    expect(normalizedText.indexOf('MATIERESLITTERAIRES')).toBeLessThan(normalizedText.indexOf('MATIERESSCIENTIFIQUES'));
    expect(text.indexOf('Fran')).toBeLessThan(text.indexOf('Math'));
    expect(text.match(/Français/g)?.length ?? 0).toBe(0);
    expect(text.match(/Fran/g)?.length).toBe(1);
    expect(text.match(/Math/g)?.length).toBe(1);
    expect(text).toContain('14.00');
    expect(text).toContain('16.00');
  });

  it('n affiche pas le bloc statut dans le PDF si le statut est absent', async () => {
    const pdfBytes = await createBulletinPdfDocument({ ...snapshotData, studentStatus: null });
    const raw = Buffer.from(pdfBytes).toString('latin1');
    const streams: string[] = [];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
      } catch {
        streams.push(match[1]);
      }
    }
    const text = streams.join('\n').replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    expect(text).not.toContain('STATUT :');
    expect(text).toContain('SEXE :');
  });
  it('génère un PDF avec succès depuis un snapshot persistant', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const app = createApp(provider);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    const header = new TextDecoder().decode(buffer.slice(0, 4));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(header).toBe('%PDF');
  });

  it('retourne 404 si le bulletin snapshot n existe pas', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => null,
    };

    const app = createApp(provider);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/999/pdf`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Bulletin not found');
  });

  it('utilise exclusivement les données snapshot injectées pour construire le PDF', async () => {
    const LIVE_MARKER = 'LIVE_RECALC_SHOULD_NOT_BE_USED';
    let capturedData: BulletinPdfData | null = null;

    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const customGenerator = async (data: BulletinPdfData) => {
      capturedData = data;
      const payload = `%PDF-1.4\n${JSON.stringify({
        mention: data.mention,
        appreciation: data.appreciation,
        average: data.average,
      })}`;
      return new TextEncoder().encode(payload);
    };

    const app = createApp(provider, customGenerator);
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(capturedData?.mention).toBe('SNAPSHOT_MENTION');
    expect(capturedData?.appreciation).toBe('SNAPSHOT_APPRECIATION');
    expect(JSON.stringify(capturedData)).not.toContain(LIVE_MARKER);
    expect(bodyText).toContain('SNAPSHOT_MENTION');
    expect(bodyText).toContain('SNAPSHOT_APPRECIATION');
    expect(bodyText).not.toContain(LIVE_MARKER);
  });

  it('interdit l accès PDF pour un parent non owner', async () => {
    const provider: BulletinPdfDataProvider = {
      getById: async () => snapshotData,
    };

    const app = createApp(provider, undefined, {
      actor: { role: 'parent', schoolId: 1 },
      detailAccessAllowed: false,
    });
    const baseUrl = await withServer(app);

    const response = await fetch(`${baseUrl}/api/bulletins/1/pdf`);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('gère un bulletin long sur plusieurs pages avec les données optionnelles absentes', async () => {
    const longData: BulletinPdfData = {
      ...snapshotData,
      appreciation: 'Appreciation longue '.repeat(20),
      lines: Array.from({ length: 45 }, (_, index) => ({
        ...snapshotData.lines[0],
        id: index + 1,
        subjectName: `Matiere ${index + 1}`,
        teacherComment: index % 3 === 0 ? 'Travail regulier et participation satisfaisante.' : null,
      })),
    };
    const pdfBytes = await createBulletinPdfDocument(longData);
    const document = await PDFDocument.load(pdfBytes);

    expect(document.getPageCount()).toBeGreaterThan(1);
  });

  it('utilise les informations propres à chaque établissement et tolère les champs absents', async () => {
    const schoolA = await createBulletinPdfDocument({
      ...snapshotData,
      schoolName: 'ECOLE A',
      classStudentCount: 3,
      school: { name: 'ECOLE A', officialName: 'COLLEGE A', motto: 'Excellence', region: 'GRAND LOMÉ', address: 'ADRESSE A', postalBox: '1234', phone: '90 00 00 01' },
    });
    const schoolB = await createBulletinPdfDocument({
      ...snapshotData,
      schoolName: 'ECOLE B',
      classStudentCount: 2,
      studentGender: 'M',
      school: { name: 'ECOLE B', officialName: 'COLLEGE B', motto: 'Travail', phone: '+228 90000002' },
    });
    const legacySchool = await createBulletinPdfDocument({
      ...snapshotData,
      classStudentCount: 0,
      studentGender: null,
      school: { name: 'ECOLE ANCIENNE' },
    });

    const extractContent = (bytes: Uint8Array) => {
      const raw = Buffer.from(bytes).toString('latin1');
      const content: string[] = [];
      const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      for (const match of raw.matchAll(streamPattern)) {
        try {
          content.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
        } catch {
          content.push(match[1]);
        }
      }
      return content.join('\n').replace(/<([0-9A-Fa-f]+)> Tj/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    };

    const textA = extractContent(schoolA);
    const textB = extractContent(schoolB);
    const legacyText = extractContent(legacySchool);
    expect(textA).toContain('EFFECTIF : 3');
    expect(textA).toContain('N° Mle : 00001N');
    expect(textA).toContain('SEXE :');
    expect(textA).toMatch(/(?:^|\s)F(?:\s|$)/);
    expect(textA).toContain('COLLEGE A');
    expect(textA).toContain("DIRECTION RE GIONALE DE L'E DUCATION GRAND LOME");
    expect(textA).not.toContain('Excellence');
    expect(textA).toContain('BP : 1234 Te l : 90 00 00 01');
    expect(textA).not.toContain('ADRESSE A');
    expect(textA).not.toContain('District');
    expect(textA).not.toContain('COLLEGE B');
    expect(textB).toContain('EFFECTIF : 2');
    expect(textB).toContain('SEXE :');
    expect(textB).toMatch(/(?:^|\s)M(?:\s|$)/);
    expect(textB).toContain('COLLEGE B');
    expect(textB).toContain('Travail');
    expect(textB).not.toContain('COLLEGE A');
    expect(legacyText).toContain('EFFECTIF : 0');
    expect(legacyText).toContain('ECOLE ANCIENNE');
    expect(legacyText).not.toContain('SEXE :');
    expect(legacyText).not.toContain('undefined');
    expect(legacyText).not.toContain('null');
  });

  it('reflète dynamiquement l ajout d un élève dans l effectif', async () => {
    const firstPdf = await createBulletinPdfDocument({ ...snapshotData, classStudentCount: 1 });
    const nextPdf = await createBulletinPdfDocument({ ...snapshotData, classStudentCount: 2 });

    const extractText = (bytes: Uint8Array) => {
      const raw = Buffer.from(bytes).toString('latin1');
      const streams: string[] = [];
      for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
        try {
          streams.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
        } catch {
          streams.push(match[1]);
        }
      }
      return streams.join('\\n').replace(/<([0-9A-Fa-f]+)> Tj/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    };

    expect(extractText(firstPdf)).toContain('EFFECTIF : 1');
    expect(extractText(nextPdf)).toContain('EFFECTIF : 2');
  });

  it('génère un PDF pour une école existante dont les métadonnées administratives sont nulles', async () => {
    const pdfBytes = await createBulletinPdfDocument({
      ...snapshotData,
      school: {
        name: 'ECOLE ANCIENNE',
        officialName: null,
        abbreviation: null,
        motto: null,
        address: null,
        postalBox: null,
        phone: null,
        email: null,
        city: null,
        region: null,
        educationDirection: null,
        logo: null,
      },
    });

    expect(new TextDecoder().decode(pdfBytes.slice(0, 4))).toBe('%PDF');
  });
});
