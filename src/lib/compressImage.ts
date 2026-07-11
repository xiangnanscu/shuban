/** 上传前压缩：长边 ≤maxEdge、JPEG（控制 OCR token 成本） */
export async function compressImage(file: File, maxEdge = 1568, quality = 0.85): Promise<Blob> {
	const bmp = await createImageBitmap(file);
	const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
	const w = Math.round(bmp.width * scale);
	const h = Math.round(bmp.height * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 不可用');
	ctx.drawImage(bmp, 0, 0, w, h);
	bmp.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
	if (!blob) throw new Error('图片压缩失败');
	return blob;
}
