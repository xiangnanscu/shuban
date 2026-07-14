export interface PageToken {
	t: string;
	p?: string;
}

export interface PageLine {
	align: 'left' | 'center' | 'right';
	tokens: PageToken[];
}

export interface ArticleSummary {
	id: number;
	title: string;
	status: 'draft' | 'published';
	coverUrl: string | null;
	pageCount: number;
	createdAt: string;
}

export interface ArticlePage {
	id: number;
	pageNo: number;
	imageUrl: string;
	ocrStatus: 'pending' | 'done' | 'failed';
	ocrError: string | null;
	content: { lines: PageLine[] };
}

export interface ArticleDetail {
	id: number;
	title: string;
	status: 'draft' | 'published';
	createdAt: string;
	prevId: number | null;
	nextId: number | null;
	pages: ArticlePage[];
}

export type PinyinMode = 'show' | 'tap' | 'hidden';

export type QuizMode = 'listen_pick';

export interface QuizQuestion {
	mode: QuizMode;
	ch: string;
	pinyin: string;
	/** 4 个汉字选项（含目标字），田字格展示 */
	options: string[];
}

export interface DueItem {
	ch: string;
	pinyin: string;
	box: number;
}

export interface PoolItem {
	ch: string;
	pinyin: string;
	box: number;
	dueAt: string;
	graduated: boolean;
	correctCount: number;
	wrongCount: number;
	totalTaps: number;
}

export interface RecordingItem {
	id: number;
	articleId: number | null;
	articleTitle: string;
	url: string;
	durationSec: number | null;
	sizeBytes: number | null;
	createdAt: string;
}

export interface StatsSummary {
	streak: number;
	activeToday: boolean;
	articlesRead: number;
	poolActive: number;
	graduated: number;
	dueToday: number;
	topChars: { ch: string; pinyin: string; taps: number }[];
}

export interface PoolDetailItem {
	ch: string;
	pinyin: string;
	graduated: boolean;
}

export interface ReadingPlanEntry {
	articleId: number;
	title: string;
	/** 本篇为目标生字覆盖到的字 */
	covers: string[];
}

export interface ReadingPlan {
	scope: 'due' | 'all';
	targetCount: number;
	plan: ReadingPlanEntry[];
	/** 没有任何文章包含的字（原文章已删等） */
	uncovered: string[];
}

export type AiProviderName = 'gemini' | 'workersai' | 'claude' | 'mimo';

export interface AiSettings {
	primaryProvider: AiProviderName | null;
	geminiModel: string | null;
	workersaiModel: string | null;
	claudeModel: string | null;
	mimoModel: string | null;
	timeoutMs: number | null;
	defaults: {
		providerOrder: AiProviderName[];
		geminiModel: string;
		workersaiModel: string;
		claudeModel: string;
		mimoModel: string;
		timeoutMs: number;
	};
}

export const isHan = (s: string): boolean => /\p{Script=Han}/u.test(s);
