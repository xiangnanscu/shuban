// 点字记录队列：离线/失败时暂存 localStorage，恢复后补发，保证发音永远即时、记录最终一致。

interface Tap {
	ch: string;
	pinyin?: string;
	articleId?: number;
}

const KEY = 'shuban.tapQueue';
let queue: Tap[] = load();
let flushing = false;

function load(): Tap[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tap[];
	} catch {
		return [];
	}
}

function save() {
	localStorage.setItem(KEY, JSON.stringify(queue.slice(0, 500)));
}

export function recordTap(tap: Tap): void {
	queue.push(tap);
	save();
	void flush();
}

async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		while (queue.length > 0) {
			const tap = queue[0];
			const res = await fetch('/api/taps', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(tap),
			});
			// 4xx = 数据本身非法，丢弃防死循环；5xx/网络错 = 保留待重试
			if (!res.ok && res.status >= 500) throw new Error('server error, retry later');
			queue.shift();
			save();
		}
	} catch {
		/* 下次 online / 下次点击时再试 */
	} finally {
		flushing = false;
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => void flush());
	void flush();
}
