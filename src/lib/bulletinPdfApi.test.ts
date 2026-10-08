import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  registerBulletinPdfRoute,
  createBulletinPdfDocument,
  BULLETIN_FINAL_AVERAGE_LABEL,
  formatStudentStatusForPdf,
  resolveStudentStatusForAcademicYear,
  calculateStudentSubjectTypeAverages,
  computeSchoolLogoRenderMetrics,
  computeHeaderParagraphLayout,
  fitHeaderParagraphFontSize,
  computeWrappedTextLines,
  formatPdfDisplayNumber,
  resolvePrincipalTitle,
  resolveSchoolHasLycee,
  resolvePreviousPeriodSummaries,
  calculateClassAverageSummary,
  normalizeStudentGender,
  resolvePromotionDecision,
  formatPromotionDecisionForPdf,
  getSubjectDisplayName,
  resolvePdfSubjectDisplayInfo,
  fitPrincipalNameToWidth,
  resolvePrincipalBoxWidth,
  fitHeaderEmailToBounds,
  resolveSchoolHeaderEmailBounds,
  resolveBulletinClassTeacher,
  type BulletinPdfActor,
  type BulletinPdfData,
  type BulletinPdfDataProvider,
} from './bulletinPdfApi';

const bulletinLogoS3 = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(command: any) {
      return bulletinLogoS3.send(command);
    }
  },
  DeleteObjectCommand: class { constructor(public input: any) {} },
  GetObjectCommand: class { constructor(public input: any) {} },
  PutObjectCommand: class { constructor(public input: any) {} },
}));
import { resolveSubjectCoefficientFromPublishedComposition } from './bulletinService';
import { calculateAnnualBulletinResults } from './bulletinSnapshotService';

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
  principalGender: 'M',
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
    ministryName: 'MINISTERE DE L EDUCATION DU TOGO',
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
  absences: 0,
  retards: 0,
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

const normalizePdfTextForAssertion = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const extractPdfText = (pdfBytes: Uint8Array): string => {
  const pdfBuffer = Buffer.from(pdfBytes);
  const raw = pdfBuffer.toString('latin1');
  const streams: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) != null) {
    const streamStart = match.index + match[0].length;
    const dictionaryStart = raw.lastIndexOf('<<', match.index);
    const dictionary = raw.slice(dictionaryStart, match.index);
    const streamLength = Number(dictionary.match(/\/Length\s+(\d+)\b/)?.[1]);
    if (!Number.isInteger(streamLength) || streamLength < 0 || streamStart + streamLength > pdfBuffer.length) {
      continue;
    }

    const streamEnd = streamStart + streamLength;
    try {
      streams.push(inflateSync(pdfBuffer.subarray(streamStart, streamEnd)).toString('latin1'));
    } catch {
      streams.push(pdfBuffer.subarray(streamStart, streamEnd).toString('latin1'));
    }
    const endMarker = /^\r?\nendstream/.exec(raw.slice(streamEnd));
    streamPattern.lastIndex = streamEnd + (endMarker?.[0].length ?? 0);
  }
  return streams.join('\n')
    .replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, 'hex').toString('latin1'))
    .replace(/Tj/g, ' ');
};

const extractPdfTextBaseline = (pdfBytes: Uint8Array, target: RegExp): number | null => {
  const pdfBuffer = Buffer.from(pdfBytes);
  const raw = pdfBuffer.toString('latin1');
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) != null) {
    const streamStart = match.index + match[0].length;
    const dictionaryStart = raw.lastIndexOf('<<', match.index);
    const streamLength = Number(raw.slice(dictionaryStart, match.index).match(/\/Length\s+(\d+)\b/)?.[1]);
    if (!Number.isInteger(streamLength) || streamLength < 0 || streamStart + streamLength > pdfBuffer.length) continue;

    const streamEnd = streamStart + streamLength;
    let content: string;
    try {
      content = inflateSync(pdfBuffer.subarray(streamStart, streamEnd)).toString('latin1');
    } catch {
      content = pdfBuffer.subarray(streamStart, streamEnd).toString('latin1');
    }
    const linePattern = /1 0 0 1 [-\d.]+ ([-\d.]+) Tm ([\s\S]*?) T\* ET/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = linePattern.exec(content)) != null) {
      if (target.test(lineMatch[2])) return Number(lineMatch[1]);
    }
    const endMarker = /^\r?\nendstream/.exec(raw.slice(streamEnd));
    streamPattern.lastIndex = streamEnd + (endMarker?.[0].length ?? 0);
  }
  return null;
};

const countPdfImages = (pdfBytes: Uint8Array): number => {
  const raw = Buffer.from(pdfBytes).toString('latin1');
  return raw.includes('/Subtype /Image') ? 1 : 0;
};

describe('résolution du nom de matière pour le PDF', () => {
  it('priorise le subject.name actuel quand subject_id est valide, même si le snapshot contient un ancien nom', () => {
    const line = {
      ...snapshotData.lines[0],
      id: 11,
      subjectId: 42,
      subjectName: 'Physique et Chimie',
      subjectCode: 'PC',
    };

    const result = resolvePdfSubjectDisplayInfo(
      line,
      new Map([[42, { name: 'Physique', code: 'PHY' }]]),
    );

    expect(result.subjectName).toBe('Physique');
    expect(result.subjectCode).toBe('PHY');
  });

  it('conserve le fallback historique si subject_id est absent ou invalide et aucune relation fiable n’existe', () => {
    const historicalLine = {
      ...snapshotData.lines[0],
      id: 12,
      subjectId: null,
      subjectName: 'Physique et Chimie',
      subjectCode: 'PC',
    };

    const invalidLine = {
      ...snapshotData.lines[0],
      id: 13,
      subjectId: 999999,
      subjectName: 'Physique et Chimie',
      subjectCode: 'PC',
    };

    expect(resolvePdfSubjectDisplayInfo(historicalLine, new Map())).toMatchObject({ subjectName: 'Physique et Chimie' });
    expect(resolvePdfSubjectDisplayInfo(invalidLine, new Map())).toMatchObject({ subjectName: 'Physique et Chimie' });
  });

  it('affiche le nom actuel quand il tient dans la colonne', () => {
    const font = { widthOfTextAtSize: (text: string) => text.length * 12 } as any;

    expect(getSubjectDisplayName('Physique', 'PHY', 200, font, 7.5)).toBe('Physique');
    expect(getSubjectDisplayName('Mathématiques', 'MATH', 200, font, 7.5)).toBe('Mathématiques');
  });

  it('utilise le code actuel uniquement quand le nom actuel est trop long pour la colonne', () => {
    const font = { widthOfTextAtSize: (text: string) => text.length * 12 } as any;
    const longName = 'Sciences de la Vie et de la Terre';

    expect(getSubjectDisplayName(longName, 'SVT', 70, font, 7.5)).toBe('SVT');
    expect(getSubjectDisplayName('Éducation Physique et Sportive', 'EPS', 70, font, 7.5)).toBe('EPS');
    expect(getSubjectDisplayName(longName, null, 70, font, 7.5)).toBe(longName);
  });

  it('n’utilise jamais un ancien nom de snapshot quand subject_id valide existe', () => {
    const line = {
      ...snapshotData.lines[0],
      id: 14,
      subjectId: 42,
      subjectName: 'Physique et Chimie',
      subjectCode: 'PC',
    };

    const map = new Map<number, { name: string | null; code: string | null }>([[42, { name: 'Physique', code: 'PHY' }]]);

    expect(resolvePdfSubjectDisplayInfo(line, map).subjectName).not.toBe('Physique et Chimie');
    expect(resolvePdfSubjectDisplayInfo(line, map).subjectName).toBe('Physique');
  });

  it('utilise le texte actuel dans le PDF et n’affiche pas l’ancien snapshot quand subject_id valide', async () => {
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [{
        ...snapshotData.lines[0],
        id: 7,
        subjectId: 42,
        subjectName: 'Physique et Chimie',
        subjectCode: 'PC',
      }],
    };

    const pdfBytes = await createBulletinPdfDocument({
      ...data,
      lines: [{
        ...data.lines[0],
        subjectName: 'Physique',
        subjectCode: 'PHY',
      }],
    });

    const text = normalizePdfTextForAssertion(extractPdfText(pdfBytes));
    expect(text).toContain('Physique');
    expect(text).not.toContain('Physique et Chimie');
  });
});

