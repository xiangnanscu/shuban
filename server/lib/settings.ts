export async function getSetting(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.bind(key, value)
		.run();
}

export async function deleteSetting(db: D1Database, key: string): Promise<void> {
	await db.prepare('DELETE FROM settings WHERE key = ?1').bind(key).run();
}
