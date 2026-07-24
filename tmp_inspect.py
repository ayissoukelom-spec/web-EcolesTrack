import psycopg2
conn = psycopg2.connect(host='127.0.0.1', port=5432, user='ecole_admin', password='1234567', dbname='ecoletrack')
cur = conn.cursor()
print('users:')
cur.execute("SELECT id, name, email, role, school_id FROM users WHERE email IN ('ndt@gmail.com','azia@gmail.com') ORDER BY role")
for row in cur.fetchall():
    print(row)
print('\nschools:')
cur.execute("SELECT id, name FROM schools ORDER BY id")
for row in cur.fetchall():
    print(row)
print('\nevaluations matching DESS1:')
cur.execute("SELECT id, title, class_id, teacher_id, subject, date FROM evaluations WHERE title ILIKE '%DESS1%' ORDER BY id")
for row in cur.fetchall():
    print(row)
cur.close()
conn.close()
