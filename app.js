// =====================================================
// 商拓通 · 商务协作管理平台 - 应用逻辑
// v8.0.0 - 用户认证体系 + Supabase 实时数据库
// =====================================================

const STORAGE_KEY = 'shangtuo_data_v1';
const SUPABASE_URL = 'https://bhyvbppafeppppqsvwrv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mAvxG4ohR7DzH-2MVitdqQ_I-kD90eK';

const IMPORTANCE_CONFIG = {
  S: { label: 'S级·核心决策者', short: 'S', color: '#EF4444', rank: 0 },
  A: { label: 'A级·关键影响者', short: 'A', color: '#F97316', rank: 1 },
  B: { label: 'B级·重要对接人', short: 'B', color: '#3B82F6', rank: 2 },
  C: { label: 'C级·普通对接人', short: 'C', color: '#10B981', rank: 3 },
  D: { label: 'D级·辅助人员', short: 'D', color: '#6B7280', rank: 4 },
};

const TYPE_CONFIG = {
  visit:   { label: '拜访', icon: 'map-pin',   color: '#4F46E5', cls: 'type-visit' },
  call:    { label: '电话', icon: 'phone',     color: '#0EA5E9', cls: 'type-call' },
  email:   { label: '邮件', icon: 'mail',      color: '#8B5CF6', cls: 'type-email' },
  meeting: { label: '会议', icon: 'video',     color: '#F59E0B', cls: 'type-meeting' },
  online:  { label: '线上', icon: 'monitor',   color: '#10B981', cls: 'type-online' },
  other:   { label: '其他', icon: 'file-text', color: '#6B7280', cls: 'type-other' },
};

let DB = { orgs: [], clientPersons: [], myUsers: [], records: [] };
let selectedTreeNode = null;
let selectedClientPersons = new Set();
let dragState = null;

// =====================================================
// 云端同步层 — Supabase 实时数据库
// 内置连接信息，所有设备打开即自动实时同步
// =====================================================
const Cloud = {
  client: null,
  enabled: true,
  status: 'off',
  _saveTimer: null,
  _reloadTimer: null,

  init() {
    try {
      this.client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      this.enabled = true;
      this.status = 'on';
      console.log('[Cloud] Supabase 客户端就绪');
      this._subscribeRealtime();
    } catch(e) {
      console.error('Supabase init failed:', e);
      this.enabled = false;
      this.status = 'err';
    }
    this.updateIndicator();
  },

  updateIndicator() {
    const el = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    if (!el) return;
    el.className = 'sync-dot sync-' + (this.status === 'on' ? 'on' : this.status === 'err' ? 'err' : this.status === 'spin' ? 'spin' : 'off');
    if (txt) txt.textContent = this.status === 'on' ? '云端已同步' : this.status === 'err' ? '同步异常' : this.status === 'spin' ? '同步中...' : '本地模式';
  },

  // 从 Supabase 全量加载数据
  async loadAll() {
    if (!this.client) return null;
    this.status = 'spin'; this.updateIndicator();
    try {
      const [orgsR, usersR, personsR, recordsR] = await Promise.all([
        this.client.from('orgs').select('*').order('sort_order'),
        this.client.from('my_users').select('*'),
        this.client.from('client_persons').select('*'),
        this.client.from('records').select('*').order('created_at', { ascending: false })
      ]);
      const data = {
        orgs: (orgsR.data || []).map(r => ({ id: r.id, name: r.name, industry: r.industry || '', createdAt: r.created_at || 0, detailUrl: r.detail_url || '', sortOrder: r.sort_order || 0 })),
        myUsers: (usersR.data || []).map(r => ({ id: r.id, name: r.name, position: r.position || '', status: r.status || 'active' })),
        clientPersons: (personsR.data || []).map(r => ({ id: r.id, orgId: r.org_id, name: r.name, position: r.position || '', importance: r.importance || 'C', parentId: r.parent_id || null, myContactId: r.my_contact_id || '', phone: r.phone || '', status: r.status || 'active' })),
        records: (recordsR.data || []).map(r => ({ id: r.id, date: r.date || '', type: r.type || 'other', title: r.title || '', content: r.content || '', myUserId: r.my_user_id || '', clientPersonIds: r.client_person_ids || [], createdAt: r.created_at || 0 }))
      };
      this.status = 'on'; this.updateIndicator();
      return data;
    } catch(e) {
      console.error('Cloud load failed:', e);
      this.status = 'on'; this.updateIndicator();
      return null;
    }
  },

  // 全量写入 Supabase（批量 upsert）
  async saveAll(db) {
    if (!this.client) return false;
    this.status = 'spin'; this.updateIndicator();
    try {
      const now = Date.now();
      const ops = [];
      if (db.orgs.length) {
        ops.push(this.client.from('orgs').upsert(db.orgs.map(o => ({ id: o.id, name: o.name, industry: o.industry || '', created_at: o.createdAt || 0, detail_url: o.detailUrl || '', sort_order: o.sortOrder || 0, updated_at: now }))));
      }
      if (db.myUsers.length) {
        ops.push(this.client.from('my_users').upsert(db.myUsers.map(u => ({ id: u.id, name: u.name, position: u.position || '', status: u.status || 'active', updated_at: now }))));
      }
      if (db.clientPersons.length) {
        ops.push(this.client.from('client_persons').upsert(db.clientPersons.map(p => ({ id: p.id, org_id: p.orgId, name: p.name, position: p.position || '', importance: p.importance || 'C', parent_id: p.parentId || null, my_contact_id: p.myContactId || '', phone: p.phone || '', status: p.status || 'active', updated_at: now }))));
      }
      if (db.records.length) {
        ops.push(this.client.from('records').upsert(db.records.map(r => ({ id: r.id, date: r.date || '', type: r.type || 'other', title: r.title || '', content: r.content || '', my_user_id: r.myUserId || '', client_person_ids: r.clientPersonIds || [], created_at: r.createdAt || 0, updated_at: now }))));
      }
      await Promise.all(ops);
      this.status = 'on'; this.updateIndicator();
      return true;
    } catch(e) {
      console.error('Cloud save failed:', e);
      this.status = 'on'; this.updateIndicator();
      return false;
    }
  },

  scheduleSave(db) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveAll(db), 1500);
  },

  // Supabase 实时订阅：任何设备修改 → 自动拉取
  _subscribeRealtime() {
    if (!this.client) return;
    this.client.channel('shangtuo-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orgs' },       () => this._onRemoteChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'my_users' },    () => this._onRemoteChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_persons' }, () => this._onRemoteChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records' },     () => this._onRemoteChange())
      .subscribe((status) => { if (status === 'SUBSCRIBED') console.log('Realtime connected'); });
  },

  // 远程变更 → 防抖 800ms 后重新加载（避免自己的写入触发重复加载）
  _onRemoteChange() {
    clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(async () => {
      const data = await this.loadAll();
      if (data) {
        DB = data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
        migrateData();
        renderAll();
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }, 800);
  }
};

// =====================================================
// 用户认证体系（管理员 / 操作员）
// =====================================================
const SESSION_KEY = 'shangtuo_session';
let currentUser = null; // { id, username, role, displayName }

// SHA-256 密码哈希（Web Crypto API）
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 检查登录状态
function checkSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try { currentUser = JSON.parse(saved); return true; } catch { return false; }
  }
  return false;
}

// 登录
async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!username || !password) { document.getElementById('loginError').classList.remove('hidden'); return; }

  const hash = await hashPassword(password);
  const { data, error } = await Cloud.client.from('app_users')
    .select('*').eq('username', username).eq('password_hash', hash).eq('status', 'active').single();

  if (data) {
    currentUser = { id: data.id, username: data.username, role: data.role, displayName: data.display_name || data.username };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('loginPassword').value = '';
    await loadData();
    renderAll();
    updateUserBar();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    document.getElementById('loginError').classList.remove('hidden');
  }
}

// 退出登录
function handleLogout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

