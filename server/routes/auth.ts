import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import {
	createSessionToken,
	currentPinVersion,
	hashPin,
	isAuthed,
	randomSaltHex,
	SESSION_COOKIE,
} from '../lib/auth';
import { getSetting, setSetting } from '../lib/settings';
import { timingSafeEqual } from '../lib/bytes';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

function validPin(pin: unknown): pin is string {
	return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

function cookieOpts(c: { req: { url: string } }) {
	return {
		httpOnly: true,
		secure: c.req.url.startsWith('https://'),
		sameSite: 'Lax' as const,
		path: '/',
		maxAge: 7 * 24 * 3600,
	};
}

export const authRoutes = new Hono<AppEnv>()
	.get('/status', async (c) => {
		const pinSet = (await getSetting(c.env.DB, 'pin_hash')) !== null;
		const authed = pinSet && (await isAuthed(c));
		return c.json(ok({ pinSet, authed }));
	})

	// 首次设置 PIN（仅当尚未设置时允许）
	.post('/setup', async (c) => {
		const { pin } = await c.req.json<{ pin?: string }>().catch(() => ({ pin: undefined }));
		if (!validPin(pin)) return c.json(err('bad_pin', 'PIN 需为 6 位数字'), 400);
		if ((await getSetting(c.env.DB, 'pin_hash')) !== null) {
			return c.json(err('pin_exists', 'PIN 已设置，请直接登录'), 400);
		}
		const salt = randomSaltHex();
		await setSetting(c.env.DB, 'pin_salt', salt);
		await setSetting(c.env.DB, 'pin_hash', await hashPin(pin, salt));
		await setSetting(c.env.DB, 'pin_version', '1');
		setCookie(c, SESSION_COOKIE, await createSessionToken(c.env.SESSION_SECRET, 1), cookieOpts(c));
		return c.json(ok({ authed: true }));
	})

	.post('/login', async (c) => {
		const db = c.env.DB;
		const lockUntil = Number((await getSetting(db, 'login_lock_until')) ?? '0');
		if (lockUntil > Date.now()) {
			const mins = Math.ceil((lockUntil - Date.now()) / 60_000);
			return c.json(err('locked', `连续失败次数过多，请 ${mins} 分钟后再试`), 429);
		}

		const { pin } = await c.req.json<{ pin?: string }>().catch(() => ({ pin: undefined }));
		const hash = await getSetting(db, 'pin_hash');
		const salt = await getSetting(db, 'pin_salt');
		if (!hash || !salt) return c.json(err('no_pin', '尚未设置 PIN'), 400);
		if (!validPin(pin) || !timingSafeEqual(await hashPin(pin, salt), hash)) {
			const fails = Number((await getSetting(db, 'login_fail_count')) ?? '0') + 1;
			if (fails >= MAX_FAILS) {
				await setSetting(db, 'login_lock_until', String(Date.now() + LOCK_MS));
				await setSetting(db, 'login_fail_count', '0');
				return c.json(err('locked', '连续失败 5 次，已锁定 15 分钟'), 429);
			}
			await setSetting(db, 'login_fail_count', String(fails));
			return c.json(err('wrong_pin', `PIN 不正确（还可尝试 ${MAX_FAILS - fails} 次）`), 401);
		}

		await setSetting(db, 'login_fail_count', '0');
		const version = await currentPinVersion(db);
		setCookie(c, SESSION_COOKIE, await createSessionToken(c.env.SESSION_SECRET, version), cookieOpts(c));
		return c.json(ok({ authed: true }));
	})

	.post('/logout', (c) => {
		deleteCookie(c, SESSION_COOKIE, { path: '/' });
		return c.json(ok({ authed: false }));
	});
