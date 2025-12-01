import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';

const router = Router();

interface AuditRecord {
  id: number;
  action: string;
  page: string;
  username: string;
  dte: Date;
  ipaddress: string;
  propertyid: number;
}

// POST /api/audit - Create audit record
router.post('/', async (req: Request, res: Response) => {
  try {
    const { action, page, username, dte, ipaddress, propertyid } = req.body;

    const db = await getDb();

    // Get the next ID (auto-increment simulation)
    const lastRecord = await db
      .collection<AuditRecord>('audit')
      .find()
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    const nextId = lastRecord.length > 0 ? lastRecord[0].id + 1 : 1;

    const auditRecord: AuditRecord = {
      id: nextId,
      action: action || null,
      page: page || null,
      username: username || null,
      dte: dte ? new Date(dte) : new Date(),
      ipaddress: ipaddress || null,
      propertyid: propertyid || null
    };

    await db.collection<AuditRecord>('audit').insertOne(auditRecord);

    res.status(201).json({ success: true, id: nextId });
  } catch (error) {
    console.error('Create audit record error:', error);
    res.status(500).json({ detail: 'Failed to create audit record' });
  }
});

// GET /api/audit - Get audit records with optional filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page,
      username,
      action,
      startDate,
      endDate,
      propertyid,
      limit = '100',
      offset = '0'
    } = req.query;

    const db = await getDb();

    // Build filter object
    const filter: Record<string, any> = {};

    if (page) {
      filter.page = page;
    }

    if (username) {
      filter.username = username;
    }

    if (action) {
      filter.action = action;
    }

    if (propertyid) {
      filter.propertyid = parseInt(propertyid as string, 10);
    }

    if (startDate || endDate) {
      filter.dte = {};
      if (startDate) {
        filter.dte.$gte = new Date(startDate as string);
      }
      if (endDate) {
        filter.dte.$lte = new Date(endDate as string);
      }
    }

    const records = await db
      .collection<AuditRecord>('audit')
      .find(filter, { projection: { _id: 0 } })
      .sort({ dte: -1 })
      .skip(parseInt(offset as string, 10))
      .limit(parseInt(limit as string, 10))
      .toArray();

    // Get total count for pagination
    const total = await db.collection<AuditRecord>('audit').countDocuments(filter);

    res.json({
      records,
      total,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10)
    });
  } catch (error) {
    console.error('Get audit records error:', error);
    res.status(500).json({ detail: 'Failed to get audit records' });
  }
});

// GET /api/audit/users - Get unique users with their activity stats
router.get('/users', async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    // Aggregate to get unique users with their stats
    const users = await db.collection<AuditRecord>('audit').aggregate([
      {
        $group: {
          _id: '$username',
          totalVisits: { $sum: 1 },
          firstVisit: { $min: '$dte' },
          lastVisit: { $max: '$dte' },
          ipAddresses: { $addToSet: '$ipaddress' },
          pagesVisited: { $addToSet: '$page' }
        }
      },
      {
        $project: {
          username: '$_id',
          totalVisits: 1,
          firstVisit: 1,
          lastVisit: 1,
          ipAddresses: 1,
          uniquePages: { $size: '$pagesVisited' },
          _id: 0
        }
      },
      { $sort: { lastVisit: -1 } }
    ]).toArray();

    res.json({
      success: true,
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Get audit users error:', error);
    res.status(500).json({ detail: 'Failed to get audit users' });
  }
});

// GET /api/audit/stats - Get overall audit statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    // Get total records
    const totalRecords = await db.collection<AuditRecord>('audit').countDocuments();

    // Get unique users count
    const uniqueUsers = await db.collection<AuditRecord>('audit').distinct('username');

    // Get page visit counts
    const pageStats = await db.collection<AuditRecord>('audit').aggregate([
      {
        $group: {
          _id: '$page',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Get visits per day for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyVisits = await db.collection<AuditRecord>('audit').aggregate([
      {
        $match: {
          dte: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$dte' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    // Get recent activity (last 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const recentActivity = await db.collection<AuditRecord>('audit').countDocuments({
      dte: { $gte: oneDayAgo }
    });

    res.json({
      success: true,
      stats: {
        totalRecords,
        uniqueUsers: uniqueUsers.length,
        recentActivity,
        pageStats: pageStats.map(p => ({ page: p._id, count: p.count })),
        dailyVisits: dailyVisits.map(d => ({ date: d._id, count: d.count }))
      }
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ detail: 'Failed to get audit stats' });
  }
});

// GET /api/audit/:id - Get single audit record
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const db = await getDb();
    const record = await db
      .collection<AuditRecord>('audit')
      .findOne({ id: parseInt(id, 10) }, { projection: { _id: 0 } });

    if (!record) {
      res.status(404).json({ detail: 'Audit record not found' });
      return;
    }

    res.json(record);
  } catch (error) {
    console.error('Get audit record error:', error);
    res.status(500).json({ detail: 'Failed to get audit record' });
  }
});

export default router;
