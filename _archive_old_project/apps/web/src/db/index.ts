import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://scoutzero:scoutzero@localhost:5432/scoutzero',
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
