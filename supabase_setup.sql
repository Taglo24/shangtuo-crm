-- =====================================================
-- 商拓通 · Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中一次性运行
-- =====================================================

-- 1. 甲方机构表
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  created_at BIGINT DEFAULT 0,
  detail_url TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  updated_at BIGINT DEFAULT 0
);

-- 2. 我方人员表
CREATE TABLE IF NOT EXISTS my_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  updated_at BIGINT DEFAULT 0
);

-- 3. 甲方人员表
CREATE TABLE IF NOT EXISTS client_persons (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  importance TEXT DEFAULT 'C',
  parent_id TEXT DEFAULT NULL,
  my_contact_id TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  updated_at BIGINT DEFAULT 0
);

-- 4. 沟通记录表
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  date TEXT DEFAULT '',
  type TEXT DEFAULT 'other',
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  my_user_id TEXT DEFAULT '',
  client_person_ids JSONB DEFAULT '[]',
  created_at BIGINT DEFAULT 0,
  updated_at BIGINT DEFAULT 0
);

-- 5. 启用实时同步（Realtime）
ALTER PUBLICATION supabase_realtime ADD TABLE orgs;
ALTER PUBLICATION supabase_realtime ADD TABLE my_users;
ALTER PUBLICATION supabase_realtime ADD TABLE client_persons;
ALTER PUBLICATION supabase_realtime ADD TABLE records;

-- 6. RLS 策略 — 允许公开读写（anon key 可见，与公开网页匹配）
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_public_access" ON orgs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_public_access" ON my_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_public_access" ON client_persons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_public_access" ON records FOR ALL USING (true) WITH CHECK (true);

-- 7. 启用 Realtime 扩展（如果未启用）
-- Supabase 控制台 → Database → Replication → 确认 supabase_realtime 发布已包含上述4张表
