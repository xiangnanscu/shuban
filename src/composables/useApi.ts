export class ApiError extends Error {
	constructor(
		public code: string,
		message: string,
		public status: number,
	) {
		super(message);
	}
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers);
	if (init?.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
	const res = await fetch(path, { ...init, headers });
	let j: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
	try {
		j = await res.json();
	} catch {
		/* 非 JSON 响应 */
	}
	if (!res.ok || !j?.ok) {
		throw new ApiError(j?.error?.code ?? `http_${res.status}`, j?.error?.message ?? `请求失败（${res.status}）`, res.status);
	}
	return j.data as T;
}
