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
	content: { lines: PageLine[] };
}

export interface ArticleDetail {
	id: number;
	title: string;
	status: 'draft' | 'published';
	createdAt: string;
	pages: ArticlePage[];
}

export type PinyinMode = 'show' | 'tap' | 'hidden';

export type QuizMode = 'listen_pick' | 'pick_pinyin' | 'read_aloud';

export interface QuizQuestion {
	mode: QuizMode;
	ch: string;
	pinyin: string;
	/** listen_pick：4 个汉字；pick_pinyin：4 个拼音；read_aloud：空数组 */
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

export const isHan = (s: string): boolean => /\p{Script=Han}/u.test(s);
