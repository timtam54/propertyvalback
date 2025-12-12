import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';

const router = Router();

const CACHE_DURATION_DAYS = 7;

interface SoldProperty {
  id: string;
  address: string;
  price: number;
  beds: number | null;
  baths: number | null;
  cars: number | null;
  land_area: number | null;
  property_type: string;
  sold_date: string;
  sold_date_raw: string | null;
  source: string;
}

interface CachedHistoricSales {
  cache_key: string;
  suburb: string;
  state: string;
  postcode: string | null;
  property_type: string;
  sales: SoldProperty[];
  scraped_url: string;
  cached_at: Date;
  total: number;
}

/**
 * GET /api/historic-sales-cache/all
 * List all cached searches (for admin dashboard)
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const collection = db.collection<CachedHistoricSales>('historic_sales_cache');

    // Get all cached entries, sorted by cached_at descending
    const entries = await collection
      .find({})
      .sort({ cached_at: -1 })
      .toArray();

    // Calculate cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_DURATION_DAYS);

    // Transform for frontend - include whether still valid
    const searches = entries.map(entry => ({
      cache_key: entry.cache_key,
      suburb: entry.suburb,
      state: entry.state.toUpperCase(),
      postcode: entry.postcode,
      property_type: entry.property_type,
      cached_at: entry.cached_at,
      total: entry.total,
      scraped_url: entry.scraped_url,
      is_valid: new Date(entry.cached_at) >= cutoffDate,
      sales: entry.sales
    }));

    console.log(`[Historic Sales Cache] Listed ${searches.length} cached searches`);

    return res.json({
      success: true,
      searches,
      total: searches.length
    });

  } catch (error) {
    console.error('Historic sales cache GET all error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ detail: 'Failed to list cached searches: ' + errorMessage });
  }
});

/**
 * GET /api/historic-sales-cache
 * Check for cached historic sales data
 * Query params: suburb, state, postcode (optional), propertyType
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { suburb, state, postcode, propertyType } = req.query;

    if (!suburb || !state) {
      return res.status(400).json({ detail: 'Missing required parameters: suburb, state' });
    }

    const db = await getDb();
    const collection = db.collection<CachedHistoricSales>('historic_sales_cache');

    // Create cache key from parameters
    const cacheKey = `${(suburb as string).toLowerCase()}-${(state as string).toLowerCase()}-${postcode || 'none'}-${propertyType || 'all'}`;

    // Calculate cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_DURATION_DAYS);

    // Look for cached data that's less than 7 days old
    const cached = await collection.findOne({
      cache_key: cacheKey,
      cached_at: { $gte: cutoffDate }
    });

    if (cached) {
      console.log(`[Historic Sales Cache] HIT for ${cacheKey} (cached ${cached.cached_at})`);
      return res.json({
        cached: true,
        cache_key: cacheKey,
        cached_at: cached.cached_at,
        suburb: cached.suburb,
        state: cached.state,
        postcode: cached.postcode,
        property_type: cached.property_type,
        sales: cached.sales,
        scraped_url: cached.scraped_url,
        total: cached.total
      });
    }

    console.log(`[Historic Sales Cache] MISS for ${cacheKey}`);
    return res.json({
      cached: false,
      cache_key: cacheKey
    });

  } catch (error) {
    console.error('Historic sales cache GET error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ detail: 'Failed to check cache: ' + errorMessage });
  }
});

/**
 * POST /api/historic-sales-cache
 * Store historic sales data in cache
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { suburb, state, postcode, propertyType, sales, scrapedUrl } = req.body;

    if (!suburb || !state || !sales) {
      return res.status(400).json({ detail: 'Missing required fields: suburb, state, sales' });
    }

    const db = await getDb();
    const collection = db.collection<CachedHistoricSales>('historic_sales_cache');

    // Create cache key from parameters
    const cacheKey = `${suburb.toLowerCase()}-${state.toLowerCase()}-${postcode || 'none'}-${propertyType || 'all'}`;

    const cacheEntry: CachedHistoricSales = {
      cache_key: cacheKey,
      suburb: suburb.toLowerCase(),
      state: state.toLowerCase(),
      postcode: postcode || null,
      property_type: propertyType || 'all',
      sales: sales,
      scraped_url: scrapedUrl || '',
      cached_at: new Date(),
      total: sales.length
    };

    // Upsert - replace existing cache entry if exists
    await collection.updateOne(
      { cache_key: cacheKey },
      { $set: cacheEntry },
      { upsert: true }
    );

    console.log(`[Historic Sales Cache] STORED ${cacheKey} with ${sales.length} properties`);

    return res.json({
      success: true,
      cache_key: cacheKey,
      cached_at: cacheEntry.cached_at,
      total: sales.length
    });

  } catch (error) {
    console.error('Historic sales cache POST error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ detail: 'Failed to store cache: ' + errorMessage });
  }
});

export default router;
