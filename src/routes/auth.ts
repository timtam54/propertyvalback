import { Router, Request, Response } from 'express';
import { getDb } from '../utils/database';
import { hashPassword, verifyPassword, createAccessToken } from '../utils/auth';
import { authenticateToken } from '../middleware/auth';
import { User, UserSignup } from '../models/types';
import {
  canCreateListings,
  canRunEvaluations,
  isTrialActive,
  isSubscriptionActive
} from '../utils/subscription';

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, username, password } = req.body as UserSignup;

    if (!email || !username || !password) {
      res.status(400).json({ detail: 'Email, username, and password are required' });
      return;
    }

    const db = getDb();

    // Check if user already exists
    const existingUser = await db.collection<User>('users').findOne({ email });
    if (existingUser) {
      res.status(409).json({ detail: 'Email already registered' });
      return;
    }

    // Create new user
    const userId = Date.now().toString();
    const userDoc: User = {
      id: userId,
      email,
      username,
      hashed_password: hashPassword(password),
      subscription_tier: 'free',
      subscription_active: false,
      subscription_end_date: null,
      trial_active: false,
      trial_end_date: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      created_at: new Date(),
      last_login: null,
      is_active: true
    };

    await db.collection<User>('users').insertOne(userDoc);

    // Generate token
    const accessToken = createAccessToken({ sub: userId, email });

    res.status(201).json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: userId,
        email,
        username,
        subscription_tier: 'free'
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ detail: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    // Handle both JSON body and form data
    const username = req.body.username || req.body.email;
    const password = req.body.password;

    if (!username || !password) {
      res.status(400).json({ detail: 'Email and password are required' });
      return;
    }

    const db = getDb();

    // Find user by email (username field contains email in OAuth2 form)
    const user = await db.collection<User>('users').findOne({ email: username });

    if (!user || !verifyPassword(password, user.hashed_password)) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }

    // Update last login
    await db.collection<User>('users').updateOne(
      { email: user.email },
      { $set: { last_login: new Date() } }
    );

    // Generate token
    const accessToken = createAccessToken({ sub: user.id, email: user.email });

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        subscription_tier: user.subscription_tier || 'free',
        subscription_active: user.subscription_active || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      subscription_tier: user.subscription_tier || 'free',
      subscription_active: user.subscription_active || false,
      subscription_end_date: user.subscription_end_date,
      trial_active: user.trial_active || false,
      trial_end_date: user.trial_end_date,
      created_at: user.created_at
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ detail: 'Failed to get user info' });
  }
});

// GET /api/auth/subscription-status
router.get('/subscription-status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const trialActive = isTrialActive(user.trial_end_date);
    const subscriptionActive = isSubscriptionActive(user.subscription_end_date);

    res.json({
      subscription_tier: user.subscription_tier || 'free',
      subscription_active: subscriptionActive,
      trial_active: trialActive,
      can_create_listings: canCreateListings(
        user.subscription_tier || 'free',
        subscriptionActive,
        trialActive
      ),
      can_run_evaluations: canRunEvaluations(
        user.subscription_tier || 'free',
        subscriptionActive,
        trialActive
      ),
      trial_end_date: user.trial_end_date,
      subscription_end_date: user.subscription_end_date
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ detail: 'Failed to get subscription status' });
  }
});

export default router;
