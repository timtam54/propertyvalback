import { Router, Request, Response } from 'express';
import { queryOne, queryMany, execute } from '../utils/database';
import { extractUserEmail } from '../middleware/auth';
import { MarketContext, MarketingPackage } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use(extractUserEmail);

// Helper to parse JSON from setting_data column
function parseSettingData(setting: { setting_id: string; setting_data: string | null } | null): any {
  if (!setting || !setting.setting_data) return null;
  try {
    return JSON.parse(setting.setting_data);
  } catch {
    return null;
  }
}

// GET /api/agent-settings
router.get('/agent-settings', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'agent_settings'`
    );

    const data = parseSettingData(setting);
    if (!data) {
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

    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('Get agent settings error:', error);
    res.status(500).json({ detail: 'Failed to get agent settings' });
  }
});

// POST /api/agent-settings
router.post('/agent-settings', async (req: Request, res: Response) => {
  try {
    const settings = req.body;

    // Check if exists
    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = 'agent_settings'`
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = 'agent_settings'`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES ('agent_settings', @data, @updated_at)`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    }

    res.json({ success: true, ...settings });
  } catch (error) {
    console.error('Update agent settings error:', error);
    res.status(500).json({ detail: 'Failed to update agent settings' });
  }
});

// GET /api/settings/agent
router.get('/agent', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'agent_settings'`
    );

    const data = parseSettingData(setting);
    if (!data) {
      res.json({
        agent1_name: '',
        agent1_phone: '',
        agent2_name: '',
        agent2_phone: '',
        agent_email: ''
      });
      return;
    }

    res.json(data);
  } catch (error) {
    console.error('Get agent settings error:', error);
    res.status(500).json({ detail: 'Failed to get agent settings' });
  }
});

// PUT /api/settings/agent
router.put('/agent', async (req: Request, res: Response) => {
  try {
    const settings = req.body;

    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = 'agent_settings'`
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = 'agent_settings'`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES ('agent_settings', @data, @updated_at)`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    }

    res.json({ success: true, ...settings });
  } catch (error) {
    console.error('Update agent settings error:', error);
    res.status(500).json({ detail: 'Failed to update agent settings' });
  }
});

// GET /api/api-settings
router.get('/', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'api_keys'`
    );

    const data = parseSettingData(setting);
    if (!data) {
      res.json({
        success: true,
        settings: {
          domain_api_key: null,
          corelogic_client_key: null,
          corelogic_secret_key: null,
          realestate_api_key: null,
          pricefinder_api_key: null,
          google_places_api_key: null
        }
      });
      return;
    }

    // Mask keys for security
    const maskedSettings: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > 8) {
        maskedSettings[key] = value.substring(0, 4) + '****' + value.substring(value.length - 4);
      } else {
        maskedSettings[key] = value;
      }
    }

    res.json({ success: true, settings: maskedSettings });
  } catch (error) {
    console.error('Get API settings error:', error);
    res.status(500).json({ success: false, detail: 'Failed to get API settings' });
  }
});

// POST /api/api-settings
router.post('/', async (req: Request, res: Response) => {
  try {
    const settings = req.body;

    const existingSetting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'api_keys'`
    );

    const existing = parseSettingData(existingSetting) || {};
    const updateData: any = {};

    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'string') {
        if (!value.includes('****') && value.length > 0) {
          updateData[key] = value;
        } else if (existing[key]) {
          updateData[key] = existing[key];
        }
      }
    }

    if (existingSetting) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = 'api_keys'`,
        { data: JSON.stringify(updateData), updated_at: new Date() }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES ('api_keys', @data, @updated_at)`,
        { data: JSON.stringify(updateData), updated_at: new Date() }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update API settings error:', error);
    res.status(500).json({ success: false, detail: 'Failed to update API settings' });
  }
});

// GET /api/settings/api-keys
router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'api_keys'`
    );

    const data = parseSettingData(setting);
    if (!data) {
      res.json({
        domain_api_key: null,
        corelogic_client_key: null,
        corelogic_secret_key: null
      });
      return;
    }

    // Mask keys
    const maskedSettings: any = {};
    for (const [key, value] of Object.entries(data)) {
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

// GET /api/settings/api-keys-internal
router.get('/api-keys-internal', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'api_keys'`
    );

    const data = parseSettingData(setting);
    res.json(data || {});
  } catch (error) {
    console.error('Get internal API keys error:', error);
    res.status(500).json({ detail: 'Failed to get API keys' });
  }
});

// PUT /api/settings/api-keys
router.put('/api-keys', async (req: Request, res: Response) => {
  try {
    const settings = req.body;

    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = 'api_keys'`
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = 'api_keys'`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES ('api_keys', @data, @updated_at)`,
        { data: JSON.stringify(settings), updated_at: new Date() }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update API keys error:', error);
    res.status(500).json({ detail: 'Failed to update API keys' });
  }
});

// GET /api/settings/market-context
router.get('/market-context', async (req: Request, res: Response) => {
  try {
    const setting = await queryOne<{ setting_id: string; setting_data: string }>(
      `SELECT * FROM settings WHERE setting_id = 'market_context'`
    );

    const data = parseSettingData(setting);
    if (!data) {
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

    res.json(data);
  } catch (error) {
    console.error('Get market context error:', error);
    res.status(500).json({ detail: 'Failed to get market context' });
  }
});

// PUT /api/settings/market-context
router.put('/market-context', async (req: Request, res: Response) => {
  try {
    const context = req.body;
    context.last_updated = new Date();
    context.updated_by = 'manual';

    const existing = await queryOne<{ setting_id: string }>(
      `SELECT setting_id FROM settings WHERE setting_id = 'market_context'`
    );

    if (existing) {
      await execute(
        `UPDATE settings SET setting_data = @data, updated_at = @updated_at WHERE setting_id = 'market_context'`,
        { data: JSON.stringify(context), updated_at: new Date() }
      );
    } else {
      await execute(
        `INSERT INTO settings (setting_id, setting_data, updated_at) VALUES ('market_context', @data, @updated_at)`,
        { data: JSON.stringify(context), updated_at: new Date() }
      );
    }

    res.json({ success: true, ...context });
  } catch (error) {
    console.error('Update market context error:', error);
    res.status(500).json({ detail: 'Failed to update market context' });
  }
});

// GET /api/marketing-packages - Return empty for now (can be added to schema later)
router.get('/marketing-packages', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, packages: [] });
  } catch (error) {
    console.error('Get marketing packages error:', error);
    res.status(500).json({ detail: 'Failed to get marketing packages' });
  }
});

// POST /api/marketing-packages
router.post('/marketing-packages', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Marketing packages not yet implemented for SQL' });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to create marketing package' });
  }
});

// PUT /api/marketing-packages/:packageId
router.put('/marketing-packages/:packageId', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Marketing packages not yet implemented for SQL' });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to update marketing package' });
  }
});

// DELETE /api/marketing-packages/:packageId
router.delete('/marketing-packages/:packageId', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Marketing packages not yet implemented for SQL' });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to delete marketing package' });
  }
});

export default router;
