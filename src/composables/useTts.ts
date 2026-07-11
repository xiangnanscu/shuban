// 点字/整句发音：优先浏览器本地合成（零成本、离线可用），
// 设备没有中文语音时回退到服务端 /api/tts（MeloTTS + R2 缓存）。

let zhVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
let fallbackAudio: HTMLAudioElement | null = null;

function refreshVoices() {
	const voices = speechSynthesis.getVoices();
	voicesLoaded = voices.length > 0;
	zhVoice =
		voices.find((v) => v.localService && v.lang.replace('_', '-').toLowerCase().startsWith('zh')) ??
		voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('zh')) ??
		null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
	refreshVoices();
	speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

function playFallback(text: string) {
	fallbackAudio?.pause();
	fallbackAudio = new Audio(`/api/tts/${encodeURIComponent(text)}`);
	void fallbackAudio.play().catch(() => {
		/* 兜底也失败：静默（UI 已有拼音可读） */
	});
}

export function speak(text: string): void {
	if (!text) return;
	const hasSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
	// voices 已加载但没有任何中文语音 → 直接走服务端兜底
	if (!hasSynthesis || (voicesLoaded && !zhVoice)) {
		playFallback(text);
		return;
	}
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = 'zh-CN';
	if (zhVoice) u.voice = zhVoice;
	u.rate = 0.8;
	speechSynthesis.speak(u);
}

export function useTts() {
	return { speak };
}
