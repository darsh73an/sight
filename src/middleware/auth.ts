import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Project, ProjectModel } from '../models/Project';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

interface JwtPayload {
  id: string;
  email: string;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

/**
 * Auth for the ingestion endpoint. SDKs never have a user JWT -
 * they identify themselves with the project's api_key instead.
 */
export interface ApiKeyRequest extends Request {
  project?: Project;
}

export async function requireApiKey(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.header('x-api-key');

  if (!apiKey) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing x-api-key header' });
    return;
  }

  try {
    const project = await ProjectModel.findByApiKey(apiKey);
    if (!project) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
      return;
    }
    req.project = project;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Could not verify API key' });
  }
}
