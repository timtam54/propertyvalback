import { Router, Request, Response } from 'express';
import { queryOne, queryMany, execute, query } from '../utils/database';

const router = Router();

const CACHE_DURATION_DAYS = 14; // 2 weeks

interface CacheEntry {
  id: number;
  cache_key: string;
  cached_at: Date;
  postcode: string | null;
  property_type: string;
}

interface HistoricProp {
  id: number;
  cache_id: number;
  prop_id: string;
  address: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  cars: number | null;
  land_area: number | null;
  property_type: string | null;
  sold_date: string | null;
  sold_date_raw: Date | null;
  source: string | null;
  latitude: number | null;
  longitude: number | null;
  homely_url: string | null;
  source_suburb: string | null;
  is_neighbouring: boolean;
}

/**
 * GET /api/historic-sales-cache/all
 * List all cached searches (for admin dashboard)
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    // Get cache entries with property counts from historic_prop table
    const entries = await queryMany<CacheEntry & { total: number }>(
      `SELECT c.id, c.cache_key, c.cached_at, c.postcode, c.property_type, COUNT(hp.id) as total
       FROM historic_sales_cache c
       LEFT JOIN historic_prop hp ON c.id = hp.cache_id
       GROUP BY c.id, c.cache_key, c.cached_at, c.postcode, c.property_type
       ORDER BY c.cached_at DESC`
    );

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_DURATION_DAYS);

    // Get properties for each cache entry
    const searches = await Promise.all(entries.map(async entry => {
      const props = await queryMany<HistoricProp>(
        `SELECT * FROM historic_prop WHERE cache_id = @cacheId ORDER BY sold_date_raw DESC`,
        { cacheId: entry.id }
      );

      // Extract suburb and state from cache_key (format: suburb-state-postcode-type)
      const parts = entry.cache_key.split('-');
      const suburb = parts[0] || '';
      const state = parts[1] || '';

      const sales = props.map(p => ({
        id: p.prop_id,
        address: p.address,
        price: p.price,
        beds: p.beds,
        baths: p.baths,
        cars: p.cars,
        land_area: p.land_area,
        property_type: p.property_type,
        sold_date: p.sold_date,
        sold_date_raw: p.sold_date_raw,
        source: p.source,
        latitude: p.latitude,
        longitude: p.longitude,
        homely_url: p.homely_url,
        source_suburb: p.source_suburb,
        is_neighbouring: p.is_neighbouring
      }));

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

    const cached = await queryOne<CacheEntry>(
      `SELECT * FROM historic_sales_cache WHERE cache_key = @cacheKey AND cached_at >= @cutoffDate`,
      { cacheKey, cutoffDate }
    );

    if (cached) {
      // Get properties from historic_prop table
      const props = await queryMany<HistoricProp>(
        `SELECT * FROM historic_prop WHERE cache_id = @cacheId ORDER BY sold_date_raw DESC`,
        { cacheId: cached.id }
      );

      const sales = props.map(p => ({
        id: p.prop_id,
        address: p.address,
        price: p.price,
        beds: p.beds,
        baths: p.baths,
        cars: p.cars,
        land_area: p.land_area,
        property_type: p.property_type,
        sold_date: p.sold_date,
        sold_date_raw: p.sold_date_raw,
        source: p.source,
        latitude: p.latitude,
        longitude: p.longitude,
        homely_url: p.homely_url,
        source_suburb: p.source_suburb,
        is_neighbouring: p.is_neighbouring
      }));

      const parts = cacheKey.split('-');
      const cachedSuburb = parts[0] || '';
      const cachedState = parts[1] || '';

      console.log(`[Historic Sales Cache] HIT for ${cacheKey} (${sales.length} properties, cached ${cached.cached_at})`);
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

    // Check if cache entry exists
    const existing = await queryOne<{ id: number; cache_key: string }>(
      `SELECT id, cache_key FROM historic_sales_cache WHERE cache_key = @cacheKey`,
      { cacheKey }
    );

    let cacheId: number;

    if (existing) {
      cacheId = existing.id;
      // Update cache entry timestamp
      await execute(
        `UPDATE historic_sales_cache SET cached_at = @cached_at, postcode = @postcode, property_type = @property_type WHERE cache_key = @cacheKey`,
        {
          cacheKey,
          cached_at: now,
          postcode: postcode || null,
          property_type: propertyType || 'all'
        }
      );
      // Delete old properties for this cache entry
      await execute(
        `DELETE FROM historic_prop WHERE cache_id = @cacheId`,
        { cacheId }
      );
    } else {
      // Insert new cache entry (without sales JSON column)
      await execute(
        `INSERT INTO historic_sales_cache (cache_key, cached_at, postcode, property_type, sales) VALUES (@cacheKey, @cached_at, @postcode, @property_type, '[]')`,
        {
          cacheKey,
          cached_at: now,
          postcode: postcode || null,
          property_type: propertyType || 'all'
        }
      );
      // Get the new cache entry ID
      const newEntry = await queryOne<{ id: number }>(
        `SELECT id FROM historic_sales_cache WHERE cache_key = @cacheKey`,
        { cacheKey }
      );
      cacheId = newEntry!.id;
    }

    // Insert properties into historic_prop table
    for (const sale of sales) {
      await execute(
        `INSERT INTO historic_prop (
          cache_id, prop_id, address, price, beds, baths, cars, land_area,
          property_type, sold_date, sold_date_raw, source, latitude, longitude,
          homely_url, source_suburb, is_neighbouring
        ) VALUES (
          @cache_id, @prop_id, @address, @price, @beds, @baths, @cars, @land_area,
          @property_type, @sold_date, @sold_date_raw, @source, @latitude, @longitude,
          @homely_url, @source_suburb, @is_neighbouring
        )`,
        {
          cache_id: cacheId,
          prop_id: sale.id || crypto.randomUUID(),
          address: sale.address,
          price: sale.price || null,
          beds: sale.beds || null,
          baths: sale.baths || null,
          cars: sale.cars || null,
          land_area: sale.land_area || null,
          property_type: sale.property_type || null,
          sold_date: sale.sold_date || null,
          sold_date_raw: sale.sold_date_raw ? new Date(sale.sold_date_raw) : null,
          source: sale.source || 'homely.com.au',
          latitude: sale.latitude || null,
          longitude: sale.longitude || null,
          homely_url: sale.homely_url || null,
          source_suburb: sale.source_suburb || null,
          is_neighbouring: sale.is_neighbouring || false
        }
      );
    }

    console.log(`[Historic Sales Cache] STORED ${cacheKey} with ${sales.length} properties in historic_prop table`);

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
