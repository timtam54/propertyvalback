import { Router, Request, Response } from 'express';
import { getDb, queryOne, queryMany, execute } from '../utils/database';
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

    // Check if user already exists
    const existingUser = await queryOne<User>(
      'SELECT * FROM users WHERE email = @email',
      { email }
    );

    if (existingUser) {
      res.status(409).json({ detail: 'Email already registered' });
      return;
    }

    // Create new user
    const userId = Date.now().toString();
    const now = new Date();

    await execute(
      `INSERT INTO users (id, email, username, hashed_password, subscription_tier, subscription_active, trial_active, created_at, is_active)
       VALUES (@id, @email, @username, @hashed_password, 'free', 0, 0, @created_at, 1)`,
      {
        id: userId,
        email,
        username,
        hashed_password: hashPassword(password),
        created_at: now
      }
    );

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

    // Find user by email
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE email = @email',
      { email: username }
    );

    if (!user || !verifyPassword(password, user.hashed_password || '')) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }

    // Update last login
    await execute(
      'UPDATE users SET last_login = @last_login WHERE email = @email',
      { last_login: new Date(), email: user.email }
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

// POST /api/auth/oauth-sync - Sync OAuth user to users table
router.post('/oauth-sync', async (req: Request, res: Response) => {
  try {
    const { email, name, provider, picture } = req.body;

    if (!email) {
      res.status(400).json({ detail: 'Email is required' });
      return;
    }

    // Check if user already exists
    const existingUser = await queryOne<User>(
      'SELECT * FROM users WHERE email = @email',
      { email }
    );

    if (existingUser) {
      // Update last login and optionally name/picture
      await execute(
        `UPDATE users SET last_login = @last_login,
         username = COALESCE(@username, username),
         picture = COALESCE(@picture, picture)
         WHERE email = @email`,
        {
          last_login: new Date(),
          username: name || null,
          picture: picture || null,
          email
        }
      );

      res.json({
        success: true,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          username: name || existingUser.username,
          isNew: false
        }
      });
    } else {
      // Create new user
      const userId = Date.now().toString();
      const now = new Date();

      await execute(
        `INSERT INTO users (id, email, username, hashed_password, subscription_tier, subscription_active, trial_active, created_at, last_login, is_active, auth_provider, picture)
         VALUES (@id, @email, @username, '', 'free', 0, 0, @created_at, @last_login, 1, @auth_provider, @picture)`,
        {
          id: userId,
          email,
          username: name || email.split('@')[0],
          created_at: now,
          last_login: now,
          auth_provider: provider || 'oauth',
          picture: picture || null
        }
      );

      res.status(201).json({
        success: true,
        user: {
          id: userId,
          email,
          username: name || email.split('@')[0],
          isNew: true
        }
      });
    }
  } catch (error) {
    console.error('OAuth sync error:', error);
    res.status(500).json({ detail: 'Failed to sync OAuth user' });
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

// GET /api/auth/users - Get all users (admin endpoint)
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await queryMany<User>(
      `SELECT id, email, username, subscription_tier, subscription_active, subscription_end_date,
              trial_active, trial_end_date, stripe_customer_id, stripe_subscription_id,
              created_at, last_login, is_active, auth_provider, picture
       FROM users
       ORDER BY last_login DESC`
    );

    res.json({
      success: true,
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ detail: 'Failed to get users' });
  }
});

export default router;