// 更新顶部用户栏
function updateUserBar() {
  if (!currentUser) return;
  const bar = document.getElementById('userBar');
  if (!bar) return;
  const isAdmin = currentUser.role === 'admin';
  bar.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="w-7 h-7 rounded-full ${isAdmin ? 'bg-indigo-100 text-indigo-600' : 'bg-green-100 text-green-600'} flex items-center justify-center text-xs font-bold">${currentUser.displayName[0] || 'U'}</div>
      <span class="text-sm text-gray-600 font-medium">${currentUser.displayName}</span>
      <span class="text-xs px-1.5 py-0.5 rounded ${isAdmin ? 'bg-indigo-50 text-indigo-500' : 'bg-green-50 text-green-500'}">${isAdmin ? '管理员' : '操作员'}</span>
      ${isAdmin ? '<button onclick="openUserManager()" style="background:#6366f1;color:#fff;border:none;width:32px;height:32px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;" title="用户管理"><i data-lucide="settings" style="width:18px;height:18px;"></i></button>' : ''}
      <button onclick="handleLogout()" class="text-xs text-gray-400 hover:text-red-500 ml-1" title="退出登录"><i data-lucide="log-out" class="w-4 h-4"></i></button>
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// =====================================================
// 管理员 · 用户管理面板
// =====================================================
async function openUserManager() {
  const { data: users } = await Cloud.client.from('app_users').select('*').order('created_at');
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <i data-lucide="users-cog" class="w-5 h-5 text-indigo-500"></i>用户管理
      </h3>
      <div class="space-y-2 mb-6">
        ${(users || []).map(u => `
          <div class="flex items-center gap-3 p-3 border border-gray-200 rounded-lg ${u.id === currentUser.id ? 'bg-indigo-50' : ''}">
            <div class="w-9 h-9 rounded-full ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-600' : 'bg-green-100 text-green-600'} flex items-center justify-center font-bold text-sm">${(u.display_name || u.username)[0]}</div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-gray-800 text-sm">${u.display_name || u.username}</span>
                <span class="text-xs px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-indigo-50 text-indigo-500' : 'bg-green-50 text-green-500'}">${u.role === 'admin' ? '管理员' : '操作员'}</span>
                ${u.status === 'inactive' ? '<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">已停用</span>' : ''}
              </div>
              <p class="text-xs text-gray-400">@${u.username}</p>
            </div>
            ${u.id !== currentUser.id ? `
              <button onclick="resetUserPassword('${u.id}')" class="text-xs text-blue-500 hover:text-blue-700 px-2 py-1">重置密码</button>
              ${u.role !== 'admin' ? `<button onclick="deleteUser('${u.id}')" class="text-xs text-red-500 hover:text-red-700 px-2 py-1">删除</button>` : ''}
            ` : '<span class="text-xs text-gray-300">当前账号</span>'}
          </div>`).join('')}
      </div>
      <div class="border-t pt-4">
        <h4 class="font-semibold text-gray-700 text-sm mb-3">添加操作员</h4>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <input type="text" id="newUsername" placeholder="登录用户名" class="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <input type="text" id="newDisplayName" placeholder="显示名称" class="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          </div>
          <input type="password" id="newPassword" placeholder="登录密码" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <button onclick="addOperator()" class="w-full bg-indigo-500 text-white rounded-lg py-2 text-sm font-semibold hover:bg-indigo-600">添加操作员</button>
        </div>
      </div>
      <button onclick="closeModal()" class="w-full mt-4 bg-gray-100 text-gray-600 rounded-lg py-2 text-sm font-semibold hover:bg-gray-200">关闭</button>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function addOperator() {
  console.log('[addOperator] 被调用');
  const username = document.getElementById('newUsername').value.trim();
  const displayName = document.getElementById('newDisplayName').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  console.log('[addOperator] username=' + username + ', displayName=' + displayName + ', passwordLength=' + password.length);
  if (!username || !password) { showToast('请填写用户名和密码'); return; }
  if (password.length < 4) { showToast('密码至少4位'); return; }

  try {
    const hash = await hashPassword(password);
    if (!Cloud.client) { showToast('云端连接未就绪，请刷新重试'); return; }
    console.log('[addOperator] 开始插入用户...');
    const { data, error } = await Cloud.client.from('app_users').insert({
      id: uid(), username, password_hash: hash, role: 'operator',
      display_name: displayName || username, status: 'active', created_at: Date.now()
    }).select();
    console.log('[addOperator] 插入结果:', { data, error });
    if (error) {
      if (error.code === '23505') showToast('用户名已存在');
      else showToast('添加失败: ' + (error.message || '未知错误'));
      console.error('addOperator error:', error);
      return;
    }
    showToast('操作员添加成功');
    // 清空表单
    document.getElementById('newUsername').value = '';
    document.getElementById('newDisplayName').value = '';
    document.getElementById('newPassword').value = '';
    openUserManager();
  } catch(e) {
    console.error('addOperator exception:', e);
    showToast('添加失败: ' + (e.message || '未知错误'));
  }
}

async function deleteUser(userId) {
  if (!confirm('确定删除该操作员？')) return;
  const { error } = await Cloud.client.from('app_users').delete().eq('id', userId);
  if (error) { showToast('删除失败'); return; }
  showToast('已删除');
  openUserManager();
}

async function resetUserPassword(userId) {
  const newPwd = prompt('请输入新密码：');
  if (!newPwd) return;
  const hash = await hashPassword(newPwd);
  const { error } = await Cloud.client.from('app_users').update({ password_hash: hash }).eq('id', userId);
  if (error) { showToast('重置失败'); return; }
  showToast('密码已重置');
}

// =====================================================
// 数据持久化（localStorage 缓存 + Supabase 实时数据库）
// =====================================================
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  Cloud.scheduleSave(DB);
}

function syncToCloud() { Cloud.scheduleSave(DB); }
function removeFromCloud() { Cloud.scheduleSave(DB); }

function pushLocalToCloud() {
  showToast('正在同步...');
  Cloud.saveAll(DB).then(ok => {
    if (ok) showToast('已同步到云端');
    else showToast('同步失败，请检查网络连接');
  });
}

async function loadFromCloud() {
  const data = await Cloud.loadAll();
  if (data && (data.orgs.length || data.myUsers.length || data.clientPersons.length || data.records.length)) {
    DB = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    return true;
  }
  return false;
}

function initSampleData() {
  const now = Date.now();
  DB = {
    orgs: [
      { id: 'org1', name: '中诚投资集团', industry: '金融投资', createdAt: now, sortOrder: 100 },
      { id: 'org2', name: '锐捷科技股份有限公司', industry: '科技/软件', createdAt: now, sortOrder: 200 },
    ],
    myUsers: [
      { id: 'my1', name: '张明', position: '销售总监', status: 'active' },
      { id: 'my2', name: '李薇', position: '客户经理', status: 'active' },
      { id: 'my3', name: '王浩', position: '技术顾问', status: 'active' },
      { id: 'my4', name: '刘婷', position: '项目经理', status: 'active' },
    ],
    clientPersons: [
      { id: 'cp1', orgId: 'org1', name: '陈志远', position: '集团董事长', importance: 'S', parentId: null, myContactId: 'my1', phone: '138****8888', status: 'active' },
      { id: 'cp2', orgId: 'org1', name: '赵国强', position: '集团总裁', importance: 'S', parentId: 'cp1', myContactId: 'my1', phone: '139****6666', status: 'active' },
      // 赵国强(总裁)下3个平级副总
      { id: 'cp3', orgId: 'org1', name: '孙丽华', position: '副总裁·分管IT', importance: 'A', parentId: 'cp2', myContactId: 'my2', phone: '137****5555', status: 'active' },
      { id: 'cp6', orgId: 'org1', name: '郑伟', position: '副总裁·分管采购', importance: 'B', parentId: 'cp2', myContactId: 'my2', phone: '133****1111', status: 'active' },
      { id: 'cp11', orgId: 'org1', name: '钱永涛', position: '副总裁·分管财务', importance: 'A', parentId: 'cp2', myContactId: 'my1', phone: '131****2222', status: 'active' },
      // 孙丽华(IT副总)下2个平级总监
      { id: 'cp4', orgId: 'org1', name: '周建明', position: '信息技术部总监', importance: 'B', parentId: 'cp3', myContactId: 'my3', phone: '136****3333', status: 'active' },
      { id: 'cp12', orgId: 'org1', name: '冯雅琴', position: '数据运营部总监', importance: 'B', parentId: 'cp3', myContactId: 'my3', phone: '132****5555', status: 'active' },
      // 周建明(IT总监)下2个平级经理
      { id: 'cp5', orgId: 'org1', name: '吴小燕', position: '信息技术部经理', importance: 'C', parentId: 'cp4', myContactId: 'my3', phone: '135****2222', status: 'active' },
      { id: 'cp13', orgId: 'org1', name: '许文斌', position: '信息安全部经理', importance: 'C', parentId: 'cp4', myContactId: 'my3', phone: '134****6666', status: 'active' },
      // 锐捷科技
      { id: 'cp7', orgId: 'org2', name: '黄晓峰', position: 'CEO·创始人', importance: 'S', parentId: null, myContactId: 'my1', phone: '138****9999', status: 'active' },
      // 黄晓峰(CEO)下2个平级C级
      { id: 'cp8', orgId: 'org2', name: '林婉清', position: 'CTO', importance: 'A', parentId: 'cp7', myContactId: 'my3', phone: '139****7777', status: 'active' },
      { id: 'cp14', orgId: 'org2', name: '秦朗', position: 'CFO', importance: 'A', parentId: 'cp7', myContactId: 'my1', phone: '137****3333', status: 'active' },
      // 林婉清(CTO)下2个平级总监
      { id: 'cp9', orgId: 'org2', name: '高磊', position: '产品总监', importance: 'B', parentId: 'cp8', myContactId: 'my4', phone: '136****4444', status: 'active' },
      { id: 'cp15', orgId: 'org2', name: '沈雨欣', position: '研发总监', importance: 'B', parentId: 'cp8', myContactId: 'my3', phone: '135****7777', status: 'active' },
      // 高磊(产品总监)下2个平级
      { id: 'cp10', orgId: 'org2', name: '马晓宇', position: '研发主管', importance: 'C', parentId: 'cp9', myContactId: 'my3', phone: '135****0000', status: 'active' },
      { id: 'cp16', orgId: 'org2', name: '韩雪', position: '产品经理', importance: 'C', parentId: 'cp9', myContactId: 'my4', phone: '138****4444', status: 'active' },
    ],
    records: [
      { id: 'r1', date: getDateOffset(-1), type: 'visit', title: '拜访中诚集团·年度合作方案沟通', content: '与陈董、赵总裁就年度数字化合作方案进行深入沟通。陈董对智能风控系统表示高度认可，要求信息技术部配合推进方案细化。下一步：两周内提交详细方案。', myUserId: 'my1', clientPersonIds: ['cp1', 'cp2', 'cp3'], createdAt: now - 86400000 },
      { id: 'r2', date: getDateOffset(-3), type: 'meeting', title: '中诚集团·IT部门技术对接会', content: '与孙副总及IT部周总监召开技术对接会，讨论系统架构和技术可行性。确定一期聚焦风控模型模块，周总监将协调内部资源配合。', myUserId: 'my3', clientPersonIds: ['cp3', 'cp4', 'cp5'], createdAt: now - 86400000 * 3 },
      { id: 'r3', date: getDateOffset(-5), type: 'call', title: '电话沟通·采购流程确认', content: '与采购部郑主管电话沟通采购流程及资质要求，确认需提供公司三证、近三年财报及案例证明。', myUserId: 'my2', clientPersonIds: ['cp6'], createdAt: now - 86400000 * 5 },
      { id: 'r4', date: getDateOffset(-7), type: 'visit', title: '拜访锐捷科技·产品演示', content: '向黄总及林总进行产品演示，重点展示数据分析平台能力。黄总对实时分析功能很感兴趣，希望尽快安排POC。', myUserId: 'my1', clientPersonIds: ['cp7', 'cp8'], createdAt: now - 86400000 * 7 },
      { id: 'r5', date: getDateOffset(-10), type: 'email', title: '邮件发送·锐捷科技POC方案', content: '向产品总监高磊发送POC技术方案及时间安排，等待其内部评审反馈。', myUserId: 'my4', clientPersonIds: ['cp9'], createdAt: now - 86400000 * 10 },
      { id: 'r6', date: getDateOffset(-14), type: 'meeting', title: '锐捷科技·技术架构评审', content: '与林总及技术团队进行架构评审，讨论高并发场景下的性能保障方案。马主管提出数据迁移问题，已记录待跟进。', myUserId: 'my3', clientPersonIds: ['cp8', 'cp10'], createdAt: now - 86400000 * 14 },
    ],
  };
  saveLocal();
  Cloud.scheduleSave(DB);
}

async function loadData() {
  // 避免重复初始化（已在 init() 中初始化过）
  if (!Cloud.client) Cloud.init();
  // 尝试从云端加载
  if (Cloud.enabled) {
    const ok = await loadFromCloud();
    if (ok) {
      migrateData();
      return;
    }
  }
  // 降级到本地
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    DB = JSON.parse(saved);
    migrateData();
  } else {
    initSampleData();
  }
}

function migrateData() {
  // 兼容旧数据：给没有 status 的 person 补充默认值
  let migrated = false;
  DB.clientPersons.forEach(p => {
    if (!p.status) { p.status = 'active'; migrated = true; }
  });
  // 兼容旧数据：给我方人员补充 status
  DB.myUsers.forEach(u => {
    if (!u.status) { u.status = 'active'; migrated = true; }
  });
  // 兼容旧数据：给机构补充 sortOrder（按当前索引*100，留足插入空间）
  DB.orgs.forEach((o, idx) => {
    if (o.sortOrder === undefined || o.sortOrder === null) {
      o.sortOrder = (idx + 1) * 100;
      migrated = true;
    }
  });
  if (migrated) saveLocal();
}

async function resetData() {
  if (!confirm('确定要重置为示例数据吗？当前数据将被清除。')) return;
  localStorage.removeItem(STORAGE_KEY);
  initSampleData();
  await loadFromCloud();
  renderAll();
  showToast('数据已重置');
}

