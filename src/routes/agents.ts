import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { Agent } from '../models/types';

const router = Router();

// GET /api/agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const agents = await db
      .collection<Agent>('agents')
      .find({}, { projection: { _id: 0 } })
      .limit(100)
      .toArray();

    res.json(agents);
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({ detail: 'Failed to get agents' });
  }
});

// GET /api/agents/:agentId
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    const db = getDb();
    const agent = await db
      .collection<Agent>('agents')
      .findOne({ id: agentId }, { projection: { _id: 0 } });

    if (!agent) {
      res.status(404).json({ detail: 'Agent not found' });
      return;
    }

    res.json(agent);
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ detail: 'Failed to get agent' });
  }
});

// POST /api/agents
router.post('/', async (req: Request, res: Response) => {
  try {
    const agentData = req.body;

    const db = getDb();

    // Check if agent with this email already exists
    const existingAgent = await db.collection<Agent>('agents').findOne({ email: agentData.email });
    if (existingAgent) {
      res.status(409).json({ detail: 'Agent with this email already exists' });
      return;
    }

    const agent: Agent = {
      id: uuidv4(),
      name: agentData.name,
      email: agentData.email,
      phone: agentData.phone || null,
      agency_id: agentData.agency_id || 'default_agency',
      agency_name: agentData.agency_name || 'My Agency',
      bio: agentData.bio || null,
      specialties: agentData.specialties || [],
      created_at: new Date()
    };

    await db.collection<Agent>('agents').insertOne(agent);

    res.status(201).json(agent);
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ detail: 'Failed to create agent' });
  }
});

// PUT /api/agents/:agentId
router.put('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const updateData = req.body;

    const db = getDb();

    const agent = await db
      .collection<Agent>('agents')
      .findOne({ id: agentId }, { projection: { _id: 0 } });

    if (!agent) {
      res.status(404).json({ detail: 'Agent not found' });
      return;
    }

    await db.collection<Agent>('agents').updateOne(
      { id: agentId },
      { $set: updateData }
    );

    const updatedAgent = await db
      .collection<Agent>('agents')
      .findOne({ id: agentId }, { projection: { _id: 0 } });

    res.json(updatedAgent);
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({ detail: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:agentId
router.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    const db = getDb();

    const result = await db.collection<Agent>('agents').deleteOne({ id: agentId });

    if (result.deletedCount === 0) {
      res.status(404).json({ detail: 'Agent not found' });
      return;
    }

    res.json({ success: true, message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(500).json({ detail: 'Failed to delete agent' });
  }
});

export default router;
