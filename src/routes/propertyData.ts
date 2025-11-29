import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';
import multer from 'multer';
import csv from 'csv-parse';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/property-data/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const collection = db.collection('property_sales');

    const totalSales = await collection.countDocuments();

    // Get counts by state
    const byState = await collection.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]).toArray();

    const stateMap: Record<string, number> = {};
    byState.forEach(item => {
      if (item._id) {
        stateMap[item._id] = item.count;
      }
    });

    // Get postcode counts by state
    const postcodesByState = await collection.aggregate([
      { $group: { _id: { state: '$state', postcode: '$postcode' } } },
      { $group: { _id: '$_id.state', count: { $sum: 1 } } }
    ]).toArray();

    const postcodeMap: Record<string, number> = {};
    postcodesByState.forEach(item => {
      if (item._id) {
        postcodeMap[item._id] = item.count;
      }
    });

    // Get date range
    const dateRange = await collection.aggregate([
      { $group: {
        _id: null,
        oldest: { $min: '$sale_date' },
        newest: { $max: '$sale_date' }
      }}
    ]).toArray();

    res.json({
      success: true,
      total_sales: totalSales,
      by_state: stateMap,
      postcodes_by_state: postcodeMap,
      date_range: dateRange.length > 0 ? {
        oldest: dateRange[0].oldest,
        newest: dateRange[0].newest
      } : null
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, detail: 'Failed to fetch stats' });
  }
});

// GET /api/property-data/postcodes
router.get('/postcodes', async (req: Request, res: Response) => {
  try {
    const { state } = req.query;

    if (!state) {
      res.status(400).json({ success: false, detail: 'State parameter required' });
      return;
    }

    const db = getDb();
    const collection = db.collection('property_sales');

    const postcodes = await collection.aggregate([
      { $match: { state: state } },
      { $group: {
        _id: { postcode: '$postcode', suburb: '$suburb' },
        count: { $sum: 1 },
        avg_price: { $avg: '$sale_price' }
      }},
      { $project: {
        postcode: '$_id.postcode',
        suburb: '$_id.suburb',
        count: 1,
        avg_price: { $round: ['$avg_price', 0] }
      }},
      { $sort: { postcode: 1, suburb: 1 } },
      { $limit: 500 }
    ]).toArray();

    res.json({
      success: true,
      postcodes: postcodes.map(p => ({
        postcode: p.postcode,
        suburb: p.suburb,
        count: p.count,
        avg_price: p.avg_price
      }))
    });
  } catch (error) {
    console.error('Error fetching postcodes:', error);
    res.status(500).json({ success: false, detail: 'Failed to fetch postcodes' });
  }
});

// GET /api/property-data/search
router.get('/search', async (req: Request, res: Response) => {
  try {
    const {
      suburb,
      state,
      property_type,
      min_price,
      max_price,
      from_date,
      to_date,
      limit = '100'
    } = req.query;

    const db = getDb();
    const collection = db.collection('property_sales');

    const query: any = {};

    if (suburb) query.suburb = { $regex: new RegExp(suburb as string, 'i') };
    if (state) query.state = state;
    if (property_type) query.property_type = { $regex: new RegExp(property_type as string, 'i') };
    if (min_price) query.sale_price = { ...query.sale_price, $gte: parseFloat(min_price as string) };
    if (max_price) query.sale_price = { ...query.sale_price, $lte: parseFloat(max_price as string) };
    if (from_date) query.sale_date = { ...query.sale_date, $gte: from_date };
    if (to_date) query.sale_date = { ...query.sale_date, $lte: to_date };

    const sales = await collection
      .find(query)
      .sort({ sale_date: -1 })
      .limit(parseInt(limit as string))
      .toArray();

    res.json({
      success: true,
      count: sales.length,
      sales: sales.map(s => ({
        address: s.address,
        suburb: s.suburb,
        postcode: s.postcode,
        property_type: s.property_type,
        list_price: s.list_price,
        sale_price: s.sale_price,
        sale_date: s.sale_date,
        beds: s.beds,
        baths: s.baths
      }))
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ success: false, detail: 'Search failed' });
  }
});

// Helper function to parse CSV
function parseCSVRow(row: any, state: string): any {
  const priceStr = (row['Sale Price'] || row['Price'] || '0').replace(/[$,]/g, '').trim();
  const salePrice = parseFloat(priceStr) || 0;

  if (salePrice <= 0) return null;

  const listPriceStr = (row['List Price'] || row['Asking Price'] || row['Advertised Price'] || '').replace(/[$,]/g, '').trim();
  const listPrice = listPriceStr ? parseFloat(listPriceStr) : null;

  // Parse date
  let saleDateStr = row['Sale Date'] || row['Date'] || '';
  let saleDate = saleDateStr;

  // Convert DD/MM/YYYY to YYYY-MM-DD
  if (saleDateStr.includes('/')) {
    const parts = saleDateStr.split('/');
    if (parts.length === 3) {
      saleDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  const address = (row['Address'] || row['Property Address'] || '').trim();
  const suburb = (row['Suburb'] || row['Locality'] || '').trim().toUpperCase();

  if (!address || !suburb) return null;

  return {
    address,
    suburb,
    postcode: (row['Postcode'] || row['Post Code'] || '').trim(),
    state,
    property_type: (row['Property Type'] || row['Type'] || '').trim(),
    list_price: listPrice,
    sale_price: salePrice,
    sale_date: saleDate,
    beds: parseInt(row['Beds'] || row['Bedrooms'] || '') || null,
    baths: parseInt(row['Baths'] || row['Bathrooms'] || '') || null,
    carpark: parseInt(row['Carpark'] || row['Parking'] || '') || null,
    land_area: parseFloat(row['Land Area'] || row['Land Size'] || '') || null,
    data_source: 'government',
    source_state: state,
    imported_at: new Date()
  };
}

// POST /api/property-data/import-csv
router.post('/import-csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { state = 'NSW' } = req.query;

    if (!req.file) {
      res.status(400).json({ success: false, detail: 'No file uploaded' });
      return;
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const db = getDb();
    const collection = db.collection('property_sales');

    // Parse CSV
    const records: any[] = [];
    const parser = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for await (const row of parser) {
      const parsed = parseCSVRow(row, state as string);
      if (parsed) {
        records.push(parsed);
      }
    }

    if (records.length === 0) {
      res.status(400).json({ success: false, detail: 'No valid records found in CSV' });
      return;
    }

    // Upsert records
    let imported = 0;
    let updated = 0;

    for (const record of records) {
      const result = await collection.updateOne(
        {
          address: record.address,
          suburb: record.suburb,
          sale_date: record.sale_date
        },
        { $set: record },
        { upsert: true }
      );

      if (result.upsertedCount > 0) imported++;
      else if (result.modifiedCount > 0) updated++;
    }

    res.json({
      success: true,
      total_processed: records.length,
      imported,
      updated
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    res.status(500).json({ success: false, detail: 'Failed to import CSV' });
  }
});

// POST /api/property-data/auto-fetch (placeholder)
router.post('/auto-fetch', async (req: Request, res: Response) => {
  const { state } = req.query;

  // This is a placeholder - auto-fetching from government sources requires
  // specific URLs that may change. Recommend manual CSV upload.
  res.status(503).json({
    success: false,
    detail: `Auto-fetch for ${state || 'NSW'} is not available. Please download CSV manually from nswpropertysalesdata.com or data.nsw.gov.au and use the upload feature.`
  });
});

export default router;
