import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth';
import { Agent } from '../models/types';

const router = Router();

// Note: Agents table not implemented in SQL migration (was empty)
// Return empty arrays for now

// GET /api/agents
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json([]);
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({ detail: 'Failed to get agents' });
  }
});

// GET /api/agents/:agentId
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    res.status(404).json({ detail: 'Agent not found' });
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ detail: 'Failed to get agent' });
  }
});

// POST /api/agents
router.post('/', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Agents not implemented for SQL' });
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ detail: 'Failed to create agent' });
  }
});

// PUT /api/agents/:agentId
router.put('/:agentId', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Agents not implemented for SQL' });
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({ detail: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:agentId
router.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    res.status(501).json({ detail: 'Agents not implemented for SQL' });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(500).json({ detail: 'Failed to delete agent' });
  }
});

export default router;
