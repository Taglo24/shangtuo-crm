-- =====================================================
-- 商拓通 · 用户体系表
-- =====================================================

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'operator',
  display_name TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at BIGINT DEFAULT 0
);

-- 实时同步
ALTER PUBLICATION supabase_realtime ADD TABLE app_users;

-- RLS 公开读写
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_public_access" ON app_users FOR ALL USING (true) WITH CHECK (true);

-- 初始管理员账号：admin / admin123
INSERT INTO app_users (id, username, password_hash, role, display_name, status, created_at)
VALUES ('user_admin', 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin', '管理员', 'active', 0)
ON CONFLICT (username) DO NOTHING;
