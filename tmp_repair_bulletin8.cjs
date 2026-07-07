const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'ecole_admin',
  password: 'EcoleTrack2026!',
  database: 'ecoletrack',
});

function parseNumeric(value) {
  if (value == null) return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function mentionFromAverage(avg) {
  if (avg == null) return null;
  if (avg >= 16) return 'Tres bien';
  if (avg >= 14) return 'Bien';
  if (avg >= 12) return 'Assez bien';
  if (avg >= 10) return 'Passable';
  return 'Insuffisant';
}

function appreciationFromAverage(avg) {
  if (avg == null) return 'Aucune note disponible pour ce trimestre.';
  if (avg >= 16) return 'Excellent trimestre, continuez ainsi.';
  if (avg >= 14) return 'Tres bon trimestre avec des resultats solides.';
  if (avg >= 12) return 'Bon trimestre, efforts reguliers.';
  if (avg >= 10) return 'Trimestre satisfaisant, peut progresser.';
  return 'Des efforts supplementaires sont attendus.';
}

async function main() {
  const bulletinId = Number(process.argv[2] || 8);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bulletinRes = await client.query(
      `select b.id, b.student_id, b.class_id, b.term_id, st.start_date, st.end_date
       from bulletins b
       left join school_terms st on st.id = b.term_id
       where b.id = $1`,
      [bulletinId],
    );

    await client.query('select id from bulletins where id = $1 for update', [bulletinId]);

    if (bulletinRes.rowCount === 0) {
      throw new Error('Bulletin not found');
    }

    const bulletin = bulletinRes.rows[0];

    const evalRes = await client.query(
      `select id, subject, coefficient, max_score, date
       from evaluations
       where class_id = $1
         and count_in_bulletin = true
         and (
           term_id = $2
           or (
             term_id is null
             and $3::text is not null
             and $4::text is not null
             and date >= $3::text
             and date <= $4::text
           )
         )`,
      [bulletin.class_id, bulletin.term_id, bulletin.start_date, bulletin.end_date],
    );

    const evals = evalRes.rows;
    if (evals.length === 0) {
      await client.query('delete from bulletin_lines where bulletin_id = $1', [bulletinId]);
      await client.query(
        `update bulletins
         set average = null,
             total_points = '0.0000',
             total_coefficients = '0.0000',
             mention = null,
             appreciation = 'Aucune note disponible pour ce trimestre.',
             updated_at = now()
         where id = $1`,
        [bulletinId],
      );
      await client.query('COMMIT');
      console.log('No evaluations found. Bulletin reset to empty values.');
      return;
    }

    const evalIds = evals.map((e) => e.id);
    const gradesRes = await client.query(
      `select evaluation_id, score
       from grades
       where student_id = $1
         and evaluation_id = any($2::int[])`,
      [bulletin.student_id, evalIds],
    );

    const latestGradeByEval = new Map();
    for (const row of gradesRes.rows) {
      latestGradeByEval.set(row.evaluation_id, row);
    }

    let totalWeighted = 0;
    let totalCoef = 0;
    const bySubject = new Map();

    for (const ev of evals) {
      const coef = Number(ev.coefficient || 0);
      if (!(coef > 0)) continue;

      const gradeRow = latestGradeByEval.get(ev.id);
      if (!gradeRow) continue;

      const raw = parseNumeric(gradeRow.score);
      const maxScore = Number(ev.max_score || 0);
      if (raw == null || !(maxScore > 0)) continue;

      const normalized = (raw / maxScore) * 20;
      const weighted = normalized * coef;

      totalWeighted += weighted;
      totalCoef += coef;

      const current = bySubject.get(ev.subject) || {
        subjectName: ev.subject,
        coefficient: 0,
        weighted: 0,
        weightedCoef: 0,
      };
      current.coefficient += coef;
      current.weighted += normalized * coef;
      current.weightedCoef += coef;
      bySubject.set(ev.subject, current);
    }

    const average = totalCoef > 0 ? (totalWeighted / totalCoef) : null;
    const mention = mentionFromAverage(average);
    const appreciation = appreciationFromAverage(average);

    const lines = Array.from(bySubject.values()).map((s) => ({
      subjectName: s.subjectName,
      coefficient: s.coefficient,
      average: s.weightedCoef > 0 ? (s.weighted / s.weightedCoef) : null,
    }));

    await client.query('delete from bulletin_lines where bulletin_id = $1', [bulletinId]);

    for (const line of lines) {
      await client.query(
        `insert into bulletin_lines (bulletin_id, subject_id, subject_name, coefficient, average, teacher_comment, rank)
         values ($1, null, $2, $3, $4, null, null)`,
        [bulletinId, line.subjectName, line.coefficient, line.average == null ? null : line.average.toFixed(4)],
      );
    }

    await client.query(
      `update bulletins
       set average = $2,
           total_points = $3,
           total_coefficients = $4,
           mention = $5,
           appreciation = $6,
           updated_at = now()
       where id = $1`,
      [
        bulletinId,
        average == null ? null : average.toFixed(4),
        totalWeighted.toFixed(4),
        totalCoef.toFixed(4),
        mention,
        appreciation,
      ],
    );

    await client.query('COMMIT');
    console.log('Bulletin repaired:', {
      bulletinId,
      lines: lines.length,
      average: average == null ? null : Number(average.toFixed(2)),
      totalCoef,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