describe('résolution des périodes historiques', () => {
  it('détermine les périodes précédentes selon la vraie configuration trimestrielle et semestrielle', () => {
    const terms = [
      { id: 1, name: 'Trimestre 1', periodType: 'trimester', orderIndex: 1, academicYearId: 2 },
      { id: 2, name: 'Trimestre 2', periodType: 'trimester', orderIndex: 2, academicYearId: 2 },
      { id: 3, name: 'Trimestre 3', periodType: 'trimester', orderIndex: 3, academicYearId: 2 },
      { id: 4, name: 'Semestre 1', periodType: 'semester', orderIndex: 1, academicYearId: 2 },
      { id: 5, name: 'Semestre 2', periodType: 'semester', orderIndex: 2, academicYearId: 2 },
    ] as const;

    const bulletins = [
      { id: 101, termId: 1, studentId: 10, schoolYearId: 2, average: '12.5', rank: 5 },
      { id: 102, termId: 2, studentId: 10, schoolYearId: 2, average: '13.2', rank: 4 },
      { id: 104, termId: 5, studentId: 10, schoolYearId: 2, average: '14.4', rank: 2 },
      { id: 103, termId: 2, studentId: 10, schoolYearId: 2, average: '13.8', rank: 3 },
    ];

    expect(resolvePreviousPeriodSummaries({
      currentTermId: 2,
      studentId: 10,
      schoolYearId: 2,
      terms,
      bulletins,
    })).toEqual([
      { termId: 1, label: 'Trimestre 1', average: 12.5, rank: 5 },
    ]);

    expect(resolvePreviousPeriodSummaries({
      currentTermId: 3,
      studentId: 10,
      schoolYearId: 2,
      terms,
      bulletins,
    })).toEqual([
      { termId: 1, label: 'Trimestre 1', average: 12.5, rank: 5 },
      { termId: 2, label: 'Trimestre 2', average: 13.8, rank: 3 },
    ]);

    expect(resolvePreviousPeriodSummaries({
      currentTermId: 5,
      studentId: 10,
      schoolYearId: 2,
      terms,
      bulletins,
    })).toEqual([
      { termId: 4, label: 'Semestre 1', average: null, rank: null },
    ]);
  });

  it('retrouve le premier semestre quand les deux périodes ont le même orderIndex mais des dates successives', () => {
    const terms = [
      {
        id: 10,
        name: '1er SEMESTRE',
        periodType: null,
        orderIndex: 1,
        academicYearId: 2,
        startDate: '2026-05-13',
        endDate: '2026-07-23',
      },
      {
        id: 18,
        name: 'Semestre 22',
        periodType: 'semester',
        orderIndex: 1,
        academicYearId: 2,
        startDate: '2026-09-18',
        endDate: '2026-09-20',
      },
    ];
    const bulletins = [
      { id: 349, termId: 10, studentId: 26, schoolYearId: 2, average: '12.3194', rank: 1 },
    ];

    expect(resolvePreviousPeriodSummaries({
      currentTermId: 18,
      studentId: 26,
      schoolYearId: 2,
      terms,
      bulletins,
    })).toEqual([
      { termId: 10, label: '1er SEMESTRE', average: 12.3194, rank: 1 },
    ]);

    expect(resolvePreviousPeriodSummaries({
      currentTermId: 10,
      studentId: 26,
      schoolYearId: 2,
      terms,
      bulletins,
    })).toEqual([]);
  });
});

describe('décision de fin d année', () => {
  it.each([
    [{ isLastPeriod: true, annualAverage: 12, promotionThreshold: 10, studentGender: 'M', nextClassName: '1ère D' }, 'Admis en classe de 1ère D'],
    [{ isLastPeriod: true, annualAverage: 8, promotionThreshold: 10, studentGender: 'M', nextClassName: '1ère D' }, 'Redouble la classe'],
    [{ isLastPeriod: true, annualAverage: 9, promotionThreshold: 9, studentGender: 'M', nextClassName: '1ère D' }, 'Admis en classe de 1ère D'],
    [{ isLastPeriod: true, annualAverage: 12, promotionThreshold: 10, studentGender: 'F', nextClassName: '1ère D' }, 'Admise en classe de 1ère D'],
    [{ isLastPeriod: true, annualAverage: 12, promotionThreshold: 10, studentGender: 'female', nextClassName: '1ère D' }, 'Admise en classe de 1ère D'],
  ])('résout %j', (input, expected) => {
    expect(resolvePromotionDecision(input)).toBe(expected);
  });

  it.each([
    ['Admis en classe de 1ère', 'ADMIS EN CLASSE DE 1ère'],
    ['Admis en classe de 2nde', 'ADMIS EN CLASSE DE 2nde'],
    ['Admis en classe de 3ème', 'ADMIS EN CLASSE DE 3ème'],
    ['Admis en classe de Tle', 'ADMIS EN CLASSE DE Tle'],
  ])('formate la décision PDF sans casser l exposant français: %s -> %s', (input, expected) => {
    expect(formatPromotionDecisionForPdf(input)).toBe(expected);
  });

  it.each([
    ['Admis au CEPD', 'ADMIS AU CEPD'],
    ['Non admis au CEPD', 'NON ADMIS AU CEPD'],
    ['Admis au BEPC', 'ADMIS AU BEPC'],
    ['Non admis au BEPC', 'NON ADMIS AU BEPC'],
    ['Admis au BAC I', 'ADMIS AU BAC I'],
    ['Non admis au BAC I', 'NON ADMIS AU BAC I'],
    ['Admis au BAC II', 'ADMIS AU BAC II'],
    ['Non admis au BAC II', 'NON ADMIS AU BAC II'],
  ])('conserve les espaces des décisions d examen: %s -> %s', (input, expected) => {
    expect(formatPromotionDecisionForPdf(input)).toBe(expected);
  });

  it.each([
    { isLastPeriod: false, annualAverage: 12, promotionThreshold: 10, studentGender: 'M', nextClassName: '1ère D' },
    { isLastPeriod: true, annualAverage: null, promotionThreshold: 10, studentGender: 'M', nextClassName: '1ère D' },
    { isLastPeriod: true, annualAverage: 12, promotionThreshold: 10, studentGender: 'M', nextClassName: null },
    { isLastPeriod: true, annualAverage: 12, promotionThreshold: 10, studentGender: null, nextClassName: '1ère D' },
  ])('ne décide pas quand une condition obligatoire manque: %j', (input) => {
    expect(resolvePromotionDecision(input)).toBeNull();
  });

  it.each([
    { average: 14, expected: 'Admis en classe de 1ère D' },
    { average: 8, expected: 'Redouble la classe' },
  ])('applique la décision annuelle avec une seule moyenne disponible: $average', ({ average, expected }) => {
    const { annualAverage } = calculateAnnualBulletinResults({
      targetStudentId: 1,
      classStudentIds: [1],
      periods: [{ id: 1, name: '1er Semestre' }, { id: 2, name: '2ème Semestre' }],
      bulletins: [{ id: 2, studentId: 1, schoolYearId: 1, termId: 2, average }],
    });
    expect(resolvePromotionDecision({
      isLastPeriod: true,
      annualAverage,
      promotionThreshold: 10,
      studentGender: 'M',
      nextClassName: '1ère D',
    })).toBe(expected);
  });

  it('normalise les valeurs de sexe existantes sans inventer un genre', () => {
    expect(normalizeStudentGender('M')).toBe('male');
    expect(normalizeStudentGender('Masculin')).toBe('male');
    expect(normalizeStudentGender('male')).toBe('male');
    expect(normalizeStudentGender('F')).toBe('female');
    expect(normalizeStudentGender('Féminin')).toBe('female');
    expect(normalizeStudentGender('unknown')).toBeNull();
  });

  it('place la décision sous le libellé existant sans supprimer les blocs validés', async () => {
    const text = extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Trimestre 3',
      promotionDecision: 'Admis en classe de 1ère D',
    }));
    expect(text.indexOf('conseil de la classe')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('conseil de la classe')).toBeLessThan(text.indexOf('ADMIS'));
  });

  it('affiche la mention d’examen sur la même ligne que la moyenne annuelle pour un élève admis', async () => {
    const pdf = await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Trimestre 3',
      promotionDecision: 'Admis au BEPC',
      examMention: 'Très bien',
      annualAverage: 12.5,
      annualRank: 4,
    });
    const text = normalizePdfTextForAssertion(extractPdfText(pdf));

    expect(text).toContain('ADMIS');
    expect(text).toContain('Mention : Tres bien');
    expect(extractPdfTextBaseline(pdf, /Moy\. Ann = 12,50/)).toBe(extractPdfTextBaseline(pdf, /Mention : Tres bien/));
  });

  it('n’affiche pas de mention vide pour un élève admis sans mention enregistrée', async () => {
    const text = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Trimestre 3',
      promotionDecision: 'Admis au BEPC',
      examMention: null,
      annualAverage: 12.5,
    })));

    expect(text).toContain('Moy. Ann = 12,50');
    expect(text).not.toContain('Mention :');
  });

  it('n’affiche pas de mention d’examen pour un élève non admis', async () => {
    const text = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Trimestre 3',
      promotionDecision: 'Non admis au BEPC',
      examMention: 'Bien',
      annualAverage: 8,
    })));

    expect(text).toContain('NON');
    expect(text).toContain('Moy. Ann = 8,00');
    expect(text).not.toContain('Mention : Bien');
  });

  it('prépare le libellé d examen avant son rendu PDF', () => {
    expect(formatPromotionDecisionForPdf('Admis au BEPC')).toBe('ADMIS AU BEPC');
    expect(formatPromotionDecisionForPdf('Non admis au BAC II')).toBe('NON ADMIS AU BAC II');
  });
});

