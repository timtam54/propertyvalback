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

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Parse CORS origins from environment
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];

// Middleware
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

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
app.use('/api/evaluate-quick', evaluationRoutes);
app.use('/api', settingsRoutes); // For /api/marketing-packages
app.use('/api/property-data', propertyDataRoutes);
app.use('/api/portfolio', portfolioRoutes);

// Root route
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

// Start server
async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();

    // Start listening
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`CORS enabled for: ${corsOrigins.join(', ')}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

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

// Start the server
startServer();
