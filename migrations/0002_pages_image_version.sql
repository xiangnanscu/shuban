-- 图片版本号：替换/旋转页图片时自增，用于让 /api/files 的 immutable 缓存失效
ALTER TABLE pages ADD COLUMN image_version INTEGER NOT NULL DEFAULT 1;
