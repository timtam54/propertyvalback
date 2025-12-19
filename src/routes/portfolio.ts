import { Router, Request, Response } from 'express';
import { queryMany, execute } from '../utils/database';
import multer from 'multer';
import csv from 'csv-parse';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// CSV Template
const CSV_TEMPLATE = `Agent Name,Agent Email,Agent Phone,Agency Name,Address,Beds,Baths,Carpark,Property Type,Price,Size,Features,Photos,Status,Sold Price,Sale Date
John Smith,john@agency.com,0412345678,My Agency,"123 Main St, Bondi, NSW 2026",3,2,1,House,850000,200,Pool; Modern kitchen,https://example.com/photo1.jpg,active,,
Sarah Lee,sarah@agency.com,0423456789,My Agency,"456 Beach Rd, Bondi, NSW 2026",2,1,1,Apartment,650000,85,Ocean views,https://example.com/photo2.jpg,sold,680000,2024-12-15`;

function parseIntSafe(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseInt(value.replace(/[^0-9.-]/g, ''), 10);
  return isNaN(parsed) ? 0 : parsed;
}

function parseFloatSafe(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

// GET /api/portfolio/csv-template
router.get('/csv-template', (req: Request, res: Response) => {
  res.json({
    success: true,
    template: CSV_TEMPLATE
  });
});

// POST /api/portfolio/import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, detail: 'No file uploaded' });
      return;
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const userEmail = req.headers['x-user-email'] as string;

    const records: any[] = [];
    const parser = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for await (const record of parser) {
      records.push(record);
    }

    let imported = 0;
    let errors: string[] = [];

    for (const record of records) {
      try {
        const propertyId = uuidv4();
        const now = new Date();
        const photos = record['Photos'] ? record['Photos'].split(';').map((p: string) => p.trim()).filter((p: string) => p) : [];

        await execute(
          `INSERT INTO properties (id, location, beds, baths, carpark, property_type, price, size, features, images, agent1_name, agent1_phone, agent_email, status, sold_price, sale_date, user_email, created_at)
           VALUES (@id, @location, @beds, @baths, @carpark, @property_type, @price, @size, @features, @images, @agent1_name, @agent1_phone, @agent_email, @status, @sold_price, @sale_date, @user_email, @created_at)`,
          {
            id: propertyId,
            location: record['Address'] || '',
            beds: parseIntSafe(record['Beds']),
            baths: parseIntSafe(record['Baths']),
            carpark: parseIntSafe(record['Carpark']),
            property_type: record['Property Type'] || 'House',
            price: parseFloatSafe(record['Price']) || null,
            size: parseFloatSafe(record['Size']) || null,
            features: record['Features'] || null,
            images: JSON.stringify(photos),
            agent1_name: record['Agent Name'] || null,
            agent1_phone: record['Agent Phone'] || null,
            agent_email: record['Agent Email'] || null,
            status: record['Status']?.toLowerCase() === 'sold' ? 'sold' : 'active',
            sold_price: parseFloatSafe(record['Sold Price']) || null,
            sale_date: record['Sale Date'] || null,
            user_email: userEmail || null,
            created_at: now
          }
        );
        imported++;
      } catch (err: any) {
        errors.push(`Row ${imported + 1}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      imported,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('Portfolio import error:', error);
    res.status(500).json({ success: false, detail: error.message });
  }
});

export default router;
