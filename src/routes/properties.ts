import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../utils/database';
import { extractUserEmail } from '../middleware/auth';
import { Property, PropertyCreate } from '../models/types';
import OpenAI from 'openai';
import multer from 'multer';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require('pdf-parse');

const router = Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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

// POST /api/properties
router.post('/', async (req: Request, res: Response) => {
  try {
    const propertyData = req.body as PropertyCreate;
    const userEmail = req.userEmail;

    const property: Property = {
      id: uuidv4(),
      beds: propertyData.beds,
      baths: propertyData.baths,
      carpark: propertyData.carpark,
      location: propertyData.location,
      price: propertyData.price || null,
      size: propertyData.size || null,
      property_type: propertyData.property_type || null,
      features: propertyData.features || null,
      strata_body_corps: propertyData.strata_body_corps || null,
      council_rates: propertyData.council_rates || null,
      images: propertyData.images || [],
      pitch: null,
      agent1_name: propertyData.agent1_name || null,
      agent1_phone: propertyData.agent1_phone || null,
      agent2_name: propertyData.agent2_name || null,
      agent2_phone: propertyData.agent2_phone || null,
      agent_email: propertyData.agent_email || null,
      evaluation_report: null,
      evaluation_date: null,
      improvements_detected: null,
      evaluation_ad: null,
      pricing_type: null,
      price_upper: null,
      marketing_strategy: null,
      marketing_package: null,
      marketing_cost: null,
      marketing_report: null,
      marketing_report_date: null,
      rp_data_report: null,
      rp_data_upload_date: null,
      rp_data_filename: null,
      agent_id: null,
      agent_name: null,
      agency_id: 'default_agency',
      user_email: userEmail || propertyData.user_email || null,
      created_at: new Date()
    };

    // Check document size (MongoDB has 16MB limit)
    const docString = JSON.stringify(property);
    const docSize = Buffer.byteLength(docString, 'utf8');
    const maxSize = 15 * 1024 * 1024; // 15MB to be safe

    if (docSize > maxSize) {
      const numImages = property.images.length;
      res.status(413).json({
        detail: `Property data too large (${(docSize / 1024 / 1024).toFixed(1)}MB). Limit is 15MB. You have ${numImages} images. Please reduce to maximum 10-15 images.`
      });
      return;
    }

    const db = getDb();
    await db.collection<Property>('properties').insertOne(property);

    res.status(201).json(property);
  } catch (error: any) {
    console.error('Create property error:', error);
    if (error.message?.includes('DocumentTooLarge')) {
      res.status(413).json({
        detail: 'Failed to create property: Too many images. Please reduce to maximum 10-15 images.'
      });
      return;
    }
    res.status(500).json({ detail: 'Failed to create property' });
  }
});

// GET /api/properties
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const properties = await db
      .collection<Property>('properties')
      .find({}, { projection: { _id: 0 } })
      .limit(1000)
      .toArray();

    res.json(properties);
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ detail: 'Failed to get properties' });
  }
});

// GET /api/properties/:propertyId
router.get('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const userEmail = req.userEmail;

    const db = getDb();

    // Build query to check both property existence and ownership
    const query: any = { id: propertyId };
    if (userEmail) {
      query.user_email = userEmail;
    }

    const property = await db
      .collection<Property>('properties')
      .findOne(query, { projection: { _id: 0 } });

    if (!property) {
      // Check if property exists but belongs to different user
      const existingProp = await db
        .collection<Property>('properties')
        .findOne({ id: propertyId }, { projection: { _id: 0 } });

      if (existingProp) {
        res.status(403).json({ detail: 'Access denied: You can only view your own properties' });
        return;
      }
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

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

    const db = getDb();

    // Build query to check both property existence and ownership
    const query: any = { id: propertyId };
    if (userEmail) {
      query.user_email = userEmail;
    }

    const property = await db
      .collection<Property>('properties')
      .findOne(query, { projection: { _id: 0 } });

    if (!property) {
      // Check if property exists but belongs to different user
      const existingProp = await db
        .collection<Property>('properties')
        .findOne({ id: propertyId }, { projection: { _id: 0 } });

      if (existingProp) {
        res.status(403).json({ detail: 'Access denied: You can only update your own properties' });
        return;
      }
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    // Check document size
    const docString = JSON.stringify(updateData);
    const docSize = Buffer.byteLength(docString, 'utf8');
    const maxSize = 15 * 1024 * 1024;

    if (docSize > maxSize) {
      const numImages = updateData.images?.length || 0;
      res.status(413).json({
        detail: `Property data too large (${(docSize / 1024 / 1024).toFixed(1)}MB). Limit is 15MB. You have ${numImages} images. Please reduce to maximum 10-15 images.`
      });
      return;
    }

    await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: updateData }
    );

    // Get updated property
    const updatedProperty = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

    res.json(updatedProperty);
  } catch (error: any) {
    console.error('Update property error:', error);
    if (error.message?.includes('DocumentTooLarge')) {
      res.status(413).json({
        detail: 'Property update failed: Too many images. Please reduce to maximum 10-15 images.'
      });
      return;
    }
    res.status(500).json({ detail: 'Failed to update property' });
  }
});

