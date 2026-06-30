# 商拓通 · 手机端同步部署指引

## 架构说明

```
手机/电脑浏览器  →  Vercel (静态托管)  →  Supabase (云数据库)
                                          ↑ 数据实时同步
```

- **前端**：静态 HTML/CSS/JS，部署在 Vercel，手机电脑访问同一 URL
- **后端**：Supabase 免费云数据库（PostgreSQL），数据云端实时同步
- **降级**：未配置云端时自动使用浏览器本地存储，不影响使用

---

## 部署三步走

### 第一步：注册 Supabase 并建表（约 5 分钟）

1. 打开 https://supabase.com ，点击 Start，用 GitHub 账号登录（免费）
2. 创建新项目：填写项目名、设置数据库密码、选择区域（East Asia 推荐）
3. 等待项目初始化完成（约 2 分钟）
4. 进入项目后，左侧菜单点 **SQL Editor**
5. 点击 New query，将本项目 `supabase.sql` 文件内容完整粘贴进去
6. 点 Run 执行，看到 Success 即建表完成

### 第二步：获取 API 配置

1. 在 Supabase 项目左侧菜单点 **Project Settings**（齿轮图标）
2. 点 **API**
3. 找到两项关键信息：
   - **Project URL**：形如 `https://xxxxx.supabase.co`
   - **anon public key**：一长串 `eyJhbGciOi...` 开头的字符串

### 第三步：在应用中填入配置

1. 用浏览器打开商拓通页面
2. 点击右上角"本地模式"状态点（或手机端顶部的圆点）
3. 在弹出的配置面板中填入上述 URL 和 anon key
4. 点"保存并连接"，状态变为"云端已同步"即成功

---

## 部署到 Vercel（让手机能访问）

### 方式一：Vercel 拖拽部署（最快）

1. 打开 https://vercel.com ，用 GitHub 登录
2. 点击 Add New → Project
3. 将本项目的 `index.html`、`style.css`、`app.js` 三个文件放入一个文件夹
4. 在 Vercel 页面拖拽上传该文件夹
5. 部署完成后获得一个 URL，如 `https://shangtuo.vercel.app`
6. 手机浏览器打开这个 URL 即可使用

### 方式二：GitHub 仓库部署（推荐，便于后续更新）

1. 在 GitHub 创建一个新仓库
2. 上传 `index.html`、`style.css`、`app.js` 三个文件
3. 在 Vercel 点 Import Project，选择该仓库
4. Framework Preset 选 Other，直接 Deploy
5. 后续修改代码 push 到 GitHub，Vercel 自动重新部署

---

## 使用说明

| 操作 | 说明 |
|------|------|
| 配置云同步 | 点右上角同步状态点，填入 Supabase URL 和 key |
| 断开云同步 | 配置面板中断开连接，回到本地模式 |
| 手机访问 | 部署后用手机浏览器打开 URL，底部有导航栏 |
| 数据同步 | 配置云端后，所有新增/编辑/删除自动同步 |
| 重置数据 | 右上角重置按钮，恢复示例数据（会覆盖当前数据） |

## 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 页面结构 |
| `style.css` | 样式 + 响应式适配 |
| `app.js` | 应用逻辑 + Supabase 云同步 |
| `supabase.sql` | 数据库建表语句 |
| `README.md` | 本文档 |

## 注意事项

- Supabase 免费额度：500MB 数据库存储、50000 月活用户，原型阶段完全够用
- 原型阶段 RLS 策略允许匿名读写，正式上线前请收紧为仅认证用户
- 首次配置云同步时，如云端已有数据会优先加载云端数据
- 未配置云同步时，数据存在浏览器本地，不同设备间不互通
