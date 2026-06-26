// Fix for /api/students query
// Change innerJoin to leftJoin for academicYears to handle missing year links

const query_before = `        .from(students)
        .innerJoin(classes, eq(students.classId, classes.id))
        .innerJoin(academicYears, eq(classes.academicYearId, academicYears.id))
        .leftJoin(parents, eq(students.parentId, parents.id))
        .leftJoin(users, eq(parents.userId, users.id));`;

const query_after = `        .from(students)
        .innerJoin(classes, eq(students.classId, classes.id))
        .leftJoin(academicYears, eq(classes.academicYearId, academicYears.id))
        .leftJoin(parents, eq(students.parentId, parents.id))
        .leftJoin(users, eq(parents.userId, users.id));`;
