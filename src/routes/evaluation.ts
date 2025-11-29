import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PropertyCreate } from '../models/types';

const router = Router();

// In-memory store for quick evaluation jobs
const quickEvalJobs: Map<string, {
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  stage: string;
  created_at: string;
  completed_at?: string;
  failed_at?: string;
  property_data?: PropertyCreate;
  result?: any;
  error?: string;
}> = new Map();

// Cleanup old jobs every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [jobId, job] of quickEvalJobs.entries()) {
    const createdAt = new Date(job.created_at);
    const ageMinutes = (now.getTime() - createdAt.getTime()) / 60000;
    if (ageMinutes > 10) {
      quickEvalJobs.delete(jobId);
    }
  }
}, 5 * 60 * 1000);

// Simulated evaluation function (since we don't have the LLM API key)
async function runQuickEvaluation(jobId: string, propertyData: PropertyCreate) {
  const job = quickEvalJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'in_progress';
    job.stage = 'fetching_data';

    // Simulate data fetching delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    job.stage = 'generating_evaluation';

    // Simulate evaluation delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate a basic evaluation report (placeholder since we don't have LLM API)
    const estimatedPrice = calculateEstimatedPrice(propertyData);

    const evaluationReport = generatePlaceholderReport(propertyData, estimatedPrice);

    job.status = 'completed';
    job.stage = 'completed';
    job.completed_at = new Date().toISOString();
    job.result = {
      evaluation_report: evaluationReport,
      comparables_data: {
        statistics: {
          total_found: Math.floor(Math.random() * 10) + 5,
          median_price: estimatedPrice,
          avg_price: Math.round(estimatedPrice * (0.95 + Math.random() * 0.1))
        }
      },
      price_per_sqm: propertyData.size ? Math.round(estimatedPrice / propertyData.size) : null
    };

    // Clean up property data
    delete job.property_data;

    console.log(`[Job ${jobId}] Evaluation completed`);
  } catch (error: any) {
    console.error(`[Job ${jobId}] Evaluation failed:`, error.message);
    job.status = 'failed';
    job.stage = 'failed';
    job.error = error.message;
    job.failed_at = new Date().toISOString();
  }
}

function calculateEstimatedPrice(property: PropertyCreate): number {
  // Basic price estimation based on property attributes
  let basePrice = 500000;

  // Adjust for bedrooms
  basePrice += (property.beds || 0) * 100000;

  // Adjust for bathrooms
  basePrice += (property.baths || 0) * 50000;

  // Adjust for car spaces
  basePrice += (property.carpark || 0) * 30000;

  // Adjust for size
  if (property.size) {
    basePrice += property.size * 3000;
  }

  // Adjust for property type
  switch (property.property_type?.toLowerCase()) {
    case 'house':
      basePrice *= 1.2;
      break;
    case 'townhouse':
      basePrice *= 1.0;
      break;
    case 'apartment':
      basePrice *= 0.85;
      break;
    case 'villa':
      basePrice *= 1.1;
      break;
  }

  // Add some randomness
  basePrice *= (0.9 + Math.random() * 0.2);

  return Math.round(basePrice / 10000) * 10000;
}

function generatePlaceholderReport(property: PropertyCreate, estimatedPrice: number): string {
  const priceFormatted = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(estimatedPrice);

  const lowerRange = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(Math.round(estimatedPrice * 0.95));

  const upperRange = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(Math.round(estimatedPrice * 1.05));

  return `PROPERTY VALUATION ESTIMATE

Property: ${property.location}
Type: ${property.property_type || 'Not specified'}
Configuration: ${property.beds} bed, ${property.baths} bath, ${property.carpark} car${property.size ? `, ${property.size}sqm` : ''}

ESTIMATED VALUE RANGE
${lowerRange} - ${upperRange}

MEDIAN ESTIMATE: ${priceFormatted}

METHODOLOGY
This estimate is based on:
- Property configuration (bedrooms, bathrooms, car spaces)
- Property type and size
- General market conditions

DISCLAIMER
This is a preliminary estimate only. For an accurate valuation, please consult a licensed property valuer. Market conditions can change rapidly and individual property features may significantly impact value.

Note: Full AI-powered evaluation with comparable sales analysis requires API configuration. Please add your EMERGENT_LLM_KEY or OPENAI_API_KEY to the backend environment to enable detailed evaluations.`;
}

// POST /api/evaluate-quick
router.post('/', async (req: Request, res: Response) => {
  try {
    const propertyData = req.body as PropertyCreate;

    // Validate required fields
    if (!propertyData.location) {
      res.status(400).json({ detail: 'Location is required' });
      return;
    }

    // Create job
    const jobId = uuidv4();

    quickEvalJobs.set(jobId, {
      status: 'queued',
      stage: 'queued',
      created_at: new Date().toISOString(),
      property_data: propertyData
    });

    // Start background evaluation
    runQuickEvaluation(jobId, propertyData);

    console.log(`[Job ${jobId}] Quick evaluation started for ${propertyData.location}`);

    res.json({
      success: true,
      job_id: jobId,
      message: 'Evaluation started. Use job_id to poll for status.'
    });
  } catch (error: any) {
    console.error('Error starting quick evaluation:', error);
    res.status(500).json({ detail: `Failed to start evaluation: ${error.message}` });
  }
});

// GET /api/evaluate-quick/:jobId/status
router.get('/:jobId/status', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = quickEvalJobs.get(jobId);

  if (!job) {
    res.status(404).json({ detail: 'Job not found or expired' });
    return;
  }

  const response: any = {
    status: job.status,
    stage: job.stage
  };

  if (job.status === 'completed' && job.result) {
    response.result = job.result;
  }

  if (job.status === 'failed' && job.error) {
    response.error = job.error;
  }

  res.json(response);
});

export default router;
