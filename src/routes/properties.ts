import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryOne, queryMany, execute, sql } from '../utils/database';
import { extractUserEmail } from '../middleware/auth';
import { Property, PropertyCreate } from '../models/types';
import OpenAI from 'openai';
import { getComparableProperties } from '../services/domainApi';
import multer from 'multer';
import { extractText } from 'unpdf';

async function extractPdfText(buffer: Buffer): Promise<string> {
  const uint8Array = new Uint8Array(buffer);
  const { text } = await extractText(uint8Array);
  if (Array.isArray(text)) {
    return text.join('\n');
  }
  return String(text);
}

const router = Router();

// Lazy-initialize OpenAI
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Use extractUserEmail middleware for all routes
router.use(extractUserEmail);

// GET /api/properties/sold/list
router.get('/sold/list', async (req: Request, res: Response) => {
  try {
    const { suburb } = req.query;

    let query = `SELECT * FROM properties WHERE status = 'sold'`;
    const params: Record<string, any> = {};

    if (suburb && typeof suburb === 'string') {
      query += ` AND location LIKE @suburb`;
      params.suburb = `%${suburb}%`;
    }

    query += ` ORDER BY sale_date DESC`;

    const properties = await queryMany<Property>(query, params);

    // Parse JSON fields
    const parsed = properties.map(p => ({
      ...p,
      images: p.images ? JSON.parse(p.images as any) : [],
      tags: p.tags ? JSON.parse(p.tags as any) : null,
      comparables_data: p.comparables_data ? JSON.parse(p.comparables_data as any) : null,
      confidence_scoring: p.confidence_scoring ? JSON.parse(p.confidence_scoring as any) : null,
      valuation_history: p.valuation_history ? JSON.parse(p.valuation_history as any) : null
    }));

    res.json({ success: true, properties: parsed });
  } catch (error) {
    console.error('Get sold properties error:', error);
    res.status(500).json({ detail: 'Failed to fetch sold properties' });
  }
});

// GET /api/properties/sold/suburbs
router.get('/sold/suburbs', async (req: Request, res: Response) => {
  try {
    const properties = await queryMany<{ location: string }>(
      `SELECT DISTINCT location FROM properties WHERE status = 'sold'`
    );

    const suburbs = new Set<string>();
    properties.forEach(p => {
      if (p.location) {
        const parts = p.location.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const suburb = parts.length >= 3 ? parts[parts.length - 2] : parts[1];
          if (suburb && !suburb.match(/^\d/)) {
            suburbs.add(suburb);
          }
        }
      }
    });

    res.json({ success: true, suburbs: Array.from(suburbs).sort() });
  } catch (error) {
    console.error('Get sold suburbs error:', error);
    res.status(500).json({ detail: 'Failed to fetch suburbs' });
  }
});

// POST /api/properties/:propertyId/resell
router.post('/:propertyId/resell', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;

    const rowsAffected = await execute(
      `UPDATE properties SET status = 'active', sold_price = NULL, sale_date = NULL WHERE id = @id`,
      { id: propertyId }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Resell property error:', error);
    res.status(500).json({ detail: 'Failed to resell property' });
  }
});