// =====================================================
// 工具函数
// =====================================================
function uid() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
function getOrg(id) { return DB.orgs.find(o => o.id === id); }
function getClientPerson(id) { return DB.clientPersons.find(p => p.id === id); }
function getMyUser(id) { return DB.myUsers.find(u => u.id === id); }
function getChildren(parentId) { return DB.clientPersons.filter(p => p.parentId === parentId && p.status !== 'archived'); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getRootPersons(orgId) { return DB.clientPersons.filter(p => p.orgId === orgId && !p.parentId && p.status !== 'archived'); }
function getActivePersons(orgId) { return DB.clientPersons.filter(p => p.orgId === orgId && p.status !== 'archived'); }
function getArchivedPersons(orgId) { return DB.clientPersons.filter(p => p.orgId === orgId && p.status === 'archived'); }
function getActiveMyUsers() { return DB.myUsers.filter(u => u.status !== 'archived'); }
function getArchivedMyUsers() { return DB.myUsers.filter(u => u.status === 'archived'); }

// 机构按 sortOrder 排序（无 sortOrder 的排最后）
function sortOrgs() {
  return [...DB.orgs].sort((a, b) => {
    const ao = a.sortOrder ?? Infinity;
    const bo = b.sortOrder ?? Infinity;
    return ao - bo;
  });
}

// =====================================================
// 仪表盘机构拖拽排序
// =====================================================
let draggedOrgId = null;

function dragStartOrg(ev, orgId) {
  draggedOrgId = orgId;
  ev.dataTransfer.effectAllowed = 'move';
  ev.target.classList.add('opacity-50', 'ring-2', 'ring-indigo-400');
}

function dragOverOrg(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  const card = ev.currentTarget;
  card.classList.add('border-indigo-400', 'bg-indigo-50');
}

function dragLeaveOrg(ev) {
  const card = ev.currentTarget;
  card.classList.remove('border-indigo-400', 'bg-indigo-50');
}

function dropOrg(ev, dropOrgId) {
  ev.preventDefault();
  const card = ev.currentTarget;
  card.classList.remove('border-indigo-400', 'bg-indigo-50');
  if (draggedOrgId && draggedOrgId !== dropOrgId) {
    reorderOrgs(draggedOrgId, dropOrgId);
  }
  draggedOrgId = null;
}

function dragEndOrg(ev) {
  ev.target.classList.remove('opacity-50', 'ring-2', 'ring-indigo-400');
  draggedOrgId = null;
}

function reorderOrgs(dragId, dropId) {
  const sorted = sortOrgs();
  const dragIdx = sorted.findIndex(o => o.id === dragId);
  const dropIdx = sorted.findIndex(o => o.id === dropId);
  if (dragIdx === -1 || dropIdx === -1) return;

  // 从数组中移除拖拽项，插入到目标位置
  const [moved] = sorted.splice(dragIdx, 1);
  sorted.splice(dropIdx, 0, moved);

  // 重新分配 sortOrder（间隔100，留足插入空间）
  sorted.forEach((o, idx) => {
    const org = DB.orgs.find(oo => oo.id === o.id);
    if (org) org.sortOrder = (idx + 1) * 100;
  });

  saveLocal();
  renderDashboard();
  // 始终刷新机构人员树（无副作用，隐藏时写入 innerHTML 不影响性能）
  renderOrgTree();
  showToast('机构顺序已更新');
}

// 统一拖拽分派器：根据 dragState 自动路由到机构排序或人员移动
function treeDragOver(ev, orgId) {
  ev.preventDefault();
  ev.stopPropagation();
  if (draggedTreeOrgId) {
    // 机构拖拽 → 显示插入指示线
    ev.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.tree-drop-indicator.show').forEach(el => el.classList.remove('show'));
    const indicator = document.querySelector('.tree-drop-indicator[data-for-org="' + orgId + '"]');
    if (indicator) indicator.classList.add('show');
  } else if (dragState && dragState.personId) {
    // 人员拖拽 → 复用原有逻辑
    dragOverNode(ev, 'org', orgId);
  }
}
function treeDragLeave(ev, orgId) {
  if (draggedTreeOrgId) {
    const indicator = document.querySelector('.tree-drop-indicator[data-for-org="' + orgId + '"]');
    if (indicator) indicator.classList.remove('show');
  } else {
    dragLeaveNode(ev);
  }
}
function treeDrop(ev, orgId) {
  ev.preventDefault();
  ev.stopPropagation();
  if (draggedTreeOrgId) {
    // 机构拖拽 → 执行排序
    document.querySelectorAll('.tree-drop-indicator.show').forEach(el => el.classList.remove('show'));
    if (draggedTreeOrgId !== orgId) reorderOrgs(draggedTreeOrgId, orgId);
    draggedTreeOrgId = null;
  } else if (dragState && dragState.personId) {
    // 人员拖拽 → 复用原有逻辑
    dropOnNode(ev, 'org', orgId);
  }
}

// 机构行拖拽开始/结束（仅用于机构拖拽）
let draggedTreeOrgId = null;
function dragStartOrgTree(ev, orgId) {
  ev.stopPropagation();
  if (dragState && dragState.personId) { ev.preventDefault(); return; }
  draggedTreeOrgId = orgId;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', 'org:' + orgId);
  ev.currentTarget.classList.add('opacity-50');
  const org = DB.orgs.find(o => o.id === orgId);
  if (org) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = '🏢 ' + org.name;
    document.body.appendChild(ghost);
    ev.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  }
}
function dragEndOrgTree(ev) {
  ev.currentTarget.classList.remove('opacity-50');
  document.querySelectorAll('.tree-drop-indicator.show').forEach(el => el.classList.remove('show'));
  draggedTreeOrgId = null;
}

function getDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((today - d) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return diff + '天前';
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

// =====================================================
// 视图切换
// =====================================================
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewName).classList.add('active');
  document.querySelectorAll('.nav-item, .nav-mobile-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`.nav-item[data-view="${viewName}"], .nav-mobile-item[data-view="${viewName}"]`).forEach(n => n.classList.add('active'));

  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'people') renderPeoplePage();
  if (viewName === 'timeline') {
    if (pendingDateFilter) {
      document.getElementById('filterDate').value = pendingDateFilter;
      document.querySelector('#view-timeline .page-title').textContent = '沟通时间线 · ' + formatDateFull(pendingDateFilter);
      pendingDateFilter = null;
    } else {
      document.getElementById('filterDate').value = '';
      document.querySelector('#view-timeline .page-title').textContent = '沟通时间线';
    }
    // 清除机构筛选残留（来自仪表盘或日历点击）
    const orgFilter = document.getElementById('filterOrg');
    if (orgFilter) orgFilter.value = '';
    document.querySelectorAll('#dashboardOrgs > div').forEach(el => {
      el.classList.remove('border-indigo-500', 'bg-indigo-50');
    });
    renderTimeline();
  }
  if (viewName === 'record') renderRecordPage();
  if (lucide) lucide.createIcons();
  window.scrollTo(0, 0);
}

// =====================================================
// 仪表盘
// =====================================================
function renderDashboard() {
  const monthAgo = getDateOffset(-30);
  const monthRecords = DB.records.filter(r => r.date >= monthAgo);

  const stats = [
    { label: '客户机构', value: DB.orgs.length, icon: 'building-2', bg: 'bg-indigo-50', tc: 'text-indigo-500' },
    { label: '我方人员', value: getActiveMyUsers().length, icon: 'user-check', bg: 'bg-green-50', tc: 'text-green-500' },
    { label: '近30天沟通', value: monthRecords.length, icon: 'message-square', bg: 'bg-orange-50', tc: 'text-orange-500' },
  ];

  document.getElementById('statCards').innerHTML = stats.map(s => `
    <div class="bg-white rounded-xl border border-gray-200 p-5 card-hover${s.label === '我方人员' || s.label === '客户机构' ? ' cursor-pointer' : ''}" ${s.label === '我方人员' ? `onclick="openMyUsersModal()"` : s.label === '客户机构' ? `onclick="goToPeople()"` : ''}>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-500">${s.label}</p>
          <p class="text-3xl font-bold text-gray-800 mt-1">${s.value}</p>
        </div>
        <div class="${s.bg} ${s.tc} w-12 h-12 rounded-xl flex items-center justify-center">
          <i data-lucide="${s.icon}" class="w-6 h-6"></i>
        </div>
      </div>
    </div>
  `).join('');

  renderDashboardCalendar();

  // 右侧：合作机构列表（支持拖拽排序）
  const orgsContainer = document.getElementById('dashboardOrgs');
  if (orgsContainer) {
    const sortedOrgs = sortOrgs();
    orgsContainer.innerHTML = sortedOrgs.length ? sortedOrgs.map(o => {
      const persons = getActivePersons(o.id);
      const records = DB.records.filter(r => r.clientPersonIds.some(id => { const p = getClientPerson(id); return p && p.orgId === o.id; }));
      const keyCount = persons.filter(p => p.importance === 'S' || p.importance === 'A').length;
      return `
        <div draggable="true" data-org-id="${o.id}" ondragstart="dragStartOrg(event,'${o.id}')" ondragover="dragOverOrg(event)" ondragleave="dragLeaveOrg(event)" ondrop="dropOrg(event,'${o.id}')" ondragend="dragEndOrg(event)"
          class="border border-gray-200 rounded-xl p-4 hover:border-indigo-400 hover:shadow-md transition-all card-hover cursor-move">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 cursor-pointer hover:bg-indigo-700" onclick="dashFilterByOrg('${o.id}')" title="点击筛选该机构沟通记录">${o.name[0]}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-gray-800 text-sm cursor-pointer hover:text-indigo-600" onclick="dashFilterByOrg('${o.id}')">${o.name}</span>
              </div>
              <p class="text-xs text-gray-400 mt-0.5">${o.industry || '未设置行业'}</p>
            </div>
            <div class="flex flex-col items-center gap-0.5 flex-shrink-0">
              ${o.detailUrl
                ? `<button onclick="event.stopPropagation(); window.open('${o.detailUrl}','_blank')" class="px-2.5 py-1 bg-blue-50 text-blue-500 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center gap-1"><i data-lucide="external-link" class="w-3 h-3"></i>详情</button>`
                : `<button onclick="event.stopPropagation(); openDetailUrlConfig('${o.id}')" class="px-2.5 py-1 bg-gray-50 text-gray-400 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-100 flex items-center gap-1"><i data-lucide="external-link" class="w-3 h-3"></i>详情</button>`
              }
              <button onclick="event.stopPropagation(); openDetailUrlConfig('${o.id}')" class="text-[10px] text-gray-300 hover:text-indigo-400 transition-colors leading-none pt-0.5">修改详情链接</button>
            </div>
          </div>
          <div class="flex items-center gap-4 text-xs cursor-pointer" onclick="dashFilterByOrg('${o.id}')">
            <div class="flex items-center gap-1 text-gray-500"><i data-lucide="users" class="w-3.5 h-3.5"></i><span>${persons.length}人</span></div>
            <div class="flex items-center gap-1 text-gray-500"><i data-lucide="star" class="w-3.5 h-3.5 text-orange-400"></i><span>核心${keyCount}人</span></div>
            <div class="flex items-center gap-1 text-gray-500"><i data-lucide="message-square" class="w-3.5 h-3.5"></i><span>${records.length}条沟通</span></div>
          </div>
        </div>
      `;
    }).join('') : '<div class="empty-state"><p>暂无机构</p></div>';
  }

  if (lucide) lucide.createIcons();
}

// 跳转到机构人员页
function goToPeople() { selectedTreeNode = null; switchView('people'); }

