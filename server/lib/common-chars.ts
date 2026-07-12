// 内置一年级常用字表（约 300 字，随代码打包）：生字池不足 4 字时为测验补干扰项（§9.3）。
// 格式：每项 = 单个汉字 + 带调拼音（多音字取小学低年级最常见读音）。

const RAW = `
一yī 二èr 三sān 四sì 五wǔ 六liù 七qī 八bā 九jiǔ 十shí 百bǎi
天tiān 地dì 日rì 月yuè 星xīng 光guāng 云yún 雨yǔ 风fēng 雪xuě 冰bīng 雷léi 电diàn
山shān 水shuǐ 火huǒ 石shí 田tián 土tǔ 江jiāng 河hé 湖hú 海hǎi 沙shā
林lín 森sēn 树shù 木mù 花huā 草cǎo 叶yè 竹zhú 苗miáo 果guǒ 瓜guā 豆dòu 桃táo 杏xìng 梨lí
鸟niǎo 虫chóng 鱼yú 虾xiā 牛niú 马mǎ 羊yáng 猫māo 狗gǒu 鸡jī 鸭yā 兔tù 猪zhū 象xiàng 熊xióng 鹅é
人rén 你nǐ 我wǒ 他tā 她tā 它tā 们men 爸bà 妈mā 爷yé 奶nǎi 哥gē 姐jiě 弟dì 妹mèi 儿ér 女nǚ 子zǐ
家jiā 亲qīn 朋péng 友yǒu
口kǒu 耳ěr 目mù 手shǒu 足zú 头tóu 脸liǎn 眼yǎn 睛jīng 鼻bí 嘴zuǐ 牙yá 脚jiǎo 心xīn 身shēn 发fā
上shàng 下xià 左zuǒ 右yòu 前qián 后hòu 里lǐ 外wài 中zhōng 东dōng 西xī 南nán 北běi 边biān 间jiān 旁páng
来lái 去qù 出chū 入rù 回huí 到dào 过guò 起qǐ 走zǒu 跑pǎo 跳tiào 飞fēi 游yóu 坐zuò 站zhàn
睡shuì 觉jiào 吃chī 喝hē 看kàn 见jiàn 听tīng 说shuō 讲jiǎng 问wèn 答dá 读dú 写xiě 画huà 唱chàng
笑xiào 哭kū 玩wán 找zhǎo 送sòng 拿ná 放fàng 打dǎ 拉lā 抱bào 洗xǐ 开kāi 关guān
学xué 习xí 想xiǎng 爱ài 要yào 让ràng 给gěi 用yòng 会huì 能néng 做zuò 生shēng
大dà 小xiǎo 多duō 少shǎo 高gāo 低dī 长cháng 好hǎo 坏huài 新xīn 旧jiù 快kuài 慢màn
远yuǎn 近jìn 早zǎo 晚wǎn 真zhēn 正zhèng 方fāng 圆yuán 半bàn 全quán
白bái 黑hēi 红hóng 黄huáng 蓝lán 绿lǜ 青qīng 亮liàng 香xiāng 甜tián 色sè
书shū 本běn 刀dāo 尺chǐ 笔bǐ 纸zhǐ 字zì 文wén 课kè 班bān 校xiào 师shī 老lǎo 同tóng
音yīn 乐lè 体tǐ 育yù 歌gē 话huà
车chē 船chuán 路lù 桥qiáo 门mén 窗chuāng 房fáng 屋wū 床chuáng 灯dēng
衣yī 服fú 帽mào 鞋xié 米mǐ 饭fàn 菜cài 茶chá 蛋dàn 肉ròu 球qiú 旗qí 伞sǎn 杯bēi 包bāo
年nián 岁suì 今jīn 明míng 昨zuó 时shí 分fēn 春chūn 夏xià 秋qiū 冬dōng
的de 了le 着zhe 是shì 在zài 有yǒu 和hé 也yě 都dōu 还hái 就jiù 很hěn 最zuì 先xiān 再zài
又yòu 与yǔ 从cóng 向xiàng 对duì 不bù 没méi 什shén 么me 谁shéi 这zhè 那nà 哪nǎ
吗ma 呢ne 吧ba 啊a
个gè 只zhī 条tiáo 张zhāng 把bǎ 片piàn 块kuài 朵duǒ 棵kē 群qún 双shuāng 位wèi
声shēng 点diǎn 面miàn 自zì 己jǐ 可kě 以yǐ 因yīn 为wèi 所suǒ 但dàn
国guó 京jīng 安ān 广guǎng 场chǎng 公gōng 园yuán 空kōng 气qì 晴qíng 阴yīn 阳yáng 太tài 金jīn
力lì 工gōng 禾hé 皮pí 毛máo 巾jīn 尾wěi 巴bā 尘chén 尖jiān 众zhòng 虹hóng 壶hú
乡xiāng 村cūn 居jū 住zhù 处chù 名míng 叫jiào 主zhǔ 认rèn 识shí 知zhī 道dào 帮bāng 忙máng 弯wān
`;

export interface CommonChar {
	ch: string;
	pinyin: string;
}

export const COMMON_CHARS: CommonChar[] = RAW.split(/\s+/)
	.filter(Boolean)
	.map((entry) => {
		const [ch = '', ...rest] = entry;
		return { ch, pinyin: rest.join('') };
	});

const BY_CH = new Map(COMMON_CHARS.map((c) => [c.ch, c.pinyin]));

/** 常用字表里查拼音（chars.pinyin 为空时兜底） */
export function commonPinyinOf(ch: string): string {
	return BY_CH.get(ch) ?? '';
}
