import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PropertyCreate } from '../models/types';
import { getComparableProperties } from '../services/domainApi';
import { searchComparableSales as getCoreLogicComparables, getPropertyAVM } from '../services/corelogicApi';
import { scrapeComparableProperties } from '../services/propertyScraper';
import { getDb } from '../utils/database';
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
    const db = await getDb();
    return await db.collection('evaluation_jobs').findOne({ job_id: jobId }) as EvaluationJob | null;
  } catch (e) {
    console.error('Error getting job:', e);
    return null;
  }
}

async function saveJob(job: EvaluationJob): Promise<void> {
  try {
    const db = await getDb();
    await db.collection('evaluation_jobs').updateOne(
      { job_id: job.job_id },
      { $set: job },
      { upsert: true }
    );
  } catch (e) {
    console.error('Error saving job:', e);
  }
}

async function deleteJob(jobId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.collection('evaluation_jobs').deleteOne({ job_id: jobId });
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
    const db = await getDb();
    const settings = await db.collection('settings').findOne({ setting_id: 'api_keys' });
    if (settings) {
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
    // Return a basic report if no API key
    return generateBasicReport(propertyData, comparablesData, pricePerSqm);
  }

  try {
    const openai = new OpenAI({ apiKey: openaiKey });

    // Format comparables for prompt
    let comparablesText = '';
    if (comparablesData?.comparable_sold?.length > 0) {
      comparablesText = 'COMPARABLE SOLD PROPERTIES:\n';
      for (const comp of comparablesData.comparable_sold.slice(0, 5)) {
        comparablesText += `- ${comp.address}: $${comp.price?.toLocaleString() || 'N/A'} | ${comp.beds || 'N/A'} bed, ${comp.baths || 'N/A'} bath | Sold: ${comp.sold_date || 'Recently'}\n`;
      }
    }

    // Statistics text
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

    const prompt = `You are an expert Australian property valuer with deep knowledge of local markets. Generate a detailed property valuation report.

SUBJECT PROPERTY:
- Address/Location: ${propertyData.location}
- Type: ${propertyData.property_type || 'House'}
- Configuration: ${propertyData.beds} bed, ${propertyData.baths} bath, ${propertyData.carpark} car
- Size: ${propertyData.size || 'Not specified'} sqm
- Asking Price: ${propertyData.price ? `$${propertyData.price.toLocaleString()}` : 'Not specified'}
- Features: ${propertyData.features || 'Standard'}

${comparablesText}

${statsText}

IMPORTANT INSTRUCTIONS:
1. Use your extensive knowledge of Australian property markets, specifically the suburb/area mentioned
2. Reference specific streets, pockets, and property characteristics that affect value in this area
3. Provide realistic price estimates based on current 2024-2025 market conditions
4. Include specific comparable sales figures you know for similar properties in this area
5. Comment on market trends, days on market, and buyer demographics for this location

Please provide:

### Estimated Value Range
- Conservative: $X
- Market Value: $Y
- Premium/Well-Presented: $Z

### Comparable Sales Analysis
Reference specific recent sales in this suburb/area with addresses and prices where possible. Include insights about which streets/pockets command premiums.

### Market Insights
- Current buyer demand level
- Typical days on market
- Price trends (growth/decline)
- Seasonal factors

### Pricing Strategy Recommendation
Specific advice for this property's pricing and marketing approach.

### Notes
Include any specific local knowledge about this suburb that affects property values (e.g., proximity to beaches, schools, transport, flood zones, development changes, etc.).

Be specific and use real suburb knowledge rather than generic statements.`;

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

// Basic report without AI
function generateBasicReport(
  propertyData: PropertyCreate,
  comparablesData: any,
  pricePerSqm: number | null
): string {
  const stats = comparablesData?.statistics || {};
  const range = stats.price_range || {};

  let estimatedPrice = range.median || range.avg || 0;

  // If no comparables data, use basic formula
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

  let report = `PROPERTY VALUATION REPORT

PROPERTY: ${propertyData.location}
TYPE: ${propertyData.property_type || 'Not specified'}
CONFIGURATION: ${propertyData.beds} bed, ${propertyData.baths} bath, ${propertyData.carpark} car${propertyData.size ? `, ${propertyData.size}sqm` : ''}

ESTIMATED VALUE RANGE
Conservative: $${lowerRange.toLocaleString()}
Market: $${estimatedPrice.toLocaleString()}
Premium: $${upperRange.toLocaleString()}

`;

  if (stats.total_found > 0) {
    report += `MARKET ANALYSIS
Based on ${stats.total_found} comparable properties in the area:
- Price Range: $${range.min?.toLocaleString() || 'N/A'} - $${range.max?.toLocaleString() || 'N/A'}
- Average Price: $${range.avg?.toLocaleString() || 'N/A'}
- Median Price: $${range.median?.toLocaleString() || 'N/A'}

`;

    if (comparablesData?.comparable_sold?.length > 0) {
      report += 'RECENT SALES:\n';
      for (const comp of comparablesData.comparable_sold.slice(0, 5)) {
        report += `- ${comp.address}: $${comp.price?.toLocaleString() || 'N/A'} (${comp.beds} bed, ${comp.baths} bath) - ${comp.sold_date || 'Recently'}\n`;
      }
      report += '\n';
    }
  }

  if (pricePerSqm) {
    report += `PRICE PER SQM: $${pricePerSqm.toLocaleString()}\n\n`;
  }

  report += `DISCLAIMER
This is a preliminary estimate based on available market data. For an accurate valuation, please consult a licensed property valuer. Market conditions can change rapidly and individual property features may significantly impact value.`;

  return report;
}

// Run quick evaluation in background
async function runQuickEvaluation(jobId: string, propertyData: PropertyCreate) {
  let job = await getJob(jobId);
  if (!job) return;

  try {
    job.status = 'in_progress';
    job.stage = 'fetching_data';
    await saveJob(job);

    console.log(`[Job ${jobId}] Starting evaluation for ${propertyData.location}`);

    // Get all API keys
    const apiKeys = await getApiKeys();

    let comparablesData: any = {
      comparable_sold: [],
      comparable_listings: [],
      statistics: {
        total_found: 0,
        price_range: {}
      }
    };

    let corelogicAVM: any = null;

    // Try CoreLogic first (professional AVM) if keys are available
    if (apiKeys.corelogic_client_key && apiKeys.corelogic_secret_key) {
      console.log(`[Job ${jobId}] Using CoreLogic API for property valuation`);
      try {
        // Get AVM (Automated Valuation Model)
        corelogicAVM = await getPropertyAVM(
          apiKeys.corelogic_client_key,
          apiKeys.corelogic_secret_key,
          propertyData.location.split(',')[0].trim(),
          propertyData.location
        );
        if (corelogicAVM) {
          console.log(`[Job ${jobId}] CoreLogic AVM returned valuation: $${corelogicAVM.valuation}`);
        }

        // Get comparable sales from CoreLogic
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
          console.log(`[Job ${jobId}] CoreLogic returned ${corelogicComps.statistics.total_found} comparable properties`);
        }
      } catch (e: any) {
        console.error(`[Job ${jobId}] CoreLogic API error:`, e.message);
      }
    }

    // Fallback to Domain API if CoreLogic didn't return data
    if (comparablesData.statistics.total_found === 0 && apiKeys.domain_api_key) {
      console.log(`[Job ${jobId}] Using Domain API for comparable properties`);
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
        console.log(`[Job ${jobId}] Domain API returned ${comparablesData.statistics?.total_found || 0} properties`);
      } catch (e: any) {
        console.error(`[Job ${jobId}] Domain API error:`, e.message);
      }
    }

    // Fallback to web scraping if APIs didn't return enough data
    if (comparablesData.statistics.total_found < 3) {
      console.log(`[Job ${jobId}] Using web scraping for additional comparable properties`);
      try {
        const scrapedData = await scrapeComparableProperties(
          propertyData.location,
          propertyData.beds || 3,
          propertyData.baths || 2,
          propertyData.property_type || 'house'
        );

        if (scrapedData.statistics.total_found > 0) {
          // Merge scraped data with existing data
          if (comparablesData.statistics.total_found === 0) {
            comparablesData = scrapedData;
          } else {
            // Add scraped listings to existing data
            comparablesData.comparable_listings = [
              ...comparablesData.comparable_listings,
              ...scrapedData.comparable_listings
            ].slice(0, 5);

            // Add scraped sold data if we don't have enough
            if (comparablesData.comparable_sold.length < 3) {
              comparablesData.comparable_sold = [
                ...comparablesData.comparable_sold,
                ...scrapedData.comparable_sold
              ].slice(0, 5);
            }

            // Update statistics with combined data
            const allSoldPrices = comparablesData.comparable_sold
              .filter((p: any) => p.price)
              .map((p: any) => p.price);
            const allListingPrices = comparablesData.comparable_listings
              .filter((p: any) => p.price)
              .map((p: any) => p.price);
            const allPrices = [...allSoldPrices, ...allListingPrices];

            if (allPrices.length > 0) {
              const sortedPrices = [...allPrices].sort((a, b) => a - b);
              comparablesData.statistics = {
                ...comparablesData.statistics,
                total_found: allPrices.length,
                sold_count: allSoldPrices.length,
                listing_count: allListingPrices.length,
                price_range: {
                  min: Math.min(...allPrices),
                  max: Math.max(...allPrices),
                  avg: Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length),
                  median: sortedPrices[Math.floor(sortedPrices.length / 2)]
                }
              };
            }
          }

          if (corelogicAVM) {
            comparablesData.corelogic_avm = corelogicAVM;
          }
          console.log(`[Job ${jobId}] Web scraping added data, now have ${comparablesData.statistics.total_found} properties`);
        }
      } catch (e: any) {
        console.error(`[Job ${jobId}] Web scraping error:`, e.message);
      }
    }

    if (comparablesData.statistics.total_found === 0) {
      console.log(`[Job ${jobId}] No comparable data found - using basic estimation`);
    }

    job.stage = 'generating_evaluation';
    await saveJob(job);

    // Calculate price per sqm
    let pricePerSqm: number | null = null;
    if (propertyData.size && comparablesData.statistics?.price_range?.avg) {
      pricePerSqm = Math.round(comparablesData.statistics.price_range.avg / propertyData.size);
    }

    // Generate evaluation report
    const evaluationReport = await generateEvaluationWithAI(propertyData, comparablesData, pricePerSqm);

    job.status = 'completed';
    job.stage = 'completed';
    job.completed_at = new Date().toISOString();
    job.result = {
      evaluation_report: evaluationReport,
      comparables_data: comparablesData,
      price_per_sqm: pricePerSqm
    };

    // Clean up property data
    delete job.property_data;
    await saveJob(job);

    console.log(`[Job ${jobId}] Evaluation completed successfully`);
  } catch (error: any) {
    console.error(`[Job ${jobId}] Evaluation failed:`, error.message);
    if (job) {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = error.message;
      job.failed_at = new Date().toISOString();
      await saveJob(job);
    }
  }
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

    const job: EvaluationJob = {
      job_id: jobId,
      status: 'queued',
      stage: 'queued',
      created_at: new Date().toISOString(),
      property_data: propertyData
    };

    // Save job to database
    await saveJob(job);

    // Start background evaluation (don't await - let it run in background)
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

  if (job.status === 'completed' && job.result) {
    response.result = job.result;
    // Clean up completed job from database after delivering result
    deleteJob(jobId);
  }

  if (job.status === 'failed' && job.error) {
    response.error = job.error;
    // Clean up failed job from database after delivering error
    deleteJob(jobId);
  }

  res.json(response);
});

export default router;
