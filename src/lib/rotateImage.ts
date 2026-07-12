/** 顺时针旋转任意角度（90 的倍数）并重新编码为 JPEG，用于校对时修正拍歪/拍倒的原图 */
export async function rotateImageBlob(blob: Blob, rotationDeg: 90 | 180 | 270, quality = 0.9): Promise<Blob> {
	const bmp = await createImageBitmap(blob);
	const swap = rotationDeg === 90 || rotationDeg === 270;
	const w = swap ? bmp.height : bmp.width;
	const h = swap ? bmp.width : bmp.height;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 不可用');
	ctx.translate(w / 2, h / 2);
	ctx.rotate((rotationDeg * Math.PI) / 180);
	ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
	bmp.close();
	const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
	if (!out) throw new Error('图片旋转失败');
	return out;
}