describe('rendu normal des libellés d en-tête du bulletin PDF', () => {
  it.each([
    { value: 10.5, expected: '10,5' },
    { value: 14.25, expected: '14,25' },
    { value: 15, expected: '15' },
  ])('affiche les notes PDF avec une virgule décimale sans modifier les entiers: $value -> $expected', ({ value, expected }) => {
    expect(formatPdfDisplayNumber(value)).toBe(expected);
  });

  it('traite les deux anciens champs comme un paragraphe de deux lignes normales', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const layout = computeHeaderParagraphLayout(
      "ENSEIGNEMENT SECONDAIRE MINISTERE DE L'EDUCATION",
      172,
      font,
      9,
    );
    const words = layout.flatMap((line) => line.words);

    expect(words).toEqual(['ENSEIGNEMENT', 'SECONDAIRE', 'MINISTERE', 'DE', "L'EDUCATION"]);
    expect(layout).toHaveLength(2);
    expect(layout[0].words).toEqual(['ENSEIGNEMENT', 'SECONDAIRE']);
    expect(layout[1].words).toEqual(['MINISTERE', 'DE', "L'EDUCATION"]);
    expect(layout[0].text).toBe('ENSEIGNEMENT SECONDAIRE');
    expect(layout[1].text).toBe("MINISTERE DE L'EDUCATION");
    expect(layout.every((line) => line.justify === false)).toBe(true);
    expect(layout.every((line) => line.wordSpacing === font.widthOfTextAtSize(' ', 9))).toBe(true);
    expect(layout[0].width).toBeLessThanOrEqual(172);
    expect(layout[1].width).toBeLessThanOrEqual(172);
  });

  it('réduit la taille commune sans créer de troisième ligne', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const value = "ENSEIGNEMENT SECONDAIRE MINISTERE DE L'EDUCATION";
    const size = fitHeaderParagraphFontSize(value, 80, font, 7.5, 5.5);
    const layout = computeHeaderParagraphLayout(value, 80, font, size);

    expect(size).toBeLessThanOrEqual(7.5);
    expect(layout).toHaveLength(2);
    expect(layout.flatMap((line) => line.words)).toEqual([
      'ENSEIGNEMENT', 'SECONDAIRE', 'MINISTERE', 'DE', "L'EDUCATION",
    ]);
    expect(layout[0].text).toContain('ENSEIGNEMENT');
    expect(layout[1].text).toContain("L'EDUCATION");
  });

  it('répartit un texte dynamique en exactement deux lignes sans perdre ni dupliquer de mot', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const value = 'MINISTERE DE L EDUCATION NATIONALE DIRECTION REGIONALE DE L EDUCATION GRAND LOME';
    const size = fitHeaderParagraphFontSize(value, 170, font, 7.5, 5.5);
    const layout = computeHeaderParagraphLayout(value, 170, font, size);
    const inputWords = value.split(' ');
    const outputWords = layout.flatMap((line) => line.words);

    expect(size).toBeLessThanOrEqual(7.5);
    expect(layout).toHaveLength(2);
    expect(outputWords).toEqual(inputWords);
    expect(outputWords).toHaveLength(inputWords.length);
    expect(layout.every((line) => line.width <= 170)).toBe(true);
  });

  it('respecte le premier marqueur de coupure et retire le marqueur du rendu', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const value = "MINISTERE DE L'EDUCATION NATIONALE | DIRECTION REGIONALE DE L'EDUCATION GRAND LOME | EXTRA";
    const size = fitHeaderParagraphFontSize(value, 170, font, 7.5, 5.5);
    const layout = computeHeaderParagraphLayout(value, 170, font, size);

    expect(layout).toHaveLength(2);
    expect(layout[0].text).toBe("MINISTERE DE L'EDUCATION NATIONALE");
    expect(layout[1].text).toContain("DIRECTION REGIONALE DE L'EDUCATION GRAND LOME");
    expect(layout[1].text).not.toContain('|');
    expect(layout.flatMap((line) => line.words)).not.toContain('|');
    expect(layout.every((line) => line.width <= 170)).toBe(true);
  });

  it('limite les matières longues à deux lignes et les garde dans la largeur de la cellule', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const value = 'Sciences de la vie et de la Terre et de l environnement';
    const layout = computeWrappedTextLines(value, 70, font, 7.5, 2);

    expect(layout.lines).toHaveLength(2);
    expect(layout.lines.every((line) => font.widthOfTextAtSize(line, 7.5) <= 70)).toBe(true);
    expect(layout.lines.some((line) => line.length > 0)).toBe(true);
    expect(layout.lines.join(' ')).toContain('Sciences');
  });

  it('choisit le nom ou le code matière selon la largeur disponible', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const shortName = 'Mathématiques';
    const shortWidth = font.widthOfTextAtSize(shortName, 7.5);
    expect(getSubjectDisplayName(shortName, 'MATH', shortWidth, font, 7.5)).toBe(shortName);
    expect(getSubjectDisplayName(shortName, 'MATH', shortWidth - 0.1, font, 7.5)).toBe('MATH');
    expect(getSubjectDisplayName('Sciences de la Vie et de la Terre', 'SVT', 70, font, 7.5)).toBe('SVT');
    expect(getSubjectDisplayName('Education Physique et Sportive', 'EPS', 70, font, 7.5)).toBe('EPS');
    expect(getSubjectDisplayName('Histoire-Geographie', 'HG', 50, font, 7.5)).toBe('HG');
    expect(getSubjectDisplayName('Sciences de la Vie et de la Terre', null, 70, font, 7.5)).toBe('Sciences de la Vie et de la Terre');
  });

  it('conserve le texte complet d une matière longue quand il tient sur deux lignes avec une taille réduite', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont('Helvetica');
    const subjectName = 'Sciences de la Vie et de la Terre et de l environnement moderne';
    const layout = computeWrappedTextLines(subjectName, 70, font, 7.5, 2);

    expect(layout.lines).toHaveLength(2);
    expect(layout.lines.join(' ')).toContain('Sciences');
    expect(layout.lines.join(' ')).toContain('de la');
    expect(layout.lines.every((line) => line.length > 0)).toBe(true);
    expect(layout.lines.every((line) => font.widthOfTextAtSize(line, 7.5) <= 70)).toBe(true);
  });

  it('transmet bien le nom actuel de l enseignant au PDF quand la ligne correspond a teacher_id 23 / user_id 54', async () => {
    const currentName = 'MASSEDA Ghislain Ikechuku Junior';
    const staleName = 'Ancien nom enseignant';
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [{
        id: 1,
        bulletinId: 1,
        subjectId: 42,
        subjectName: 'Mathématiques',
        subjectTypeId: 1,
        subjectTypeName: 'Scientifique',
        sortOrder: 1,
        coefficient: 1,
        average: 15,
        teacherName: currentName,
        teacherComment: 'Très bon niveau',
        rank: 1,
        interrogation: 15,
        devoir: 16,
        composition: 14,
        classAverage: 12,
      }],
    };

    expect(data.lines[0].teacherName).toBe(currentName);

    const bytes = await createBulletinPdfDocument(data);
    const text = normalizePdfTextForAssertion(extractPdfText(bytes));
    expect(text).toContain('MASSEDA');
    expect(text).not.toContain(staleName);
    expect(text).not.toContain('Ancien nom');
  });
});

