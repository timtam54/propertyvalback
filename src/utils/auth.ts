import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { TokenPayload } from '../models/types';

const SECRET_KEY = process.env.SECRET_KEY || 'your-secret-key-here';
const ACCESS_TOKEN_EXPIRE_MINUTES = parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || '30', 10);

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hashedPassword: string): boolean {
  return bcrypt.compareSync(password, hashedPassword);
}

export function createAccessToken(data: { sub: string; email: string }): string {
  const payload: TokenPayload = {
    ...data,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRE_MINUTES * 60
  };

  return jwt.sign(payload, SECRET_KEY);
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET_KEY) as TokenPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
