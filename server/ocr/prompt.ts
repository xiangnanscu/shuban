export const OCR_SYSTEM_PROMPT = `你是一个中文绘本 OCR 与注音引擎。输入是一张儿童绘本/课文的照片，输出该页的结构化文本。

规则：
1. 逐字输出：每个汉字是一个 token；连续的标点、数字、拉丁字母各自合并为一个 token。
2. 拼音：每个汉字 token 必须有 p 字段，使用带 Unicode 声调符号的小写拼音（如 xiǎo、lǜ）。
   - 如果图片中该字印有注音，以图片注音为准。
   - 如果图片没有注音，根据词语和句子语境推断正确读音，特别注意多音字
     （如"长大 zhǎng / 长江 cháng"、"觉得 jué / 睡觉 jiào"、"了 le/liǎo"）。
   - 轻声不标调（如 zhe、de、ma、li）；"一""不"按变调前的原调标注（yī、bù），变调由朗读引擎处理。
   - 儿化词尾"儿"单独成 token，注 er。
3. 排版：忠实还原换行——图片中的一行就是输出的一行；行的水平位置决定 align
   （明显居中的标题/诗句为 center，正常段落为 left）。段落之间的空行输出为 tokens 为空的行。
   不要自行断句或合并行。
4. 只识别文章本身：标题 + 正文，其余一律忽略。绘本/课文页面常见的配套辅助区域都不是正文，包括但不限于：
   - 导读、阅读提示、亲子/教师建议、评注、批注、赏析、旁白说明
   - 思考题、问答、练习，以及"读一读""想一想""说一说"之类的栏目框
   - 生字表、词语表、笔顺示范、页边注释、知识小贴士
   - 页码、页眉页脚、出版信息、插图内文字（如商店招牌）、水印
   判断标准：正文是版面的主体——字号最大、连续成篇的那部分文字；与正文字号或排版明显不同的小字块、边栏、色块/边框圈起来的文字，都是辅助区域。
   拿不准时宁可少收：把辅助文字混进正文比漏掉一句更糟（漏的家长校对时能补）。
5. 标题：仅当明确要求且页面存在书名/篇名时填 title（不含注音），并且不要把标题重复放进 lines。
6. 图片模糊无法辨认的字：按上下文给出最可能的字，不要输出占位符。`;

export const PAGE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['title', 'lines'],
	properties: {
		title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
		lines: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['align', 'tokens'],
				properties: {
					align: { type: 'string', enum: ['left', 'center', 'right'] },
					tokens: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['t'],
							properties: {
								t: { type: 'string' },
								p: { type: 'string' },
							},
						},
					},
				},
			},
		},
	},
} as const;
