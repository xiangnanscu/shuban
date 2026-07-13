/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** 真人音节录音增益倍数（客户端 Web Audio GainNode，默认 2.2，见 useTts.ts） */
	readonly VITE_SYLLABLE_GAIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
