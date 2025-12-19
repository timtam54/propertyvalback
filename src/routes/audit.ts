import { Router, Request, Response } from 'express';
import { queryOne, queryMany, execute, query } from '../utils/database';

const router = Router();

interface AuditRecord {
  id: number;
  action: string;
  page: string;
  username: string;
  dte: Date;
  ipaddress: string;
  propertyid: string | null;
}

// POST /api/audit - Create audit record
router.post('/', async (req: Request, res: Response) => {
  try {
    const { action, page, username, dte, ipaddress, propertyid } = req.body;

    // Insert and get the new ID
    const result = await query<{ id: number }>(
      `INSERT INTO audit (action, page, username, dte, ipaddress, propertyid)
       OUTPUT INSERTED.id
       VALUES (@action, @page, @username, @dte, @ipaddress, @propertyid)`,
      {
        action: action || null,
        page: page || null,
        username: username || null,
        dte: dte ? new Date(dte) : new Date(),
        ipaddress: ipaddress || null,
        propertyid: propertyid || null
      }
    );

    const newId = result.recordset[0]?.id;
    res.status(201).json({ success: true, id: newId });
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

    let queryStr = 'SELECT * FROM audit WHERE 1=1';
    const params: Record<string, any> = {};

    if (page) {
      queryStr += ' AND page = @page';
      params.page = page;
    }

    if (username) {
      queryStr += ' AND username = @username';
      params.username = username;
    }

    if (action) {
      queryStr += ' AND action = @action';
      params.action = action;
    }

    if (propertyid) {
      queryStr += ' AND propertyid = @propertyid';
      params.propertyid = propertyid;
    }

    if (startDate) {
      queryStr += ' AND dte >= @startDate';
      params.startDate = new Date(startDate as string);
    }

    if (endDate) {
      queryStr += ' AND dte <= @endDate';
      params.endDate = new Date(endDate as string);
    }

    queryStr += ' ORDER BY dte DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
    params.offset = parseInt(offset as string, 10);
    params.limit = parseInt(limit as string, 10);

    const records = await queryMany<AuditRecord>(queryStr, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM audit WHERE 1=1';
    const countParams: Record<string, any> = {};

    if (page) {
      countQuery += ' AND page = @page';
      countParams.page = page;
    }
    if (username) {
      countQuery += ' AND username = @username';
      countParams.username = username;
    }
    if (action) {
      countQuery += ' AND action = @action';
      countParams.action = action;
    }
    if (propertyid) {
      countQuery += ' AND propertyid = @propertyid';
      countParams.propertyid = propertyid;
    }
    if (startDate) {
      countQuery += ' AND dte >= @startDate';
      countParams.startDate = new Date(startDate as string);
    }
    if (endDate) {
      countQuery += ' AND dte <= @endDate';
      countParams.endDate = new Date(endDate as string);
    }

    const countResult = await queryOne<{ total: number }>(countQuery, countParams);

    res.json({
      records,
      total: countResult?.total || 0,
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
    const users = await queryMany<{
      username: string;
      totalVisits: number;
      firstVisit: Date;
      lastVisit: Date;
    }>(
      `SELECT
        username,
        COUNT(*) as totalVisits,
        MIN(dte) as firstVisit,
        MAX(dte) as lastVisit
       FROM audit
       WHERE username IS NOT NULL
       GROUP BY username
       ORDER BY MAX(dte) DESC`
    );

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
    // Get total records
    const totalResult = await queryOne<{ total: number }>('SELECT COUNT(*) as total FROM audit');
    const totalRecords = totalResult?.total || 0;

    // Get unique users count
    const uniqueUsersResult = await queryOne<{ count: number }>(
      'SELECT COUNT(DISTINCT username) as count FROM audit WHERE username IS NOT NULL'
    );
    const uniqueUsers = uniqueUsersResult?.count || 0;

    // Get page visit counts
    const pageStats = await queryMany<{ page: string; count: number }>(
      `SELECT page as page, COUNT(*) as count FROM audit
       WHERE page IS NOT NULL
       GROUP BY page
       ORDER BY COUNT(*) DESC`
    );

    // Get visits per day for the last 30 days
    const dailyVisits = await queryMany<{ date: string; count: number }>(
      `SELECT CONVERT(VARCHAR(10), dte, 120) as date, COUNT(*) as count
       FROM audit
       WHERE dte >= DATEADD(day, -30, GETUTCDATE())
       GROUP BY CONVERT(VARCHAR(10), dte, 120)
       ORDER BY CONVERT(VARCHAR(10), dte, 120)`
    );

    // Get recent activity (last 24 hours)
    const recentResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM audit WHERE dte >= DATEADD(hour, -24, GETUTCDATE())`
    );
    const recentActivity = recentResult?.count || 0;

    res.json({
      success: true,
      stats: {
        totalRecords,
        uniqueUsers,
        recentActivity,
        pageStats,
        dailyVisits
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

    const record = await queryOne<AuditRecord>(
      'SELECT * FROM audit WHERE id = @id',
      { id: parseInt(id, 10) }
    );

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
