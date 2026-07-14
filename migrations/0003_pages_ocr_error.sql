-- 记录 OCR 失败的具体错误信息，供校对页点击查看
ALTER TABLE pages ADD COLUMN ocr_error TEXT;
