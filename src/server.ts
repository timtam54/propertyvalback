import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectToDatabase, closeDatabase } from './utils/database';

// Import routes
import authRoutes from './routes/auth';
import propertyRoutes from './routes/properties';
import agentRoutes from './routes/agents';
import paymentRoutes from './routes/payments';
import settingsRoutes from './routes/settings';
import evaluationRoutes from './routes/evaluation';
import propertyDataRoutes from './routes/propertyData';
import portfolioRoutes from './routes/portfolio';
import auditRoutes from './routes/audit';
import historicSalesCacheRoutes from './routes/historicSalesCache';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Parse CORS origins from environment
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];

// CORS configuration - allow Vercel preview deployments
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    // Allow any vercel.app domain (for preview deployments)
    if (origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    // Allow configured origins
    if (corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Log blocked origins for debugging
    console.log(`CORS blocked origin: ${origin}`);
    callback(null, false);
  },
  credentials: true
};

// Middleware
app.use(cors(corsOptions));

// Manual CORS headers on EVERY response to ensure they're always present
// This prevents Vercel edge caching issues
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  // Set CORS headers for all responses
  if (origin && (origin.endsWith('.vercel.app') || corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, X-User-Email');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Origin');

  // Handle preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    return res.status(204).end();
  }

  next();
});

// Raw body for Stripe webhooks (must be before express.json())
app.use('/api/payments/webhook/stripe', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/api-settings', settingsRoutes); // For frontend compatibility
app.use('/api/evaluate-quick', evaluationRoutes);
app.use('/api', settingsRoutes); // For /api/marketing-packages
app.use('/api/property-data', propertyDataRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/historic-sales-cache', historicSalesCacheRoutes);

// Root route
app.get('/', (req: Request, res: Response) => {
  res.send('Backend alive... at least for now');
});

app.get('/api', (req: Request, res: Response) => {
  res.json({ message: 'Real Estate Property Pitch Generator API' });
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ detail: 'Internal server error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ detail: 'Not found' });
});

// Connect to database on cold start
connectToDatabase().catch(err => {
  console.error('Failed to connect to database:', err);
});

// Export for Vercel serverless
export default app;

// Start server only when running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`CORS enabled for: ${corsOrigins.join(', ')}`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await closeDatabase();
    process.exit(0);
  });
}
