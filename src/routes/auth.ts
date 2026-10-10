import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { UserModel, User } from '../models/User';
import { RefreshTokenModel } from '../models/RefreshToken';
import { PasswordResetTokenModel } from '../models/PasswordResetToken';
import { config } from '../config';
import { validateBody } from '../middleware/validate';
import { authRateLimit } from '../middleware/rateLimit';
import { generateOpaqueToken, hashToken } from '../utils/token';
import { logger } from '../utils/logger';

const router = Router();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Name is required').max(255),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.email_verified_at !== null,
  };
}

function generateAccessToken(user: Pick<User, 'id' | 'email'>): string {
  return jwt.sign({ id: user.id, email: user.email }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as unknown as SignOptions);
}

async function issueRefreshToken(userId: string): Promise<string> {
  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.refreshToken.expiresDays * 86_400_000);
  await RefreshTokenModel.create(userId, hash, expiresAt);
  return raw;
}

/**
 * Stateless signed token, not DB-stored like refresh/reset tokens -
 * reusing an old verification link after the email's already verified is
 * harmless (it just re-sets the same already-true state), so there's no
 * real need for single-use enforcement here the way there is for a
 * password reset token.
 */
function generateEmailVerificationToken(userId: string): string {
  return jwt.sign({ id: userId, purpose: 'verify-email' }, config.jwt.secret, {
    expiresIn: '24h',
  } as unknown as SignOptions);
}

router.post(
  '/register',
  authRateLimit,
  validateBody(registerSchema),
  async (req: Request, res: Response) => {
    const { email, password, name } = req.body;

    try {
      const alreadyExists = await UserModel.existsByEmail(email);
      if (alreadyExists) {
        res.status(409).json({ error: 'Conflict', message: 'Email already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await UserModel.create({ email, passwordHash, name });

      // No email provider wired up (see README) - logging the link is
      // the dev-mode stand-in so the verification flow is demoable
      // end-to-end without real SMTP/SES/SendGrid configured.
      const verifyToken = generateEmailVerificationToken(user.id);
      logger.info(
        `Verification link for ${user.email}: ${config.appUrl}/verify-email?token=${verifyToken}`
      );

      res.status(201).json({ user: sanitizeUser(user) });
    } catch (err) {
      logger.error('Register failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not register user' });
    }
  }
);

router.post(
  '/login',
  authRateLimit,
  validateBody(loginSchema),
  async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
      const user = await UserModel.findByEmail(email);
      if (!user) {
        // Same message as a wrong password - don't reveal whether the email exists
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
        return;
      }

      const accessToken = generateAccessToken(user);
      const refreshToken = await issueRefreshToken(user.id);

      res.status(200).json({ accessToken, refreshToken, user: sanitizeUser(user) });
    } catch (err) {
      logger.error('Login failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not log in' });
    }
  }
);

/**
 * Rotation: the presented refresh token is revoked and a new one issued
 * on every call, not just re-validated. If a stolen refresh token is
 * ever used, the legitimate owner's next refresh attempt gets a 401
 * (their token was already revoked by the attacker's use) - a visible
 * signal instead of a silent, open-ended impersonation window.
 */
router.post(
  '/refresh',
  authRateLimit,
  validateBody(refreshSchema),
  async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    try {
      const tokenHash = hashToken(refreshToken);
      const stored = await RefreshTokenModel.findValidByHash(tokenHash);
      if (!stored) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
        return;
      }

      const user = await UserModel.findById(stored.user_id);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
        return;
      }

      await RefreshTokenModel.revoke(stored.id);

      const accessToken = generateAccessToken(user);
      const newRefreshToken = await issueRefreshToken(user.id);

      res.status(200).json({ accessToken, refreshToken: newRefreshToken, user: sanitizeUser(user) });
    } catch (err) {
      logger.error('Refresh failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not refresh session' });
    }
  }
);

// No requireAuth here deliberately - logout needs to work even if the
// access token already expired, which is a likely reason to be calling
// it. Revoking an already-invalid/unrecognized hash is a harmless no-op,
// so there's nothing unsafe about accepting this without a valid access token.
router.post('/logout', validateBody(refreshSchema), async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  try {
    const tokenHash = hashToken(refreshToken);
    const stored = await RefreshTokenModel.findValidByHash(tokenHash);
    if (stored) {
      await RefreshTokenModel.revoke(stored.id);
    }
    res.status(204).send();
  } catch (err) {
    logger.error('Logout failed', err);
    res.status(500).json({ error: 'InternalError', message: 'Could not log out' });
  }
});

router.post(
  '/verify-email',
  validateBody(verifyEmailSchema),
  async (req: Request, res: Response) => {
    const { token } = req.body;

    try {
      const payload = jwt.verify(token, config.jwt.secret) as { id: string; purpose: string };
      if (payload.purpose !== 'verify-email') {
        res.status(400).json({ error: 'ValidationError', message: 'Invalid verification token' });
        return;
      }

      const user = await UserModel.markEmailVerified(payload.id);
      if (!user) {
        res.status(404).json({ error: 'NotFound', message: 'User not found' });
        return;
      }

      res.status(200).json({ user: sanitizeUser(user) });
    } catch (err) {
      res.status(400).json({ error: 'ValidationError', message: 'Invalid or expired verification token' });
    }
  }
);

router.post(
  '/forgot-password',
  authRateLimit,
  validateBody(forgotPasswordSchema),
  async (req: Request, res: Response) => {
    const { email } = req.body;

    try {
      const user = await UserModel.findByEmail(email);

      // Always the same response whether or not the account exists -
      // otherwise this endpoint becomes a way to check which emails are
      // registered, one request at a time.
      if (user) {
        const { raw, hash } = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await PasswordResetTokenModel.create(user.id, hash, expiresAt);

        // No email provider wired up (see README) - logged for the same
        // reason the verification link is logged above.
        logger.info(
          `Password reset link for ${user.email}: ${config.appUrl}/reset-password?token=${raw}`
        );
      }

      res.status(200).json({
        message: 'If that email is registered, a password reset link has been sent',
      });
    } catch (err) {
      logger.error('Forgot-password failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not process request' });
    }
  }
);

router.post(
  '/reset-password',
  authRateLimit,
  validateBody(resetPasswordSchema),
  async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;

    try {
      const tokenHash = hashToken(token);
      const stored = await PasswordResetTokenModel.findValidByHash(tokenHash);
      if (!stored) {
        res.status(400).json({ error: 'ValidationError', message: 'Invalid or expired reset token' });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await UserModel.updatePassword(stored.user_id, passwordHash);
      await PasswordResetTokenModel.markUsed(stored.id);

      // A password reset means "assume the account may have been
      // compromised" - signing out every existing session is the
      // correct response, not just changing the password and leaving
      // whatever session an attacker already had still valid.
      await RefreshTokenModel.revokeAllForUser(stored.user_id);

      res.status(200).json({ message: 'Password reset - please log in again' });
    } catch (err) {
      logger.error('Reset-password failed', err);
      res.status(500).json({ error: 'InternalError', message: 'Could not reset password' });
    }
  }
);

export default router;