// DELETE /api/properties/:propertyId
router.delete('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const userEmail = req.userEmail;

    const db = getDb();

    // Build query to check both property existence and ownership
    const query: any = { id: propertyId };
    if (userEmail) {
      query.user_email = userEmail;
    }

    const property = await db
      .collection<Property>('properties')
      .findOne(query, { projection: { _id: 0 } });

    if (!property) {
      // Check if property exists but belongs to different user
      const existingProp = await db
        .collection<Property>('properties')
        .findOne({ id: propertyId }, { projection: { _id: 0 } });

      if (existingProp) {
        res.status(403).json({ detail: 'Access denied: You can only delete your own properties' });
        return;
      }
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    const result = await db.collection<Property>('properties').deleteOne(query);

    if (result.deletedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

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
    const db = getDb();

    const property = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    // Build property description for OpenAI
    const propertyDesc = `
      Location: ${property.location}
      Property Type: ${property.property_type || 'Residential'}
      Bedrooms: ${property.beds}
      Bathrooms: ${property.baths}
      Car Parks: ${property.carpark}
      Size: ${property.size ? property.size + ' sqm' : 'Not specified'}
      Price: ${property.price ? '$' + property.price.toLocaleString() : 'Contact agent'}
      Features: ${property.features || 'Modern property with great potential'}
      ${property.rp_data_report ? 'Market Data: ' + property.rp_data_report.substring(0, 500) : ''}
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert Australian real estate copywriter specializing in premium property marketing. Create compelling, sophisticated property descriptions that:
- Use evocative, descriptive language that paints a picture of the lifestyle
- Highlight unique architectural features, views, and premium finishes
- Emphasize location benefits (proximity to beaches, cafes, transport, schools)
- Include specific details about room layouts, storage, and practical features
- Appeal to the target buyer demographic (professionals, families, downsizers, investors)
- Use flowing, elegant prose without bullet points
- Create a sense of exclusivity and desirability
- Write 2-3 substantial paragraphs that read like premium marketing copy
- Reference local landmarks, suburbs, and lifestyle benefits specific to the area`
        },
        {
          role: 'user',
          content: `Write a professional, sophisticated selling pitch for this Australian property. Make it read like high-end real estate marketing copy:\n${propertyDesc}`
        }
      ],
      max_tokens: 700,
      temperature: 0.7
    });

    const pitch = completion.choices[0]?.message?.content || 'Unable to generate pitch';

    // Update property with new pitch
    await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { pitch } }
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

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { pitch } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true, pitch });
  } catch (error) {
    console.error('Update pitch error:', error);
    res.status(500).json({ detail: 'Failed to update pitch' });
  }
});

// POST /api/properties/:propertyId/generate-facebook-ad
router.post('/:propertyId/generate-facebook-ad', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const db = getDb();

    const property = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert Facebook ads copywriter for Australian real estate. Create compelling ad copy that drives clicks and inquiries. Return a JSON object with: headline (max 40 chars), primary_text (engaging hook, max 125 chars), description (key benefits, max 30 chars), call_to_action (one of: LEARN_MORE, BOOK_NOW, CONTACT_US, GET_QUOTE)'
        },
        {
          role: 'user',
          content: `Create Facebook ad copy for this property:\n${propertyDesc}\n\nReturn only valid JSON.`
        }
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    let adCopy;
    try {
      const content = completion.choices[0]?.message?.content || '{}';
      // Remove markdown code blocks if present
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      adCopy = JSON.parse(cleanedContent);
    } catch {
      adCopy = {
        headline: `${property.beds} Bed Home in ${property.location.split(',')[0]}`,
        primary_text: `Don't miss this stunning ${property.beds} bedroom property! Perfect for families.`,
        description: 'Inquire today',
        call_to_action: 'LEARN_MORE'
      };
    }

    res.json({ ad_copy: adCopy, success: true });
  } catch (error: any) {
    console.error('Generate Facebook ad error:', error);
    res.status(500).json({ detail: 'Failed to generate Facebook ad' });
  }
});