// POST /api/properties
router.post('/', async (req: Request, res: Response) => {
  try {
    const propertyData = req.body as PropertyCreate;
    const userEmail = req.userEmail;

    const propertyId = uuidv4();
    const now = new Date();

    await execute(
      `INSERT INTO properties (id, beds, baths, carpark, location, price, size, property_type, features,
        strata_body_corps, council_rates, images, agent1_name, agent1_phone, agent2_name, agent2_phone,
        agent_email, agency_id, user_email, created_at, status, neighbouring_suburb, neighbouring_postcode, neighbouring_state)
       VALUES (@id, @beds, @baths, @carpark, @location, @price, @size, @property_type, @features,
        @strata_body_corps, @council_rates, @images, @agent1_name, @agent1_phone, @agent2_name, @agent2_phone,
        @agent_email, @agency_id, @user_email, @created_at, 'active', @neighbouring_suburb, @neighbouring_postcode, @neighbouring_state)`,
      {
        id: propertyId,
        beds: propertyData.beds || null,
        baths: propertyData.baths || null,
        carpark: propertyData.carpark || null,
        location: propertyData.location || null,
        price: propertyData.price || null,
        size: propertyData.size || null,
        property_type: propertyData.property_type || null,
        features: propertyData.features || null,
        strata_body_corps: propertyData.strata_body_corps || null,
        council_rates: propertyData.council_rates || null,
        images: JSON.stringify(propertyData.images || []),
        agent1_name: propertyData.agent1_name || null,
        agent1_phone: propertyData.agent1_phone || null,
        agent2_name: propertyData.agent2_name || null,
        agent2_phone: propertyData.agent2_phone || null,
        agent_email: propertyData.agent_email || null,
        agency_id: 'default_agency',
        user_email: userEmail || propertyData.user_email || null,
        created_at: now,
        neighbouring_suburb: propertyData.neighbouring_suburb || null,
        neighbouring_postcode: propertyData.neighbouring_postcode || null,
        neighbouring_state: propertyData.neighbouring_state || null
      }
    );

    const property = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (property) {
      property.images = property.images ? JSON.parse(property.images as any) : [];
    }

    res.status(201).json(property);
  } catch (error: any) {
    console.error('Create property error:', error);
    res.status(500).json({ detail: 'Failed to create property' });
  }
});

// GET /api/properties
router.get('/', async (req: Request, res: Response) => {
  try {
    const userEmail = req.userEmail;

    let query: string;
    const params: Record<string, any> = {};

    if (userEmail) {
      query = `SELECT * FROM properties WHERE user_email = @userEmail OR user_email IS NULL`;
      params.userEmail = userEmail;
    } else {
      query = `SELECT * FROM properties`;
    }

    const properties = await queryMany<Property>(query, params);

    // Parse JSON fields
    const parsed = properties.map(p => ({
      ...p,
      images: p.images ? JSON.parse(p.images as any) : [],
      tags: p.tags ? JSON.parse(p.tags as any) : null,
      comparables_data: p.comparables_data ? JSON.parse(p.comparables_data as any) : null,
      confidence_scoring: p.confidence_scoring ? JSON.parse(p.confidence_scoring as any) : null,
      valuation_history: p.valuation_history ? JSON.parse(p.valuation_history as any) : null
    }));

    res.json(parsed);
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ detail: 'Failed to get properties' });
  }
});

// POST /api/properties/extract-pdf-text
router.post('/extract-pdf-text', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ detail: 'PDF file is required' });
      return;
    }

    let pdfText = '';
    try {
      pdfText = await extractPdfText(req.file.buffer);
    } catch (parseError) {
      console.error('PDF parsing error:', parseError);
      res.status(400).json({ detail: 'Could not extract text from PDF.' });
      return;
    }

    if (!pdfText || pdfText.trim() === '') {
      res.status(400).json({ detail: 'Could not extract text from PDF.' });
      return;
    }

    res.json({ success: true, text: pdfText });
  } catch (error) {
    console.error('Extract PDF text error:', error);
    res.status(500).json({ detail: 'Failed to extract text from PDF' });
  }
});

// GET /api/properties/:propertyId
router.get('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const userEmail = req.userEmail;

    const property = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    // Check ownership
    if (userEmail && property.user_email && property.user_email !== userEmail) {
      res.status(403).json({ detail: 'Access denied: You can only view your own properties' });
      return;
    }

    // Parse JSON fields
    property.images = property.images ? JSON.parse(property.images as any) : [];
    property.tags = property.tags ? JSON.parse(property.tags as any) : null;
    property.comparables_data = property.comparables_data ? JSON.parse(property.comparables_data as any) : null;
    property.confidence_scoring = property.confidence_scoring ? JSON.parse(property.confidence_scoring as any) : null;
    property.valuation_history = property.valuation_history ? JSON.parse(property.valuation_history as any) : null;

    res.json(property);
  } catch (error) {
    console.error('Get property error:', error);
    res.status(500).json({ detail: 'Failed to get property' });
  }
});