// 我方人员弹窗 - 展示我方人员及其服务的合作机构
function openMyUsersModal() {
  const activeUsers = getActiveMyUsers();
  const archivedUsers = getArchivedMyUsers();
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6 max-h-[80vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2"><i data-lucide="user-check" class="w-5 h-5 text-green-500"></i>我方人员 · 服务机构一览</h3>
        <div class="flex items-center gap-2">
          <button onclick="openAddMyUserModal()" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-semibold hover:bg-green-600 flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>新增</button>
          <button onclick="closeModal()" class="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="关闭"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
      </div>
      ${activeUsers.length === 0 ? '<div class="text-center py-8 text-gray-400"><p class="text-sm">暂无在职人员</p></div>' : `
      <div class="space-y-4">
        ${activeUsers.map(u => renderMyUserCard(u)).join('')}
      </div>`}
      ${archivedUsers.length > 0 ? `
      <div class="mt-5 pt-4 border-t border-gray-200">
        <div class="flex items-center gap-2 mb-3 cursor-pointer" onclick="toggleArchivedMyUsers()">
          <i data-lucide="archive" class="w-4 h-4 text-gray-400"></i>
          <span class="text-sm font-semibold text-gray-500">归档人员（${archivedUsers.length}）</span>
          <i data-lucide="chevron-down" class="w-4 h-4 text-gray-400 archived-my-toggle"></i>
        </div>
        <div id="archivedMyUsers" class="space-y-3 hidden">
          ${archivedUsers.map(u => renderMyUserCard(u, true)).join('')}
        </div>
      </div>` : ''}
      <div class="flex mt-5">
        <button onclick="closeModal()" class="w-full px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">关闭</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

function renderMyUserCard(u, isArchived = false) {
  const clientPersons = DB.clientPersons.filter(p => p.myContactId === u.id);
  const orgs = [...new Set(clientPersons.map(p => p.orgId))];
  const records = DB.records.filter(r => r.myUserId === u.id).length;
  return `
    <div class="border rounded-xl p-4 ${isArchived ? 'border-gray-200 opacity-70 grayscale bg-gray-50' : 'border-gray-200'}">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-full ${isArchived ? 'bg-gray-100 text-gray-400' : 'bg-green-100 text-green-600'} flex items-center justify-center font-bold text-sm">${u.name[0]}</div>
        <div>
          <div class="font-bold text-gray-800 text-sm flex items-center gap-2">
            ${u.name}
            ${isArchived ? '<span class="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-normal">已归档</span>' : ''}
          </div>
          <div class="text-xs text-gray-400">${u.position}</div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <span class="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">${records}条记录</span>
          ${isArchived
            ? `<button onclick="event.stopPropagation(); restoreMyUser('${u.id}')" class="px-2.5 py-1.5 bg-blue-50 text-blue-500 rounded-lg text-xs hover:bg-blue-100 flex items-center gap-1"><i data-lucide="rotate-ccw" class="w-3 h-3"></i>恢复</button>`
            : `<button onclick="event.stopPropagation(); deleteMyUser('${u.id}')" class="px-2.5 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs hover:bg-red-100 flex items-center gap-1"><i data-lucide="trash-2" class="w-3 h-3"></i>删除</button>`
          }
        </div>
      </div>
      ${orgs.length ? `
        <div class="space-y-2">
          <p class="text-xs text-gray-500 font-semibold flex items-center gap-1"><i data-lucide="building-2" class="w-3 h-3"></i>服务的合作机构：</p>
          <div class="flex flex-wrap gap-2">
            ${orgs.map(oid => {
              const o = getOrg(oid);
              const ps = clientPersons.filter(p => p.orgId === oid);
              return o ? `
                <div class="bg-indigo-50 rounded-lg px-3 py-2 min-w-[140px] border border-indigo-100 cursor-pointer hover:bg-indigo-100 transition-colors" onclick="closeModal(); setTimeout(()=>jumpToOrg('${oid}'),80)">
                  <p class="text-sm font-semibold text-indigo-700">${o.name}</p>
                  <p class="text-xs text-indigo-400 mt-0.5">对接 ${ps.length} 人：${ps.map(p => p.name).join('、')}</p>
                </div>
              ` : '';
            }).join('')}
          </div>
        </div>
      ` : '<p class="text-xs text-gray-400">暂未对接甲方人员</p>'}
    </div>
  `;
}

function toggleArchivedMyUsers() {
  const el = document.getElementById('archivedMyUsers');
  const icon = document.querySelector('.archived-my-toggle');
  if (!el || !icon) return;
  el.classList.toggle('hidden');
  // Flip chevron
  if (el.classList.contains('hidden')) {
    icon.setAttribute('data-lucide', 'chevron-down');
  } else {
    icon.setAttribute('data-lucide', 'chevron-up');
  }
  if (lucide) lucide.createIcons();
}

function openAddMyUserModal() {
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6 max-h-[80vh] overflow-y-auto">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="user-plus" class="w-5 h-5 text-green-500"></i>新增我方人员</h3>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">姓名 <span class="text-red-500">*</span></label>
          <input id="myUserName" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" placeholder="请输入姓名" maxlength="20"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">职位 <span class="text-red-500">*</span></label>
          <input id="myUserPosition" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" placeholder="如：销售总监、客户经理" maxlength="30"></div>
      </div>
      <div class="flex gap-3 mt-5">
        <button onclick="closeModal()" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
        <button onclick="saveMyUser()" class="flex-1 px-4 py-2.5 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600">保存</button>
      </div>
    </div>`;
  if (lucide) lucide.createIcons();
}

function saveMyUser() {
  const name = document.getElementById('myUserName').value.trim();
  const position = document.getElementById('myUserPosition').value.trim();
  if (!name) { showToast('请输入姓名'); return; }
  if (!position) { showToast('请输入职位'); return; }
  const newUser = { id: uid(), name, position, status: 'active' };
  DB.myUsers.push(newUser);
  saveLocal();
  syncToCloud('my_users', newUser);
  closeModal();
  setTimeout(() => openMyUsersModal(), 100);
  showToast('已新增我方人员');
}

// 编辑我方人员
function openEditMyUserModal(userId) {
  const u = getMyUser(userId);
  if (!u) { showToast('人员不存在'); return; }
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6 max-h-[80vh] overflow-y-auto">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="user-cog" class="w-5 h-5 text-blue-500"></i>编辑我方人员</h3>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">姓名 <span class="text-red-500">*</span></label>
          <input id="editMyUserName" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" placeholder="请输入姓名" maxlength="20" value="${escapeHtml(u.name)}"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">职位 <span class="text-red-500">*</span></label>
          <input id="editMyUserPosition" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" placeholder="如：销售总监、客户经理" maxlength="30" value="${escapeHtml(u.position || '')}"></div>
        <div class="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
          <p class="mb-1">📌 关联信息（不可编辑）：</p>
          <p>• 服务合作机构：${DB.clientPersons.filter(p => p.myContactId === u.id).length} 个</p>
          <p>• 沟通记录：${DB.records.filter(r => r.myUserId === u.id).length} 条</p>
        </div>
      </div>
      <div class="flex gap-3 mt-5">
        <button onclick="openMyUsersModal()" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
        <button onclick="updateMyUser('${u.id}')" class="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">保存修改</button>
      </div>
    </div>`;
  if (lucide) lucide.createIcons();
}

function updateMyUser(userId) {
  const u = getMyUser(userId);
  if (!u) { showToast('人员不存在'); return; }
  const name = document.getElementById('editMyUserName').value.trim();
  const position = document.getElementById('editMyUserPosition').value.trim();
  if (!name) { showToast('请输入姓名'); return; }
  if (!position) { showToast('请输入职位'); return; }
  u.name = name;
  u.position = position;
  saveLocal();
  syncToCloud('my_users', u);
  openMyUsersModal();
  showToast('修改已保存');
}

// 删除我方人员 - 弹出选择框：归档 或 直接删除
function deleteMyUser(userId) {
  const u = getMyUser(userId);
  if (!u) return;
  const records = DB.records.filter(r => r.myUserId === userId).length;
  const clientRefs = DB.clientPersons.filter(p => p.myContactId === userId).length;
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6 max-w-md">
      <h3 class="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2"><i data-lucide="alert-triangle" class="w-5 h-5 text-red-500"></i>删除我方人员</h3>
      <p class="text-sm text-gray-600 mb-4">确定要处理「<span class="font-bold text-gray-800">${escapeHtml(u.name)}</span>（${escapeHtml(u.position || '')}）」吗？</p>
      ${records > 0 || clientRefs > 0 ? `<p class="text-xs text-gray-500 bg-amber-50 rounded-lg p-3 mb-4 border border-amber-200">该人员涉及 <span class="font-bold text-amber-700">${records}</span> 条沟通记录、<span class="font-bold text-amber-700">${clientRefs}</span> 个甲方人员关联。如选择「归档」，这些关联将被完整保留。</p>` : ''}
      <div class="space-y-3">
        <button onclick="archiveMyUser('${userId}')" class="w-full px-4 py-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm font-semibold hover:bg-amber-100 flex items-center justify-center gap-2">
          <i data-lucide="archive" class="w-4 h-4"></i>归档 — 保留记录和关系，放入归档区
        </button>
        <button onclick="hardDeleteMyUser('${userId}')" class="w-full px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-100 flex items-center justify-center gap-2">
          <i data-lucide="trash-2" class="w-4 h-4"></i>直接删除 — 永久移除，清除所有关联
        </button>
        <button onclick="openMyUsersModal()" class="w-full px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  if (lucide) lucide.createIcons();
}

function archiveMyUser(userId) {
  const u = getMyUser(userId);
  if (!u) return;
  u.status = 'archived';
  saveLocal();
  syncToCloud('my_users', u);
  openMyUsersModal();
  showToast('已归档，记录和关系保留');
}

function hardDeleteMyUser(userId) {
  const u = getMyUser(userId);
  if (!u) return;
  // 将关联的 clientPersons 的 myContactId 清除
  DB.clientPersons.forEach(p => { if (p.myContactId === userId) p.myContactId = null; });
  // 将关联的 records 的 myUserId 清除
  DB.records.forEach(r => { if (r.myUserId === userId) r.myUserId = null; });
  // 物理删除
  DB.myUsers = DB.myUsers.filter(u => u.id !== userId);
  saveLocal();
  removeFromCloud('my_users', userId);
  openMyUsersModal();
  renderAll();
  showToast('已直接删除');
}

function restoreMyUser(userId) {
  const u = getMyUser(userId);
  if (!u) return;
  u.status = 'active';
  saveLocal();
  syncToCloud('my_users', u);
  openMyUsersModal();
  showToast('已恢复在职');
}

// 点击仪表盘机构卡片筛选左侧时间线
let dashSelectedOrg = null;
function dashFilterByOrg(orgId) {
  // 再次点击同一个机构则取消筛选
  if (dashSelectedOrg === orgId) {
    dashSelectedOrg = null;
  } else {
    dashSelectedOrg = orgId;
  }
  // 高亮选中机构
  document.querySelectorAll('#dashboardOrgs > div').forEach(el => {
    el.classList.remove('border-indigo-500', 'bg-indigo-50');
  });
  if (dashSelectedOrg) {
    const idx = DB.orgs.findIndex(o => o.id === orgId);
    const cards = document.querySelectorAll('#dashboardOrgs > div');
    if (cards[idx]) cards[idx].classList.add('border-indigo-500', 'bg-indigo-50');
  }
  // 跳转到沟通时间线页并筛选
  switchView('timeline');
  setTimeout(() => {
    document.getElementById('filterOrg').value = dashSelectedOrg || '';
    renderTimeline();
  }, 50);
}

// 仪表盘沟通日历
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1; // 1-12

function navCalendar(dir) {
  calMonth += dir;
  if (calMonth < 1) { calMonth = 12; calYear--; }
  if (calMonth > 12) { calMonth = 1; calYear++; }
  renderDashboardCalendar();
}

function renderDashboardCalendar() {
  document.getElementById('calMonthLabel').textContent = calYear + '年' + calMonth + '月';

  // 统计当月所有记录并按日期分组
  const prefix = `${calYear}-${String(calMonth).padStart(2,'0')}`;
  const monthRecords = DB.records.filter(r => r.date.startsWith(prefix));
  const dayMap = {};
  monthRecords.forEach(r => {
    if (!dayMap[r.date]) dayMap[r.date] = [];
    dayMap[r.date].push(r);
  });

  const countEl = document.getElementById('timelineCountDash');
  if (countEl) countEl.textContent = `本月 ${monthRecords.length} 条沟通`;

  // 计算日历格子
  const firstDay = new Date(calYear, calMonth - 1, 1).getDay(); // 0=周日
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1; // 周一为第0格

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let cells = '';
  // 前置空白
  for (let i = 0; i < startOffset; i++) cells += '<div class="cal-cell cal-empty"></div>';
  // 日期格子
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const records = dayMap[dateStr] || [];
    const isToday = dateStr === todayStr;
    const orgNames = [...new Set(records.flatMap(r => r.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean).map(p => p.orgId)))].map(id => getOrg(id)).filter(Boolean);

    cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${records.length ? ' cal-has-records' : ''}" onclick="${records.length ? `clickCalDay('${dateStr}')` : ''}" title="${records.length ? records.length+'条沟通记录' : ''}">
      <span class="cal-day-num">${d}</span>
      ${orgNames.length ? `<div class="cal-orgs">${orgNames.map(o => `<span class="cal-org-tag">${o.name.length > 4 ? o.name.substring(0,4)+'…' : o.name}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  document.getElementById('dashboardCalendar').innerHTML = `
    <div class="cal-grid">
      <div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div>
      <div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header cal-weekend">六</div><div class="cal-header cal-weekend">日</div>
      ${cells}
    </div>`;

  if (lucide) lucide.createIcons();
}

// 点击日历某天跳转到沟通时间线页面并筛选该日期
let pendingDateFilter = null;
function clickCalDay(dateStr) {
  pendingDateFilter = dateStr;
  switchView('timeline');
}

// =====================================================
// 机构人员页
// =====================================================
function renderPeoplePage() {
  // 默认折叠所有人名节点 + 机构节点 + 过往人员分组
  collapsedNodes = new Set([
    ...DB.clientPersons.filter(p => getChildren(p.id).length > 0).map(p => p.id),
    ...DB.orgs.map(o => o.id),
    ...DB.orgs.filter(o => getArchivedPersons(o.id).length > 0).map(o => 'archived_' + o.id)
  ]);

  renderOrgTree();
  if (selectedTreeNode) {
    if (selectedTreeNode.type === 'org') renderOrgDetail(selectedTreeNode.id);
    else renderPersonDetail(selectedTreeNode.id);
  } else {
    document.getElementById('personDetailPanel').innerHTML = `
      <div class="empty-state">
        <i data-lucide="mouse-pointer-click" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
        <p>点击左侧机构或人员查看详情</p>
      </div>`;
  }
  if (lucide) lucide.createIcons();
}

// 折叠状态记录：展开的节点 id 集合，默认全部展开
let collapsedNodes = new Set();

function isCollapsed(id) { return collapsedNodes.has(id); }
function toggleCollapse(id) {
  if (collapsedNodes.has(id)) collapsedNodes.delete(id);
  else collapsedNodes.add(id);
}

// 展开/折叠机构及其下所有人员（箭头专用）
function toggleOrgCollapse(orgId) {
  const personIds = DB.clientPersons.filter(p => p.orgId === orgId).map(p => p.id);
  if (collapsedNodes.has(orgId)) {
    // 折叠→展开：机构+所有人员都展开
    collapsedNodes.delete(orgId);
    personIds.forEach(pid => collapsedNodes.delete(pid));
    collapsedNodes.delete('archived_' + orgId);
  } else {
    // 展开→折叠：机构+所有人员+过往人员都折叠
    collapsedNodes.add(orgId);
    personIds.forEach(pid => collapsedNodes.add(pid));
    collapsedNodes.add('archived_' + orgId);
  }
}

// 展开/折叠人员及其所有下级（箭头专用）
function togglePersonCollapse(personId) {
  // 获取该人员下的所有子孙节点
  function getDescendants(id) {
    const ids = [];
    const children = DB.clientPersons.filter(p => p.parentId === id && p.status !== 'archived');
    for (const c of children) {
      ids.push(c.id);
      ids.push(...getDescendants(c.id));
    }
    return ids;
  }
  const descendants = getDescendants(personId);
  if (collapsedNodes.has(personId)) {
    collapsedNodes.delete(personId);
    descendants.forEach(did => collapsedNodes.delete(did));
  } else {
    collapsedNodes.add(personId);
    descendants.forEach(did => collapsedNodes.add(did));
  }
}

function renderOrgTree() {
  const container = document.getElementById('orgTree');
  if (DB.orgs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无机构，点击右上角添加</p></div>';
    return;
  }
  container.innerHTML = sortOrgs().map(org => {
    const activePersons = getActivePersons(org.id);
    const archivedPersons = getArchivedPersons(org.id);
    const isSelected = selectedTreeNode && selectedTreeNode.type === 'org' && selectedTreeNode.id === org.id;
    const collapsed = isCollapsed(org.id);
    return `
      <div class="tree-node" data-org-id="${org.id}">
        <div class="tree-row ${isSelected ? 'selected' : ''} p-2 flex items-center gap-2"
             draggable="true"
             ondragstart="dragStartOrgTree(event, '${org.id}')"
             ondragend="dragEndOrgTree(event)"
             ondragover="treeDragOver(event, '${org.id}')"
             ondragleave="treeDragLeave(event, '${org.id}')"
             ondrop="treeDrop(event, '${org.id}')"
             onclick="selectNode('org','${org.id}')">
          <i data-lucide="grip-vertical" class="w-4 h-4 text-gray-300 flex-shrink-0 cursor-grab" title="拖动排序"></i>
          <i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}" class="w-4 h-4 text-gray-400 flex-shrink-0 cursor-pointer" onclick="event.stopPropagation(); toggleOrgCollapse('${org.id}'); renderOrgTree(); if(lucide)lucide.createIcons();"></i>
          <i data-lucide="building-2" class="w-4 h-4 text-indigo-500 flex-shrink-0"></i>
          <span class="text-sm font-semibold text-gray-700">${org.name}</span>
          <span class="text-xs text-gray-400 ml-auto">${activePersons.length}人${archivedPersons.length ? ' · ' + archivedPersons.length + '归档' : ''}</span>
        </div>
        <div class="tree-drop-indicator" data-for-org="${org.id}"></div>
        ${!collapsed ? `<div class="tree-children">
          ${renderPersonTree(org.id, null)}
          ${renderArchivedSection(org.id)}
        </div>` : ''}
      </div>`;
  }).join('');
}

function renderArchivedSection(orgId) {
  const archivedPersons = getArchivedPersons(orgId);
  if (archivedPersons.length === 0) return '';
  const collapsed = isCollapsed('archived_' + orgId);
  return `
    <div class="tree-node">
      <div class="tree-row p-2 flex items-center gap-2" onclick="event.stopPropagation(); toggleCollapse('archived_${orgId}'); renderOrgTree(); if(lucide)lucide.createIcons();">
        <i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}" class="w-4 h-4 text-gray-400 flex-shrink-0 cursor-pointer"></i>
        <i data-lucide="archive" class="w-3.5 h-3.5 text-gray-400 flex-shrink-0"></i>
        <span class="text-sm text-gray-500">过往人员</span>
        <span class="text-xs text-gray-400 ml-auto">${archivedPersons.length}人</span>
      </div>
      ${!collapsed ? `<div class="tree-children">${archivedPersons.map(p => `
        <div class="tree-row p-2 pl-10 flex items-center gap-2 ${selectedTreeNode && selectedTreeNode.type === 'person' && selectedTreeNode.id === p.id ? 'selected' : ''}" onclick="selectNode('person','${p.id}')">
          <span class="imp-dot imp-${p.importance} flex-shrink-0" style="opacity:0.5"></span>
          <span class="text-sm text-gray-500">${p.name}</span>
          <span class="text-xs text-gray-400 truncate hidden sm:inline">${p.position}</span>
          <span class="text-xs text-orange-400 ml-auto">已归档</span>
        </div>`).join('')}</div>` : ''}
    </div>`;
}

function renderPersonTree(orgId, parentId) {
  const persons = DB.clientPersons.filter(p => p.orgId === orgId && p.parentId === parentId && p.status !== 'archived');
  if (persons.length === 0) return '';
  return persons.map(p => {
    const children = getChildren(p.id);
    const isSelected = selectedTreeNode && selectedTreeNode.type === 'person' && selectedTreeNode.id === p.id;
    const collapsed = isCollapsed(p.id);
    const hasChildren = children.length > 0;
    return `
      <div class="tree-node">
        <div class="tree-row ${isSelected ? 'selected' : ''} p-2 flex items-center gap-2"
             draggable="true"
             ondragstart="dragStartPerson(event, '${p.id}')"
             ondragend="dragEnd(event)"
             ondragover="dragOverNode(event, 'person', '${p.id}')"
             ondragleave="dragLeaveNode(event)"
             ondrop="dropOnNode(event, 'person', '${p.id}')"
             onclick="selectNode('person','${p.id}')">
          ${hasChildren
            ? `<i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}" class="w-4 h-4 text-gray-400 flex-shrink-0 cursor-pointer" onclick="event.stopPropagation(); togglePersonCollapse('${p.id}'); renderOrgTree(); if(lucide)lucide.createIcons();"></i>`
            : `<i data-lucide="grip-vertical" class="w-4 h-4 text-gray-300 flex-shrink-0 cursor-grab" onclick="event.stopPropagation()"></i>`
          }
          <span class="imp-dot imp-${p.importance} flex-shrink-0"></span>
          <span class="text-sm text-gray-700">${p.name}</span>
          <span class="text-xs text-gray-400 truncate hidden sm:inline">${p.position}</span>
          ${hasChildren ? `<span class="text-xs text-gray-400 ml-auto">${children.length}下属</span>` : ''}
        </div>
        ${hasChildren && !collapsed ? `<div class="tree-children">${renderPersonTree(orgId, p.id)}</div>` : ''}
      </div>`;
  }).join('');
}

// =====================================================
// 拖拽排序
// =====================================================
function isDescendant(personId, ancestorId) {
  let pid = personId;
  while (pid) {
    const p = getClientPerson(pid);
    if (!p || !p.parentId) return false;
    if (p.parentId === ancestorId) return true;
    pid = p.parentId;
  }
  return false;
}

function dragStartPerson(e, personId) {
  const p = getClientPerson(personId);
  if (!p) return;
  dragState = { personId, sourceOrgId: p.orgId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', personId);
  // 自定义拖拽幽灵
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = p.name + ' · ' + p.position;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  setTimeout(() => ghost.remove(), 0);
  // 标记源节点
  setTimeout(() => {
    const row = e.target.closest('.tree-row');
    if (row) row.classList.add('drag-source');
  }, 0);
}

function dragEnd(e) {
  // 清除所有高亮
  document.querySelectorAll('.tree-row').forEach(r => {
    r.classList.remove('drag-over', 'drag-over-invalid', 'drag-source');
  });
  dragState = null;
}

function dragOverNode(e, targetType, targetId) {
  e.preventDefault();
  if (!dragState) return;
  const row = e.currentTarget;
  // 判断是否合法
  let valid = true;
  if (targetType === 'person') {
    // 不能拖到自己或自己的子孙
    if (targetId === dragState.personId || isDescendant(targetId, dragState.personId)) {
      valid = false;
    }
    // 不能拖到已归档人员
    const tp = getClientPerson(targetId);
    if (tp && tp.status === 'archived') valid = false;
  }
  // 不能拖到源机构的相同父级（即无变化）
  if (valid && targetType === 'person') {
    const tp = getClientPerson(targetId);
    const sp = getClientPerson(dragState.personId);
    if (tp && sp && sp.parentId === targetId && sp.orgId === tp.orgId) valid = false;
  }
  if (valid && targetType === 'org') {
    const sp = getClientPerson(dragState.personId);
    if (sp && sp.orgId === targetId && sp.parentId === null) valid = false;
  }

  e.dataTransfer.dropEffect = valid ? 'move' : 'none';
  row.classList.remove('drag-over', 'drag-over-invalid');
  row.classList.add(valid ? 'drag-over' : 'drag-over-invalid');
}

function dragLeaveNode(e) {
  e.currentTarget.classList.remove('drag-over', 'drag-over-invalid');
}

async function dropOnNode(e, targetType, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over', 'drag-over-invalid');
  document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('drag-source'));
  if (!dragState) return;

  const sp = getClientPerson(dragState.personId);
  if (!sp) { dragState = null; return; }

  let valid = true;
  if (targetType === 'person') {
    if (targetId === dragState.personId || isDescendant(targetId, dragState.personId)) valid = false;
    const tp = getClientPerson(targetId);
    if (tp && tp.status === 'archived') valid = false;
    if (sp.parentId === targetId && sp.orgId === (tp ? tp.orgId : sp.orgId)) valid = false;
  }
  if (targetType === 'org') {
    if (sp.orgId === targetId && sp.parentId === null) valid = false;
  }

  if (!valid) { dragState = null; return; }

  // 执行移动
  if (targetType === 'person') {
    const tp = getClientPerson(targetId);
    sp.parentId = targetId;
    sp.orgId = tp.orgId;
  } else if (targetType === 'org') {
    sp.parentId = null;
    sp.orgId = targetId;
  }

  saveLocal();
  await syncToCloud('client_persons', sp);
  selectedTreeNode = null;
  renderOrgTree();
  if (lucide) lucide.createIcons();
  showToast('人员位置已调整');
  dragState = null;
}

// =====================================================
// 机构人员页
// =====================================================
function selectNode(type, id) {
  selectedTreeNode = { type, id };
  if (type === 'org') {
    // 点击已展开的机构 → 折叠；点击折叠的机构 → 展开
    if (!isCollapsed(id)) {
      // 已展开 → 折叠（机构本身 + 所有人员 + 过往人员）
      collapsedNodes.add(id);
      DB.clientPersons.filter(p => p.orgId === id).map(p => p.id).forEach(pid => collapsedNodes.add(pid));
      collapsedNodes.add('archived_' + id);
      selectedTreeNode = null;
      document.getElementById('personDetailPanel').innerHTML = `
        <div class="empty-state">
          <i data-lucide="mouse-pointer-click" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
          <p>点击左侧机构或人员查看详情</p>
        </div>`;
    } else {
      // 已折叠 → 展开
      collapsedNodes.delete(id);
      DB.clientPersons.filter(p => p.orgId === id).map(p => p.id).forEach(pid => collapsedNodes.delete(pid));
      renderOrgDetail(id);
    }
  } else renderPersonDetail(id);
  renderOrgTree();
  if (lucide) lucide.createIcons();
}

function renderOrgDetail(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  const activePersons = getActivePersons(orgId);
  const archivedPersons = getArchivedPersons(orgId);
  const allPersonIds = DB.clientPersons.filter(p => p.orgId === orgId).map(p => p.id);
  const records = DB.records.filter(r => r.clientPersonIds.some(id => allPersonIds.includes(id)));

  document.getElementById('personDetailPanel').innerHTML = `
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
          <i data-lucide="building-2" class="w-6 h-6 text-indigo-500"></i>
        </div>
        <div>
          <h3 class="text-lg font-bold text-gray-800">${org.name}</h3>
          <p class="text-sm text-gray-400">${org.industry || '未设置行业'} · ${activePersons.length}位在职${archivedPersons.length ? ' · ' + archivedPersons.length + '位归档' : ''} · ${records.length}条沟通记录</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button onclick="openOrgEditModal('${orgId}')" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1"><i data-lucide="pencil" class="w-4 h-4"></i>编辑</button>
        <button onclick="deleteOrg('${orgId}')" class="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-sm hover:bg-red-100 flex items-center gap-1"><i data-lucide="trash-2" class="w-4 h-4"></i>删除</button>
        <button onclick="openPersonModal('${orgId}')" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm hover:bg-indigo-100 flex items-center gap-1"><i data-lucide="user-plus" class="w-4 h-4"></i>添加人员</button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 detail-card-grid">
      ${activePersons.sort((a,b) => (IMPORTANCE_CONFIG[a.importance]?.rank??4) - (IMPORTANCE_CONFIG[b.importance]?.rank??4)).map(p => renderPersonCard(p)).join('') || '<div class="empty-state col-span-2"><p>暂无在职人员</p></div>'}
    </div>
    ${archivedPersons.length ? `
      <h4 class="font-bold text-gray-500 text-sm mt-5 mb-3 flex items-center gap-2"><i data-lucide="archive" class="w-4 h-4"></i>过往人员（${archivedPersons.length}）</h4>
      <div class="grid grid-cols-2 gap-3 detail-card-grid">
        ${archivedPersons.sort((a,b) => (IMPORTANCE_CONFIG[a.importance]?.rank??4) - (IMPORTANCE_CONFIG[b.importance]?.rank??4)).map(p => renderPersonCard(p, true)).join('')}
      </div>
    ` : ''}`;
  if (lucide) lucide.createIcons();
}

function renderPersonCard(p, isArchived) {
  const myUser = getMyUser(p.myContactId);
  const children = getChildren(p.id);
  const parent = p.parentId ? getClientPerson(p.parentId) : null;
  const cardClass = isArchived ? 'opacity-60 grayscale' : '';
  return `
    <div class="imp-${p.importance} person-card border border-gray-200 rounded-xl p-4 card-hover ${cardClass}" onclick="selectNode('person','${p.id}')">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style="background:${IMPORTANCE_CONFIG[p.importance].color}">${p.name[0]}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-gray-800 text-sm">${p.name}</span>
            ${isArchived ? '<span class="text-xs text-orange-500 border border-orange-300 rounded px-1.5 py-0.5">已归档</span>' : ''}
            <span class="imp-badge">${IMPORTANCE_CONFIG[p.importance].short}</span>
          </div>
          <p class="text-xs text-gray-500 mt-0.5">${p.position}</p>
          <div class="mt-2 space-y-1">
            <div class="flex items-center gap-1.5 text-xs text-gray-400"><i data-lucide="link" class="w-3 h-3"></i><span>对接：${myUser ? myUser.name : '未指定'}</span></div>
            ${parent ? `<div class="flex items-center gap-1.5 text-xs text-gray-400"><i data-lucide="arrow-up" class="w-3 h-3"></i><span>上级：${parent.name}</span></div>` : ''}
            ${children.length ? `<div class="flex items-center gap-1.5 text-xs text-gray-400"><i data-lucide="arrow-down" class="w-3 h-3"></i><span>下属：${children.length}人</span></div>` : ''}
            ${p.phone ? `<div class="flex items-center gap-1.5 text-xs text-gray-400"><i data-lucide="phone" class="w-3 h-3"></i><span>${p.phone}</span></div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function renderPersonDetail(personId) {
  const p = getClientPerson(personId);
  if (!p) return;
  const isArchived = p.status === 'archived';
  const org = getOrg(p.orgId);
  const myUser = getMyUser(p.myContactId);
  const parent = p.parentId ? getClientPerson(p.parentId) : null;
  const children = getChildren(p.id);
  const records = DB.records.filter(r => r.clientPersonIds.includes(personId));

  document.getElementById('personDetailPanel').innerHTML = `
    <div class="imp-${p.importance} person-card border border-gray-200 rounded-xl p-5 mb-5 ${isArchived ? 'opacity-60 grayscale' : ''}">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0" style="background:${IMPORTANCE_CONFIG[p.importance].color}">${p.name[0]}</div>
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-xl font-bold text-gray-800">${p.name}</h3>
            ${isArchived ? '<span class="text-sm text-orange-500 border border-orange-300 rounded px-2 py-0.5 font-medium">已归档</span>' : ''}
            <span class="imp-badge">${IMPORTANCE_CONFIG[p.importance].label}</span>
          </div>
          <p class="text-sm text-gray-500 mt-1">${p.position} · ${org ? org.name : ''}</p>
          <div class="grid grid-cols-2 gap-3 mt-4 person-detail-grid">
            <div class="bg-gray-50 rounded-lg p-3"><p class="text-xs text-gray-400 mb-1">我方对接人</p><p class="text-sm font-semibold text-gray-700">${myUser ? myUser.name + '（' + myUser.position + '）' : '未指定'}</p></div>
            <div class="bg-gray-50 rounded-lg p-3"><p class="text-xs text-gray-400 mb-1">联系电话</p><p class="text-sm font-semibold text-gray-700">${p.phone || '未录入'}</p></div>
            <div class="bg-gray-50 rounded-lg p-3"><p class="text-xs text-gray-400 mb-1">上级</p><p class="text-sm font-semibold text-gray-700">${parent ? parent.name + '（' + parent.position + '）' : '无（顶层）'}</p></div>
            <div class="bg-gray-50 rounded-lg p-3"><p class="text-xs text-gray-400 mb-1">下级</p><p class="text-sm font-semibold text-gray-700">${children.length ? children.map(c => c.name).join('、') : '无'}</p></div>
          </div>
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          <button onclick="openPersonModal(null,'${p.id}')" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 flex items-center gap-1"><i data-lucide="pencil" class="w-3.5 h-3.5"></i>编辑</button>
          ${isArchived
            ? `<button onclick="restorePerson('${p.id}')" class="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs hover:bg-green-100 flex items-center gap-1"><i data-lucide="undo-2" class="w-3.5 h-3.5"></i>恢复</button>`
            : `<button onclick="deletePerson('${p.id}')" class="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs hover:bg-red-100 flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>删除</button>`
          }
        </div>
      </div>
    </div>
    ${children.length ? `
      <h4 class="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2"><i data-lucide="git-fork" class="w-4 h-4 text-indigo-500"></i>下属人员（${children.length}）</h4>
      <div class="grid grid-cols-2 gap-3 mb-5 detail-card-grid">${children.map(c => renderPersonCard(c)).join('')}</div>
    ` : ''}
    <h4 class="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2"><i data-lucide="message-square" class="w-4 h-4 text-indigo-500"></i>相关沟通记录（${records.length}）</h4>
    <div class="space-y-3">
      ${records.length ? [...records].sort((a,b) => b.date.localeCompare(a.date)).map(r => {
        const type = TYPE_CONFIG[r.type];
        const myU = getMyUser(r.myUserId);
        return `
          <div class="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer" onclick="jumpToRecord('${r.id}')">
            <div class="flex items-center gap-2 mb-1">
              <span class="type-badge ${type.cls}">${type.label}</span>
              <span class="text-sm font-semibold text-gray-800">${r.title}</span>
              <span class="text-xs text-gray-400 ml-auto">${formatDate(r.date)}</span>
            </div>
            <p class="text-xs text-gray-500 line-clamp-2">${r.content}</p>
            <p class="text-xs text-gray-400 mt-1">我方：${myU ? myU.name : ''}</p>
          </div>`;
      }).join('') : '<div class="empty-state py-8"><p>暂无相关沟通记录</p></div>'}
    </div>`;
  if (lucide) lucide.createIcons();
}

// =====================================================
// 添加机构
// =====================================================
function openOrgModal() {
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="building-2" class="w-5 h-5 text-indigo-500"></i>添加客户机构</h3>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">机构名称 <span class="text-red-500">*</span></label>
          <input type="text" id="orgName" placeholder="如：XX集团有限公司" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">所属行业</label>
          <input type="text" id="orgIndustry" placeholder="如：金融投资、科技/软件" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="saveOrg()" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">确认添加</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function saveOrg() {
  const name = document.getElementById('orgName').value.trim();
  if (!name) { showToast('请输入机构名称'); return; }
  const industry = document.getElementById('orgIndustry').value.trim();
  const maxOrder = DB.orgs.reduce((max, o) => Math.max(max, o.sortOrder || 0), 0);
  const org = { id: uid(), name, industry, createdAt: Date.now(), sortOrder: maxOrder + 100 };
  DB.orgs.push(org);
  saveLocal();
  await syncToCloud('orgs', org);
  closeModal();
  renderPeoplePage();
  showToast('机构添加成功');
}

// 编辑机构
function openOrgEditModal(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="building-2" class="w-5 h-5 text-indigo-500"></i>编辑机构</h3>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">机构名称 <span class="text-red-500">*</span></label>
          <input type="text" id="orgName" value="${org.name}" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">所属行业</label>
          <input type="text" id="orgIndustry" value="${org.industry || ''}" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">详情链接（腾讯文档等）</label>
          <input type="url" id="orgDetailUrl" value="${org.detailUrl || ''}" placeholder="粘贴腾讯文档/飞书文档链接..." class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="saveOrgEdit('${orgId}')" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">保存修改</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function saveOrgEdit(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  const name = document.getElementById('orgName').value.trim();
  if (!name) { showToast('请输入机构名称'); return; }
  org.name = name;
  org.industry = document.getElementById('orgIndustry').value.trim();
  org.detailUrl = document.getElementById('orgDetailUrl').value.trim();
  saveLocal();
  await syncToCloud('orgs', org);
  closeModal();
  renderPeoplePage();
  showToast('机构修改成功');
}

// 点击详情按钮但未配置链接 → 弹出配置弹窗
function openDetailUrlConfig(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2"><i data-lucide="external-link" class="w-5 h-5 text-blue-500"></i>配置详情链接</h3>
      <p class="text-xs text-gray-400 mb-4">为「<span class="font-semibold text-gray-700">${org.name}</span>」配置腾讯文档等外部详情页链接</p>
      <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">详情链接</label>
        <input type="url" id="configDetailUrl" value="${org.detailUrl || ''}" placeholder="https://docs.qq.com/doc/..." class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
      <div class="flex gap-3 mt-6">
        <button onclick="saveDetailUrlConfig('${orgId}')" class="flex-1 px-4 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">保存</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function saveDetailUrlConfig(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  const url = document.getElementById('configDetailUrl').value.trim();
  org.detailUrl = url || undefined;
  saveLocal();
  await syncToCloud('orgs', org);
  closeModal();
  renderDashboard();
  if (url) { window.open(url, '_blank'); }
  else { showToast('已清除详情链接'); }
}

async function deleteOrg(orgId) {
  if (!confirm('确定删除该机构吗？过往沟通记录将被保留，机构下所有人员也将被删除。')) return;
  // 删除该机构下的所有人员
  const personIds = DB.clientPersons.filter(p => p.orgId === orgId).map(p => p.id);
  DB.clientPersons = DB.clientPersons.filter(p => p.orgId !== orgId);
  DB.orgs = DB.orgs.filter(o => o.id !== orgId);
  selectedTreeNode = null;
  saveLocal();
  // 同步到云端
  await removeFromCloud('orgs', orgId);
  for (const pid of personIds) await removeFromCloud('client_persons', pid);
  renderPeoplePage();
  showToast('机构已删除（沟通记录已保留）');
}

// =====================================================
// 添加/编辑人员
// =====================================================
function openPersonModal(orgId, personId) {
  const isEdit = !!personId;
  const person = isEdit ? getClientPerson(personId) : null;
  const targetOrgId = orgId || (person ? person.orgId : (DB.orgs[0]?.id || ''));
  const orgOptions = sortOrgs().map(o => `<option value="${o.id}" ${o.id === targetOrgId ? 'selected' : ''}>${o.name}</option>`).join('');
  const impOptions = Object.entries(IMPORTANCE_CONFIG).map(([k,v]) => `<option value="${k}" ${person && person.importance === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const myUserOptions = getActiveMyUsers().map(u => `<option value="${u.id}" ${person && person.myContactId === u.id ? 'selected' : ''}>${u.name}（${u.position}）</option>`).join('');

  document.getElementById('modalBody').innerHTML = `
    <div class="p-6 max-h-[80vh] overflow-y-auto">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="user-plus" class="w-5 h-5 text-indigo-500"></i>${isEdit ? '编辑人员' : '添加人员'}</h3>
      ${DB.orgs.length === 0 ? `
        <div class="text-center py-6 text-gray-400 text-sm"><p>请先添加客户机构</p></div>
        <button onclick="closeModal()" class="w-full px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">关闭</button>
      ` : `
        <div class="space-y-4">
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">所属机构 <span class="text-red-500">*</span></label>
            <select id="pOrgId" onchange="updateParentSelect(this.value)" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm">${orgOptions}</select></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">姓名 <span class="text-red-500">*</span></label>
              <input type="text" id="pName" value="${person ? person.name : ''}" placeholder="如：张三" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
            <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">职位 <span class="text-red-500">*</span></label>
              <input type="text" id="pPosition" value="${person ? person.position : ''}" placeholder="如：IT总监" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
          </div>
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">重要程度 <span class="text-red-500">*</span></label>
            <select id="pImportance" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm">${impOptions}</select></div>
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">上级（可选）</label>
            <select id="pParent" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"><option value="">无（顶层人员）</option>${updateParentOptions(targetOrgId, personId)}</select></div>
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">我方对接人</label>
            <select id="pMyContact" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"><option value="">-</option>${myUserOptions}</select></div>
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">联系电话</label>
            <input type="text" id="pPhone" value="${person ? person.phone || '' : ''}" placeholder="如：138****8888" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
        </div>
        <div class="flex gap-3 mt-6">
          <button onclick="savePerson('${personId || ''}')" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">${isEdit ? '保存修改' : '确认添加'}</button>
          <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
        </div>
      `}
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

function updateParentOptions(orgId, excludeId) {
  const persons = DB.clientPersons.filter(p => p.orgId === orgId && p.id !== excludeId && p.status !== 'archived');
  return persons.map(p => `<option value="${p.id}">${p.name}（${p.position}）</option>`).join('');
}

window.updateParentSelect = function(orgId) {
  document.getElementById('pParent').innerHTML = '<option value="">无（顶层人员）</option>' + updateParentOptions(orgId);
};

async function savePerson(personId) {
  const orgId = document.getElementById('pOrgId').value;
  const name = document.getElementById('pName').value.trim();
  const position = document.getElementById('pPosition').value.trim();
  const importance = document.getElementById('pImportance').value;
  const parentId = document.getElementById('pParent').value || null;
  const myContactId = document.getElementById('pMyContact').value;
  const phone = document.getElementById('pPhone').value.trim();

  if (!name || !position) { showToast('请填写必填项'); return; }

  if (personId) {
    const p = getClientPerson(personId);
    if (p) { Object.assign(p, { orgId, name, position, importance, parentId, myContactId, phone }); await syncToCloud('client_persons', p); }
  } else {
    const p = { id: uid(), orgId, name, position, importance, parentId, myContactId, phone, status: 'active' };
    DB.clientPersons.push(p);
    await syncToCloud('client_persons', p);
  }
  saveLocal();
  closeModal();
  renderPeoplePage();
  showToast(personId ? '人员修改成功' : '人员添加成功');
}

async function deletePerson(personId) {
  const p = getClientPerson(personId);
  if (!p) return;
  if (!confirm(`确定将「${p.name}」归档到"过往人员"吗？\n\n归档后：\n· 人员信息保留在机构下的"过往人员"分组中\n· 过往沟通记录将完整保留\n· 关联的下级人员将变为顶层`)) return;
  DB.clientPersons.filter(p => p.parentId === personId).forEach(p => p.parentId = null);
  p.status = 'archived';
  selectedTreeNode = null;
  saveLocal();
  await syncToCloud('client_persons', p);
  renderPeoplePage();
  showToast('人员已归档至「过往人员」');
}

async function restorePerson(personId) {
  const p = getClientPerson(personId);
  if (!p) return;
  p.status = 'active';
  selectedTreeNode = null;
  saveLocal();
  await syncToCloud('client_persons', p);
  renderPeoplePage();
  showToast('人员已恢复为在职状态');
}

// =====================================================
// 时间线
// =====================================================
function renderTimeline() {
  const filterOrg = document.getElementById('filterOrg');
  const currentOrg = filterOrg.value;
  filterOrg.innerHTML = '<option value="">全部机构</option>' + sortOrgs().map(o => `<option value="${o.id}" ${o.id === currentOrg ? 'selected' : ''}>${o.name}</option>`).join('');

  const filterPerson = document.getElementById('filterPerson');
  const selectedOrg = document.getElementById('filterOrg').value;
  const currentPerson = filterPerson.value;
  if (selectedOrg) {
    const personOpts = DB.clientPersons.filter(p => p.orgId === selectedOrg);
    filterPerson.innerHTML = '<option value="">全部甲方人员</option>' + personOpts.map(p => `<option value="${p.id}" ${p.id === currentPerson ? 'selected' : ''}>${p.name}（${p.position}）${p.status === 'archived' ? '[归档]' : ''}</option>`).join('');
    filterPerson.disabled = false;
    filterPerson.className = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm';
  } else {
    filterPerson.innerHTML = '<option value="">请先选择机构</option>';
    filterPerson.disabled = true;
    filterPerson.className = 'border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-400 bg-gray-50';
  }

  let records = [...DB.records];
  const fType = document.getElementById('filterType').value;
  const fOrg = document.getElementById('filterOrg').value;
  const fPerson = document.getElementById('filterPerson').value;
  const fKeyword = (document.getElementById('filterKeyword')?.value || '').trim().toLowerCase();
  if (fType) records = records.filter(r => r.type === fType);
  if (fPerson) records = records.filter(r => r.clientPersonIds.includes(fPerson));
  if (fOrg) records = records.filter(r => r.clientPersonIds.some(id => { const p = getClientPerson(id); return p && p.orgId === fOrg; }));
  if (fKeyword) records = records.filter(r => r.title.toLowerCase().includes(fKeyword) || r.content.toLowerCase().includes(fKeyword));
  const fDate = document.getElementById('filterDate')?.value;
  if (fDate) records = records.filter(r => r.date === fDate);
  records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  document.getElementById('timelineCount').textContent = `共 ${records.length} 条记录`;

  const container = document.getElementById('timelineList');
  if (records.length === 0) {
    container.innerHTML = '<div class="empty-state"><i data-lucide="inbox" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i><p>暂无沟通记录</p></div>';
    if (lucide) lucide.createIcons();
    return;
  }

  const groups = {};
  records.forEach(r => { if (!groups[r.date]) groups[r.date] = []; groups[r.date].push(r); });
  // 同一日期内按机构分组排序
  Object.values(groups).forEach(recs => {
    recs.sort((a, b) => {
      const ao = a.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean).map(p => p.orgId).join(',');
      const bo = b.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean).map(p => p.orgId).join(',');
      if (ao !== bo) return ao.localeCompare(bo);
      return a.createdAt - b.createdAt;
    });
  });

  container.innerHTML = Object.entries(groups).map(([date, recs]) => `
    <div class="mb-6 last:mb-0">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center"><i data-lucide="calendar" class="w-4 h-4 text-indigo-500"></i></div>
        <span class="font-bold text-gray-800">${formatDateFull(date)}</span>
        <span class="text-sm text-gray-400">（${formatDate(date)}）</span>
        <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">${recs.length}条</span>
      </div>
      ${recs.map((r, i) => {
        const curOrgs = r.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean).map(p => p.orgId).join(',');
        const nextOrgs = i < recs.length - 1 ? recs[i+1].clientPersonIds.map(id => getClientPerson(id)).filter(Boolean).map(p => p.orgId).join(',') : '';
        const isBreak = i === recs.length - 1 || curOrgs !== nextOrgs;
        return renderTimelineItem(r, isBreak);
      }).join('')}
    </div>
  `).join('');

  if (lucide) lucide.createIcons();
}

// 点击相关沟通记录跳转到沟通时间线页并高亮定位
function jumpToRecord(recordId) {
  switchView('timeline');
  setTimeout(() => {
    const container = document.getElementById('timelineList');
    const items = container.querySelectorAll('.timeline-item');
    let target = null;
    items.forEach(item => {
      item.classList.remove('record-highlight');
      if (item.dataset.recordId === recordId) target = item;
    });
    if (target) {
      target.classList.add('record-highlight');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => target.classList.remove('record-highlight'), 3000);
    }
  }, 300);
}

function renderTimelineItem(r, isOrgBreak) {
  const type = TYPE_CONFIG[r.type];
  const myUser = getMyUser(r.myUserId);
  const persons = r.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean);
  const orgs = [...new Set(persons.map(p => p.orgId))];
  const keyword = (document.getElementById('filterKeyword')?.value || '').trim();
  const hl = (text) => keyword ? text.replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark class="keyword-highlight">${m}</mark>`) : text;
  return `
    <div class="timeline-item type-${r.type}${isOrgBreak ? ' org-break' : ''}" data-record-id="${r.id}">
      <div class="timeline-dot"></div>
      <div class="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <span class="type-badge ${type.cls}">${type.label}</span>
          ${orgs.map(oid => { const o = getOrg(oid); return o ? `<span class="text-sm text-white bg-indigo-600 px-2.5 py-0.5 rounded-md font-bold flex items-center gap-1 cursor-pointer hover:bg-indigo-700 transition-colors" onclick="filterByOrg('${oid}')" title="点击筛选该机构"><i data-lucide="building-2" class="w-3 h-3"></i>${o.name}</span>` : ''; }).join('')}
          <span class="font-semibold text-gray-800 text-sm">${hl(r.title)}</span>
          <button onclick="deleteRecord('${r.id}')" class="ml-auto text-gray-300 hover:text-red-500" title="删除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
        <p class="text-sm text-gray-600 leading-relaxed mb-3">${hl(r.content)}</p>
        <div class="flex items-center gap-4 flex-wrap text-xs">
          <div class="flex items-center gap-1.5 text-gray-500"><i data-lucide="user" class="w-3.5 h-3.5"></i><span>我方：${myUser ? myUser.name + '（' + myUser.position + '）' : '未知'}</span></div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <i data-lucide="users" class="w-3.5 h-3.5 text-gray-400"></i>
            <span class="text-gray-400">甲方：</span>
            ${persons.map(p => `<span class="tag-chip imp-${p.importance} cursor-pointer hover:opacity-80 transition-opacity" style="background:var(--ibg);color:var(--ic);border:1px solid var(--ibd)" onclick="jumpToPerson('${p.id}')" title="点击查看人员详情">${p.name}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
}

// 点击机构名称跳转到机构人员页查看机构详情
function jumpToOrg(orgId) {
  selectedTreeNode = { type: 'org', id: orgId };
  switchView('people');
  setTimeout(() => {
    collapsedNodes.delete(orgId);
    DB.clientPersons.filter(p => p.orgId === orgId).map(p => p.id).forEach(pid => collapsedNodes.delete(pid));
    renderOrgTree();
    renderOrgDetail(orgId);
    if (lucide) lucide.createIcons();
  }, 50);
}

// 点击甲方人员跳转到机构人员页查看详情
function jumpToPerson(personId) {
  // 确保该人员所有上级节点都是展开状态
  selectedTreeNode = { type: 'person', id: personId };
  switchView('people');
  // 展开该人员、其所属机构及所有上级节点
  setTimeout(() => {
    const p = getClientPerson(personId);
    if (p) {
      collapsedNodes.delete(p.orgId);
      let pid = personId;
      while (pid) {
        collapsedNodes.delete(pid);
        const pp = getClientPerson(pid);
        pid = pp ? pp.parentId : null;
      }
    }
    renderOrgTree();
    if (lucide) lucide.createIcons();
  }, 50);
}

// 点击机构标签筛选（时间线页 + 仪表盘）
function filterByOrg(orgId) {
  const tl = document.getElementById('filterOrg');
  if (tl) tl.value = orgId;
  renderTimeline();
  if (lucide) lucide.createIcons();
}

function filterByOrgDash(orgId) {
  const dash = document.getElementById('filterOrgDash');
  if (dash) dash.value = orgId;
  renderDashboardCalendar();
  if (lucide) lucide.createIcons();
}

async function deleteRecord(id) {
  if (!confirm('确定删除该沟通记录吗？')) return;
  DB.records = DB.records.filter(r => r.id !== id);
  saveLocal();
  await removeFromCloud('records', id);
  renderTimeline();
  showToast('记录已删除');
}

// =====================================================
// 录入工作
// =====================================================
function renderRecordPage() {
  document.getElementById('recDate').value = getDateOffset(0);
  const myUserSelect = document.getElementById('recMyUser');
  myUserSelect.innerHTML = '<option value="">请选择...</option>' + getActiveMyUsers().map(u => `<option value="${u.id}">${u.name}（${u.position}）</option>`).join('');

  selectedClientPersons.clear();
  // 填充合作机构下拉
  const orgSelect = document.getElementById('recClientOrg');
  orgSelect.innerHTML = '<option value="">请选择机构...</option>' + sortOrgs().map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  // 隐藏人员区域
  document.getElementById('recClientPersonsContainer').classList.add('hidden');

  updateTypeSelector();
  if (lucide) lucide.createIcons();
}

// 选择机构后渲染该机构的人员
function renderRecClientPersons() {
  const orgId = document.getElementById('recClientOrg').value;
  const container = document.getElementById('recClientPersons');
  const wrapper = document.getElementById('recClientPersonsContainer');

  if (!orgId) {
    wrapper.classList.add('hidden');
    return;
  }

  selectedClientPersons.clear();
  const persons = DB.clientPersons.filter(p => p.orgId === orgId && p.status !== 'archived');
  if (persons.length === 0) {
    container.innerHTML = '<div class="text-center py-4 text-gray-400 text-sm">该机构暂无人员</div>';
  } else {
    container.innerHTML = persons.map(p => `
      <div class="checkbox-tag imp-${p.importance} border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5" data-person-id="${p.id}" onclick="togglePerson('${p.id}')">
        <span class="imp-dot"></span><span>${p.name}</span><span class="text-xs text-gray-400">${p.position}</span>
      </div>`).join('');
  }
  wrapper.classList.remove('hidden');
  if (lucide) lucide.createIcons();
}

// 从录入页面新增机构
function openAddOrgFromRecord() {
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="building-2" class="w-5 h-5 text-indigo-500"></i>新增客户机构</h3>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">机构名称 <span class="text-red-500">*</span></label>
          <input type="text" id="quickOrgName" placeholder="如：XX集团有限公司" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">所属行业</label>
          <input type="text" id="quickOrgIndustry" placeholder="如：金融投资、科技/软件" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"></div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="saveOrgFromRecord()" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">确认添加</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function saveOrgFromRecord() {
  const name = document.getElementById('quickOrgName').value.trim();
  if (!name) { showToast('请输入机构名称'); return; }
  const industry = document.getElementById('quickOrgIndustry').value.trim();
  const maxOrder = DB.orgs.reduce((max, o) => Math.max(max, o.sortOrder || 0), 0);
  const org = { id: uid(), name, industry, createdAt: Date.now(), sortOrder: maxOrder + 100 };
  DB.orgs.push(org);
  saveLocal();
  await syncToCloud('orgs', org);
  closeModal();
  // 刷新下拉并自动选中新机构
  const orgSelect = document.getElementById('recClientOrg');
  orgSelect.innerHTML = '<option value="">请选择机构...</option>' + sortOrgs().map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  orgSelect.value = org.id;
  // 触发人员区域刷新
  renderRecClientPersons();
  showToast('机构添加成功，已自动选中');
}

// 从录入页面新增甲方人员
function openAddPersonFromRecord() {
  const orgId = document.getElementById('recClientOrg').value;
  if (!orgId) { showToast('请先选择合作机构'); return; }
  const org = getOrg(orgId);
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><i data-lucide="user-plus" class="w-5 h-5 text-indigo-500"></i>新增甲方人员</h3>
      <p class="text-xs text-gray-400 mb-4">所属机构：<span class="font-bold text-gray-700">${org ? org.name : orgId}</span></p>
      <div class="space-y-4">
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">姓名 <span class="text-red-500">*</span></label>
          <input type="text" id="quickPersonName" placeholder="请输入姓名" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" maxlength="20"></div>
        <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">职位 <span class="text-red-500">*</span></label>
          <input type="text" id="quickPersonPosition" placeholder="如：总经理、技术总监" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm" maxlength="30"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">重要程度</label>
            <select id="quickPersonImportance" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm">
              ${Object.entries(IMPORTANCE_CONFIG).map(([k,v]) => `<option value="${k}" ${k === 'B' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select></div>
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">我方对接人</label>
            <select id="quickPersonMyUser" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm">
              <option value="">-</option>
              ${getActiveMyUsers().map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
            </select></div>
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="savePersonFromRecord('${orgId}')" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">确认添加</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function savePersonFromRecord(orgId) {
  const name = document.getElementById('quickPersonName').value.trim();
  const position = document.getElementById('quickPersonPosition').value.trim();
  if (!name) { showToast('请输入姓名'); return; }
  if (!position) { showToast('请输入职位'); return; }
  const importance = document.getElementById('quickPersonImportance').value;
  const myContactId = document.getElementById('quickPersonMyUser').value || null;
  const person = {
    id: uid(), orgId, name, position, importance,
    parentId: null, myContactId, phone: '', status: 'active'
  };
  DB.clientPersons.push(person);
  saveLocal();
  await syncToCloud('client_persons', person);
  closeModal();
  // 刷新人员列表
  renderRecClientPersons();
  showToast('人员添加成功');
}

function updateTypeSelector() {
  document.querySelectorAll('#typeSelector .checkbox-tag').forEach(label => {
    const radio = label.querySelector('input');
    if (radio.checked) { label.classList.add('selected'); label.classList.remove('border-gray-300'); label.classList.add('border-indigo-400'); }
    else { label.classList.remove('selected'); label.classList.add('border-gray-300'); label.classList.remove('border-indigo-400'); }
  });
}

window.togglePerson = function(personId) {
  const label = document.querySelector(`[data-person-id="${personId}"]`);
  if (selectedClientPersons.has(personId)) { selectedClientPersons.delete(personId); label.classList.remove('selected'); }
  else { selectedClientPersons.add(personId); label.classList.add('selected'); }
};

async function submitRecord(event) {
  event.preventDefault();
  const date = document.getElementById('recDate').value;
  const type = document.querySelector('input[name="recType"]:checked').value;
  const myUserId = document.getElementById('recMyUser').value;
  const title = document.getElementById('recTitle').value.trim();
  const content = document.getElementById('recContent').value.trim();

  if (!date || !type || !myUserId || !title || !content) { showToast('请填写所有必填项'); return; }
  if (selectedClientPersons.size === 0) { document.getElementById('recClientError').classList.remove('hidden'); return; }
  document.getElementById('recClientError').classList.add('hidden');

  const record = { id: uid(), date, type, title, content, myUserId, clientPersonIds: Array.from(selectedClientPersons), createdAt: Date.now() };
  DB.records.push(record);
  saveLocal();
  await syncToCloud('records', record);

  document.getElementById('recordForm').reset();
  selectedClientPersons.clear();
  document.querySelectorAll('#recClientPersons .checkbox-tag').forEach(el => el.classList.remove('selected'));
  document.getElementById('recDate').value = getDateOffset(0);
  updateTypeSelector();

  showToast('工作记录已提交，已同步到时间线');
  setTimeout(() => switchView('timeline'), 800);
}

// =====================================================
// 云同步状态面板（Supabase 实时数据库）
// =====================================================
function openSyncModal() {
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <i data-lucide="cloud" class="w-5 h-5 text-indigo-500"></i>云同步状态
      </h3>
      <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <p class="text-sm text-green-800 font-semibold flex items-center gap-2">
          <span class="sync-dot sync-on inline-block"></span> Supabase 实时数据库 · 全自动同步
        </p>
        <p class="text-xs text-green-600 mt-1">所有设备打开即同步，修改实时推送，无需任何配置。</p>
      </div>
      <p class="text-sm text-gray-500 mb-4">数据存储在 Supabase 云数据库中，支持多设备<strong>实时协作</strong>。本页面任一操作（新增、编辑、删除、排序）均自动同步，其他设备<strong>无需刷新</strong>即可看到更新。</p>
      <div class="flex items-center gap-2 text-sm mb-4">
        <span class="sync-dot sync-${Cloud.status === 'on' ? 'on' : Cloud.status === 'err' ? 'err' : 'off'}"></span>
        <span class="text-gray-600">当前状态：${Cloud.status === 'on' ? '实时同步中' : Cloud.status === 'err' ? '连接异常' : '离线模式'}</span>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="pushLocalToCloud();closeModal()" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">手动同步</button>
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">关闭</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

// =====================================================
// 模态框
// =====================================================
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
}

// =====================================================
// 初始化
// =====================================================
function renderAll() { renderDashboard(); }

async function init() {
  document.getElementById('currentDate').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // 绑定导航事件
  document.querySelectorAll('.nav-item, .nav-mobile-item').forEach(btn => {
    if (btn.dataset.view) btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // 类型选择器
  document.querySelectorAll('#typeSelector input[name="recType"]').forEach(radio => radio.addEventListener('change', updateTypeSelector));

  // 模态框遮罩点击关闭
  document.getElementById('modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

  // 登录回车键支持
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('loginUsername').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPassword').focus(); });

  // 先初始化 Supabase 连接
  Cloud.init();

  // 检查登录状态
  if (checkSession()) {
    document.getElementById('loginOverlay').classList.add('hidden');
    await loadData();
    renderAll();
    updateUserBar();
  }
  // 未登录则显示登录页（默认可见）
  if (lucide) lucide.createIcons();
}

window.addEventListener('DOMContentLoaded', init);
