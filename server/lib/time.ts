// 上海固定 UTC+8，无夏令时，直接偏移换算即可。
const SHANGHAI_OFFSET_MS = 8 * 3600_000;

/** 上海时区的当天日期（YYYY-MM-DD） */
export function shanghaiToday(now = new Date()): string {
	return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 生字入池的首个到期时间：上海当天 20:00（= 当天 12:00 UTC）。
 * 若当前已过 20:00，则立即到期（当晚就能测）。
 */
export function dueTonightUtcIso(now = new Date()): string {
	const sh = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
	const dueUtcMs = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), 12, 0, 0);
	return new Date(dueUtcMs >= now.getTime() ? dueUtcMs : now.getTime()).toISOString();
}
