import {
  GetCurrentAuthUserResponse,
} from '@workspace/api-zod';
import { db, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  clearSession,
  createSession,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from '../lib/auth';

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

function parseLoginBody(body: unknown): { email: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== 'string' || !b.email.trim()) return null;
  if (typeof b.password !== 'string' || !b.password) return null;
  return { email: b.email, password: b.password };
}

// GET /api/auth/user — returns the current user or null
router.get('/auth/user', (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

// POST /api/login — email + password login
router.post('/login', async (req: Request, res: Response) => {
  const parsed = parseLoginBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const { email, password } = parsed;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  // Return sid so the client can store it as a Bearer token (avoids
  // cookie-forwarding issues in the Replit proxy environment).
  res.json({ ok: true, user: sessionData.user, sid });
});

// GET /api/logout — clear session and redirect
router.get('/logout', async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);

  const rawReturnTo = req.query.returnTo;
  const returnTo =
    typeof rawReturnTo === 'string' &&
    rawReturnTo.startsWith('/') &&
    !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : '/';

  res.redirect(returnTo);
});

export default router;
