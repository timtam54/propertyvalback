import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PropertyCreate } from '../models/types';
import { getComparableProperties } from '../services/domainApi';
import { searchComparableSales as getCoreLogicComparables, getPropertyAVM } from '../services/corelogicApi';
import { scrapeComparableProperties } from '../services/propertyScraper';
import { queryOne, execute } from '../utils/database';
import OpenAI from 'openai';

const router = Router();

// Job interface for database storage
interface EvaluationJob {
  job_id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  stage: string;
  created_at: string;
  completed_at?: string;
  failed_at?: string;
  property_data?: PropertyCreate;
  result?: any;
  error?: string;
}

// Helper functions for database job storage
async function getJob(jobId: string): Promise<EvaluationJob | null> {
  try {
    const job = await queryOne<{ job_id: string; created_at: Date; property_data: string; stage: string; status: string }>(
      `SELECT * FROM evaluation_jobs WHERE job_id = @jobId`,
      { jobId }
    );
    if (!job) return null;

    return {
      job_id: job.job_id,
      status: job.status as EvaluationJob['status'],
      stage: job.stage,
      created_at: job.created_at?.toISOString() || new Date().toISOString(),
      property_data: job.property_data ? JSON.parse(job.property_data) : undefined
    };
  } catch (e) {
    console.error('Error getting job:', e);
    return null;
  }
}

async function saveJob(job: EvaluationJob): Promise<void> {
  try {
    const existing = await queryOne<{ job_id: string }>(
      `SELECT job_id FROM evaluation_jobs WHERE job_id = @jobId`,
      { jobId: job.job_id }
    );

    if (existing) {
      await execute(
        `UPDATE evaluation_jobs SET status = @status, stage = @stage, property_data = @property_data WHERE job_id = @jobId`,
        {
          jobId: job.job_id,
          status: job.status,
          stage: job.stage,
          property_data: job.property_data ? JSON.stringify(job.property_data) : null
        }
      );
    } else {
      await execute(
        `INSERT INTO evaluation_jobs (job_id, created_at, property_data, stage, status) VALUES (@jobId, @created_at, @property_data, @stage, @status)`,
        {
          jobId: job.job_id,
          created_at: new Date(job.created_at),
          property_data: job.property_data ? JSON.stringify(job.property_data) : null,
          stage: job.stage,
          status: job.status
        }
      );
    }
  } catch (e) {
    console.error('Error saving job:', e);
  }
}

async function deleteJob(jobId: string): Promise<void> {
  try {
    await execute(`DELETE FROM evaluation_jobs WHERE job_id = @jobId`, { jobId });
  } catch (e) {
    console.error('Error deleting job:', e);
  }
}

// API Keys interface
interface ApiKeys {
  domain_api_key: string | null;
  corelogic_client_key: string | null;
  corelogic_secret_key: string | null;
}

