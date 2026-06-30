-- ============================================
-- 商拓通 · Supabase 建表 SQL
-- 在 Supabase 控制台 → SQL Editor 中执行
-- ============================================

-- 1. 客户机构表
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  industry    TEXT,
  created_at  BIGINT
);

-- 2. 我方人员表
CREATE TABLE IF NOT EXISTS my_users (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  position  TEXT
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
  phone          TEXT
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
