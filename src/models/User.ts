import { query, queryOne } from '../config/database';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export const UserModel = {
  async create(input: CreateUserInput): Promise<User> {
    const row = await queryOne<User>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.email.toLowerCase(), input.passwordHash, input.name]
    );
    if (!row) throw new Error('Failed to create user');
    return row;
  },

  async findById(id: string): Promise<User | null> {
    return queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
  },

  async findByEmail(email: string): Promise<User | null> {
    return queryOne<User>('SELECT * FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
  },

  async existsByEmail(email: string): Promise<boolean> {
    const row = await queryOne<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) as exists',
      [email.toLowerCase()]
    );
    return row?.exists ?? false;
  },

  async markEmailVerified(id: string): Promise<User | null> {
    return queryOne<User>(
      `UPDATE users SET email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
  },

  async updatePassword(id: string, passwordHash: string): Promise<User | null> {
    return queryOne<User>(
      `UPDATE users SET password_hash = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, passwordHash]
    );
  },
};