// PUT /api/properties/:propertyId
router.put('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const userEmail = req.userEmail;
    const updateData = req.body as PropertyCreate;

    const property = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    if (userEmail && property.user_email && property.user_email !== userEmail) {
      res.status(403).json({ detail: 'Access denied' });
      return;
    }

    await execute(
      `UPDATE properties SET
        beds = @beds, baths = @baths, carpark = @carpark, location = @location,
        price = @price, size = @size, property_type = @property_type, features = @features,
        strata_body_corps = @strata_body_corps, council_rates = @council_rates, images = @images,
        agent1_name = @agent1_name, agent1_phone = @agent1_phone, agent2_name = @agent2_name,
        agent2_phone = @agent2_phone, agent_email = @agent_email,
        neighbouring_suburb = @neighbouring_suburb, neighbouring_postcode = @neighbouring_postcode, neighbouring_state = @neighbouring_state
       WHERE id = @id`,
      {
        id: propertyId,
        beds: updateData.beds ?? property.beds,
        baths: updateData.baths ?? property.baths,
        carpark: updateData.carpark ?? property.carpark,
        location: updateData.location ?? property.location,
        price: updateData.price ?? property.price,
        size: updateData.size ?? property.size,
        property_type: updateData.property_type ?? property.property_type,
        features: updateData.features ?? property.features,
        strata_body_corps: updateData.strata_body_corps ?? property.strata_body_corps,
        council_rates: updateData.council_rates ?? property.council_rates,
        images: updateData.images ? JSON.stringify(updateData.images) : property.images,
        agent1_name: updateData.agent1_name ?? property.agent1_name,
        agent1_phone: updateData.agent1_phone ?? property.agent1_phone,
        agent2_name: updateData.agent2_name ?? property.agent2_name,
        agent2_phone: updateData.agent2_phone ?? property.agent2_phone,
        agent_email: updateData.agent_email ?? property.agent_email,
        neighbouring_suburb: updateData.neighbouring_suburb ?? property.neighbouring_suburb,
        neighbouring_postcode: updateData.neighbouring_postcode ?? property.neighbouring_postcode,
        neighbouring_state: updateData.neighbouring_state ?? property.neighbouring_state
      }
    );

    const updated = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (updated) {
      updated.images = updated.images ? JSON.parse(updated.images as any) : [];
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Update property error:', error);
    res.status(500).json({ detail: 'Failed to update property' });
  }
});

// PATCH /api/properties/:propertyId
router.patch('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const updateData = req.body;

    const allowedFields = ['latitude', 'longitude', 'status', 'is_favourite', 'tags', 'estimated_value_range'];
    const updates: string[] = [];
    const params: Record<string, any> = { id: propertyId };

    for (const key of Object.keys(updateData)) {
      if (allowedFields.includes(key)) {
        if (key === 'tags') {
          updates.push(`${key} = @${key}`);
          params[key] = JSON.stringify(updateData[key]);
        } else if (key === 'is_favourite') {
          updates.push(`${key} = @${key}`);
          params[key] = updateData[key] ? 1 : 0;
        } else {
          updates.push(`${key} = @${key}`);
          params[key] = updateData[key];
        }
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ detail: 'No valid fields to update' });
      return;
    }

    const rowsAffected = await execute(
      `UPDATE properties SET ${updates.join(', ')} WHERE id = @id`,
      params
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    const updated = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (updated) {
      updated.images = updated.images ? JSON.parse(updated.images as any) : [];
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Patch property error:', error.message || error);
    res.status(500).json({ detail: 'Failed to patch property: ' + (error.message || 'Unknown error') });
  }
});

