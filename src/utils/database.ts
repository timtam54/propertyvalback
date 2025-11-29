import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL || '';
const DB_NAME = process.env.DB_NAME || 'property_app';

let client: MongoClient;
let db: Db;
let connectionAttempts = 0;

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const options: MongoClientOptions = {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    tls: true,
    tlsAllowInvalidCertificates: false,
    retryWrites: true,
    w: 'majority'
  };

  try {
    console.log('Attempting to connect to MongoDB...');
    client = new MongoClient(MONGO_URL, options);
    await client.connect();
    db = client.db(DB_NAME);

    console.log('Connected to MongoDB successfully');

    // Create indexes
    await createIndexes();

    return db;
  } catch (error: any) {
    connectionAttempts++;
    console.error(`Failed to connect to MongoDB (attempt ${connectionAttempts}):`, error.message);

    // Provide helpful message for TLS errors
    if (error.message?.includes('TLS') || error.message?.includes('SSL') || error.message?.includes('tlsv1')) {
      console.error('\n=== TROUBLESHOOTING TLS ERROR ===');
      console.error('This error usually means:');
      console.error('1. Your IP address is not whitelisted in MongoDB Atlas');
      console.error('   - Go to MongoDB Atlas > Network Access > Add IP Address');
      console.error('   - Add your current IP or use 0.0.0.0/0 for development');
      console.error('2. The cluster might be paused (free tier clusters pause after inactivity)');
      console.error('   - Go to MongoDB Atlas and resume the cluster');
      console.error('3. The connection string might be incorrect');
      console.error('================================\n');
    }

    throw error;
  }
}

async function createIndexes(): Promise<void> {
  try {
    // Property indexes
    await db.collection('properties').createIndex({ id: 1 }, { unique: true });
    await db.collection('properties').createIndex({ user_id: 1 });
    await db.collection('properties').createIndex({ user_email: 1 });
    await db.collection('properties').createIndex({ created_at: 1 });
    await db.collection('properties').createIndex({ agent_id: 1 });

    // User indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ id: 1 }, { unique: true });

    // Property sales indexes
    await db.collection('property_sales').createIndex({ suburb: 1 });
    await db.collection('property_sales').createIndex({ state: 1 });
    await db.collection('property_sales').createIndex({ sale_date: -1 });

    // Agent indexes
    await db.collection('agents').createIndex({ email: 1 }, { unique: true });
    await db.collection('agents').createIndex({ id: 1 }, { unique: true });

    console.log('Database indexes created successfully');
  } catch (error) {
    console.warn('Error creating indexes (may already exist):', error);
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase() first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}
