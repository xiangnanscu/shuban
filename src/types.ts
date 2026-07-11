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

export const isHan = (s: string): boolean => /\p{Script=Han}/u.test(s);
