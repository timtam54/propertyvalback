import { Router, Request, Response } from 'express';
import { queryOne, queryMany, execute, query } from '../utils/database';

const router = Router();

const CACHE_DURATION_DAYS = 7;

interface CachedHistoricSales {
  id?: number;
  cache_key: string;
  cached_at: Date;
  postcode: string | null;
  property_type: string;
  sales: string; // JSON string in SQL
}

/**
 * GET /api/historic-sales-cache/all
 * List all cached searches (for admin dashboard)
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const entries = await queryMany<CachedHistoricSales>(
      `SELECT * FROM historic_sales_cache ORDER BY cached_at DESC`
    );

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_DURATION_DAYS);

    const searches = entries.map(entry => {
      let sales = [];
      try {
        sales = entry.sales ? JSON.parse(entry.sales) : [];
      } catch { }

      // Extract suburb and state from cache_key (format: suburb-state-postcode-type)
      const parts = entry.cache_key.split('-');
      const suburb = parts[0] || '';
      const state = parts[1] || '';

      return {
        cache_key: entry.cache_key,
        suburb,
        state: state.toUpperCase(),
        postcode: entry.postcode,
        property_type: entry.property_type,
        cached_at: entry.cached_at,
        total: sales.length,
        is_valid: new Date(entry.cached_at) >= cutoffDate,
        sales
      };
    });

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
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { suburb, state, postcode, propertyType } = req.query;

    if (!suburb || !state) {
      return res.status(400).json({ detail: 'Missing required parameters: suburb, state' });
    }

    const cacheKey = `${(suburb as string).toLowerCase()}-${(state as string).toLowerCase()}-${postcode || 'none'}-${propertyType || 'all'}`;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_DURATION_DAYS);

    const cached = await queryOne<CachedHistoricSales>(
      `SELECT * FROM historic_sales_cache WHERE cache_key = @cacheKey AND cached_at >= @cutoffDate`,
      { cacheKey, cutoffDate }
    );

    if (cached) {
      let sales = [];
      try {
        sales = cached.sales ? JSON.parse(cached.sales) : [];
      } catch { }

      const parts = cacheKey.split('-');
      const cachedSuburb = parts[0] || '';
      const cachedState = parts[1] || '';

      console.log(`[Historic Sales Cache] HIT for ${cacheKey} (cached ${cached.cached_at})`);
      return res.json({
        cached: true,
        cache_key: cacheKey,
        cached_at: cached.cached_at,
        suburb: cachedSuburb,
        state: cachedState,
        postcode: cached.postcode,
        property_type: cached.property_type,
        sales,
        total: sales.length
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

    const cacheKey = `${suburb.toLowerCase()}-${state.toLowerCase()}-${postcode || 'none'}-${propertyType || 'all'}`;
    const now = new Date();

    // Check if exists
    const existing = await queryOne<{ cache_key: string }>(
      `SELECT cache_key FROM historic_sales_cache WHERE cache_key = @cacheKey`,
      { cacheKey }
    );

    if (existing) {
      await execute(
        `UPDATE historic_sales_cache SET cached_at = @cached_at, postcode = @postcode, property_type = @property_type, sales = @sales WHERE cache_key = @cacheKey`,
        {
          cacheKey,
          cached_at: now,
          postcode: postcode || null,
          property_type: propertyType || 'all',
          sales: JSON.stringify(sales)
        }
      );
    } else {
      await execute(
        `INSERT INTO historic_sales_cache (cache_key, cached_at, postcode, property_type, sales) VALUES (@cacheKey, @cached_at, @postcode, @property_type, @sales)`,
        {
          cacheKey,
          cached_at: now,
          postcode: postcode || null,
          property_type: propertyType || 'all',
          sales: JSON.stringify(sales)
        }
      );
    }

    console.log(`[Historic Sales Cache] STORED ${cacheKey} with ${sales.length} properties`);

    return res.json({
      success: true,
      cache_key: cacheKey,
      cached_at: now,
      total: sales.length
    });
  } catch (error) {
    console.error('Historic sales cache POST error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ detail: 'Failed to store cache: ' + errorMessage });
  }
});

export default router;