// Get API keys from environment or settings
async function getApiKeys(): Promise<ApiKeys> {
  const keys: ApiKeys = {
    domain_api_key: process.env.DOMAIN_API_KEY || null,
    corelogic_client_key: process.env.CORELOGIC_CLIENT_KEY || null,
    corelogic_secret_key: process.env.CORELOGIC_SECRET_KEY || null
  };

  // Fallback to database settings
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'api_keys'`
    );
    if (setting && setting.setting_data) {
      const settings = JSON.parse(setting.setting_data);
      if (!keys.domain_api_key && settings.domain_api_key) {
        keys.domain_api_key = settings.domain_api_key;
      }
      if (!keys.corelogic_client_key && settings.corelogic_client_key) {
        keys.corelogic_client_key = settings.corelogic_client_key;
      }
      if (!keys.corelogic_secret_key && settings.corelogic_secret_key) {
        keys.corelogic_secret_key = settings.corelogic_secret_key;
      }
    }
  } catch (e) {
    console.error('Error fetching API keys from database:', e);
  }

  return keys;
}

// Generate evaluation report using OpenAI
async function generateEvaluationWithAI(
  propertyData: PropertyCreate,
  comparablesData: any,
  pricePerSqm: number | null
): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  try {
    const openai = new OpenAI({ apiKey: openaiKey });

    let comparablesText = '';
    if (comparablesData?.comparable_sold?.length > 0) {
      comparablesText = 'COMPARABLE SOLD PROPERTIES:\n';
      for (const comp of comparablesData.comparable_sold.slice(0, 5)) {
        const landAreaText = comp.land_area ? `${comp.land_area}m²` : 'N/A';
        comparablesText += `- ${comp.address}: $${comp.price?.toLocaleString() || 'N/A'} | ${comp.beds || 'N/A'} bed, ${comp.baths || 'N/A'} bath, ${landAreaText} land | Sold: ${comp.sold_date || 'Recently'}\n`;
      }
    }

    let statsText = '';
    if (comparablesData?.statistics) {
      const stats = comparablesData.statistics;
      const range = stats.price_range || {};
      statsText = `
MARKET STATISTICS (${stats.total_found || 0} comparable properties):
- Price Range: $${range.min?.toLocaleString() || 'N/A'} - $${range.max?.toLocaleString() || 'N/A'}
- Average Price: $${range.avg?.toLocaleString() || 'N/A'}
- Median Price: $${range.median?.toLocaleString() || 'N/A'}
`;
    }

    // Calculate time since each comparable sale for time adjustment context
    const today = new Date();

    const prompt = `You are an expert Australian property valuer. Generate a detailed property valuation report.

SUBJECT PROPERTY:
- Address/Location: ${propertyData.location}
- Type: ${propertyData.property_type || 'House'}
- Configuration: ${propertyData.beds} bed, ${propertyData.baths} bath, ${propertyData.carpark} car
- Land Size: ${propertyData.size || 'Not specified'} sqm
- Asking Price: ${propertyData.price ? `$${propertyData.price.toLocaleString()}` : 'Not specified'}
- Features/Condition: ${propertyData.features || 'Standard'}
- Today's Date: ${today.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}

${comparablesText}

${statsText}

IMPORTANT VALUATION ADJUSTMENTS:
You MUST adjust comparable sale prices for differences between the comparable and the subject property:

1. **TIME ADJUSTMENT**: Property markets typically appreciate. Adjust older sales upward:
   - Sales 6-12 months ago: add ~3-5%
   - Sales 12-18 months ago: add ~5-8%
   - Sales 18-24 months ago: add ~8-12%

2. **LAND SIZE ADJUSTMENT**: Larger land = higher value. Calculate $/sqm from comparables:
   - If subject has MORE land than comparable, ADD value
   - If subject has LESS land than comparable, SUBTRACT value
   - Typical land value: $500-2000/sqm depending on area

3. **QUALITY/CONDITION ADJUSTMENT**:
   - Newer build/recent renovation: add 5-15%
   - Better views/position: add 5-10%
   - Superior finishes: add 5-10%

4. **NEVER value a SUPERIOR property LOWER than an INFERIOR comparable** - this is a fundamental valuation error.

Provide:
### Estimated Value Range
- Conservative: $X
- Market Value: $Y
- Premium/Well-Presented: $Z

### Adjustment Analysis
Show your workings - how you adjusted each comparable sale price to estimate the subject property value.

### Comparable Sales Analysis
Reference specific recent sales with addresses, prices, and the adjustments you applied.

### Market Insights
- Current buyer demand
- Typical days on market
- Price trends

### Pricing Strategy Recommendation
Specific advice for this property.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500,
      temperature: 0.7
    });

    return completion.choices[0]?.message?.content || generateBasicReport(propertyData, comparablesData, pricePerSqm);

  } catch (error: any) {
    console.error('[OpenAI] Error generating evaluation:', error.message);
    return generateBasicReport(propertyData, comparablesData, pricePerSqm);
  }
}

function generateBasicReport(
  propertyData: PropertyCreate,
  comparablesData: any,
  pricePerSqm: number | null
): string {
  const stats = comparablesData?.statistics || {};
  const range = stats.price_range || {};

  let estimatedPrice = range.median || range.avg || 0;

  if (!estimatedPrice) {
    estimatedPrice = 500000;
    estimatedPrice += (propertyData.beds || 0) * 100000;
    estimatedPrice += (propertyData.baths || 0) * 50000;
    estimatedPrice += (propertyData.carpark || 0) * 30000;
    if (propertyData.size) {
      estimatedPrice += propertyData.size * 3000;
    }
  }

  const lowerRange = Math.round(estimatedPrice * 0.95);
  const upperRange = Math.round(estimatedPrice * 1.05);

  return `PROPERTY VALUATION REPORT

PROPERTY: ${propertyData.location}
TYPE: ${propertyData.property_type || 'Not specified'}
CONFIGURATION: ${propertyData.beds} bed, ${propertyData.baths} bath, ${propertyData.carpark} car

ESTIMATED VALUE RANGE
Conservative: $${lowerRange.toLocaleString()}
Market: $${estimatedPrice.toLocaleString()}
Premium: $${upperRange.toLocaleString()}

DISCLAIMER
This is a preliminary estimate. For an accurate valuation, consult a licensed property valuer.`;
}

// In-memory job results storage (since we can't store large JSON in evaluation_jobs)
const jobResults: Map<string, any> = new Map();

