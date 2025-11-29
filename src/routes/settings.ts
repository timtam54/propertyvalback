import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';
import { extractUserEmail } from '../middleware/auth';
import { MarketContext, MarketingPackage } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use(extractUserEmail);

// GET /api/agent-settings (alias for frontend compatibility)
router.get('/agent-settings', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = await db.collection('settings').findOne({ setting_id: 'agent_settings' });

    if (!settings) {
      res.json({
        success: true,
        settings: {
          agent1_name: '',
          agent1_phone: '',
          agent2_name: '',
          agent2_phone: '',
          agent_email: ''
        }
      });
      return;
    }

    const { _id, setting_id, ...agentData } = settings;
    res.json({ success: true, settings: agentData });
  } catch (error) {
    console.error('Get agent settings error:', error);
    res.status(500).json({ detail: 'Failed to get agent settings' });
  }
});

// POST /api/agent-settings (alias for frontend compatibility)
router.post('/agent-settings', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    const db = getDb();

    await db.collection('settings').updateOne(
      { setting_id: 'agent_settings' },
      { $set: { ...settings, setting_id: 'agent_settings' } },
      { upsert: true }
    );

    res.json({ success: true, ...settings });
  } catch (error) {
    console.error('Update agent settings error:', error);
    res.status(500).json({ detail: 'Failed to update agent settings' });
  }
});

// GET /api/settings/agent
router.get('/agent', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = await db.collection('settings').findOne({ setting_id: 'agent_settings' });

    if (!settings) {
      res.json({
        agent1_name: '',
        agent1_phone: '',
        agent2_name: '',
        agent2_phone: '',
        agent_email: ''
      });
      return;
    }

    res.json(settings);
  } catch (error) {
    console.error('Get agent settings error:', error);
    res.status(500).json({ detail: 'Failed to get agent settings' });
  }
});

// PUT /api/settings/agent
router.put('/agent', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    const db = getDb();

    await db.collection('settings').updateOne(
      { setting_id: 'agent_settings' },
      { $set: { ...settings, setting_id: 'agent_settings' } },
      { upsert: true }
    );

    res.json({ success: true, ...settings });
  } catch (error) {
    console.error('Update agent settings error:', error);
    res.status(500).json({ detail: 'Failed to update agent settings' });
  }
});

// GET /api/settings/api-keys
router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = await db.collection('settings').findOne({ setting_id: 'api_keys' });

    if (!settings) {
      res.json({
        domain_api_key: null,
        corelogic_client_key: null,
        corelogic_secret_key: null,
        realestate_api_key: null,
        pricefinder_api_key: null,
        google_places_api_key: null
      });
      return;
    }

    // Mask keys for security
    const maskedSettings: any = {};
    for (const [key, value] of Object.entries(settings)) {
      if (key === '_id' || key === 'setting_id') continue;
      if (typeof value === 'string' && value.length > 8) {
        maskedSettings[key] = value.substring(0, 4) + '****' + value.substring(value.length - 4);
      } else {
        maskedSettings[key] = value;
      }
    }

    res.json(maskedSettings);
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ detail: 'Failed to get API keys' });
  }
});

// PUT /api/settings/api-keys
router.put('/api-keys', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    const db = getDb();

    settings.updated_at = new Date();

    await db.collection('settings').updateOne(
      { setting_id: 'api_keys' },
      { $set: { ...settings, setting_id: 'api_keys' } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update API keys error:', error);
    res.status(500).json({ detail: 'Failed to update API keys' });
  }
});

