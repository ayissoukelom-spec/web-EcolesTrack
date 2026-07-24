import psycopg2
from psycopg2 import sql

conn = psycopg2.connect(host='127.0.0.1', port=5432, user='ecole_admin', password='1234567', dbname='ecoletrack')
cur = conn.cursor()

# Resolve teacher and school from known accounts
cur.execute("SELECT id, name, email, role, school_id FROM users WHERE email IN ('ndt@gmail.com','azia@gmail.com') ORDER BY role")
users = cur.fetchall()
print('USERS')
for row in users:
    print(row)

# Resolve teacher profile for azia@gmail.com
cur.execute("SELECT id, user_id, school_id FROM teachers WHERE user_id = %s", (82,))
teacher = cur.fetchone()
print('\nTEACHER_PROFILE', teacher)

# school info
cur.execute("SELECT id, name FROM schools WHERE id = %s", (4,))
print('SCHOOL', cur.fetchone())

# Get class assignments for teacher 82
cur.execute("SELECT ct.class_id, c.name, c.school_id FROM class_teachers ct JOIN classes c ON c.id = ct.class_id WHERE ct.teacher_id = %s", (teacher[0],))
assignments = cur.fetchall()
print('\nASSIGNMENTS')
for row in assignments:
    print(row)

# Dashboard-like query for teacher role
teacher_class_ids = [row[0] for row in assignments]
print('\nTEACHER_CLASS_IDS', teacher_class_ids)

# Query 1: dashboard summary student count for teacher scope
cur.execute("SELECT s.id, s.first_name, s.last_name, s.school_id, s.class_id, c.name AS class_name, c.school_id AS class_school_id FROM students s JOIN classes c ON c.id = s.class_id WHERE s.class_id = ANY(%s)", (teacher_class_ids,))
print('\nDASHBOARD_LIKE_ROWS')
for row in cur.fetchall():
    print(row)

# Query 2: /api/students for teacher scope with extra filters
cur.execute("SELECT s.id, s.first_name, s.last_name, s.school_id, s.class_id, c.name AS class_name, c.school_id AS class_school_id FROM students s JOIN classes c ON c.id = s.class_id WHERE s.class_id = ANY(%s) AND s.school_id = %s", (teacher_class_ids, 4))
print('\nSTUDENTS_API_ROWS')
for row in cur.fetchall():
    print(row)

cur.close()
conn.close()