describe('résolution du titulaire de classe pour le PDF', () => {
  const schoolAssignments = [
    { schoolId: 10, classId: 4, name: 'Titulaire Ecole A', lastName: null, firstNames: null },
    { schoolId: 20, classId: 4, name: 'Titulaire Ecole B', lastName: null, firstNames: null },
  ];

  const renderPdfWithTeacher = async (teacher: ReturnType<typeof resolveBulletinClassTeacher>) => {
    const bytes = await createBulletinPdfDocument({ ...snapshotData, ...{
      classTeacherName: teacher.name,
      classTeacherLastName: teacher.lastName,
      classTeacherFirstNames: teacher.firstNames,
    } });
    return normalizePdfTextForAssertion(extractPdfText(bytes));
  };

  it('uses the class and bulletin school assignment for global classes', async () => {
    const teacherA = resolveBulletinClassTeacher(null, 4, 10, {
      name: null,
      lastName: null,
      firstNames: null,
    }, schoolAssignments);
    const teacherB = resolveBulletinClassTeacher(null, 4, 20, {
      name: null,
      lastName: null,
      firstNames: null,
    }, schoolAssignments);

    expect((await renderPdfWithTeacher(teacherA))).toContain('Titulaire Ecole A');
    expect((await renderPdfWithTeacher(teacherB))).toContain('Titulaire Ecole B');
  });

  it('uses the existing school-owned class teacher and falls back to Aucun without a global assignment', async () => {
    const legacyTeacher = { name: 'Titulaire historique', lastName: null, firstNames: null };
    const schoolClassTeacher = resolveBulletinClassTeacher(10, 4, 10, legacyTeacher, []);
    const missingGlobalTeacher = resolveBulletinClassTeacher(null, 4, 30, legacyTeacher, schoolAssignments);

    expect((await renderPdfWithTeacher(schoolClassTeacher))).toContain('Titulaire historique');
    expect((await renderPdfWithTeacher(missingGlobalTeacher))).toContain('Aucun');
  });
});

describe('ajustement de l email dans la zone fixe de l en-tête', () => {
    const createEmailLayout = async (email: string, centerX?: number) => {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
      const bounds = resolveSchoolHeaderEmailBounds(16);
      const layout = fitHeaderEmailToBounds(email, font, bounds, centerX ?? (bounds.left + bounds.right) / 2);
      return { bounds, layout };
    };

    it.each([
      { label: 'court', email: 'info@ecole.test' },
      { label: 'long', email: 'contact.direction.generale@ecole-secondaire-regionale.test' },
      { label: 'très long', email: 'contact.direction.generale.administration.scolarite@ecole-secondaire-regionale-avec-nom-tres-long.test' },
    ])('conserve l adresse complète sur une seule ligne pour un email $label', async ({ email }) => {
      const { bounds, layout } = await createEmailLayout(email);

      expect(layout.text).toBe(email);
      expect(layout.text).not.toMatch(/[\r\n]/);
      expect(layout.x).toBeGreaterThanOrEqual(bounds.left);
      expect(layout.x + layout.textWidth).toBeLessThanOrEqual(bounds.right);
      expect(layout.availableWidth).toBe(bounds.width);
      expect(layout.fontSize).toBeLessThanOrEqual(7);
      if (email === 'info@ecole.test') expect(layout.fontSize).toBe(7);
      else expect(layout.fontSize).toBeLessThan(7);
    });

    it('garde la largeur du grand bloc constante quelle que soit la longueur de l email', async () => {
      const short = await createEmailLayout('info@ecole.test');
      const long = await createEmailLayout('contact.direction.generale.administration@ecole-secondaire-regionale.test');

      expect(short.bounds).toEqual({ left: 29, right: 194, width: 165 });
      expect(long.bounds).toEqual(short.bounds);
    });

    it('positionne l email près des bords gauche et droit sans les dépasser', async () => {
      const bounds = resolveSchoolHeaderEmailBounds(16);
      const left = await createEmailLayout('info@ecole.test', bounds.left);
      const right = await createEmailLayout('info@ecole.test', bounds.right);

      expect(left.layout.x).toBe(bounds.left);
      expect(right.layout.x + right.layout.textWidth).toBeCloseTo(bounds.right, 6);
    });

    it('utilise uniquement l espace avant la zone du logo pour éviter un chevauchement à droite', async () => {
      const { bounds, layout } = await createEmailLayout('contact.direction.generale@ecole-secondaire-regionale.test', 400);
      const logoZoneLeft = 16 + 178 + 8;

      expect(layout.x + layout.textWidth).toBeLessThanOrEqual(logoZoneLeft - 8);
      expect(layout.x + layout.textWidth).toBeLessThanOrEqual(bounds.right);
    });

    it('rend un email très long complet dans le PDF sans le passer sur plusieurs lignes', async () => {
      const email = 'contact.direction.generale.administration.scolarite@ecole-secondaire-regionale-avec-nom-tres-long.test';
      const bytes = await createBulletinPdfDocument({
        ...snapshotData,
        school: { ...snapshotData.school, email },
      });
      const pdfText = extractPdfText(bytes);

      expect(pdfText).toContain(email);
    });
});

