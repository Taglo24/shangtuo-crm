-- ============================================
-- 商拓通 · Supabase 建表 SQL（v2.6.2+）
-- 在 Supabase 控制台 → SQL Editor 中执行
-- ============================================

-- 1. 客户机构表
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  industry    TEXT,
  detail_url  TEXT,
  sort_order  INTEGER DEFAULT 100,
  created_at  BIGINT
);

-- 2. 我方人员表
CREATE TABLE IF NOT EXISTS my_users (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  position  TEXT,
  status    TEXT DEFAULT 'active'
);

-- 3. 甲方人员表
CREATE TABLE IF NOT EXISTS client_persons (
  id             TEXT PRIMARY KEY,
  org_id         TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  position       TEXT,
  importance     TEXT DEFAULT 'C',
  parent_id      TEXT,
  my_contact_id  TEXT REFERENCES my_users(id),
  phone          TEXT,
  status         TEXT DEFAULT 'active'
);

-- 4. 沟通记录表（client_person_ids 用数组存储多对多关系）
CREATE TABLE IF NOT EXISTS records (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,
  type               TEXT,
  title              TEXT,
  content            TEXT,
  my_user_id         TEXT REFERENCES my_users(id),
  client_person_ids  TEXT[] DEFAULT '{}',
  created_at         BIGINT
);

-- ============================================
-- 开启 RLS（行级安全）策略
-- 原型阶段允许匿名读写，生产环境请收紧权限
-- ============================================
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

-- 允许匿名访问（原型验证用，上线前请改为仅认证用户）
CREATE POLICY "Allow all for prototype" ON orgs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for prototype" ON my_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for prototype" ON client_persons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for prototype" ON records FOR ALL USING (true) WITH CHECK (true);

-- 如果表已存在需加新字段，取消注释以下并执行：
-- ALTER TABLE orgs ADD COLUMN IF NOT EXISTS detail_url TEXT;
-- ALTER TABLE orgs ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;
-- ALTER TABLE my_users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
-- ALTER TABLE client_persons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
