import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { err } from '../env';
import { b64url, b64urlDecode, bytesToHex, hexToBytes, timingSafeEqual } from './bytes';
import { getSetting } from './settings';

const enc = new TextEncoder();
const SESSION_TTL_MS = 7 * 24 * 3600_000;
export const SESSION_COOKIE = 'session';

// —— PIN 哈希（PBKDF2-SHA256，100k 次为 Workers 上限）——

export function randomSaltHex(): string {
	return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin: string, saltHex: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 100_000 },
		key,
		256,
	);
	return bytesToHex(new Uint8Array(bits));
}

// —— 会话 cookie（HMAC 签名，payload 含过期时间与 PIN 版本号）——

async function hmacSign(data: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
	return b64url(new Uint8Array(sig));
}

export async function createSessionToken(secret: string, pinVersion: number): Promise<string> {
	const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, v: pinVersion })));
	return `${payload}.${await hmacSign(payload, secret)}`;
}

export async function verifySessionToken(token: string, secret: string, pinVersion: number): Promise<boolean> {
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return false;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!timingSafeEqual(sig, await hmacSign(payload, secret))) return false;
	try {
		const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { exp: number; v: number };
		return data.exp > Date.now() && data.v === pinVersion;
	} catch {
		return false;
	}
}

export async function currentPinVersion(db: D1Database): Promise<number> {
	return Number((await getSetting(db, 'pin_version')) ?? '0');
}

/** 请求是否携带有效家长会话 */
export async function isAuthed(c: { req: { raw: Request }; env: AppEnv['Bindings'] }, cookieVal?: string): Promise<boolean> {
	const token = cookieVal ?? getCookieFromRequest(c.req.raw);
	if (!token) return false;
	const version = await currentPinVersion(c.env.DB);
	if (version === 0) return false;
	return verifySessionToken(token, c.env.SESSION_SECRET, version);
}

function getCookieFromRequest(req: Request): string | undefined {
	const header = req.headers.get('cookie') ?? '';
	const m = header.match(/(?:^|;\s*)session=([^;]+)/);
	return m?.[1];
}

/** /api/admin/* 中间件 */
export const adminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
	const token = getCookie(c, SESSION_COOKIE);
	if (!token || !(await isAuthed({ req: { raw: c.req.raw }, env: c.env }, token))) {
		return c.json(err('unauthorized', '请先登录家长区'), 401);
	}
	await next();
};
