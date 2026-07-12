// 点字/整句发音。单字带拼音走 /api/syllable 真人音节录音（声调跟校对拼音，多音字不出错）；
// 整句优先浏览器本地合成（零成本、离线可用），设备没有中文语音时回退服务端 /api/tts（MeloTTS + R2 缓存）。

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

function useServerFallback(): boolean {
	const hasSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
	return !hasSynthesis || (voicesLoaded && !zhVoice);
}

/** 停掉当前一切发音（本地合成 + 兜底音频） */
export function cancelSpeak(): void {
	if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
	fallbackAudio?.pause();
	fallbackAudio = null;
}

function playFallback(text: string, onDone?: () => void) {
	fallbackAudio?.pause();
	const audio = new Audio(`/api/tts/${encodeURIComponent(text)}`);
	fallbackAudio = audio;
	if (onDone) {
		audio.onended = onDone;
		audio.onerror = onDone;
	}
	void audio.play().catch(() => onDone?.());
}

function speakSynth(text: string): void {
	if (useServerFallback()) {
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

/**
 * 即发即忘（点字、选项发音）。
 * 单字且带校对拼音时优先真人音节录音（声调准、音色纯正），失败退回合成。
 */
export function speak(text: string, pinyin?: string): void {
	if (!text) return;
	if (pinyin && [...text].length === 1) {
		cancelSpeak();
		const audio = new Audio(`/api/syllable/${encodeURIComponent(pinyin)}`);
		fallbackAudio = audio;
		let failed = false;
		const fallback = () => {
			if (failed) return;
			failed = true;
			speakSynth(text);
		};
		audio.onerror = fallback;
		void audio.play().catch(fallback);
		return;
	}
	speakSynth(text);
}

/** 朗读并等待结束（"听全文"逐行链式播放用）。被 cancelSpeak 打断也会 resolve。 */
export function speakAsync(text: string): Promise<void> {
	return new Promise((resolve) => {
		if (!text) return resolve();
		if (useServerFallback()) {
			playFallback(text, resolve);
			return;
		}
		speechSynthesis.cancel();
		const u = new SpeechSynthesisUtterance(text);
		u.lang = 'zh-CN';
		if (zhVoice) u.voice = zhVoice;
		u.rate = 0.8;
		u.onend = () => resolve();
		u.onerror = () => resolve();
		speechSynthesis.speak(u);
	});
}

export function useTts() {
	return { speak, speakAsync, cancelSpeak };
}
