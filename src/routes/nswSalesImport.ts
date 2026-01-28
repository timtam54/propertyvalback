import { Router, Request, Response } from 'express';
import { queryMany, execute, queryOne } from '../utils/database';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for large Excel files
});

interface NSWSaleRecord {
  'District Code': string;
  'Property ID': string;
  'Sale Number': string;
  'Unit': string;
  'House Number': string;
  'Street': string;
  'Suburb': string;
  'Postcode': string;
  'Area': number;
  'Area Unit': string;
  'Contract Date': string;
  'Settlement Date': string;
  'Purchase Price': number;
  'Zoning': string;
  'Nature of Property': string;
  'Primary Purpose': string;
  'Strata Lot': string;
  'Component Code': string;
  'Sale Code': string;
  'Interest of Sale': string;
  'Dealing Number': string;
}

function parseFloatSafe(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return isNaN(parsed) ? null : parsed;
}

function parseIntSafe(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return isNaN(parsed) ? null : parsed;
}

function formatAddress(record: NSWSaleRecord): string {
  const parts: string[] = [];

  // Add unit if present
  if (record['Unit'] && record['Unit'].toString().trim()) {
    parts.push(`Unit ${record['Unit'].toString().trim()}`);
  }

  // Add house number
  if (record['House Number'] && record['House Number'].toString().trim()) {
    parts.push(record['House Number'].toString().trim());
  }

  // Add street
  if (record['Street'] && record['Street'].toString().trim()) {
    parts.push(record['Street'].toString().trim());
  }

  // Create address line
  let address = parts.join(' ');

  // Add suburb, state and postcode
  if (record['Suburb'] && record['Suburb'].toString().trim()) {
    address += `, ${record['Suburb'].toString().trim()}`;
  }

  address += ', NSW';

  if (record['Postcode'] && record['Postcode'].toString().trim()) {
    address += ` ${record['Postcode'].toString().trim()}`;
  }

  return address;
}

function mapPropertyType(natureOfProperty: string, primaryPurpose: string): string {
  const purpose = (primaryPurpose || '').toUpperCase();
  const nature = (natureOfProperty || '').toUpperCase();

  if (nature === 'S') return 'Unit';
  if (purpose.includes('RESIDENCE') || purpose.includes('RESIDENTIAL')) {
    return 'House';
  }
  if (purpose.includes('UNIT') || purpose.includes('APARTMENT')) {
    return 'Unit';
  }
  if (purpose.includes('VACANT') || purpose.includes('LAND')) {
    return 'Land';
  }
  if (purpose.includes('COMMERCIAL')) {
    return 'Commercial';
  }
  if (purpose.includes('RURAL') || purpose.includes('FARM')) {
    return 'Rural';
  }

  return 'House'; // Default
}

function parseExcelDate(value: any): { display: string; raw: Date } | null {
  if (!value) return null;

  let date: Date;

  // If it's already a string date
  if (typeof value === 'string') {
    date = new Date(value);
    if (isNaN(date.getTime())) return null;
  } else if (typeof value === 'number') {
    // Excel dates are days since 1900-01-01 (with a bug for 1900 leap year)
    const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
    date = new Date(excelEpoch.getTime() + value * 86400000);
  } else {
    return null;
  }

  // Format display date like "15 Mar 2017"
  const display = date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return { display, raw: date };
}

