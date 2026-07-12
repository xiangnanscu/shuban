/** 上传前压缩：长边 ≤maxEdge、JPEG（控制 OCR token 成本），可选顺时针旋转（拍歪/拍倒时用） */
export async function compressImage(
	file: File | Blob,
	maxEdge = 1568,
	quality = 0.85,
	rotationDeg: 0 | 90 | 180 | 270 = 0,
): Promise<Blob> {
	const bmp = await createImageBitmap(file);
	const swap = rotationDeg === 90 || rotationDeg === 270;
	const outW = swap ? bmp.height : bmp.width;
	const outH = swap ? bmp.width : bmp.height;
	const scale = Math.min(1, maxEdge / Math.max(outW, outH));
	const w = Math.round(outW * scale);
	const h = Math.round(outH * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 不可用');
	ctx.translate(w / 2, h / 2);
	ctx.rotate((rotationDeg * Math.PI) / 180);
	ctx.drawImage(bmp, -(bmp.width * scale) / 2, -(bmp.height * scale) / 2, bmp.width * scale, bmp.height * scale);
	bmp.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
	if (!blob) throw new Error('图片压缩失败');
	return blob;
}
