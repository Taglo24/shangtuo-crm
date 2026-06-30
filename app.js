// =====================================================
// 商拓通 · 商务协作管理平台 - 应用逻辑
// 支持 Supabase 云端同步 + localStorage 本地降级
// =====================================================

const STORAGE_KEY = 'shangtuo_data_v1';
const CONFIG_KEY = 'shangtuo_supabase_config';

const IMPORTANCE_CONFIG = {
  S: { label: 'S级·核心决策者', short: 'S', color: '#EF4444' },
  A: { label: 'A级·关键影响者', short: 'A', color: '#F97316' },
  B: { label: 'B级·重要对接人', short: 'B', color: '#3B82F6' },
  C: { label: 'C级·普通对接人', short: 'C', color: '#10B981' },
  D: { label: 'D级·辅助人员', short: 'D', color: '#6B7280' },
};

const TYPE_CONFIG = {
  visit:   { label: '拜访', icon: 'map-pin',   color: '#4F46E5', cls: 'type-visit' },
  call:    { label: '电话', icon: 'phone',     color: '#0EA5E9', cls: 'type-call' },
  email:   { label: '邮件', icon: 'mail',      color: '#8B5CF6', cls: 'type-email' },
  meeting: { label: '会议', icon: 'video',     color: '#F59E0B', cls: 'type-meeting' },
  other:   { label: '其他', icon: 'file-text', color: '#6B7280', cls: 'type-other' },
};

// 字段映射：JS camelCase <-> Supabase snake_case
const FIELD_MAP = {
  orgs: { orgId:'org_id', createdAt:'created_at' },
  client_persons: { orgId:'org_id', parentId:'parent_id', myContactId:'my_contact_id' },
  records: { myUserId:'my_user_id', clientPersonIds:'client_person_ids', createdAt:'created_at' },
};

let DB = { orgs: [], clientPersons: [], myUsers: [], records: [] };
let selectedTreeNode = null;
let selectedClientPersons = new Set();

// =====================================================
// 云端同步层 (Supabase)
// =====================================================
const Cloud = {
  client: null,
  enabled: false,
  status: 'off', // off | on | err | spin

  getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); }
    catch { return {}; }
  },

  setConfig(url, key) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
    this.init();
  },

  clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
    this.client = null;
    this.enabled = false;
    this.status = 'off';
    this.updateIndicator();
  },

  init() {
    const cfg = this.getConfig();
    if (cfg.url && cfg.key && window.supabase) {
      try {
        this.client = supabase.createClient(cfg.url, cfg.key);
        this.enabled = true;
        this.status = 'on';
      } catch (e) {
        this.status = 'err';
      }
    } else {
      this.status = 'off';
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

  // camelCase -> snake_case
  toRow(table, obj) {
    const map = FIELD_MAP[table] || {};
    const row = {};
    for (const [k, v] of Object.entries(obj)) {
      row[map[k] || k] = v;
    }
    return row;
  },

  // snake_case -> camelCase
  fromRow(table, row) {
    const map = FIELD_MAP[table] || {};
    const inv = Object.fromEntries(Object.entries(map).map(([c,s]) => [s,c]));
    const obj = {};
    for (const [k, v] of Object.entries(row)) {
      obj[inv[k] || k] = v;
    }
    return obj;
  },

  async loadAll() {
    if (!this.enabled) return null;
    this.status = 'spin'; this.updateIndicator();
    try {
      const [orgs, myUsers, persons, records] = await Promise.all([
        this.client.from('orgs').select('*'),
        this.client.from('my_users').select('*'),
        this.client.from('client_persons').select('*'),
        this.client.from('records').select('*'),
      ]);
      this.status = 'on'; this.updateIndicator();
      return {
        orgs: (orgs.data || []).map(r => this.fromRow('orgs', r)),
        myUsers: (myUsers.data || []).map(r => this.fromRow('my_users', r)),
        clientPersons: (persons.data || []).map(r => this.fromRow('client_persons', r)),
        records: (records.data || []).map(r => this.fromRow('records', r)),
      };
    } catch (e) {
      console.error('Cloud load failed:', e);
      this.status = 'err'; this.updateIndicator();
      return null;
    }
  },

  async upsert(table, obj) {
    if (!this.enabled) return;
    try { await this.client.from(table).upsert(this.toRow(table, obj)); } catch (e) { console.error('Cloud upsert failed:', e); }
  },

  async remove(table, id) {
    if (!this.enabled) return;
    try { await this.client.from(table).delete().eq('id', id); } catch (e) { console.error('Cloud delete failed:', e); }
  },
};

// =====================================================
// 数据持久化（本地 + 云端同步）
// =====================================================
function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); }