// DELETE /api/properties/:propertyId
router.delete('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const userEmail = req.userEmail;

    const property = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    if (userEmail && property.user_email && property.user_email !== userEmail) {
      res.status(403).json({ detail: 'Access denied' });
      return;
    }

    await execute('DELETE FROM properties WHERE id = @id', { id: propertyId });

    res.json({ success: true, message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({ detail: 'Failed to delete property' });
  }
});

// POST /api/properties/:propertyId/generate-pitch
router.post('/:propertyId/generate-pitch', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;

    const property = await queryOne<Property>(
      'SELECT * FROM properties WHERE id = @id',
      { id: propertyId }
    );

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    const propertyDesc = `
      Location: ${property.location}
      Property Type: ${property.property_type || 'Residential'}
      Bedrooms: ${property.beds}
      Bathrooms: ${property.baths}
      Car Parks: ${property.carpark}
      Size: ${property.size ? property.size + ' sqm' : 'Not specified'}
      Price: ${property.price ? '$' + property.price.toLocaleString() : 'Contact agent'}
      Features: ${property.features || 'Modern property'}
    `;

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert Australian real estate copywriter. Create compelling property descriptions.`
        },
        {
          role: 'user',
          content: `Write a professional selling pitch for this property:\n${propertyDesc}`
        }
      ],
      max_tokens: 700,
      temperature: 0.7
    });

    const pitch = completion.choices[0]?.message?.content || 'Unable to generate pitch';

    await execute(
      'UPDATE properties SET pitch = @pitch WHERE id = @id',
      { pitch, id: propertyId }
    );

    res.json({ pitch, success: true });
  } catch (error: any) {
    console.error('Generate pitch error:', error);
    res.status(500).json({ detail: 'Failed to generate pitch' });
  }
});

// PUT /api/properties/:propertyId/update-pitch
router.put('/:propertyId/update-pitch', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { pitch } = req.body;

    if (!pitch || typeof pitch !== 'string') {
      res.status(400).json({ detail: 'Pitch is required' });
      return;
    }

    const rowsAffected = await execute(
      'UPDATE properties SET pitch = @pitch WHERE id = @id',
      { pitch, id: propertyId }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true, pitch });
  } catch (error) {
    console.error('Update pitch error:', error);
    res.status(500).json({ detail: 'Failed to update pitch' });
  }
});

// PUT /api/properties/:propertyId/update-rp-data
router.put('/:propertyId/update-rp-data', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { report } = req.body;

    if (!report || typeof report !== 'string') {
      res.status(400).json({ detail: 'Report content is required' });
      return;
    }

    const rowsAffected = await execute(
      `UPDATE properties SET rp_data_report = @report, rp_data_upload_date = @upload_date WHERE id = @id`,
      { report, upload_date: new Date(), id: propertyId }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update RP data error:', error);
    res.status(500).json({ detail: 'Failed to update RP data' });
  }
});

// POST /api/properties/:propertyId/mark-sold
router.post('/:propertyId/mark-sold', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { sold_price, sale_date } = req.body;

    if (!sold_price || typeof sold_price !== 'number' || sold_price <= 0) {
      res.status(400).json({ detail: 'Valid sold price is required' });
      return;
    }

    const rowsAffected = await execute(
      `UPDATE properties SET status = 'sold', sold_price = @sold_price, sale_date = @sale_date WHERE id = @id`,
      {
        sold_price,
        sale_date: sale_date || new Date().toISOString().split('T')[0],
        id: propertyId
      }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark as sold error:', error);
    res.status(500).json({ detail: 'Failed to mark property as sold' });
  }
});

// POST /api/properties/:propertyId/save-evaluation
router.post('/:propertyId/save-evaluation', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { evaluation_report, comparables_data, confidence_scoring, valuation_entry } = req.body;

    if (!evaluation_report || typeof evaluation_report !== 'string') {
      res.status(400).json({ detail: 'Evaluation report is required' });
      return;
    }

    // Extract estimated value range from evaluation report
    // Look for patterns like "$X - $Y", "$X to $Y", or "Estimated Value Range" section
    let estimated_value_range: string | null = null;

    // Pattern 1: Look for "Estimated Value Range" section with price range
    const estimatedValueMatch = evaluation_report.match(/estimated value range[^$]*(\$[\d,]+\s*[-–to]+\s*\$[\d,]+)/i);
    if (estimatedValueMatch) {
      estimated_value_range = estimatedValueMatch[1].replace(/\s+/g, ' ').trim();
    }

    // Pattern 2: Look for "value range is $X - $Y" or similar
    if (!estimated_value_range) {
      const valueRangeMatch = evaluation_report.match(/value range[^$]*is[^$]*(\$[\d,]+\s*[-–to]+\s*\$[\d,]+)/i);
      if (valueRangeMatch) {
        estimated_value_range = valueRangeMatch[1].replace(/\s+/g, ' ').trim();
      }
    }

    // Pattern 3: Look for RP Data estimated value pattern
    if (!estimated_value_range) {
      const rpDataMatch = evaluation_report.match(/RP Data[^$]*(\$[\d,]+\s*[-–to]+\s*\$[\d,]+)/i);
      if (rpDataMatch) {
        estimated_value_range = rpDataMatch[1].replace(/\s+/g, ' ').trim();
      }
    }

    // Pattern 4: Look for any price range in the format "$X - $Y" or "$X to $Y"
    if (!estimated_value_range) {
      const priceRangeMatch = evaluation_report.match(/(\$[\d,]+(?:,\d{3})*)\s*[-–to]+\s*(\$[\d,]+(?:,\d{3})*)/i);
      if (priceRangeMatch) {
        estimated_value_range = `${priceRangeMatch[1]} - ${priceRangeMatch[2]}`;
      }
    }

    if (estimated_value_range) {
      console.log(`[SaveEvaluation] Extracted estimated value range: ${estimated_value_range}`);
    }

    const valuation_history = valuation_entry ? JSON.stringify([valuation_entry]) : null;

    const rowsAffected = await execute(
      `UPDATE properties SET
        evaluation_report = @evaluation_report,
        evaluation_date = @evaluation_date,
        comparables_data = @comparables_data,
        confidence_scoring = @confidence_scoring,
        valuation_history = @valuation_history,
        estimated_value_range = @estimated_value_range,
        improvements_detected = NULL,
        evaluation_ad = NULL
       WHERE id = @id`,
      {
        evaluation_report,
        evaluation_date: new Date(),
        comparables_data: comparables_data ? JSON.stringify(comparables_data) : null,
        confidence_scoring: confidence_scoring ? JSON.stringify(confidence_scoring) : null,
        valuation_history,
        estimated_value_range,
        id: propertyId
      }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    console.log(`[SaveEvaluation] Saved evaluation for property ${propertyId}`);
    res.json({ success: true, estimated_value_range });
  } catch (error) {
    console.error('Save evaluation error:', error);
    res.status(500).json({ detail: 'Failed to save evaluation' });
  }
});

// POST /api/properties/:propertyId/apply-valuation
router.post('/:propertyId/apply-valuation', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { market_value } = req.body;

    if (!market_value || typeof market_value !== 'number' || market_value <= 0) {
      res.status(400).json({ detail: 'Valid market value is required' });
      return;
    }

    const rowsAffected = await execute(
      'UPDATE properties SET price = @price WHERE id = @id',
      { price: market_value, id: propertyId }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true, price: market_value });
  } catch (error) {
    console.error('Apply valuation error:', error);
    res.status(500).json({ detail: 'Failed to apply valuation' });
  }
});

export default router;
