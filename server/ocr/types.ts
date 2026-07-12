export interface PageToken {
	/** 单个汉字，或一段连续的非汉字串（标点/数字/拉丁） */
	t: string;
	/** 拼音（带 Unicode 声调）；仅汉字 token 有 */
	p?: string;
}

export interface PageLine {
	align: 'left' | 'center' | 'right';
	tokens: PageToken[];
}

export interface PageContent {
	/** 仅第一页可能返回书名/篇名 */
	title: string | null;
	lines: PageLine[];
}

export interface OcrProvider {
	recognize(image: ArrayBuffer, opts: { isFirstPage: boolean; signal: AbortSignal }): Promise<PageContent>;
}