async function runQuickEvaluation(jobId: string, propertyData: PropertyCreate) {
  let job = await getJob(jobId);
  if (!job) return;

  try {
    job.status = 'in_progress';
    job.stage = 'fetching_data';
    await saveJob(job);

    console.log(`[Job ${jobId}] Starting evaluation for ${propertyData.location}`);

    const apiKeys = await getApiKeys();

    let comparablesData: any = {
      comparable_sold: [],
      comparable_listings: [],
      statistics: { total_found: 0, price_range: {} }
    };

    let corelogicAVM: any = null;

    // Try CoreLogic first
    if (apiKeys.corelogic_client_key && apiKeys.corelogic_secret_key) {
      console.log(`[Job ${jobId}] Using CoreLogic API`);
      try {
        corelogicAVM = await getPropertyAVM(
          apiKeys.corelogic_client_key,
          apiKeys.corelogic_secret_key,
          propertyData.location.split(',')[0].trim(),
          propertyData.location
        );

        const corelogicComps = await getCoreLogicComparables(
          apiKeys.corelogic_client_key,
          apiKeys.corelogic_secret_key,
          propertyData.location,
          propertyData.beds || 3,
          propertyData.baths || 2,
          propertyData.property_type || 'House'
        );

        if (corelogicComps.statistics.total_found > 0) {
          comparablesData = corelogicComps;
          comparablesData.corelogic_avm = corelogicAVM;
        }
      } catch (e: any) {
        console.error(`[Job ${jobId}] CoreLogic error:`, e.message);
      }
    }

    // Fallback to Domain API
    if (comparablesData.statistics.total_found === 0 && apiKeys.domain_api_key) {
      console.log(`[Job ${jobId}] Using Domain API`);
      try {
        comparablesData = await getComparableProperties(
          apiKeys.domain_api_key,
          propertyData.location,
          propertyData.beds || 3,
          propertyData.baths || 2,
          propertyData.property_type || 'House'
        );
        if (corelogicAVM) {
          comparablesData.corelogic_avm = corelogicAVM;
        }
      } catch (e: any) {
        console.error(`[Job ${jobId}] Domain API error:`, e.message);
      }
    }

    // Fallback to web scraping
    if (comparablesData.statistics.total_found < 3) {
      console.log(`[Job ${jobId}] Using web scraping`);
      try {
        const scrapedData = await scrapeComparableProperties(
          propertyData.location,
          propertyData.beds || 3,
          propertyData.baths || 2,
          propertyData.property_type || 'house'
        );

        if (scrapedData.statistics.total_found > 0) {
          if (comparablesData.statistics.total_found === 0) {
            comparablesData = scrapedData;
          } else {
            comparablesData.comparable_listings = [
              ...comparablesData.comparable_listings,
              ...scrapedData.comparable_listings
            ].slice(0, 5);
          }
          if (corelogicAVM) {
            comparablesData.corelogic_avm = corelogicAVM;
          }
        }
      } catch (e: any) {
        console.error(`[Job ${jobId}] Web scraping error:`, e.message);
      }
    }

    job.stage = 'generating_evaluation';
    await saveJob(job);

    let pricePerSqm: number | null = null;
    if (propertyData.size && comparablesData.statistics?.price_range?.avg) {
      pricePerSqm = Math.round(comparablesData.statistics.price_range.avg / propertyData.size);
    }

    const evaluationReport = await generateEvaluationWithAI(propertyData, comparablesData, pricePerSqm);

    job.status = 'completed';
    job.stage = 'completed';
    job.completed_at = new Date().toISOString();

    // Store result in memory
    jobResults.set(jobId, {
      evaluation_report: evaluationReport,
      comparables_data: comparablesData,
      price_per_sqm: pricePerSqm
    });

    delete job.property_data;
    await saveJob(job);

    console.log(`[Job ${jobId}] Evaluation completed`);
  } catch (error: any) {
    console.error(`[Job ${jobId}] Evaluation failed:`, error.message);
    if (job) {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = error.message;
      await saveJob(job);
    }
  }
}

// POST /api/evaluate-quick
router.post('/', async (req: Request, res: Response) => {
  try {
    const propertyData = req.body as PropertyCreate;

    if (!propertyData.location) {
      res.status(400).json({ detail: 'Location is required' });
      return;
    }

    const jobId = uuidv4();

    const job: EvaluationJob = {
      job_id: jobId,
      status: 'queued',
      stage: 'queued',
      created_at: new Date().toISOString(),
      property_data: propertyData
    };

    await saveJob(job);
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

  const job = await getJob(jobId);

  if (!job) {
    res.status(404).json({ detail: 'Job not found or expired' });
    return;
  }

  const response: any = {
    status: job.status,
    stage: job.stage
  };

  if (job.status === 'completed') {
    response.result = jobResults.get(jobId);
    jobResults.delete(jobId);
    deleteJob(jobId);
  }

  if (job.status === 'failed' && job.error) {
    response.error = job.error;
    deleteJob(jobId);
  }

  res.json(response);
});

export default router;