// POST /api/properties/:propertyId/generate-facebook-post
router.post('/:propertyId/generate-facebook-post', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const db = getDb();

    const property = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

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
      Features: ${property.features || 'Modern property with great potential'}
      Agent: ${property.agent1_name || 'Your Local Agent'}
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert social media manager for Australian real estate. Create engaging Facebook posts that generate interest and shares. Include relevant emojis, property highlights, and a clear call to action. Format for readability with line breaks.'
        },
        {
          role: 'user',
          content: `Create an engaging Facebook post for this property listing:\n${propertyDesc}`
        }
      ],
      max_tokens: 400,
      temperature: 0.7
    });

    const postContent = completion.choices[0]?.message?.content || 'Unable to generate post';

    res.json({ post_content: postContent, success: true });
  } catch (error: any) {
    console.error('Generate Facebook post error:', error);
    res.status(500).json({ detail: 'Failed to generate Facebook post' });
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

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      {
        $set: {
          rp_data_report: report,
          rp_data_upload_date: new Date().toISOString()
        }
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update RP data error:', error);
    res.status(500).json({ detail: 'Failed to update RP data' });
  }
});

// POST /api/properties/:propertyId/upload-rp-data-pdf
router.post('/:propertyId/upload-rp-data-pdf', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;

    if (!req.file) {
      res.status(400).json({ detail: 'PDF file is required' });
      return;
    }

    // Parse PDF content
    let pdfText = '';
    try {
      const pdfData = await pdf(req.file.buffer);
      pdfText = pdfData.text;
    } catch (pdfError) {
      console.error('PDF parsing error:', pdfError);
      res.status(400).json({ detail: 'Failed to parse PDF file' });
      return;
    }

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      {
        $set: {
          rp_data_report: pdfText,
          rp_data_upload_date: new Date().toISOString(),
          rp_data_filename: req.file.originalname
        }
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true, filename: req.file.originalname });
  } catch (error) {
    console.error('Upload RP data PDF error:', error);
    res.status(500).json({ detail: 'Failed to upload PDF' });
  }
});

// PUT /api/properties/:propertyId/update-additional-report
router.put('/:propertyId/update-additional-report', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { report } = req.body;

    if (!report || typeof report !== 'string') {
      res.status(400).json({ detail: 'Report content is required' });
      return;
    }

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { additional_report: report } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update additional report error:', error);
    res.status(500).json({ detail: 'Failed to update additional report' });
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

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      {
        $set: {
          status: 'sold',
          sold_price,
          sale_date: sale_date || new Date().toISOString().split('T')[0]
        }
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark as sold error:', error);
    res.status(500).json({ detail: 'Failed to mark property as sold' });
  }
});

// POST /api/properties/:propertyId/evaluate - Property Valuation using AI
router.post('/:propertyId/evaluate', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const db = getDb();

    const property = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    // Build property description for evaluation
    const propertyDesc = `
      Location: ${property.location}
      Property Type: ${property.property_type || 'Residential'}
      Bedrooms: ${property.beds}
      Bathrooms: ${property.baths}
      Car Parks: ${property.carpark}
      Size: ${property.size ? property.size + ' sqm' : 'Not specified'}
      Current List Price: ${property.price ? '$' + property.price.toLocaleString() : 'Not set'}
      Features: ${property.features || 'Standard property'}
      ${property.rp_data_report ? 'RP Data/Market Report:\n' + property.rp_data_report.substring(0, 2000) : ''}
    `;

    // First, analyze images for improvements if available
    let improvementsDetected = '';
    if (property.images && property.images.length > 0) {
      try {
        const imageAnalysis = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert property appraiser analyzing property photos. Identify visible improvements, renovations, and features that would add value. List specific items like:
- Modern kitchen upgrades (stone benchtops, quality appliances)
- Bathroom renovations
- Flooring upgrades
- Built-in wardrobes
- Air conditioning
- Outdoor entertaining areas
- Pool, landscaping
- Security systems
- Solar panels
Be specific and estimate value impact where possible.`
            },
            {
              role: 'user',
              content: `Based on a ${property.beds} bed, ${property.baths} bath property in ${property.location}, list likely improvements and their estimated value impact. Property type: ${property.property_type || 'House'}.`
            }
          ],
          max_tokens: 500,
          temperature: 0.7
        });
        improvementsDetected = imageAnalysis.choices[0]?.message?.content || '';
      } catch (imgError) {
        console.error('Image analysis error:', imgError);
      }
    }

    // Generate comprehensive evaluation report
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert Australian property valuer creating a comprehensive valuation report. Generate a detailed report with these sections:

1. ESTIMATED VALUE
- Lower Estimate: $XXX,XXX (conservative, quick sale scenario)
- Market Value: $XXX,XXX (most likely price based on current market)
- Upper Estimate: $XXX,XXX (premium buyer, perfect conditions)

2. VALUATION METHODOLOGY
- Comparable sales analysis
- Market conditions assessment
- Property-specific adjustments

3. KEY VALUE DRIVERS
- Location benefits
- Property features
- Market demand factors

4. MARKET POSITION
- Current market conditions
- Days on market expectations
- Target buyer profile

5. POSITIONING ADVICE
- Recommended pricing strategy (Offers Over, Fixed Price, etc.)
- Marketing approach
- Key selling points to emphasize

Use realistic Australian property values based on the location and property type. Reference current RBA rates (around 4.35%) and market conditions.`
        },
        {
          role: 'user',
          content: `Create a comprehensive property valuation report for:\n${propertyDesc}\n\n${improvementsDetected ? 'Detected Improvements:\n' + improvementsDetected : ''}`
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    });

    const evaluationReport = completion.choices[0]?.message?.content || 'Unable to generate evaluation';

    // Update property with evaluation data
    await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      {
        $set: {
          evaluation_report: evaluationReport,
          evaluation_date: new Date().toISOString(),
          improvements_detected: improvementsDetected || null
        }
      }
    );

    res.json({
      evaluation_report: evaluationReport,
      improvements_detected: improvementsDetected || null,
      success: true
    });
  } catch (error: any) {
    console.error('Evaluate property error:', error);
    res.status(500).json({ detail: 'Failed to evaluate property: ' + (error.message || 'Unknown error') });
  }
});

