import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

process.env.SQL_DB_NAME = 'ecoletrack_test';
