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

/** fetch 无上传进度事件，大表单（批量图片）用 XHR 才能给用户看实时上传百分比 */
export function apiUpload<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', path);
		xhr.upload.onprogress = (e) => {
			if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			let j: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
			try {
				j = JSON.parse(xhr.responseText);
			} catch {
				/* 非 JSON 响应 */
			}
			if (xhr.status >= 200 && xhr.status < 300 && j?.ok) resolve(j.data as T);
			else
				reject(
					new ApiError(j?.error?.code ?? `http_${xhr.status}`, j?.error?.message ?? `请求失败（${xhr.status}）`, xhr.status),
				);
		};
		xhr.onerror = () => reject(new ApiError('network', '网络错误，请重试', 0));
		xhr.send(form);
	});
}