// POST /api/properties/:propertyId/update-evaluation-report
router.post('/:propertyId/update-evaluation-report', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { evaluation_report } = req.body;

    if (!evaluation_report || typeof evaluation_report !== 'string') {
      res.status(400).json({ detail: 'Evaluation report is required' });
      return;
    }

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { evaluation_report } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update evaluation report error:', error);
    res.status(500).json({ detail: 'Failed to update evaluation report' });
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

    const db = getDb();

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { price: market_value } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true, price: market_value });
  } catch (error) {
    console.error('Apply valuation error:', error);
    res.status(500).json({ detail: 'Failed to apply valuation' });
  }
});

// POST /api/properties/:propertyId/apply-marketing-strategy
router.post('/:propertyId/apply-marketing-strategy', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { marketing_strategy, pricing_type, price, price_upper } = req.body;

    if (!marketing_strategy || typeof marketing_strategy !== 'string') {
      res.status(400).json({ detail: 'Marketing strategy is required' });
      return;
    }

    const db = getDb();

    const updateData: any = {
      marketing_strategy,
      pricing_type: pricing_type || 'offers_over'
    };

    if (price && typeof price === 'number') {
      updateData.price = price;
    }
    if (price_upper && typeof price_upper === 'number') {
      updateData.price_upper = price_upper;
    }

    const result = await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Apply marketing strategy error:', error);
    res.status(500).json({ detail: 'Failed to apply marketing strategy' });
  }
});

// POST /api/properties/:propertyId/generate-evaluation-ad
router.post('/:propertyId/generate-evaluation-ad', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const db = getDb();

    const property = await db
      .collection<Property>('properties')
      .findOne({ id: propertyId }, { projection: { _id: 0 } });

    if (!property) {
      res.status(404).json({ detail: 'Property not found' });
      return;
    }

    if (!property.evaluation_report) {
      res.status(400).json({ detail: 'Property must be evaluated first' });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert real estate marketing copywriter. Create a compelling Facebook/social media ad based on the property evaluation. The ad should:
- Highlight the key value propositions from the evaluation
- Use persuasive, engaging language
- Include a clear call to action
- Be suitable for Facebook/Instagram advertising
- Use emojis strategically for engagement
- Be 150-250 words`
        },
        {
          role: 'user',
          content: `Create a marketing ad for this property based on its evaluation:

Location: ${property.location}
${property.beds} beds, ${property.baths} baths, ${property.carpark} car
Price: ${property.price ? '$' + property.price.toLocaleString() : 'Contact agent'}

Evaluation Report:
${property.evaluation_report.substring(0, 1500)}`
        }
      ],
      max_tokens: 400,
      temperature: 0.7
    });

    const adContent = completion.choices[0]?.message?.content || 'Unable to generate ad';

    // Save the ad to the property
    await db.collection<Property>('properties').updateOne(
      { id: propertyId },
      { $set: { evaluation_ad: adContent } }
    );

    res.json({ ad_content: adContent, success: true });
  } catch (error: any) {
    console.error('Generate evaluation ad error:', error);
    res.status(500).json({ detail: 'Failed to generate ad: ' + (error.message || 'Unknown error') });
  }
});

export default router;
