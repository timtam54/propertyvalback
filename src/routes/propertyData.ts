import { Router, Request, Response } from 'express';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Note: property_sales table not implemented in SQL migration (was empty)
// Return empty/stub responses for now

// GET /api/property-data/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    res.json({
      totalSales: 0,
      byState: {},
      postcodesByState: {},
      dateRange: { oldest: null, newest: null }
    });
  } catch (error) {
    console.error('Get property data stats error:', error);
    res.status(500).json({ detail: 'Failed to get stats' });
  }
});

// POST /api/property-data/import
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Property data import not implemented for SQL' });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to import data' });
  }
});

// GET /api/property-data/median-price
router.get('/median-price', async (req: Request, res: Response) => {
  try {
    res.json({ medianPrice: null, count: 0, message: 'No data available' });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to calculate median' });
  }
});

// GET /api/property-data/comparable-sales
router.get('/comparable-sales', async (req: Request, res: Response) => {
  try {
    res.json({ sales: [], statistics: { count: 0 } });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to get comparable sales' });
  }
});

export default router;
