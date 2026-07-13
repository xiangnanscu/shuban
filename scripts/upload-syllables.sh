#!/usr/bin/env bash
# 把真人音节录音库（davinfifield/mp3-chinese-pinyin-sound，Unlicense 公有领域）
# 一次性灌进 R2 syllables/ 前缀，免去线上首次点字时的 GitHub 拉取延迟（~1s）。
#
# 键名与 /api/syllable 路由约定一致：{音节}{声调1-5}.mp3。
# 库里 5 个无调号裸文件（de/ma/zi/zhai/luun）映射到 {音节}5：
# 已有显式 5 号版本的（de5/ma5）跳过裸版，其余按 5 号键上传。
#
# 可重复执行：成功清单记在缓存目录，重跑只补漏。并行度 JOBS=6 可覆盖。
set -euo pipefail

BUCKET=shuban
PREFIX=syllables
TARBALL_URL=https://github.com/davinfifield/mp3-chinese-pinyin-sound/archive/refs/heads/master.tar.gz
CACHE_DIR="${SYLLABLE_CACHE_DIR:-$HOME/.cache/shuban-syllables}"
MANIFEST="$CACHE_DIR/uploaded.txt"
JOBS="${JOBS:-6}"
WRANGLER="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin/wrangler"

mkdir -p "$CACHE_DIR"
touch "$MANIFEST"

if [ ! -d "$CACHE_DIR/mp3" ]; then
	echo "下载录音库 tarball ..."
	curl -fL --retry 3 --max-time 300 -o "$CACHE_DIR/repo.tar.gz" "$TARBALL_URL"
	tar -xzf "$CACHE_DIR/repo.tar.gz" -C "$CACHE_DIR" --strip-components=1 "*/mp3"
	rm -f "$CACHE_DIR/repo.tar.gz"
fi

# 生成 "本地文件<TAB>R2键名" 上传清单
PLAN="$CACHE_DIR/plan.txt"
: > "$PLAN"
for f in "$CACHE_DIR"/mp3/*.mp3; do
	name="$(basename "$f" .mp3)"
	case "$name" in
	*[0-9]) key="$name" ;;
	*)
		# 裸名 = 轻声：有显式 5 号版本就跳过，否则映射成 {name}5
		[ -f "$CACHE_DIR/mp3/${name}5.mp3" ] && continue
		key="${name}5"
		;;
	esac
	grep -qx "$key" "$MANIFEST" || printf '%s\t%s\n' "$f" "$key" >> "$PLAN"
done

TOTAL=$(wc -l < "$PLAN" | tr -d ' ')
echo "待上传 $TOTAL 个（已完成 $(wc -l < "$MANIFEST" | tr -d ' ') 个，清单：${MANIFEST}）"
[ "$TOTAL" -eq 0 ] && { echo "无需上传，已全部完成。"; exit 0; }

upload_one() {
	local file="$1" key="$2"
	if "$WRANGLER" r2 object put "$BUCKET/$PREFIX/$key.mp3" \
		--file "$file" --content-type audio/mpeg --remote >/dev/null 2>&1; then
		echo "$key" >> "$MANIFEST"
		echo "ok $key"
	else
		echo "FAIL $key" >&2
	fi
}
export -f upload_one
export WRANGLER BUCKET PREFIX MANIFEST

xargs -P "$JOBS" -n 2 bash -c 'upload_one "$0" "$1"' < "$PLAN"

DONE=$(wc -l < "$MANIFEST" | tr -d ' ')
echo "本轮结束，清单累计 $DONE 个。"
if [ "$DONE" -lt 1630 ]; then
	echo "尚有缺口（期望 1630），重跑本脚本补漏。" >&2
	exit 1
fi
echo "全部 1630 个音节已入 R2 $BUCKET/$PREFIX/。"
