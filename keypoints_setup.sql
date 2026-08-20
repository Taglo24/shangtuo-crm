-- =====================================================
-- 商拓通 · 重点事项表（keypoints）建表脚本
-- 在 Supabase 控制台 → SQL Editor 中一次性运行
-- =====================================================

-- 1. 重点事项表（按机构维度隔离）
CREATE TABLE IF NOT EXISTS keypoints (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  node TEXT DEFAULT '',
  details TEXT DEFAULT '',
  issues JSONB DEFAULT '[]',
  status TEXT DEFAULT 'active',
  updated_at BIGINT DEFAULT 0
);

-- 2. 启用实时同步（Realtime）
ALTER PUBLICATION supabase_realtime ADD TABLE keypoints;

-- 3. RLS 策略 — 允许公开读写（与现有表一致）
ALTER TABLE keypoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_public_access" ON keypoints FOR ALL USING (true) WITH CHECK (true);
