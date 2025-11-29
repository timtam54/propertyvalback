import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';
import multer from 'multer';
import csv from 'csv-parse';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// CSV Template
const CSV_TEMPLATE = `Agent Name,Agent Email,Agent Phone,Agency Name,Address,Beds,Baths,Carpark,Property Type,Price,Size,Features,Photos,Status,Sold Price,Sale Date
John Smith,john@agency.com,0412345678,My Agency,"123 Main St, Bondi, NSW 2026",3,2,1,House,850000,200,Pool; Modern kitchen,https://example.com/photo1.jpg,active,,
Sarah Lee,sarah@agency.com,0423456789,My Agency,"456 Beach Rd, Bondi, NSW 2026",2,1,1,Apartment,650000,85,Ocean views,https://example.com/photo2.jpg,sold,680000,2024-12-15`;

// Helper functions
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
    const db = getDb();
    const agentsCollection = db.collection('agents');
    const propertiesCollection = db.collection('properties');

    // Parse CSV
    const records: any[] = [];
    const parser = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for await (const row of parser) {
      records.push(row);
    }

    // Process records
    const agents: Record<string, any> = {};
    const properties: any[] = [];
    const errors: string[] = [];

    let rowNum = 0;
    for (const row of records) {
      rowNum++;
      try {
        // Extract agent info
        const agentName = (row['Agent Name'] || '').trim();
        const agentEmail = (row['Agent Email'] || '').trim().toLowerCase();

        if (!agentName || !agentEmail) {
          errors.push(`Row ${rowNum}: Missing agent name or email`);
          continue;
        }

        // Create or get agent
        if (!agents[agentEmail]) {
          agents[agentEmail] = {
            id: uuidv4(),
            name: agentName,
            email: agentEmail,
            phone: (row['Agent Phone'] || '').trim(),
            agency_name: (row['Agency Name'] || 'My Agency').trim(),
            created_at: new Date()
          };
        }

        const agent = agents[agentEmail];

        // Parse property
        const address = (row['Address'] || '').trim();
        if (!address) {
          errors.push(`Row ${rowNum}: Missing address`);
          continue;
        }

        // Parse beds, baths, carpark
        const beds = parseIntSafe(row['Beds']);
        const baths = parseIntSafe(row['Baths']);
        const carpark = parseIntSafe(row['Carpark']);

        // Parse price
        const price = parseFloatSafe(row['Price']);

        // Parse status
        const status = (row['Status'] || 'active').trim().toLowerCase();

        // Parse sold info if sold
        let soldPrice = null;
        let saleDate = null;
        if (status === 'sold') {
          soldPrice = parseFloatSafe(row['Sold Price']) || price;
          saleDate = (row['Sale Date'] || '').trim() || new Date().toISOString().split('T')[0];
        }

        // Parse photos (comma-separated URLs)
        const photosStr = (row['Photos'] || '').trim();
        const photos = photosStr ? photosStr.split(',').map((url: string) => url.trim()).filter((url: string) => url) : [];

        const propertyData: any = {
          id: uuidv4(),
          location: address,
          beds,
          baths,
          carpark,
          property_type: (row['Property Type'] || 'House').trim(),
          price,
          size: parseFloatSafe(row['Size']),
          features: (row['Features'] || '').trim(),
          images: photos,
          agent_id: agent.id,
          agent_name: agent.name,
          status,
          created_at: new Date()
        };

        // Add sold info if applicable
        if (status === 'sold') {
          propertyData.sold_price = soldPrice;
          propertyData.sale_date = saleDate;
        }

        properties.push(propertyData);
      } catch (e: any) {
        errors.push(`Row ${rowNum}: ${e.message}`);
      }
    }

    // Insert agents
    let agentsCreated = 0;
    let agentsUpdated = 0;
    for (const agent of Object.values(agents)) {
      const existing = await agentsCollection.findOne({ email: agent.email });
      if (existing) {
        await agentsCollection.updateOne(
          { email: agent.email },
          { $set: { ...agent, updated_at: new Date() } }
        );
        agent.id = existing.id; // Use existing ID
        agentsUpdated++;
      } else {
        await agentsCollection.insertOne(agent);
        agentsCreated++;
      }
    }

    // Update property agent IDs to match existing agents
    for (const property of properties) {
      const agentEmail = Object.keys(agents).find(email => agents[email].name === property.agent_name);
      if (agentEmail) {
        property.agent_id = agents[agentEmail].id;
      }
    }

    // Insert properties
    let propertiesCreated = 0;
    let propertiesUpdated = 0;
    for (const property of properties) {
      const existing = await propertiesCollection.findOne({
        location: property.location,
        agent_id: property.agent_id
      });
      if (existing) {
        await propertiesCollection.updateOne(
          { _id: existing._id },
          { $set: { ...property, updated_at: new Date() } }
        );
        propertiesUpdated++;
      } else {
        await propertiesCollection.insertOne(property);
        propertiesCreated++;
      }
    }

    res.json({
      success: true,
      agents: {
        total: Object.keys(agents).length,
        created: agentsCreated,
        updated: agentsUpdated
      },
      properties: {
        total: properties.length,
        created: propertiesCreated,
        updated: propertiesUpdated
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('Error importing portfolio:', error);
    res.status(500).json({ success: false, detail: error.message || 'Failed to import portfolio' });
  }
});

export default router;