// GET /api/nsw-sales/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const result = await queryOne<any>(`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT source_suburb) as unique_suburbs,
        MIN(sold_date_raw) as earliest_sale,
        MAX(sold_date_raw) as latest_sale,
        AVG(price) as avg_price,
        MIN(price) as min_price,
        MAX(price) as max_price
      FROM historic_prop
      WHERE source = 'nsw-valuer-general'
    `);

    res.json({
      success: true,
      stats: result
    });
  } catch (error: any) {
    console.error('NSW Sales stats error:', error);
    res.status(500).json({ success: false, detail: error.message });
  }
});

// POST /api/nsw-sales/import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, detail: 'No file uploaded' });
      return;
    }

    console.log(`[NSW Sales Import] Processing file: ${req.file.originalname}, size: ${req.file.size} bytes`);

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records: NSWSaleRecord[] = XLSX.utils.sheet_to_json(sheet);

    console.log(`[NSW Sales Import] Found ${records.length} records in sheet "${sheetName}"`);

    // Group records by suburb-postcode for cache entries
    const suburbGroups: Map<string, NSWSaleRecord[]> = new Map();

    for (const record of records) {
      // Skip records without price or address
      if (!record['Purchase Price'] || !record['Street']) continue;

      const suburb = (record['Suburb'] || '').toString().toLowerCase().trim();
      const postcode = (record['Postcode'] || '').toString().trim();
      const propertyType = mapPropertyType(record['Nature of Property'], record['Primary Purpose']);

      if (!suburb) continue;

      // Create cache key: suburb-state-postcode-type
      const cacheKey = `${suburb}-nsw-${postcode || 'none'}-all`;

      if (!suburbGroups.has(cacheKey)) {
        suburbGroups.set(cacheKey, []);
      }
      suburbGroups.get(cacheKey)!.push(record);
    }

    console.log(`[NSW Sales Import] Grouped into ${suburbGroups.size} suburb cache entries`);

    let imported = 0;
    let skipped = 0;
    let errors: string[] = [];
    const now = new Date();

    // Process each suburb group
    for (const [cacheKey, suburbRecords] of suburbGroups) {
      try {
        const parts = cacheKey.split('-');
        const suburb = parts[0];
        const postcode = parts[2] !== 'none' ? parts[2] : null;

        // Check if cache entry exists
        let cacheEntry = await queryOne<{ id: number }>(
          `SELECT id FROM historic_sales_cache WHERE cache_key = @cacheKey`,
          { cacheKey }
        );

        let cacheId: number;

        if (cacheEntry) {
          cacheId = cacheEntry.id;
          // Update cache entry timestamp
          await execute(
            `UPDATE historic_sales_cache SET cached_at = @cached_at WHERE id = @cacheId`,
            { cacheId, cached_at: now }
          );
        } else {
          // Insert new cache entry
          await execute(
            `INSERT INTO historic_sales_cache (cache_key, cached_at, postcode, property_type, sales)
             VALUES (@cacheKey, @cached_at, @postcode, @property_type, '[]')`,
            {
              cacheKey,
              cached_at: now,
              postcode: postcode,
              property_type: 'all'
            }
          );
          // Get the new cache entry ID
          const newEntry = await queryOne<{ id: number }>(
            `SELECT id FROM historic_sales_cache WHERE cache_key = @cacheKey`,
            { cacheKey }
          );
          cacheId = newEntry!.id;
        }

        // Insert property records
        for (const record of suburbRecords) {
          try {
            const saleDate = parseExcelDate(record['Contract Date']) || parseExcelDate(record['Settlement Date']);
            const price = parseFloatSafe(record['Purchase Price']);
            const landArea = record['Area Unit'] === 'M' ? parseFloatSafe(record['Area']) : null;

            // Skip invalid records
            if (!price || price <= 0) {
              skipped++;
              continue;
            }

            await execute(
              `INSERT INTO historic_prop (
                cache_id, prop_id, address, price, beds, baths, cars, land_area,
                property_type, sold_date, sold_date_raw, source, source_suburb, is_neighbouring
              ) VALUES (
                @cache_id, @prop_id, @address, @price, @beds, @baths, @cars, @land_area,
                @property_type, @sold_date, @sold_date_raw, @source, @source_suburb, @is_neighbouring
              )`,
              {
                cache_id: cacheId,
                prop_id: uuidv4(),
                address: formatAddress(record),
                price: price,
                beds: null, // Not provided in NSW data
                baths: null,
                cars: null,
                land_area: landArea,
                property_type: mapPropertyType(record['Nature of Property'], record['Primary Purpose']),
                sold_date: saleDate?.display || null,
                sold_date_raw: saleDate?.raw || null,
                source: 'nsw-valuer-general',
                source_suburb: (record['Suburb'] || '').toString().trim(),
                is_neighbouring: false
              }
            );
            imported++;
          } catch (err: any) {
            skipped++;
            if (errors.length < 10) {
              errors.push(`Record error: ${err.message}`);
            }
          }
        }

        // Log progress
        console.log(`[NSW Sales Import] Processed ${suburb}: ${suburbRecords.length} records`);

      } catch (err: any) {
        if (errors.length < 10) {
          errors.push(`Suburb ${cacheKey}: ${err.message}`);
        }
      }
    }

    console.log(`[NSW Sales Import] Complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`);

    res.json({
      success: true,
      imported,
      skipped,
      total: records.length,
      suburbsProcessed: suburbGroups.size,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('NSW Sales import error:', error);
    res.status(500).json({ success: false, detail: error.message });
  }
});

// POST /api/nsw-sales/preview - Preview import without saving
router.post('/preview', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, detail: 'No file uploaded' });
      return;
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records: NSWSaleRecord[] = XLSX.utils.sheet_to_json(sheet);

    // Get column headers
    const headers = Object.keys(records[0] || {});

    // Count valid records
    const validRecords = records.filter(r => r['Purchase Price'] && r['Street']);

    // Count unique suburbs
    const suburbs = new Set(records.map(r => (r['Suburb'] || '').toString().toLowerCase().trim()).filter(s => s));
    const postcodes = new Set(records.map(r => (r['Postcode'] || '').toString().trim()).filter(p => p));

    // Preview first 10 records
    const preview = validRecords.slice(0, 10).map(record => {
      const saleDate = parseExcelDate(record['Contract Date']) || parseExcelDate(record['Settlement Date']);
      return {
        address: formatAddress(record),
        suburb: record['Suburb'],
        postcode: record['Postcode'],
        price: parseFloatSafe(record['Purchase Price']),
        size: record['Area Unit'] === 'M' ? parseFloatSafe(record['Area']) : null,
        saleDate: saleDate?.display || null,
        propertyType: mapPropertyType(record['Nature of Property'], record['Primary Purpose']),
        zoning: record['Zoning']
      };
    });

    // Calculate stats
    const prices = validRecords.map(r => parseFloatSafe(r['Purchase Price'])).filter(p => p && p > 0) as number[];

    res.json({
      success: true,
      sheetName,
      headers,
      totalRows: records.length,
      validRows: validRecords.length,
      preview,
      stats: {
        avgPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
        minPrice: prices.length > 0 ? Math.min(...prices) : 0,
        maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
        uniqueSuburbs: suburbs.size,
        uniquePostcodes: postcodes.size
      }
    });
  } catch (error: any) {
    console.error('NSW Sales preview error:', error);
    res.status(500).json({ success: false, detail: error.message });
  }
});

// DELETE /api/nsw-sales/clear - Clear all imported NSW sales from historic_prop
router.delete('/clear', async (req: Request, res: Response) => {
  try {
    // Delete all records with nsw-valuer-general source
    const result = await execute(
      `DELETE FROM historic_prop WHERE source = 'nsw-valuer-general'`
    );

    // Also delete empty cache entries that have no properties left
    await execute(
      `DELETE FROM historic_sales_cache
       WHERE id NOT IN (SELECT DISTINCT cache_id FROM historic_prop)`
    );

    console.log(`[NSW Sales] Cleared ${result} imported records from historic_prop`);

    res.json({
      success: true,
      deleted: result
    });
  } catch (error: any) {
    console.error('NSW Sales clear error:', error);
    res.status(500).json({ success: false, detail: error.message });
  }
});

export default router;
