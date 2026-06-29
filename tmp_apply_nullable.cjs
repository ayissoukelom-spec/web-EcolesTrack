const { Client } = require('pg');
(async () => {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    database: 'ecoletrack',
    user: 'ecole_admin',
    password: 'EcoleTrack2026!',
  });
  try {
    await client.connect();
    console.log('CONNECTED');

    const colRes = await client.query(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='classes' ORDER BY ordinal_position;"
    );
    console.log('BEFORE COLUMNS:', JSON.stringify(colRes.rows, null, 2));

    const schoolIdCol = colRes.rows.find((r) => r.column_name === 'school_id');
    if (!schoolIdCol) {
      throw new Error('classes.school_id column not found');
    }

    if (schoolIdCol.is_nullable === 'NO') {
      console.log('Applying ALTER TABLE to make classes.school_id nullable');
      await client.query('ALTER TABLE classes ALTER COLUMN school_id DROP NOT NULL;');
    } else {
      console.log('classes.school_id is already nullable');
    }

    const colAfter = await client.query(
      "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='classes' AND column_name='school_id';"
    );
    console.log('AFTER COLUMNS:', JSON.stringify(colAfter.rows, null, 2));

    const yearRes = await client.query('SELECT id FROM academic_years ORDER BY id LIMIT 1;');
    let academicYearId;
    if (yearRes.rows.length > 0) {
      academicYearId = yearRes.rows[0].id;
    } else {
      const useRes = await client.query('SELECT academic_year_id FROM classes ORDER BY id LIMIT 1;');
      academicYearId = useRes.rows[0]?.academic_year_id;
    }
    if (!academicYearId) {
      throw new Error('No academic_year_id available for test insert');
    }

    const insertRes = await client.query(
      'INSERT INTO classes (school_id, academic_year_id, name, teacher_id) VALUES ($1, $2, $3, $4) RETURNING id, school_id, academic_year_id, name, teacher_id;',
      [null, academicYearId, 'tmp nullable test', null]
    );
    console.log('INSERT SUCCESS:', JSON.stringify(insertRes.rows[0], null, 2));

    await client.end();
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
