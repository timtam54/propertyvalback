import { Router, Request, Response } from 'express';
import { queryOne, queryMany, execute } from '../utils/database';
import { HistoricSalesWeights, DEFAULT_HISTORIC_SALES_WEIGHTS } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Store weights as JSON in settings table for simplicity
const WEIGHTS_SETTING_ID = 'historic_sales_weights';

interface WeightsSetting {
  setting_id: string;
  setting_data: string;
  updated_at: Date;
}

function parseWeights(setting: WeightsSetting | null): HistoricSalesWeights | null {
  if (!setting || !setting.setting_data) return null;
  try {
    return JSON.parse(setting.setting_data);
  } catch {
    return null;
  }
}

/**
 * GET /api/historic-sales-weights
 * Get the active weights configuration
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<WeightsSetting>(
      `SELECT * FROM settings WHERE setting_id = @id`,
      { id: WEIGHTS_SETTING_ID }
    );

    let weights = parseWeights(setting);

    if (!weights) {
      // Create default weights
      const now = new Date();
      const defaultWeights: HistoricSalesWeights = {
        ...DEFAULT_HISTORIC_SALES_WEIGHTS,
        id: uuidv4(),
        created_at: now,
        updated_at: now,
      };

      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES (@id, @data, @updated_at)`,
        { id: WEIGHTS_SETTING_ID, data: JSON.stringify(defaultWeights), updated_at: now }
      );

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
 * Note: With SQL we only store the current active config
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<WeightsSetting>(
      `SELECT * FROM settings WHERE setting_id = @id`,
      { id: WEIGHTS_SETTING_ID }
    );

    const weights = parseWeights(setting);
    res.json(weights ? [weights] : []);
  } catch (error) {
    console.error('Error fetching all historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to fetch weights' });
  }
});

/**
 * POST /api/historic-sales-weights
 * Create/update weights configuration
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const newWeights: HistoricSalesWeights = {
      ...DEFAULT_HISTORIC_SALES_WEIGHTS,
      ...req.body,
      id: uuidv4(),
      created_at: now,
      updated_at: now,
      is_active: true,
    };

    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = @id`,
      { id: WEIGHTS_SETTING_ID }
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = @id`,
        { id: WEIGHTS_SETTING_ID, data: JSON.stringify(newWeights), updated_at: now }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES (@id, @data, @updated_at)`,
        { id: WEIGHTS_SETTING_ID, data: JSON.stringify(newWeights), updated_at: now }
      );
    }

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

    const setting = await queryOne<WeightsSetting>(
      `SELECT * FROM settings WHERE setting_id = @settingId`,
      { settingId: WEIGHTS_SETTING_ID }
    );

    const existing = parseWeights(setting);
    if (!existing || existing.id !== id) {
      return res.status(404).json({ detail: 'Weights configuration not found' });
    }

    const now = new Date();
    const updates: HistoricSalesWeights = {
      ...existing,
      ...req.body,
      id,
      created_at: existing.created_at,
      updated_at: now,
    };

    await execute(
      `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = @settingId`,
      { settingId: WEIGHTS_SETTING_ID, data: JSON.stringify(updates), updated_at: now }
    );

    console.log(`[Historic Sales Weights] Updated weights: ${id}`);
    res.json(updates);
  } catch (error) {
    console.error('Error updating historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to update weights' });
  }
});

/**
 * POST /api/historic-sales-weights/:id/activate
 * Activate a specific weights configuration (no-op for single config)
 */
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<WeightsSetting>(
      `SELECT * FROM settings WHERE setting_id = @id`,
      { id: WEIGHTS_SETTING_ID }
    );

    const weights = parseWeights(setting);
    if (!weights) {
      return res.status(404).json({ detail: 'Weights configuration not found' });
    }

    res.json(weights);
  } catch (error) {
    console.error('Error activating historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to activate weights' });
  }
});

/**
 * DELETE /api/historic-sales-weights/:id
 * Delete not supported - just reset to defaults instead
 */
router.delete('/:id', async (req: Request, res: Response) => {
  return res.status(400).json({ detail: 'Cannot delete weights. Use reset instead.' });
});

/**
 * POST /api/historic-sales-weights/reset
 * Reset to default weights
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const defaultWeights: HistoricSalesWeights = {
      ...DEFAULT_HISTORIC_SALES_WEIGHTS,
      id: uuidv4(),
      name: 'default_reset_' + now.toISOString().split('T')[0],
      description: 'Reset to default weights',
      created_at: now,
      updated_at: now,
    };

    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = @id`,
      { id: WEIGHTS_SETTING_ID }
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = @id`,
        { id: WEIGHTS_SETTING_ID, data: JSON.stringify(defaultWeights), updated_at: now }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES (@id, @data, @updated_at)`,
        { id: WEIGHTS_SETTING_ID, data: JSON.stringify(defaultWeights), updated_at: now }
      );
    }

    console.log(`[Historic Sales Weights] Reset to defaults`);
    res.json(defaultWeights);
  } catch (error) {
    console.error('Error resetting historic sales weights:', error);
    res.status(500).json({ detail: 'Failed to reset weights' });
  }
});

export default router;
