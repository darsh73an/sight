import { query, queryOne } from '../config/database';
import crypto from 'crypto';

export interface Project {
  id: string;
  name: string;
  api_key: string;
  owner_id: string;
  platform: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectInput {
  name: string;
  ownerId: string;
  platform?: string;
}

function generateApiKey(): string {
  // uuidv4 - crypto.randomUUID() is RFC 4122 v4 compliant, no extra dependency needed
  return crypto.randomUUID();
}

export const ProjectModel = {
  async create(input: CreateProjectInput): Promise<Project> {
    const row = await queryOne<Project>(
      `INSERT INTO projects (name, api_key, owner_id, platform)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.name, generateApiKey(), input.ownerId, input.platform ?? 'javascript']
    );
    if (!row) throw new Error('Failed to create project');
    return row;
  },

  async findById(id: string): Promise<Project | null> {
    return queryOne<Project>('SELECT * FROM projects WHERE id = $1', [id]);
  },

  async findByApiKey(apiKey: string): Promise<Project | null> {
    return queryOne<Project>('SELECT * FROM projects WHERE api_key = $1', [
      apiKey,
    ]);
  },

  async findByOwner(ownerId: string): Promise<Project[]> {
    return query<Project>(
      'SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC',
      [ownerId]
    );
  },

  async belongsToOwner(projectId: string, ownerId: string): Promise<boolean> {
    const row = await queryOne(
      'SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2',
      [projectId, ownerId]
    );
    return row !== null;
  },

  async delete(id: string): Promise<void> {
    await query('DELETE FROM projects WHERE id = $1', [id]);
  },

  async regenerateApiKey(id: string): Promise<Project | null> {
    return queryOne<Project>(
      `UPDATE projects SET api_key = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, generateApiKey()]
    );
  },
};
