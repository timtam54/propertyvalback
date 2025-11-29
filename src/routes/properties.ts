import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../utils/database';
import { extractUserEmail } from '../middleware/auth';
import { Property, PropertyCreate } from '../models/types';

const router = Router();

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

export default router;