describe('largeur fixe du rectangle du proviseur', () => {
  const createPrincipalLayout = async (name: string, structuredName?: { lastName?: string | null; firstNames?: string | null }) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595.28;
    const margin = 16;
    const principalNameX = pageWidth - margin - 80;
    const boxWidth = resolvePrincipalBoxWidth(pageWidth, margin, principalNameX);
    const horizontalPadding = 16;
    const textLayout = fitPrincipalNameToWidth(name, font, boxWidth - horizontalPadding * 2, 10, 8, structuredName);
    return { boxWidth, textMaxWidth: boxWidth - horizontalPadding * 2, textLayout };
  };

  it('keeps the family name intact and preserves the first given name when structured data is provided', async () => {
    const layout = await createPrincipalLayout('AYISSOU Koffi', { lastName: 'AYISSOU', firstNames: 'Koffi' });

    expect(layout.textLayout.text).toBe('AYISSOU Koffi');
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
    expect(layout.textLayout.text.startsWith('AYISSOU')).toBe(true);
  });

  it('keeps the full family name and additional given names when they fit within the fixed width', async () => {
    const layout = await createPrincipalLayout('AYISSOU Koffi Albert', { lastName: 'AYISSOU', firstNames: 'Koffi Albert' });

    expect(layout.textLayout.text).toBe('AYISSOU Koffi Albert');
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
    expect(layout.textLayout.text.startsWith('AYISSOU')).toBe(true);
  });

  it('abbreviates only the extra given names while keeping the family name complete', async () => {
    const layout = await createPrincipalLayout('AYISSOU Koffi Albert Emmanuel François', { lastName: 'AYISSOU', firstNames: 'Koffi Albert Emmanuel François' });

    expect(layout.textLayout.text).toMatch(/^AYISSOU Koffi A\. E\. F\.$|^AYISSOU Koffi A\. E\. F\. /);
    expect(layout.textLayout.text.startsWith('AYISSOU')).toBe(true);
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('never abbreviates a long family name even when additional given names are shortened', async () => {
    const layout = await createPrincipalLayout('NOMDEFAMILLELONG Koffi Albert Emmanuel', { lastName: 'NOMDEFAMILLELONG', firstNames: 'Koffi Albert Emmanuel' });

    expect(layout.textLayout.text.startsWith('NOMDEFAMILLELONG')).toBe(true);
    expect(layout.textLayout.text.includes('NOMDEFAMILLELONG')).toBe(true);
    expect(layout.textLayout.text).toContain('Koffi');
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('keeps a short name unchanged at the original size', async () => {
    const layout = await createPrincipalLayout('Koffi Amouzou');

    expect(layout.boxWidth).toBe(160);
    expect(layout.textLayout.text).toBe('Koffi Amouzou');
    expect(layout.textLayout.fontSize).toBe(10);
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('reduces font size before abbreviating a long name', async () => {
    const layout = await createPrincipalLayout('Koffi Albert Emmanuel NOM');

    expect(layout.boxWidth).toBe(160);
    expect(layout.textLayout.text).toBe('Koffi Albert Emmanuel NOM');
    expect(layout.textLayout.fontSize).toBeLessThan(10);
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('abbreviates only the additional given names while keeping the family name and first given name intact', async () => {
    const layout = await createPrincipalLayout('Koffi Albert Emmanuel Prosper Athanase NOM');

    expect(layout.boxWidth).toBe(160);
    expect(layout.textLayout.text).toBe('Koffi Albert E. P. A. N.');
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('preserves accents and hyphens when the full name fits', async () => {
    const layout = await createPrincipalLayout('Koffi-Jean Amouzou');

    expect(layout.boxWidth).toBe(160);
    expect(layout.textLayout.text).toBe('Koffi-Jean Amouzou');
    expect(layout.textLayout.textWidth).toBeLessThanOrEqual(layout.textMaxWidth);
  });

  it('keeps the same box width and bounds an extremely long indivisible name', async () => {
    const first = await createPrincipalLayout('NOMEXTREMEMENTLONG'.repeat(8));
    const second = await createPrincipalLayout('Koffi Albert Emmanuel Prosper Athanase NOM-COMPOSE-EXTREMEMENT-LONG'.repeat(3));

    expect(first.boxWidth).toBe(160);
    expect(second.boxWidth).toBe(first.boxWidth);
    expect(first.textLayout.text).toMatch(/\.\.\.$/);
    expect(first.textLayout.textWidth).toBeLessThanOrEqual(first.textMaxWidth);
    expect(second.textLayout.textWidth).toBeLessThanOrEqual(second.textMaxWidth);
  });
});

const withStoredLogo = async (extension: string, content: string, callback: (logoPath: string) => Promise<void>) => {
  const storageDir = path.resolve(process.cwd(), 'uploads', 'school-logos');
  await mkdir(storageDir, { recursive: true });
  const fileName = `bulletin-pdf-test-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const filePath = path.join(storageDir, fileName);
  await writeFile(filePath, Buffer.from(content, 'base64'));
  try {
    await callback(`school-logos/${fileName}`);
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
};

const testPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const testJpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8Bf//Z';

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
  it('calcule un rendu de logo centré et proportionnel dans une zone rectangulaire cible', () => {
    const square = computeSchoolLogoRenderMetrics(200, 200, 140, 100, 80, 90);
    const landscape = computeSchoolLogoRenderMetrics(300, 200, 140, 100, 80, 90);
    const portrait = computeSchoolLogoRenderMetrics(200, 300, 140, 100, 80, 90);

    expect(square.drawWidth).toBeCloseTo(90, 5);
    expect(square.drawHeight).toBeCloseTo(90, 5);
    expect(square.x).toBeCloseTo(55, 5);
    expect(square.y).toBeCloseTo(35, 5);

    expect(landscape.drawWidth).toBeLessThanOrEqual(140);
    expect(landscape.drawHeight).toBeLessThanOrEqual(90);
    expect(landscape.drawWidth / landscape.drawHeight).toBeCloseTo(300 / 200, 3);
    expect(landscape.x).toBeCloseTo(100 - landscape.drawWidth / 2, 5);
    expect(landscape.y).toBeCloseTo(80 - landscape.drawHeight / 2, 5);

    expect(portrait.drawWidth).toBeLessThanOrEqual(140);
    expect(portrait.drawHeight).toBeLessThanOrEqual(90);
    expect(portrait.drawWidth / portrait.drawHeight).toBeCloseTo(200 / 300, 3);
    expect(portrait.x).toBeCloseTo(100 - portrait.drawWidth / 2, 5);
    expect(portrait.y).toBeCloseTo(80 - portrait.drawHeight / 2, 5);
  });

  it('embarque le logo établissement PNG dans le PDF', async () => {
    await withStoredLogo('png', testPngBase64, async (logoPath) => {
      const pdfBytes = await createBulletinPdfDocument({
        ...snapshotData,
        school: { ...snapshotData.school, logoPath },
      });

      expect(countPdfImages(pdfBytes)).toBeGreaterThan(0);
    });
  });

  it('embarque un logo PNG lu depuis le stockage S3 configuré', async () => {
    const envKeys = ['FILE_STORAGE_PROVIDER', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    process.env.FILE_STORAGE_PROVIDER = 's3';
    process.env.S3_BUCKET = 'bulletin-logo-test';
    process.env.S3_REGION = 'eu-west-1';
    bulletinLogoS3.send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(testPngBase64, 'base64')) },
      ContentType: 'image/png',
    });

    try {
      const pdfBytes = await createBulletinPdfDocument({
        ...snapshotData,
        school: { ...snapshotData.school, logoPath: 'school-logos/remote-school-logo.png' },
      });

      expect(countPdfImages(pdfBytes)).toBeGreaterThan(0);
      expect(bulletinLogoS3.send.mock.calls[0][0].input).toEqual({
        Bucket: 'bulletin-logo-test',
        Key: 'school-logos/remote-school-logo.png',
      });
    } finally {
      bulletinLogoS3.send.mockReset();
      for (const key of envKeys) {
        const original = originalEnv[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });

  it('résout et embarque un logo stocké sous les formats réels de la base (school-logos/ et uploads/school-logos/)', async () => {
    const storageDir = path.resolve(process.cwd(), 'uploads', 'school-logos');
    await mkdir(storageDir, { recursive: true });
    const fileName = `real-format-logo-${Date.now()}.png`;
    const filePath = path.join(storageDir, fileName);
    await writeFile(filePath, Buffer.from(testPngBase64, 'base64'));

    try {
      for (const logoPath of [`school-logos/${fileName}`, `uploads/school-logos/${fileName}`, `/uploads/school-logos/${fileName}`]) {
        const pdfBytes = await createBulletinPdfDocument({
          ...snapshotData,
          school: { ...snapshotData.school, logoPath },
        });

        expect(countPdfImages(pdfBytes)).toBeGreaterThan(0);
      }
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  });

  it('embarque le logo établissement JPG et JPEG dans le PDF', async () => {
    for (const extension of ['jpg', 'jpeg']) {
      await withStoredLogo(extension, testJpegBase64, async (logoPath) => {
        const pdfBytes = await createBulletinPdfDocument({
          ...snapshotData,
          school: { ...snapshotData.school, logoPath },
        });

        expect(countPdfImages(pdfBytes)).toBeGreaterThan(0);
      });
    }
  });

  it('génère le PDF sans image lorsqu aucun logo établissement n est configuré', async () => {
    const pdfBytes = await createBulletinPdfDocument({
      ...snapshotData,
      school: { ...snapshotData.school, logoPath: null },
    });

    expect(new TextDecoder().decode(pdfBytes.slice(0, 4))).toBe('%PDF');
    expect(countPdfImages(pdfBytes)).toBe(0);
  });

  it('ignore un logo établissement introuvable sans bloquer la génération', async () => {
    const pdfBytes = await createBulletinPdfDocument({
      ...snapshotData,
      school: { ...snapshotData.school, logoPath: 'school-logos/logo-introuvable.png' },
    });

    expect(new TextDecoder().decode(pdfBytes.slice(0, 4))).toBe('%PDF');
    expect(countPdfImages(pdfBytes)).toBe(0);
  });

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

  it('affiche le libellé Note /20 dans l en-tête du tableau PDF', async () => {
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
    expect(BULLETIN_FINAL_AVERAGE_LABEL).toBe('Note /20');
    expect(text).toContain('Note');
    expect(text).toContain('/20');
    expect(text).toContain('Dev.');
  });

  it('rend la structure institutionnelle, élève, tableau et pied de page du bulletin', async () => {
    const pdfBytes = await createBulletinPdfDocument(snapshotData);
    const document = await PDFDocument.load(pdfBytes);
    const text = extractPdfText(pdfBytes);

    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(document.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
    expect(text).toContain('MINISTERE');
    expect(text).toContain('EDUCATION');
    expect(text).toContain('TOGO');
    expect(text).not.toContain('MINISTÈRE DE L EDUCATION NATIONALE');
    expect(text).toContain('Direction');
    expect(text).toContain('Maritime');
    expect(text).toContain('COLLEGE LE SAVOIR');
    expect(text).toContain('BP 12');
    expect(text).toContain('+228 90000000');
    expect(text).toContain('REPUBLIQUE TOGOLAISE');
    expect(text).toContain('Le travail et la reussite');
    expect(text).toContain('Année scolaire: 2025-2026');
    expect(text).toContain('BULLETIN DE NOTES DU Trimestre 1');
    expect(text).toContain('Classe:');
    expect(text).toContain('EFFECTIF : 42');
    expect(normalizePdfTextForAssertion(text)).toContain(normalizePdfTextForAssertion("NOM ET PRENOMS DE L'ELEVE :"));
    expect(text).toContain('Alice Dupont');
    expect(text).toContain('N° Mle : 00001N');
    expect(text).toContain('STATUT :');
    expect(text).toContain('SEXE :');
    expect(text).toContain('Matières');
    expect(text).toContain('Inter.');
    expect(text).toContain('Dev.');
    expect(text).toContain('Moy.');
    expect(text).toContain('Clas');
    expect(text).toContain('Compo.');
    expect(text).toContain('Note');
    expect(text).toContain('/20');
    expect(text).toContain('Coef.');
    expect(text).toContain('Note');
    expect(text).toContain('Rang');
    expect(text).toContain('Professeur');
    expect(text).toContain('Appréciation');
    expect(text).toContain('Signature');
    expect(text).toContain('1er Trimestre :');
    expect(text).toContain('Moyennes :');
    expect(text).toContain('conseil de la classe');
    expect(text).toContain('Retard : 0 min');
    expect(text).toContain('Absences : 0');
    expect(text).toContain('Plus forte moyenne');
    expect(text).toContain('Plus faible moyenne');
    expect(text).toContain('Moyenne de la classe');
    expect(text).toContain('CONSEIL DES PROFESSEURS');
    expect(text).toContain('Distinctions spéciales');
    expect(text).toContain('Sanctions');
    expect(text).toContain("APPRECIATION DU CHEF D'ETABLISSEMENT");
    expect(text).toContain('Signature du titulaire de la classe');
    expect(text).toContain('Le Directeur');
    expect(text).toContain('Page 1/1');
  });

  it('normalise uniquement la classe affichée sans changer les résultats du bulletin', async () => {
    const storedClassName = '4EME';
    const data = { ...snapshotData, className: storedClassName };
    const generatedPdf = await createBulletinPdfDocument(data);
    const expectedDisplayPdf = await createBulletinPdfDocument({ ...snapshotData, className: '4ème' });

    expect(Buffer.from(generatedPdf).equals(Buffer.from(expectedDisplayPdf))).toBe(true);
    expect(data.className).toBe(storedClassName);
    expect(data.average).toBe(snapshotData.average);
    expect(data.rank).toBe(snapshotData.rank);
    expect(data.lines).toEqual(snapshotData.lines);
  });

  it.each(['TLE', 'Tle'])('rend %s sous forme de Tle avec le suffixe en exposant', async (className) => {
    const data = { ...snapshotData, className };
    const pdfBytes = await createBulletinPdfDocument(data);
    const canonicalPdfBytes = await createBulletinPdfDocument({ ...snapshotData, className: 'Tle' });
    const baselinePdfBytes = await createBulletinPdfDocument({ ...snapshotData, className: 'T le' });

    const pdfText = normalizePdfTextForAssertion(extractPdfText(pdfBytes));
    const canonicalPdfText = normalizePdfTextForAssertion(extractPdfText(canonicalPdfBytes));
    const baselinePdfText = normalizePdfTextForAssertion(extractPdfText(baselinePdfBytes));

    expect(pdfText).toBe(canonicalPdfText);
    expect(pdfText).not.toBe(baselinePdfText);
    expect(data.className).toBe(className);
    expect(data.average).toBe(snapshotData.average);
    expect(data.rank).toBe(snapshotData.rank);
    expect(data.lines).toEqual(snapshotData.lines);
  });

  it('conserve les zones futures quand les données optionnelles sont absentes', async () => {
    const data: BulletinPdfData = {
      ...snapshotData,
      studentMatricule: null,
      studentGender: null,
      studentStatus: null,
      mention: null,
      appreciation: null,
      school: { name: 'ECOLE SANS METADONNEES' },
      subjectGroups: [
        { subjectTypeId: 1, subjectTypeName: 'Littéraire', sortOrder: 1, lines: [] },
        { subjectTypeId: 2, subjectTypeName: 'Scientifique', sortOrder: 2, lines: [] },
      ],
      lines: [],
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));

    expect(text).toContain('MATIERES LITTÉRAIRE');
    expect(text).toContain('TOTAL MATIERES LITTÉRAIRE');
    expect(text).toContain('MATIERES SCIENTIFIQUE');
    expect(text).toContain('TOTAL MATIERES SCIENTIFIQUE');
    expect(text).toContain('Moyenne de la classe');
    expect(text).toContain('conseil de la classe');
    expect(text).toContain('CONSEIL DES PROFESSEURS');
    expect(text).toContain('Distinctions spéciales');
    expect(text).toContain('Sanctions');
    expect(text).toContain("APPRECIATION DU CHEF D'ETABLISSEMENT");
    expect(text).not.toContain('Admis');
    expect(text).not.toContain('Distinction obtenue');
    expect(text).not.toContain('Aucune sanction');
  });

  it('affiche les groupes de matières dans l ordre littéraire puis scientifique', async () => {
    const literaryLine = { ...snapshotData.lines[0], subjectName: 'Français', subjectTypeName: 'Littéraire', average: 14 };
    const historyLine = { ...snapshotData.lines[0], id: 2, subjectName: 'Histoire', subjectTypeName: 'Littéraire', average: 12 };
    const mathLine = { ...snapshotData.lines[0], id: 3, subjectName: 'Mathématiques', subjectTypeName: 'Scientifique', average: 16 };
    const scienceLine = { ...snapshotData.lines[0], id: 4, subjectName: 'Sciences', subjectTypeName: 'Scientifique', average: 15 };
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [literaryLine, historyLine, mathLine, scienceLine],
      subjectGroups: [
        { subjectTypeId: 1, subjectTypeName: 'Littéraire', sortOrder: 1, lines: [literaryLine, historyLine] },
        { subjectTypeId: 2, subjectTypeName: 'Scientifique', sortOrder: 2, lines: [mathLine, scienceLine] },
      ],
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));

    const normalizedText = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
    expect(normalizedText).toContain('MATIERESLITTERAIRE');
    expect(normalizedText).toContain('MATIERESSCIENTIFIQUE');
    expect(normalizedText.indexOf('MATIERESLITTERAIRE')).toBeLessThan(normalizedText.indexOf('MATIERESSCIENTIFIQUE'));
    expect(text.indexOf('Fran')).toBeLessThan(text.indexOf('Math'));
    expect((text.match(/Français/g) ?? []).length).toBe(1);
    expect((text.match(/Math/g) ?? []).length).toBeGreaterThan(0);
    expect(text).toContain('14.00');
    expect(text).toContain('16.00');
  });

  it('affiche tous les groupes dynamiques dans leur ordre sortOrder', async () => {
    const literaryLine = { ...snapshotData.lines[0], subjectName: 'Français', subjectTypeId: 1, subjectTypeName: 'Littéraire', sortOrder: 2, average: 14 };
    const technicalLine = { ...snapshotData.lines[0], id: 2, subjectName: 'Informatique', subjectTypeId: 3, subjectTypeName: 'Informatique', sortOrder: 3, average: 13 };
    const scientificLine = { ...snapshotData.lines[0], id: 3, subjectName: 'Mathématiques', subjectTypeId: 2, subjectTypeName: 'Scientifique', sortOrder: 1, average: 16 };
    const untypedLine = { ...snapshotData.lines[0], id: 4, subjectName: 'Sport', subjectTypeId: null, subjectTypeName: null, sortOrder: null, average: 12 };
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [literaryLine, technicalLine, scientificLine, untypedLine],
      subjectGroups: [
        { subjectTypeId: 2, subjectTypeName: 'Scientifique', sortOrder: 1, lines: [scientificLine] },
        { subjectTypeId: 1, subjectTypeName: 'Littéraire', sortOrder: 2, lines: [literaryLine] },
        { subjectTypeId: 3, subjectTypeName: 'Informatique', sortOrder: 3, lines: [technicalLine] },
        { subjectTypeId: null, subjectTypeName: 'Matières sans type', sortOrder: 0, lines: [untypedLine] },
      ],
    };

    const normalizedText = extractPdfText(await createBulletinPdfDocument(data)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

    expect(normalizedText.indexOf('MATIERESSCIENTIFIQUE')).toBeLessThan(normalizedText.indexOf('MATIERESLITTERAIRE'));
    expect(normalizedText.indexOf('MATIERESLITTERAIRE')).toBeLessThan(normalizedText.indexOf('INFORMATIQUE'));
    expect(normalizedText).toContain('MATIERESSANSTYPE');
    expect(normalizedText).toContain('Informatique');
    expect(normalizedText).toContain('Sport');
  });

  it('affiche le total après toutes les matières et additionne coefficients et notes coefficientées', async () => {
    // Expected: Literary total = 70 (3*12 + 2*17 = 36 + 34 = 70)
    // Expected: Scientific total = 86 (4*13 + 2*17 = 52 + 34 = 86)
    // Expected: General total = 156 (70 + 86 = 156)
    const literaryLine = { ...snapshotData.lines[0], subjectName: 'Français', subjectTypeName: 'Littéraire', coefficient: 3, average: 12 };
    const historyLine = { ...snapshotData.lines[0], id: 2, subjectName: 'Histoire', subjectTypeName: 'Littéraire', coefficient: 2, average: 17 };
    const mathLine = { ...snapshotData.lines[0], id: 3, subjectName: 'Mathématiques', subjectTypeName: 'Scientifique', coefficient: 4, average: 13 };
    const scienceLine = { ...snapshotData.lines[0], id: 4, subjectName: 'Sciences', subjectTypeName: 'Scientifique', coefficient: 2, average: 17 };
    const data: BulletinPdfData = {
      ...snapshotData,
      lines: [literaryLine, historyLine, mathLine, scienceLine],
      subjectGroups: [
        { subjectTypeId: 1, subjectTypeName: 'Littéraire', sortOrder: 1, lines: [literaryLine, historyLine] },
        { subjectTypeId: 2, subjectTypeName: 'Scientifique', sortOrder: 2, lines: [mathLine, scienceLine] },
      ],
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));
    const normalizedText = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');

    const literarySubtotal = normalizedText.indexOf('TOTALMATIERESLITTERAIRE');
    const scientificGroup = normalizedText.indexOf('MATIERESSCIENTIFIQUE');
    const scientificSubtotal = normalizedText.indexOf('TOTALMATIERESSCIENTIFIQUE');
    const generalTotal = normalizedText.indexOf('TOTALGENERAL');
    expect(literarySubtotal).toBeGreaterThan(normalizedText.indexOf('Histoire'));
    expect(scientificGroup).toBeGreaterThan(literarySubtotal);
    expect(scientificSubtotal).toBeGreaterThan(normalizedText.indexOf('Sciences'));
    expect(generalTotal).toBeGreaterThan(scientificSubtotal);
    expect(normalizedText.match(/TOTALMATIERESLITTERAIRE/g)?.length).toBe(1);
    expect(normalizedText.match(/TOTALMATIERESSCIENTIFIQUE/g)?.length).toBe(1);
    expect(normalizedText.match(/TOTALGENERAL/g)?.length).toBe(1);
    expect(normalizedText).toContain('5.00');
    expect(normalizedText).toContain('70.00');
    expect(normalizedText).toContain('6.00');
    expect(normalizedText).toContain('86.00');
    expect(normalizedText).toContain('11.00');
    expect(normalizedText).toContain('156.00');
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

  it('génère un bulletin compact en une seule page même avec beaucoup de matières', async () => {
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

    expect(document.getPageCount()).toBe(1);
    expect(extractPdfText(pdfBytes)).toContain('Matiere 45');
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
    expect(textA).toContain('DIRECTION');
    expect(textA).toContain('GRAND');
    expect(textA).toContain('Excellence');
    expect(textA).toContain('BP : 1234 Tél : 90 00 00 01');
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
    expect(extractPdfText(pdfBytes)).not.toContain('MINISTÈRE DE L EDUCATION NATIONALE');
  });

  it('affiche les absences et retards dans le bloc compact du modèle', async () => {
    const data: BulletinPdfData = {
      ...snapshotData,
      absences: 5,
      retards: 2,
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));

    expect(text).toContain('Retard : 2 min');
    expect(text).toContain('Absences : 5');
  });

  it.each([
    [true, 'M', 'Le Proviseur'],
    [true, 'F', 'La Proviseure'],
    [false, 'M', 'Le Directeur'],
    [false, 'F', 'La Directrice'],
  ] as const)('affiche le titre %s/%s et conserve le nom %s', async (schoolHasLycee, principalGender, expectedTitle) => {
    const text = extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      principalName: 'Kossi AYISSOU',
      principalGender,
      schoolHasLycee,
    }));

    expect(text).toContain(expectedTitle);
    expect(text).toContain('Kossi AYISSOU');
  });

  it('garde le comportement lycée pour une école historique sans cycles déclarés', async () => {
    expect(resolveSchoolHasLycee([])).toBe(false);
    expect(resolvePrincipalTitle(undefined, 'M')).toBe('Le Directeur');
    const text = extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      principalName: 'Responsable historique',
      principalGender: 'M',
      schoolHasLycee: false,
    }));

    expect(text).toContain('Le Directeur');
    expect(text).toContain('Responsable historique');
    expect(text).not.toContain('undefined');
  });

  it('considère le lycée actif présent même lorsque le CEG est aussi configuré', () => {
    expect(resolveSchoolHasLycee([
      { code: 'college', isActive: true },
      { code: 'lycee', isActive: true },
    ])).toBe(true);
    expect(resolveSchoolHasLycee([{ code: 'college', isActive: true }])).toBe(false);
    expect(resolveSchoolHasLycee([
      { code: 'college', isActive: true },
      { code: 'lycee', isActive: false },
    ])).toBe(false);
    expect(resolveSchoolHasLycee([{ code: 'lycee', isActive: true }])).toBe(true);
  });

  it('uses the student school cycles rather than the bulletin class cycle', async () => {
    const source = await readFile(path.resolve('src/lib/bulletinPdfApi.ts'), 'utf8');
    expect(source).toContain('studentSchoolId: students.schoolId');
    expect(source).toContain('.where(eq(schoolCycles.schoolId, header.studentSchoolId))');
    expect(source).toContain('schoolHasLycee: header.schoolHasLycee');

    const schoolHasLycee = resolveSchoolHasLycee([
      { code: 'college', isActive: true },
      { code: 'lycee', isActive: true },
    ]);
    const text = extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      className: '3ème A',
      principalName: 'Kossi AYISSOU',
      principalGender: 'M',
      schoolHasLycee,
    }));
    expect(text).toContain('Le Proviseur');
    expect(text).toContain('Kossi AYISSOU');
  });

  it('uses a neutral title when the responsible person gender is unknown', async () => {
    const text = extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      principalName: 'Responsable historique',
      principalGender: null,
      schoolHasLycee: false,
    }));

    expect(normalizePdfTextForAssertion(text)).toContain('Responsable');
    expect(text).toContain('Responsable historique');
    expect(text).not.toContain('undefined');
  });

  it('calcule les trois moyennes en excluant les valeurs nulles', () => {
    expect(calculateClassAverageSummary([16.42, 7.35, 11.28, null])).toEqual({
      highest: 16.42,
      lowest: 7.35,
      average: (16.42 + 7.35 + 11.28) / 3,
    });
    expect(calculateClassAverageSummary([])).toEqual({ highest: null, lowest: null, average: null });
  });

  it('filtre les moyennes de classe par classe, année scolaire et période du bulletin', async () => {
    const source = await readFile(path.resolve('src/lib/bulletinPdfApi.ts'), 'utf8');
    expect(source).toContain('eq(bulletins.classId, header.classId)');
    expect(source).toContain('eq(bulletins.schoolYearId, header.schoolYearId)');
    expect(source).toContain('eq(bulletins.termId, header.termId)');
    expect(source).toContain('sql`${bulletins.average} is not null`');
    expect(source).toContain('classAverage: bulletins.classAverage');
  });

  it('rend les tableaux de moyennes entre retard/absences et la signature', async () => {
    const text = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      classHighestAverage: 16.42,
      classLowestAverage: 7.35,
      classAverage: 11.28,
      retards: 15,
      absences: 7,
    }))).replace(/\s+/g, ' ');

    expect(text).toContain('Retard : 15 min');
    expect(text).toContain('Absences : 7');
    expect(text).toContain('Plus forte moyenne');
    expect(text).toContain('16,42');
    expect(text).toContain('Plus faible moyenne');
    expect(text).toContain('7,35');
    expect(text).toContain('Moyenne de la classe');
    expect(text).toContain('11,28');

    const source = await import('node:fs/promises').then(({ readFile }) => readFile(path.resolve('src/lib/bulletinPdfApi.ts'), 'utf8'));
    expect(source.indexOf('drawText(page, `Retard : ${data.retards} min`')).toBeLessThan(source.indexOf("'Plus forte moyenne'"));
    expect(source.indexOf("'Plus forte moyenne'")).toBeLessThan(source.indexOf("'Plus faible moyenne'"));
    expect(source.indexOf("'Plus faible moyenne'")).toBeLessThan(source.indexOf("'Moyenne de la classe'"));
    expect(source.indexOf("'Moyenne de la classe'")).toBeLessThan(source.indexOf("const signatureLabelY = classAverageBottom"));
  });

  it('ajoute le recapitulatif de moyenne generale et rang sous le tableau pour les semestres et trimestres', async () => {
    const semesterText = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Semestre 1',
      average: 14.25,
      rank: 3,
    }))).replace(/\s+/g, ' ');

    const trimesterText = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Trimestre 2',
      average: 13.8,
      rank: 5,
    }))).replace(/\s+/g, ' ');

    expect(semesterText).toContain(normalizePdfTextForAssertion('1er Semestre : 14,25'));
    expect(semesterText).toContain(normalizePdfTextForAssertion('Rang : 3ème'));
    expect(trimesterText).toContain(normalizePdfTextForAssertion('2ème Trimestre : 13,80'));
    expect(trimesterText).toContain(normalizePdfTextForAssertion('Rang : 5ème'));
  });

  it('affiche la moyenne et le rang annuels uniquement sur la dernière période', async () => {
    const firstSemesterText = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Semestre 1',
      average: 12,
      rank: 2,
      annualAverage: null,
      annualRank: null,
    }))).replace(/\s+/g, ' ');
    const secondSemesterText = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Semestre 2',
      average: 8,
      rank: 3,
      annualAverage: 10,
      annualRank: 6,
    }))).replace(/\s+/g, ' ');

    expect(firstSemesterText).not.toContain(normalizePdfTextForAssertion('Moy. Ann = 10'));
    expect(secondSemesterText).toContain(normalizePdfTextForAssertion('Moy. Ann = 10'));
    expect(secondSemesterText).toContain(normalizePdfTextForAssertion('Rang : 6ème'));
  });

  it('affiche le semestre précédent au-dessus du semestre actuel pour le 2ème semestre et n affiche pas de ligne précédente au 1er semestre', async () => {
    const firstSemesterPdf = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Semestre 1',
      average: 12.32,
      rank: 1,
      previousPeriodSummaries: [{ termId: 11, label: 'Semestre 0', average: 11.5, rank: 2 }],
    }))).replace(/\s+/g, ' ');

    const secondSemesterPdf = normalizePdfTextForAssertion(extractPdfText(await createBulletinPdfDocument({
      ...snapshotData,
      termName: 'Semestre 2',
      average: 14.25,
      rank: 2,
      previousPeriodSummaries: [{ termId: 10, label: 'Semestre 1', average: 12.32, rank: 1 }],
    }))).replace(/\s+/g, ' ');

    expect((firstSemesterPdf.match(/1er Semestre : 12,32/g) ?? []).length).toBe(1);
    expect((firstSemesterPdf.match(/Rang : 1er/g) ?? []).length).toBe(1);
    expect(secondSemesterPdf).toContain(normalizePdfTextForAssertion('1er Semestre : 12,32'));
    expect(secondSemesterPdf).toContain(normalizePdfTextForAssertion('2ème Semestre : 14,25'));
    expect(secondSemesterPdf).toContain(normalizePdfTextForAssertion('Rang : 1er'));
    expect(secondSemesterPdf).toContain(normalizePdfTextForAssertion('Rang : 2ème'));
  });

  it('affiche zéro absence quand l\'élève n\'en a aucune', async () => {
    const data: BulletinPdfData = {
      ...snapshotData,
      absences: 0,
      retards: 0,
    };

    const text = extractPdfText(await createBulletinPdfDocument(data));

    expect(text).toContain('Retard : 0 min');
    expect(text).toContain('Absences : 0');
  });

  it('compte les absences réelles d un élève dans le bulletin PDF et exclut les autres périodes', async () => {
    const studentA = { ...snapshotData, studentId: 10, studentName: 'Élève A', absences: 5, retards: 0 };
    const studentB = { ...snapshotData, studentId: 11, studentName: 'Élève B', absences: 2, retards: 0 };
    const studentC = { ...snapshotData, studentId: 12, studentName: 'Élève C', absences: 0, retards: 0 };

    const pdfA = extractPdfText(await createBulletinPdfDocument(studentA));
    const pdfB = extractPdfText(await createBulletinPdfDocument(studentB));
    const pdfC = extractPdfText(await createBulletinPdfDocument(studentC));

    expect(pdfA).toContain('Absences : 5');
    expect(pdfB).toContain('Absences : 2');
    expect(pdfC).toContain('Absences : 0');
    expect(pdfA).not.toContain('Absences : 2');
    expect(pdfB).not.toContain('Absences : 5');
    expect(pdfC).not.toContain('Absences : 1');
  });

  it('affiche des nombres différents pour chaque élève', async () => {
    const student1 = await createBulletinPdfDocument({
      ...snapshotData,
      studentId: 10,
      absences: 3,
      retards: 1,
    });

    const student2 = await createBulletinPdfDocument({
      ...snapshotData,
      studentId: 11,
      absences: 7,
      retards: 2,
    });

    const text1 = extractPdfText(student1);
    const text2 = extractPdfText(student2);

    expect(text1).toContain('Absences : 3');
    expect(text1).toContain('Retard : 1 min');
    expect(text2).toContain('Absences : 7');
    expect(text2).toContain('Retard : 2 min');
  });
});
