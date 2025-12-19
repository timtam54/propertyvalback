import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

// Azure SQL Configuration
const sqlConfig: sql.config = {
  user: process.env.SQL_USER || 'eoneval',
  password: process.env.SQL_PASSWORD || 'ABC1234!',
  database: process.env.SQL_DATABASE || 'eonevalsql',
  server: process.env.SQL_SERVER || 'eoneval.database.windows.net',
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true, // Required for Azure SQL
    trustServerCertificate: false
  }
};

let pool: sql.ConnectionPool | null = null;

export async function connectToDatabase(): Promise<sql.ConnectionPool> {
  if (pool) return pool;

  try {
    console.log('Attempting to connect to Azure SQL...');
    console.log(`Server: ${sqlConfig.server}, Database: ${sqlConfig.database}`);

    pool = await sql.connect(sqlConfig);
    console.log('Connected to Azure SQL successfully');

    return pool;
  } catch (error: any) {
    console.error('Failed to connect to Azure SQL:', error.message);
    throw error;
  }
}

export async function getDb(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  return connectToDatabase();
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('Azure SQL connection closed');
  }
}

// Helper function to execute queries
export async function query<T>(queryString: string, params?: Record<string, any>): Promise<sql.IResult<T>> {
  const db = await getDb();
  const request = db.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  return request.query(queryString);
}

// Helper to get a single row
export async function queryOne<T>(queryString: string, params?: Record<string, any>): Promise<T | null> {
  const result = await query<T>(queryString, params);
  return result.recordset.length > 0 ? result.recordset[0] : null;
}

// Helper to get multiple rows
export async function queryMany<T>(queryString: string, params?: Record<string, any>): Promise<T[]> {
  const result = await query<T>(queryString, params);
  return result.recordset;
}

// Helper for INSERT/UPDATE/DELETE
export async function execute(queryString: string, params?: Record<string, any>): Promise<number> {
  const result = await query(queryString, params);
  return result.rowsAffected[0] || 0;
}

export { sql };
