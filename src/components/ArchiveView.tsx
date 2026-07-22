import React, { useState } from 'react';
import { Evaluation, Grade, Student, Class, UserRole } from '../types.ts';
import { sortClasses } from '../lib/classOrdering';
import { isClassVisibleToSchool } from '../lib/classVisibility.ts';
import { BookOpen } from 'lucide-react';
import { getEligibleStudentsForEvaluation, getEligibleStudentsForEvaluationWithGrades, getDateOnlyMs, isEvaluationArchived as isEvaluationArchivedUtil, parseDateValue } from '../lib/evaluationUtils';
import { getGradeBadgeClass, getGradeBand } from '../lib/gradeColor';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface ArchiveViewProps {
  userRole: UserRole;
  evaluationsList: Evaluation[];
  gradesList: Grade[];
  studentsList: Student[];
  classesList: Class[];
  schoolsList: { id: number; name: string }[];
  schoolFilterId?: number | null;
  onSchoolFilterChange?: (schoolId: number | null) => void;
  teacherClassIds?: number[];
  teacherId?: number;
}

export default function ArchiveView({
  userRole,
  evaluationsList,
  gradesList,
  studentsList,
  classesList,
  schoolsList,
  schoolFilterId,
  onSchoolFilterChange,
  teacherClassIds = [],
  teacherId,
}: ArchiveViewProps) {
  const sortedClasses = sortClasses(classesList || []);
  const availableClasses = userRole === 'teacher'
    ? sortedClasses.filter((c) => teacherClassIds.includes(c.id))
    : sortedClasses;
  const filteredClasses = schoolFilterId
    ? availableClasses.filter((c) => isClassVisibleToSchool(c, schoolFilterId))
    : availableClasses;
  const [selectedClassId, setSelectedClassId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const normalizeDateOnly = (value: string | Date | undefined | null): string | null => {
    const date = parseDateValue(value);
    if (!date) return null;
    return date.toISOString().split('T')[0];
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const getExportRows = (ev: Evaluation) => {
    const evaluationClass = classesList.find((cls) => cls.id === ev.classId);
    const school = evaluationClass ? schoolsList.find((school) => school.id === evaluationClass.schoolId) : undefined;
    const gradesForEval = gradesList
      .filter((grade) => grade.evaluationId === ev.id)
      .map((grade, index) => {
        const student = studentsList.find((st) => st.id === grade.studentId);
        const studentName = grade.studentName || `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim();
        return {
          index: index + 1,
          studentName: studentName || 'Élève',
          score: grade.score ?? '',
          remarks: grade.remarks ?? '',
        };
      });

    return {
      meta: [
        ['École', school?.name ?? ''],
        ['Classe', evaluationClass?.name ?? ''],
        ['Matière', ev.subject],
        ['Enseignant', ev.teacherName ?? ''],
        ['Intitulé du devoir', ev.title],
        ['Date', normalizeDateOnly(ev.date || ev.createdAt) ?? ''],
      ],
      grades: gradesForEval,
    };
  };

  const exportEvaluationExcel = async (ev: Evaluation) => {
    const { meta, grades } = getExportRows(ev);
    const rows: Array<Array<string | number>> = [
      ['Relevé des notes'],
      [],
      ...meta,
      [],
      ['N°', 'Élève', 'Note', 'Remarques'],
      ...grades.map((grade) => [grade.index, grade.studentName, grade.score, grade.remarks]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Relevé des notes');

    worksheet['!cols'] = [
      { wch: 5 },
      { wch: 30 },
      { wch: 15 },
      { wch: 40 },
    ];
    worksheet['!freeze'] = { xSplit: 0, ySplit: 7 };

    const headerRow = 6;
    const titleCell = worksheet['A1'];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, sz: 16 },
        alignment: { horizontal: 'left', vertical: 'center' },
      };
    }

    for (let col = 0; col < 4; col += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
      const cell = worksheet[cellRef];
      if (cell) {
        cell.s = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'FFDCE6F1' } },
          border: {
            top: { style: 'thin', color: { rgb: 'FFBFBFBF' } },
            bottom: { style: 'thin', color: { rgb: 'FFBFBFBF' } },
            left: { style: 'thin', color: { rgb: 'FFBFBFBF' } },
            right: { style: 'thin', color: { rgb: 'FFBFBFBF' } },
          },
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      }
    }

    grades.forEach((_, rowIndex) => {
      const rowNumber = headerRow + 1 + rowIndex;
      for (let col = 0; col < 4; col += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: rowNumber, c: col });
        const cell = worksheet[cellRef];
        if (cell) {
          cell.s = {
            alignment: { horizontal: col === 0 ? 'center' : 'left', vertical: 'center' },
          };
        }
      }
    });

    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `archive-evaluation-${ev.id}.xlsx`);
  };

  const exportEvaluationPdf = async (ev: Evaluation) => {
    const { meta, grades } = getExportRows(ev);
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 40;
    const lineHeight = 18;
    const tableTopGap = 24;
    const cellPadding = 6;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const colWidths = [40, 220, 100, tableWidth - 40 - 220 - 100];

    const createPage = () => pdfDoc.addPage([pageWidth, pageHeight]);
    let page = createPage();
    let cursorY = pageHeight - margin;

    const drawText = (text: string, x: number, y: number, options: any = {}) => {
      page.drawText(text, { x, y, font: options.bold ? helveticaBold : helvetica, size: options.size ?? 11, color: rgb(0, 0, 0) });
    };

    const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    };

    const addPageIfNeeded = (neededHeight: number) => {
      if (cursorY - neededHeight < margin) {
        page = createPage();
        cursorY = pageHeight - margin;
      }
    };

    drawText('Relevé des notes', tableX, cursorY, { bold: true, size: 18 });
    cursorY -= 28;

    meta.forEach(([label, value]) => {
      addPageIfNeeded(lineHeight);
      drawText(`${label}:`, tableX, cursorY, { bold: true, size: 11 });
      drawText(String(value), tableX + 110, cursorY, { size: 11 });
      cursorY -= lineHeight;
    });

    cursorY -= 8;
    addPageIfNeeded(lineHeight + tableTopGap + (grades.length + 1) * (lineHeight + 8));

    const headerY = cursorY;
    const headerHeight = lineHeight + 10;
    const headerTextY = headerY - 16;
    let currentX = tableX;
    const headers = ['N°', 'Élève', 'Note', 'Remarques'];

    headers.forEach((header, index) => {
      page.drawRectangle({
        x: currentX,
        y: headerY - headerHeight - 4,
        width: colWidths[index],
        height: headerHeight,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 1,
      });

      const textSize = 11;
      const textWidth = helveticaBold.widthOfTextAtSize(header, textSize);
      const textX = (index === 0 || index === 2)
        ? currentX + (colWidths[index] - textWidth) / 2
        : currentX + cellPadding;

      drawText(header, textX, headerTextY, { bold: true, size: textSize });
      currentX += colWidths[index];
    });

    let rowY = headerY - headerHeight - 8;
    grades.forEach((grade) => {
      addPageIfNeeded(lineHeight + 8);
      currentX = tableX;
      const rowHeight = lineHeight + 8;
      page.drawRectangle({ x: currentX, y: rowY - 4, width: tableWidth, height: rowHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
      drawText(String(grade.index), currentX + cellPadding, rowY, { size: 10 });
      currentX += colWidths[0];
      drawText(grade.studentName, currentX + cellPadding, rowY, { size: 10 });
      currentX += colWidths[1];
      drawText(String(grade.score), currentX + cellPadding, rowY, { size: 10 });
      currentX += colWidths[2];
      drawText(grade.remarks || '—', currentX + cellPadding, rowY, { size: 10 });
      rowY -= rowHeight;
    });

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    downloadBlob(blob, `archive-evaluation-${ev.id}.pdf`);
  };

  const isEvaluationFullyGraded = (ev: Evaluation) =>
    isEvaluationFullyGradedUtil(ev, studentsList, gradesList);

  const isEvaluationCompleted = (ev: Evaluation) =>
    isEvaluationCompletedUtil(ev, studentsList, gradesList);

  const isGradeModified = (grade: Grade) => {
    return grade.isModified ?? ((grade.editCount ?? 0) > 0);
  };

  const getEvaluationDateValue = (ev: Evaluation): string | null => {
    return normalizeDateOnly(ev.date || ev.createdAt);
  };

  const filteredArchived = evaluationsList
    .filter((ev) => {
      if (userRole === 'teacher') {
        if (teacherId == null) return false;
        if (ev.teacherId !== teacherId) return false;
      }
      if (schoolFilterId) {
        const evaluationClass = classesList.find((cls) => cls.id === ev.classId);
        if (!evaluationClass || evaluationClass.schoolId !== schoolFilterId) return false;
      }
      if (selectedClassId && String(ev.classId) !== selectedClassId) return false;
      if (!isEvaluationArchivedUtil(ev, studentsList, gradesList)) return false;

      const evaluationDateValue = getEvaluationDateValue(ev);
      if (fromDate && (!evaluationDateValue || evaluationDateValue < fromDate)) return false;
      if (toDate && (!evaluationDateValue || evaluationDateValue > toDate)) return false;

      return true;
    })
    .sort((a, b) => {
      const aDate = getEvaluationDateValue(a);
      const bDate = getEvaluationDateValue(b);
      if (aDate && bDate) return bDate.localeCompare(aDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

  return (
    <div className="space-y-6" id="archive-view">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Archive des devoirs terminés</h2>
          <p className="text-sm text-slate-500">Consultez les devoirs dont toutes les notes ont été saisies et leurs résultats.</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-2 text-slate-600 text-xs font-semibold">
          <BookOpen className="h-4.5 w-4.5" />
          {filteredArchived.length} devoir{filteredArchived.length > 1 ? 's' : ''}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-white p-4 border border-slate-50 rounded-2xl shadow-sm">
        {userRole === 'super_admin' && (
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par école</label>
            <select
              value={schoolFilterId ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (onSchoolFilterChange) onSchoolFilterChange(value ? parseInt(value, 10) : null);
                setSelectedClassId('');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
            >
              <option value="">Toutes les écoles</option>
              {schoolsList.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-1">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Filtrer par classe</label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          >
            <option value="">Toutes les classes</option>
            {filteredClasses.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Du</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Au</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-100 text-xs sm:text-sm rounded-xl focus:outline-none"
          />
        </div>
        <div className="sm:col-span-1 flex flex-col justify-end text-slate-500 text-xs leading-relaxed">
          <p>Les devoirs les plus récents apparaissent en premier. Vous pouvez aussi filtrer par période.</p>
        </div>
      </div>

      {filteredArchived.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center text-slate-500">
          Aucun devoir terminé n’est disponible pour cette sélection.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredArchived.map((ev) => {
            const gradesForEval = gradesList.filter((g) => g.evaluationId === ev.id);
            const classStudents = studentsList.filter((st) => st.classId === ev.classId);
            const evaluationTimestamp = parseDateValue(ev.createdAt || ev.date);
            const eligibleStudents = classStudents.filter((st) => {
              if (!st.enrolledAt || !evaluationTimestamp) return true;
              const enrollmentDate = parseDateValue(st.enrolledAt);
              return enrollmentDate ? enrollmentDate.getTime() <= evaluationTimestamp.getTime() : true;
            });
            return (
              <div key={ev.id} className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold">{ev.subject}</div>
                    <h3 className="text-lg font-semibold text-slate-900">{ev.title}</h3>
                    <div className="mt-2 text-sm text-slate-500">Date : {ev.date}</div>
                  </div>
                  <div className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-xs font-semibold">Terminé</div>
                </div>

                <div className="mt-4 rounded-3xl bg-slate-50 border border-slate-100 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 text-[12px] uppercase tracking-[0.15em] text-slate-500 font-semibold">
                    <span>Notes enregistrées</span>
                    <span>{gradesForEval.length} / {getEligibleStudentsForEvaluationWithGrades(ev, studentsList.filter((st) => st.classId === ev.classId), gradesList).length}</span>
                  </div>
                  {userRole === 'teacher' && ev.teacherId === teacherId && (
                    <div className="flex flex-wrap gap-3 mb-4">
                      <button
                        type="button"
                        onClick={() => exportEvaluationExcel(ev)}
                        className="rounded-full bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700"
                      >
                        Télécharger Excel
                      </button>
                      <button
                        type="button"
                        onClick={() => exportEvaluationPdf(ev)}
                        className="rounded-full bg-rose-600 text-white px-4 py-2 text-xs font-semibold hover:bg-rose-700"
                      >
                        Télécharger PDF
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {gradesForEval.map((grade) => {
                      const student = studentsList.find((st) => st.id === grade.studentId);
                      const gradeBand = getGradeBand(grade.score, ev.maxScore ?? 20);
                      const gradeClass = getGradeBadgeClass(gradeBand);
                      return (
                        <div key={grade.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-800">{grade.studentName || `${student?.firstName || 'Élève'} ${student?.lastName || ''}`.trim() || 'Élève'}</div>
                            {isGradeModified(grade) && (
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                                Modifiée
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-slate-600 text-xs">
                            <div>
                              Note :
                              <span className={`ml-1 font-bold px-2 py-0.5 rounded-lg ${gradeClass}`}>
                                {grade.score}{ev.maxScore != null ? `/${ev.maxScore}` : '/20'}
                              </span>
                            </div>
                            <div>Remarque : <span className="text-slate-700">{grade.remarks || '—'}</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
