import psycopg2
conn = psycopg2.connect(host='127.0.0.1', port=5432, user='ecole_admin', password='1234567', dbname='ecoletrack')
cur = conn.cursor()

cur.execute("SELECT id, user_id, school_id FROM teachers WHERE user_id = %s", (82,))
teacher = cur.fetchone()
cur.execute("SELECT ct.class_id, c.name, c.school_id, c.academic_year_id FROM class_teachers ct JOIN classes c ON c.id = ct.class_id WHERE ct.teacher_id = %s", (teacher[0],))
assignments = cur.fetchall()
teacher_class_ids = [row[0] for row in assignments]

print('TEACHER_CLASS_IDS', teacher_class_ids)
print('\nTHIRD_STUDENT_DETAILS')
cur.execute("SELECT s.id, s.first_name, s.last_name, s.school_id, s.class_id, c.name AS class_name, c.school_id AS class_school_id, c.academic_year_id, ay.name AS year_name FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN academic_years ay ON ay.id = c.academic_year_id WHERE s.id = %s", (8,))
for row in cur.fetchall():
    print(row)

print('\nALL_STUDENTS_FOR_CLASS_80')
cur.execute("SELECT s.id, s.first_name, s.last_name, s.school_id, s.class_id, c.name AS class_name, c.school_id AS class_school_id, c.academic_year_id, ay.name AS year_name FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN academic_years ay ON ay.id = c.academic_year_id WHERE s.class_id = %s ORDER BY s.id", (80,))
for row in cur.fetchall():
    print(row)
cur.close()
conn.close()
