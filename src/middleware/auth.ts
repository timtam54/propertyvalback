import { Request, Response, NextFunction } from 'express';
import { decodeToken } from '../utils/auth';
import { getDb } from '../utils/database';
import { User } from '../models/types';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
      userEmail?: string;
    }
  }
}

export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const payload = decodeToken(token);
  if (!payload) {
    res.status(401).json({ detail: 'Invalid or expired token' });
    return;
  }

  try {
    const db = await getDb();
    const user = await db.collection<User>('users').findOne({ id: payload.sub });

    if (!user || !user.is_active) {
      res.status(401).json({ detail: 'User not found or inactive' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ detail: 'Authentication error' });
  }
}

// Optional auth - extracts user email from header if present
export function extractUserEmail(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  req.userEmail = req.headers['x-user-email'] as string | undefined;
  next();
}