// GET /api/settings/market-context
router.get('/market-context', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const context = await db.collection('settings').findOne({ setting_id: 'market_context' });

    if (!context) {
      // Return defaults
      const defaultContext: Partial<MarketContext> = {
        rba_interest_rate: 3.60,
        housing_shortage_national: 175000,
        housing_shortage_nsw: 70000,
        housing_shortage_vic: 60000,
        housing_shortage_qld: 30000,
        housing_shortage_wa: 15000,
        housing_shortage_sa: 10000,
        annual_growth_rate_min: 8.0,
        annual_growth_rate_max: 12.0,
        net_migration: 400000,
        construction_shortfall: 50000,
        rental_vacancy_rate: 1.5,
        auction_clearance_rate: 70.0,
        days_on_market: 28,
        scarcity_premium_min: 15.0,
        scarcity_premium_max: 25.0,
        last_updated: new Date(),
        updated_by: 'system'
      };
      res.json(defaultContext);
      return;
    }

    const { _id, setting_id, ...contextData } = context;
    res.json(contextData);
  } catch (error) {
    console.error('Get market context error:', error);
    res.status(500).json({ detail: 'Failed to get market context' });
  }
});

// PUT /api/settings/market-context
router.put('/market-context', async (req: Request, res: Response) => {
  try {
    const context = req.body;
    const db = getDb();

    context.last_updated = new Date();
    context.updated_by = 'manual';

    await db.collection('settings').updateOne(
      { setting_id: 'market_context' },
      { $set: { ...context, setting_id: 'market_context' } },
      { upsert: true }
    );

    res.json({ success: true, ...context });
  } catch (error) {
    console.error('Update market context error:', error);
    res.status(500).json({ detail: 'Failed to update market context' });
  }
});

// GET /api/marketing-packages
router.get('/marketing-packages', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const packages = await db
      .collection<MarketingPackage>('marketing_packages')
      .find({ active: true }, { projection: { _id: 0 } })
      .sort({ order: 1 })
      .toArray();

    res.json({ success: true, packages });
  } catch (error) {
    console.error('Get marketing packages error:', error);
    res.status(500).json({ detail: 'Failed to get marketing packages' });
  }
});

// POST /api/marketing-packages
router.post('/marketing-packages', async (req: Request, res: Response) => {
  try {
    const packageData = req.body;
    const db = getDb();

    const pkg: MarketingPackage = {
      id: uuidv4(),
      name: packageData.name,
      price: packageData.price || 0,
      inclusions: packageData.inclusions || [],
      description: packageData.description || null,
      order: packageData.order || 0,
      active: true,
      created_at: new Date()
    };

    await db.collection<MarketingPackage>('marketing_packages').insertOne(pkg);

    res.status(201).json(pkg);
  } catch (error) {
    console.error('Create marketing package error:', error);
    res.status(500).json({ detail: 'Failed to create marketing package' });
  }
});

// PUT /api/marketing-packages/:packageId
router.put('/marketing-packages/:packageId', async (req: Request, res: Response) => {
  try {
    const { packageId } = req.params;
    const updateData = req.body;
    const db = getDb();

    await db.collection<MarketingPackage>('marketing_packages').updateOne(
      { id: packageId },
      { $set: updateData }
    );

    const updatedPkg = await db
      .collection<MarketingPackage>('marketing_packages')
      .findOne({ id: packageId }, { projection: { _id: 0 } });

    if (!updatedPkg) {
      res.status(404).json({ detail: 'Marketing package not found' });
      return;
    }

    res.json(updatedPkg);
  } catch (error) {
    console.error('Update marketing package error:', error);
    res.status(500).json({ detail: 'Failed to update marketing package' });
  }
});

// DELETE /api/marketing-packages/:packageId
router.delete('/marketing-packages/:packageId', async (req: Request, res: Response) => {
  try {
    const { packageId } = req.params;
    const db = getDb();

    // Soft delete by setting active to false
    const result = await db.collection<MarketingPackage>('marketing_packages').updateOne(
      { id: packageId },
      { $set: { active: false } }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ detail: 'Marketing package not found' });
      return;
    }

    res.json({ success: true, message: 'Marketing package deleted' });
  } catch (error) {
    console.error('Delete marketing package error:', error);
    res.status(500).json({ detail: 'Failed to delete marketing package' });
  }
});

export default router;
