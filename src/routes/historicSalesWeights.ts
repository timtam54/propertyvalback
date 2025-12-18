import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';
import { HistoricSalesWeights, DEFAULT_HISTORIC_SALES_WEIGHTS } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * GET /api/historic-sales-weights
 * Get the active weights configuration
 * Returns default weights if none exist in database
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    // Find active weights
    let weights = await collection.findOne({ is_active: true });

    // If no weights exist, create default weights
    if (!weights) {
      const now = new Date();
      const defaultWeights: HistoricSalesWeights = {
        ...DEFAULT_HISTORIC_SALES_WEIGHTS,
        id: uuidv4(),
        created_at: now,
        updated_at: now,
      };

      await collection.insertOne(defaultWeights);
      weights = defaultWeights;
      console.log('[Historic Sales Weights] Created default weights');
    }

    res.json(weights);
  } catch (error) {
    console.error('Error fetching historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to fetch weights' });
  }
});

/**
 * GET /api/historic-sales-weights/all
 * Get all weights configurations (for admin/history)
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const allWeights = await collection
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    res.json(allWeights);
  } catch (error) {
    console.error('Error fetching all historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to fetch weights' });
  }
});

/**
 * POST /api/historic-sales-weights
 * Create new weights configuration
 * Automatically deactivates previous active weights
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const now = new Date();
    const newWeights: HistoricSalesWeights = {
      ...DEFAULT_HISTORIC_SALES_WEIGHTS, // Start with defaults
      ...req.body,                        // Override with provided values
      id: uuidv4(),
      created_at: now,
      updated_at: now,
      is_active: true,
    };

    // Deactivate all existing active weights
    await collection.updateMany(
      { is_active: true },
      { $set: { is_active: false, updated_at: now } }
    );

    // Insert new weights
    await collection.insertOne(newWeights);

    console.log(`[Historic Sales Weights] Created new weights: ${newWeights.name}`);
    res.status(201).json(newWeights);
  } catch (error) {
    console.error('Error creating historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to create weights' });
  }
});

/**
 * PUT /api/historic-sales-weights/:id
 * Update existing weights configuration
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const existing = await collection.findOne({ id });
    if (!existing) {
      return res.status(404).json({ detail: 'Weights configuration not found' });
    }

    const now = new Date();
    const updates = {
      ...req.body,
      id, // Preserve ID
      created_at: existing.created_at, // Preserve created_at
      updated_at: now,
    };

    // If activating this config, deactivate others
    if (updates.is_active) {
      await collection.updateMany(
        { is_active: true, id: { $ne: id } },
        { $set: { is_active: false, updated_at: now } }
      );
    }

    await collection.updateOne({ id }, { $set: updates });

    const updated = await collection.findOne({ id });
    console.log(`[Historic Sales Weights] Updated weights: ${id}`);
    res.json(updated);
  } catch (error) {
    console.error('Error updating historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to update weights' });
  }
});

/**
 * POST /api/historic-sales-weights/:id/activate
 * Activate a specific weights configuration
 */
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const existing = await collection.findOne({ id });
    if (!existing) {
      return res.status(404).json({ detail: 'Weights configuration not found' });
    }

    const now = new Date();

    // Deactivate all others
    await collection.updateMany(
      { is_active: true },
      { $set: { is_active: false, updated_at: now } }
    );

    // Activate this one
    await collection.updateOne(
      { id },
      { $set: { is_active: true, updated_at: now } }
    );

    const activated = await collection.findOne({ id });
    console.log(`[Historic Sales Weights] Activated weights: ${id}`);
    res.json(activated);
  } catch (error) {
    console.error('Error activating historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to activate weights' });
  }
});

/**
 * DELETE /api/historic-sales-weights/:id
 * Delete a weights configuration (cannot delete active config)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const existing = await collection.findOne({ id });
    if (!existing) {
      return res.status(404).json({ detail: 'Weights configuration not found' });
    }

    if (existing.is_active) {
      return res.status(400).json({ detail: 'Cannot delete active weights configuration' });
    }

    await collection.deleteOne({ id });
    console.log(`[Historic Sales Weights] Deleted weights: ${id}`);
    res.json({ message: 'Weights configuration deleted' });
  } catch (error) {
    console.error('Error deleting historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to delete weights' });
  }
});

/**
 * POST /api/historic-sales-weights/reset
 * Reset to default weights
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const collection = db.collection<HistoricSalesWeights>('historic_sales_weights');

    const now = new Date();

    // Deactivate all existing
    await collection.updateMany(
      { is_active: true },
      { $set: { is_active: false, updated_at: now } }
    );

    // Create fresh default weights
    const defaultWeights: HistoricSalesWeights = {
      ...DEFAULT_HISTORIC_SALES_WEIGHTS,
      id: uuidv4(),
      name: 'default_reset_' + now.toISOString().split('T')[0],
      description: 'Reset to default weights',
      created_at: now,
      updated_at: now,
    };

    await collection.insertOne(defaultWeights);

    console.log(`[Historic Sales Weights] Reset to defaults`);
    res.json(defaultWeights);
  } catch (error) {
    console.error('Error resetting historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to reset weights' });
  }
});

export default router;
