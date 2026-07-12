import { ref } from 'vue';
import { Mp3Encoder } from '@breezystack/lamejs';

// 采集：getUserMedia → AudioWorklet（不支持则 ScriptProcessor）取 PCM
// 编码：lamejs 实时编 MP3（128kbps 单声道），无服务器转码
const WORKLET_CODE = `
class PcmCapture extends AudioWorkletProcessor {
	process(inputs) {
		const ch = inputs[0] && inputs[0][0];
		if (ch) this.port.postMessage(ch.slice(0));
		return true;
	}
}
registerProcessor('pcm-capture', PcmCapture);
`;

export function useRecorder() {
	const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
	const recording = ref(false);
	const seconds = ref(0);
	const level = ref(0);
	const blobUrl = ref<string | null>(null);
	const durationSec = ref(0);
	const error = ref('');

	let ctx: AudioContext | null = null;
	let stream: MediaStream | null = null;
	let workletNode: AudioWorkletNode | null = null;
	let scriptNode: ScriptProcessorNode | null = null;
	let silentGain: GainNode | null = null;
	let encoder: Mp3Encoder | null = null;
	let chunks: Uint8Array[] = [];
	let sampleCount = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let wakeLock: { release(): Promise<void> } | null = null;
	let mp3Blob: Blob | null = null;

	function onPcm(f32: Float32Array) {
		if (!encoder) return;
		const i16 = new Int16Array(f32.length);
		let sum = 0;
		for (let i = 0; i < f32.length; i++) {
			const s = Math.max(-1, Math.min(1, f32[i] ?? 0));
			i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
			sum += s * s;
		}
		const out = encoder.encodeBuffer(i16);
		if (out.length > 0) chunks.push(new Uint8Array(out));
		sampleCount += f32.length;
		level.value = Math.min(1, Math.sqrt(sum / f32.length) * 4);
	}

	async function start(): Promise<void> {
		error.value = '';
		discard();
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: true, channelCount: 1 },
			});
			ctx = new AudioContext();
			await ctx.resume();
			const sampleRate = ctx.sampleRate;
			encoder = new Mp3Encoder(1, sampleRate, 128);
			chunks = [];
			sampleCount = 0;

			const source = ctx.createMediaStreamSource(stream);
			// 静音增益：让节点接入图谱被驱动，但不外放（防啸叫）
			silentGain = ctx.createGain();
			silentGain.gain.value = 0;
			silentGain.connect(ctx.destination);

			if (ctx.audioWorklet) {
				const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'text/javascript' }));
				await ctx.audioWorklet.addModule(url);
				URL.revokeObjectURL(url);
				workletNode = new AudioWorkletNode(ctx, 'pcm-capture');
				workletNode.port.onmessage = (e) => onPcm(e.data as Float32Array);
				source.connect(workletNode);
				workletNode.connect(silentGain);
			} else {
				scriptNode = ctx.createScriptProcessor(4096, 1, 1);
				scriptNode.onaudioprocess = (e) => onPcm(e.inputBuffer.getChannelData(0));
				source.connect(scriptNode);
				scriptNode.connect(silentGain);
			}

			recording.value = true;
			seconds.value = 0;
			const startedAt = Date.now();
			timer = setInterval(() => {
				seconds.value = Math.floor((Date.now() - startedAt) / 1000);
			}, 250);
			try {
				wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<never> } }).wakeLock?.request(
					'screen',
				) ?? null;
			} catch {
				/* 不支持就算了 */
			}
		} catch (e) {
			teardown();
			error.value = e instanceof Error && e.name === 'NotAllowedError' ? '请允许使用麦克风' : '无法启动录音';
			throw e;
		}
	}

	/** 结束并生成 MP3 */
	function stop(): { blob: Blob; durationSec: number } | null {
		if (!recording.value || !encoder || !ctx) return null;
		const sampleRate = ctx.sampleRate;
		const tail = encoder.flush();
		if (tail.length > 0) chunks.push(new Uint8Array(tail));
		mp3Blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
		durationSec.value = Math.round((sampleCount / sampleRate) * 10) / 10;
		blobUrl.value = URL.createObjectURL(mp3Blob);
		teardown();
		return { blob: mp3Blob, durationSec: durationSec.value };
	}

	function cancel(): void {
		teardown();
		discard();
	}

	function discard(): void {
		if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
		blobUrl.value = null;
		mp3Blob = null;
		durationSec.value = 0;
		seconds.value = 0;
	}

	function teardown(): void {
		recording.value = false;
		level.value = 0;
		if (timer) clearInterval(timer);
		timer = null;
		workletNode?.disconnect();
		workletNode = null;
		if (scriptNode) scriptNode.onaudioprocess = null;
		scriptNode?.disconnect();
		scriptNode = null;
		silentGain?.disconnect();
		silentGain = null;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		void ctx?.close().catch(() => {});
		ctx = null;
		encoder = null;
		void wakeLock?.release().catch(() => {});
		wakeLock = null;
	}

	function getBlob(): Blob | null {
		return mp3Blob;
	}

	return { supported, recording, seconds, level, blobUrl, durationSec, error, start, stop, cancel, discard, getBlob };
}