async function syncToCloud(table, obj) { await Cloud.upsert(table, obj); }
async function removeFromCloud(table, id) { await Cloud.remove(table, id); }

async function loadFromCloud() {
  const data = await Cloud.loadAll();
  if (data && (data.orgs.length || data.myUsers.length || data.clientPersons.length || data.records.length)) {
    DB = data;
    saveLocal();
    return true;
  }
  return false;
}

function initSampleData() {
  const now = Date.now();
  DB = {
    orgs: [
      { id: 'org1', name: '中诚投资集团', industry: '金融投资', createdAt: now },
      { id: 'org2', name: '锐捷科技股份有限公司', industry: '科技/软件', createdAt: now },
    ],
    myUsers: [
      { id: 'my1', name: '张明', position: '销售总监' },
      { id: 'my2', name: '李薇', position: '客户经理' },
      { id: 'my3', name: '王浩', position: '技术顾问' },
      { id: 'my4', name: '刘婷', position: '项目经理' },
    ],
    clientPersons: [
      { id: 'cp1', orgId: 'org1', name: '陈志远', position: '集团董事长', importance: 'S', parentId: null, myContactId: 'my1', phone: '138****8888' },
      { id: 'cp2', orgId: 'org1', name: '赵国强', position: '集团总裁', importance: 'S', parentId: 'cp1', myContactId: 'my1', phone: '139****6666' },
      { id: 'cp3', orgId: 'org1', name: '孙丽华', position: '副总裁·分管IT', importance: 'A', parentId: 'cp2', myContactId: 'my2', phone: '137****5555' },
      { id: 'cp4', orgId: 'org1', name: '周建明', position: '信息技术部总监', importance: 'B', parentId: 'cp3', myContactId: 'my3', phone: '136****3333' },
      { id: 'cp5', orgId: 'org1', name: '吴小燕', position: '信息技术部经理', importance: 'C', parentId: 'cp4', myContactId: 'my3', phone: '135****2222' },
      { id: 'cp6', orgId: 'org1', name: '郑伟', position: '采购部主管', importance: 'B', parentId: 'cp2', myContactId: 'my2', phone: '133****1111' },
      { id: 'cp7', orgId: 'org2', name: '黄晓峰', position: 'CEO·创始人', importance: 'S', parentId: null, myContactId: 'my1', phone: '138****9999' },
      { id: 'cp8', orgId: 'org2', name: '林婉清', position: 'CTO', importance: 'A', parentId: 'cp7', myContactId: 'my3', phone: '139****7777' },
      { id: 'cp9', orgId: 'org2', name: '高磊', position: '产品总监', importance: 'B', parentId: 'cp8', myContactId: 'my4', phone: '136****4444' },
      { id: 'cp10', orgId: 'org2', name: '马晓宇', position: '研发主管', importance: 'C', parentId: 'cp9', myContactId: 'my3', phone: '135****0000' },
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
  // 同步到云端
  if (Cloud.enabled) {
    DB.orgs.forEach(o => syncToCloud('orgs', o));
    DB.myUsers.forEach(u => syncToCloud('my_users', u));
    DB.clientPersons.forEach(p => syncToCloud('client_persons', p));
    DB.records.forEach(r => syncToCloud('records', r));
  }
}

async function loadData() {
  Cloud.init();
  // 尝试从云端加载
  if (Cloud.enabled) {
    const ok = await loadFromCloud();
    if (ok) return;
  }
  // 降级到本地
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    DB = JSON.parse(saved);
  } else {
    initSampleData();
  }
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
function getChildren(parentId) { return DB.clientPersons.filter(p => p.parentId === parentId); }
function getRootPersons(orgId) { return DB.clientPersons.filter(p => p.orgId === orgId && !p.parentId); }

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
  if (viewName === 'timeline') renderTimeline();
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
    { label: '甲方人员', value: DB.clientPersons.length, icon: 'users', bg: 'bg-blue-50', tc: 'text-blue-500' },
    { label: '我方人员', value: DB.myUsers.length, icon: 'user-check', bg: 'bg-green-50', tc: 'text-green-500' },
    { label: '近30天沟通', value: monthRecords.length, icon: 'message-square', bg: 'bg-orange-50', tc: 'text-orange-500' },
  ];

  document.getElementById('statCards').innerHTML = stats.map(s => `
    <div class="bg-white rounded-xl border border-gray-200 p-5 card-hover">
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

  const recentRecords = [...DB.records].sort((a,b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
  document.getElementById('dashboardTimeline').innerHTML = recentRecords.length ? recentRecords.map(r => {
    const type = TYPE_CONFIG[r.type];
    const myUser = getMyUser(r.myUserId);
    const persons = r.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean);
    return `
      <div class="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
        <div class="${type.cls} flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style="background:${type.color}15">
          <i data-lucide="${type.icon}" class="w-4 h-4" style="color:${type.color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-800 truncate">${r.title}</span>
            <span class="type-badge ${type.cls} flex-shrink-0">${type.label}</span>
          </div>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
            <span>${formatDate(r.date)}</span>
            <span>${myUser ? myUser.name : ''}</span>
            <span class="truncate">${persons.map(p => p.name).join('、')}</span>
          </div>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state"><p>暂无沟通记录</p></div>';

  const keyPersons = DB.clientPersons.filter(p => p.importance === 'S' || p.importance === 'A');
  document.getElementById('dashboardKeyPersons').innerHTML = keyPersons.length ? keyPersons.map(p => {
    const org = getOrg(p.orgId);
    const myUser = getMyUser(p.myContactId);
    return `
      <div class="imp-${p.importance} person-card bg-gray-50 rounded-lg p-3 flex items-center gap-3">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:${IMPORTANCE_CONFIG[p.importance].color}">${p.name[0]}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-800">${p.name}</span>
            <span class="imp-badge">${IMPORTANCE_CONFIG[p.importance].short}</span>
          </div>
          <p class="text-xs text-gray-400 truncate">${p.position} · ${org ? org.name : ''}</p>
        </div>
        <span class="text-xs text-gray-400 flex-shrink-0">对接:${myUser ? myUser.name : '-'}</span>
      </div>
    `;
  }).join('') : '<div class="empty-state"><p>暂无核心人员</p></div>';

  if (lucide) lucide.createIcons();
}

// =====================================================
// 机构人员页
// =====================================================
function renderPeoplePage() {
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

function renderOrgTree() {
  const container = document.getElementById('orgTree');
  if (DB.orgs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无机构，点击右上角添加</p></div>';
    return;
  }
  container.innerHTML = DB.orgs.map(org => {
    const persons = DB.clientPersons.filter(p => p.orgId === org.id);
    const isSelected = selectedTreeNode && selectedTreeNode.type === 'org' && selectedTreeNode.id === org.id;
    return `
      <div class="tree-node">
        <div class="tree-row ${isSelected ? 'selected' : ''} p-2 flex items-center gap-2" onclick="selectNode('org','${org.id}')">
          <i data-lucide="building-2" class="w-4 h-4 text-indigo-500 flex-shrink-0"></i>
          <span class="text-sm font-semibold text-gray-700">${org.name}</span>
          <span class="text-xs text-gray-400 ml-auto">${persons.length}人</span>
        </div>
        <div class="tree-children">${renderPersonTree(org.id, null)}</div>
      </div>`;
  }).join('');
}

function renderPersonTree(orgId, parentId) {
  const persons = DB.clientPersons.filter(p => p.orgId === orgId && p.parentId === parentId);
  if (persons.length === 0) return '';
  return persons.map(p => {
    const children = getChildren(p.id);
    const isSelected = selectedTreeNode && selectedTreeNode.type === 'person' && selectedTreeNode.id === p.id;
    return `
      <div class="tree-node">
        <div class="tree-row ${isSelected ? 'selected' : ''} p-2 flex items-center gap-2" onclick="selectNode('person','${p.id}')">
          <span class="imp-dot imp-${p.importance} flex-shrink-0"></span>
          <span class="text-sm text-gray-700">${p.name}</span>
          <span class="text-xs text-gray-400 truncate hidden sm:inline">${p.position}</span>
          ${children.length ? `<span class="text-xs text-gray-400 ml-auto">${children.length}下属</span>` : ''}
        </div>
        ${children.length ? `<div class="tree-children">${renderPersonTree(orgId, p.id)}</div>` : ''}
      </div>`;
  }).join('');
}

function selectNode(type, id) {
  selectedTreeNode = { type, id };
  if (type === 'org') renderOrgDetail(id);
  else renderPersonDetail(id);
  renderOrgTree();
  if (lucide) lucide.createIcons();
}

function renderOrgDetail(orgId) {
  const org = getOrg(orgId);
  if (!org) return;
  const persons = DB.clientPersons.filter(p => p.orgId === orgId);
  const records = DB.records.filter(r => r.clientPersonIds.some(id => getClientPerson(id)?.orgId === orgId));

  document.getElementById('personDetailPanel').innerHTML = `
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
          <i data-lucide="building-2" class="w-6 h-6 text-indigo-500"></i>
        </div>
        <div>
          <h3 class="text-lg font-bold text-gray-800">${org.name}</h3>
          <p class="text-sm text-gray-400">${org.industry || '未设置行业'} · ${persons.length}位人员 · ${records.length}条沟通记录</p>
        </div>
      </div>
      <button onclick="openPersonModal('${orgId}')" class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm hover:bg-indigo-100 flex items-center gap-1 flex-shrink-0">
        <i data-lucide="user-plus" class="w-4 h-4"></i>添加人员
      </button>
    </div>
    <div class="grid grid-cols-2 gap-3 detail-card-grid">
      ${persons.map(p => renderPersonCard(p)).join('') || '<div class="empty-state col-span-2"><p>暂无人员</p></div>'}
    </div>`;
  if (lucide) lucide.createIcons();
}

function renderPersonCard(p) {
  const myUser = getMyUser(p.myContactId);
  const children = getChildren(p.id);
  const parent = p.parentId ? getClientPerson(p.parentId) : null;
  return `
    <div class="imp-${p.importance} person-card border border-gray-200 rounded-xl p-4 card-hover" onclick="selectNode('person','${p.id}')">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style="background:${IMPORTANCE_CONFIG[p.importance].color}">${p.name[0]}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-gray-800 text-sm">${p.name}</span>
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
  const org = getOrg(p.orgId);
  const myUser = getMyUser(p.myContactId);
  const parent = p.parentId ? getClientPerson(p.parentId) : null;
  const children = getChildren(p.id);
  const records = DB.records.filter(r => r.clientPersonIds.includes(personId));

  document.getElementById('personDetailPanel').innerHTML = `
    <div class="imp-${p.importance} person-card border border-gray-200 rounded-xl p-5 mb-5">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0" style="background:${IMPORTANCE_CONFIG[p.importance].color}">${p.name[0]}</div>
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-xl font-bold text-gray-800">${p.name}</h3>
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
          <button onclick="deletePerson('${p.id}')" class="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs hover:bg-red-100 flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>删除</button>
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
          <div class="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer" onclick="switchView('timeline')">
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
  const org = { id: uid(), name, industry, createdAt: Date.now() };
  DB.orgs.push(org);
  saveLocal();
  await syncToCloud('orgs', org);
  closeModal();
  renderPeoplePage();
  showToast('机构添加成功');
}

// =====================================================
// 添加/编辑人员
// =====================================================
function openPersonModal(orgId, personId) {
  const isEdit = !!personId;
  const person = isEdit ? getClientPerson(personId) : null;
  const targetOrgId = orgId || (person ? person.orgId : (DB.orgs[0]?.id || ''));
  const orgOptions = DB.orgs.map(o => `<option value="${o.id}" ${o.id === targetOrgId ? 'selected' : ''}>${o.name}</option>`).join('');
  const impOptions = Object.entries(IMPORTANCE_CONFIG).map(([k,v]) => `<option value="${k}" ${person && person.importance === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const myUserOptions = DB.myUsers.map(u => `<option value="${u.id}" ${person && person.myContactId === u.id ? 'selected' : ''}>${u.name}（${u.position}）</option>`).join('');

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
          <div><label class="block text-sm font-semibold text-gray-700 mb-1.5">我方对接人 <span class="text-red-500">*</span></label>
            <select id="pMyContact" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"><option value="">请选择...</option>${myUserOptions}</select></div>
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
  const persons = DB.clientPersons.filter(p => p.orgId === orgId && p.id !== excludeId);
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

  if (!name || !position || !myContactId) { showToast('请填写必填项'); return; }

  if (personId) {
    const p = getClientPerson(personId);
    if (p) { Object.assign(p, { orgId, name, position, importance, parentId, myContactId, phone }); await syncToCloud('client_persons', p); }
  } else {
    const p = { id: uid(), orgId, name, position, importance, parentId, myContactId, phone };
    DB.clientPersons.push(p);
    await syncToCloud('client_persons', p);
  }
  saveLocal();
  closeModal();
  renderPeoplePage();
  showToast(personId ? '人员修改成功' : '人员添加成功');
}

async function deletePerson(personId) {
  if (!confirm('确定删除该人员吗？关联的下级人员将变为顶层，相关沟通记录中的该人员引用将被移除。')) return;
  DB.clientPersons.filter(p => p.parentId === personId).forEach(p => p.parentId = null);
  DB.records.forEach(r => { r.clientPersonIds = r.clientPersonIds.filter(id => id !== personId); });
  DB.records = DB.records.filter(r => r.clientPersonIds.length > 0);
  DB.clientPersons = DB.clientPersons.filter(p => p.id !== personId);
  selectedTreeNode = null;
  saveLocal();
  await removeFromCloud('client_persons', personId);
  renderPeoplePage();
  showToast('人员已删除');
}

// =====================================================
// 时间线
// =====================================================
function renderTimeline() {
  const filterOrg = document.getElementById('filterOrg');
  const currentOrg = filterOrg.value;
  filterOrg.innerHTML = '<option value="">全部机构</option>' + DB.orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? 'selected' : ''}>${o.name}</option>`).join('');

  const filterPerson = document.getElementById('filterPerson');
  const currentPerson = filterPerson.value;
  let personOpts = DB.clientPersons.slice();
  if (document.getElementById('filterOrg').value) {
    personOpts = personOpts.filter(p => p.orgId === document.getElementById('filterOrg').value);
  }
  filterPerson.innerHTML = '<option value="">全部甲方人员</option>' + personOpts.map(p => `<option value="${p.id}" ${p.id === currentPerson ? 'selected' : ''}>${p.name}（${p.position}）</option>`).join('');

  let records = [...DB.records];
  const fType = document.getElementById('filterType').value;
  const fOrg = document.getElementById('filterOrg').value;
  const fPerson = document.getElementById('filterPerson').value;
  if (fType) records = records.filter(r => r.type === fType);
  if (fPerson) records = records.filter(r => r.clientPersonIds.includes(fPerson));
  if (fOrg) records = records.filter(r => r.clientPersonIds.some(id => { const p = getClientPerson(id); return p && p.orgId === fOrg; }));
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

  container.innerHTML = Object.entries(groups).map(([date, recs]) => `
    <div class="mb-6 last:mb-0">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center"><i data-lucide="calendar" class="w-4 h-4 text-indigo-500"></i></div>
        <span class="font-bold text-gray-800">${formatDateFull(date)}</span>
        <span class="text-sm text-gray-400">（${formatDate(date)}）</span>
        <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">${recs.length}条</span>
      </div>
      ${recs.map(r => renderTimelineItem(r)).join('')}
    </div>
  `).join('');

  if (lucide) lucide.createIcons();
}

function renderTimelineItem(r) {
  const type = TYPE_CONFIG[r.type];
  const myUser = getMyUser(r.myUserId);
  const persons = r.clientPersonIds.map(id => getClientPerson(id)).filter(Boolean);
  return `
    <div class="timeline-item type-${r.type}">
      <div class="timeline-dot"></div>
      <div class="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <span class="type-badge ${type.cls}">${type.label}</span>
          <span class="font-semibold text-gray-800 text-sm">${r.title}</span>
          <button onclick="deleteRecord('${r.id}')" class="ml-auto text-gray-300 hover:text-red-500" title="删除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>
        <p class="text-sm text-gray-600 leading-relaxed mb-3">${r.content}</p>
        <div class="flex items-center gap-4 flex-wrap text-xs">
          <div class="flex items-center gap-1.5 text-gray-500"><i data-lucide="user" class="w-3.5 h-3.5"></i><span>我方：${myUser ? myUser.name + '（' + myUser.position + '）' : '未知'}</span></div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <i data-lucide="users" class="w-3.5 h-3.5 text-gray-400"></i>
            <span class="text-gray-400">甲方：</span>
            ${persons.map(p => { const org = getOrg(p.orgId); return `<span class="tag-chip imp-${p.importance}" style="background:var(--ibg);color:var(--ic);border:1px solid var(--ibd)">${p.name}<span class="text-[10px] opacity-60">@${org ? org.name : ''}</span></span>`; }).join('')}
          </div>
        </div>
      </div>
    </div>`;
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
  myUserSelect.innerHTML = '<option value="">请选择...</option>' + DB.myUsers.map(u => `<option value="${u.id}">${u.name}（${u.position}）</option>`).join('');

  selectedClientPersons.clear();
  const container = document.getElementById('recClientPersons');
  if (DB.clientPersons.length === 0) {
    container.innerHTML = '<div class="text-center py-4 text-gray-400 text-sm">暂无甲方人员，请先在"机构人员"中添加</div>';
    return;
  }

  container.innerHTML = DB.orgs.map(org => {
    const persons = DB.clientPersons.filter(p => p.orgId === org.id);
    if (!persons.length) return '';
    return `
      <div class="mb-3 last:mb-0">
        <p class="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1"><i data-lucide="building-2" class="w-3 h-3"></i>${org.name}</p>
        <div class="flex flex-wrap gap-2">
          ${persons.map(p => `
            <label class="checkbox-tag imp-${p.importance} border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex items-center gap-1.5" data-person-id="${p.id}" onclick="togglePerson('${p.id}')">
              <input type="checkbox" class="hidden" value="${p.id}">
              <span class="imp-dot"></span><span>${p.name}</span><span class="text-xs text-gray-400">${p.position}</span>
            </label>`).join('')}
        </div>
      </div>`;
  }).join('');

  updateTypeSelector();
  if (lucide) lucide.createIcons();
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
// 云同步配置面板
// =====================================================
function openSyncModal() {
  const cfg = Cloud.getConfig();
  document.getElementById('modalBody').innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <i data-lucide="cloud" class="w-5 h-5 text-indigo-500"></i>云同步配置
      </h3>
      <p class="text-sm text-gray-500 mb-4">配置 Supabase 云数据库后，手机和电脑访问同一网址即可数据实时同步。<a href="https://supabase.com" target="_blank" class="text-indigo-500 underline">注册 Supabase</a>，执行项目内的 <code class="bg-gray-100 px-1 rounded">supabase.sql</code> 建表，然后填入下方信息。</p>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1.5">Supabase URL</label>
          <input type="text" id="syncUrl" value="${cfg.url || ''}" placeholder="https://xxxx.supabase.co" class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1.5">anon public key</label>
          <textarea id="syncKey" rows="3" placeholder="eyJhbGciOi..." class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm resize-none">${cfg.key || ''}</textarea>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="sync-dot sync-${Cloud.status === 'on' ? 'on' : Cloud.status === 'err' ? 'err' : 'off'}"></span>
          <span class="text-gray-600">当前状态：${Cloud.status === 'on' ? '已连接云端' : Cloud.status === 'err' ? '连接异常' : '本地模式'}</span>
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick="saveSyncConfig()" class="flex-1 px-4 py-2.5 bg-indigo-500 text-white rounded-lg text-sm font-semibold hover:bg-indigo-600">保存并连接</button>
        ${Cloud.enabled ? '<button onclick="clearSyncConfig()" class="px-4 py-2.5 bg-red-50 text-red-500 rounded-lg text-sm font-semibold hover:bg-red-100">断开</button>' : ''}
        <button onclick="closeModal()" class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-200">取消</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
  if (lucide) lucide.createIcons();
}

async function saveSyncConfig() {
  const url = document.getElementById('syncUrl').value.trim();
  const key = document.getElementById('syncKey').value.trim();
  if (!url || !key) { showToast('请填写完整配置'); return; }
  Cloud.setConfig(url, key);
  closeModal();
  showToast('配置已保存，正在连接云端...');
  const ok = await loadFromCloud();
  if (ok) {
    renderAll();
    showToast('云端数据已加载');
  } else if (Cloud.enabled) {
    showToast('连接成功，云端暂无数据');
  } else {
    showToast('连接失败，请检查配置');
  }
}

async function clearSyncConfig() {
  Cloud.clearConfig();
  closeModal();
  showToast('已断开云同步，切换为本地模式');
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

  // 加载数据
  await loadData();
  renderAll();
  if (lucide) lucide.createIcons();
}

window.addEventListener('DOMContentLoaded', init);
