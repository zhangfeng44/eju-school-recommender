import { recommend, fitTierLabel } from './recommend.js';

const form = document.getElementById('score-form');
const resultsEl = document.getElementById('results');
const resultsList = document.getElementById('results-list');
const emptyEl = document.getElementById('empty-state');
const metaEl = document.getElementById('data-meta');
const crawlMetaEl = document.getElementById('crawl-meta');
const crawlSummaryEl = document.getElementById('crawl-summary');
const crawlListEl = document.getElementById('crawl-list');
const footerUpdateEl = document.getElementById('footer-update');
const trackSelect = document.getElementById('track');
const mathCourseField = document.getElementById('math-course-field');
const scienceFields = document.getElementById('science-fields');
const humanitiesFields = document.getElementById('humanities-fields');

/** @type {import('./recommend.js').Program[]} */
let programs = [];

async function loadLatestCrawl() {
  const base = import.meta.url.includes('/js/')
    ? new URL('../data/latest.json', import.meta.url)
    : new URL('./data/latest.json', window.location.href);

  const res = await fetch(base);
  if (!res.ok) {
    if (crawlMetaEl) crawlMetaEl.textContent = '暂无爬取数据，等待首次定时任务运行';
    return;
  }

  const data = await res.json();
  renderCrawlData(data);
}

function statusLabel(status) {
  const map = {
    extracted: '已抽取 EJU 信息',
    links_only: '已发现链接',
    ok: '已发现链接',
    fetch_failed: '抓取失败',
    no_domain: '缺少域名',
    no_candidates: '未找到页面',
  };
  return map[status] || status || '未知';
}

function statusClass(status) {
  if (status === 'extracted') return 'status-extracted';
  if (status === 'links_only' || status === 'ok') return 'status-links_only';
  return 'status-failed';
}

function formatScores(scores) {
  if (!scores) return '';
  const labels = {
    japanese: '日语',
    math: '数学',
    physics: '物理',
    chemistry: '化学',
    biology: '生物',
    japanWorld: '日本与世界',
  };
  const parts = [];
  for (const [k, v] of Object.entries(scores)) {
    if (v != null) parts.push(`${labels[k] || k} ${v}`);
  }
  return parts.length ? `识别到的分数参考：${parts.join(' · ')}` : '';
}

function renderCrawlData(data) {
  if (crawlMetaEl) {
    crawlMetaEl.textContent = `最后更新：${data.updatedAtLocal || data.updatedAt}（${data.timezone || 'Asia/Shanghai'}）`;
  }
  if (footerUpdateEl && data.updatedAtLocal) {
    footerUpdateEl.textContent = `爬取数据最后更新：${data.updatedAtLocal}。每日北京时间 00:00 自动同步至 GitHub。`;
  }

  const s = data.summary || {};
  if (crawlSummaryEl) {
    crawlSummaryEl.innerHTML = [
      ['total', '学校总数'],
      ['extracted', '含 EJU 文本'],
      ['linksOnly', '仅链接'],
      ['withPdf', '含 PDF'],
      ['withScores', '识别到分数'],
      ['failed', '失败/缺失'],
    ]
      .map(
        ([key, label]) =>
          `<div class="stat-card"><strong>${s[key] ?? 0}</strong><span>${label}</span></div>`
      )
      .join('');
  }

  if (!crawlListEl) return;
  crawlListEl.innerHTML = '';
  for (const school of data.schools || []) {
    const item = document.createElement('article');
    item.className = 'crawl-item';
    const status = school.enrichStatus || school.status;
    const snippet = (school.ejuSnippets || [])[0] || '';
    const scores = formatScores(school.extractedScores);
    const link = school.bestAdmissionUrl || school.domain;
    item.innerHTML = `
      <div class="crawl-item-header">
        <span class="tier-tag">${school.tier || ''}</span>
        <span class="status-tag ${statusClass(status)}">${statusLabel(status)}</span>
      </div>
      <h3>${school.name} <span class="ja">${school.nameJa || ''}</span></h3>
      ${snippet ? `<p class="crawl-snippet">${snippet}</p>` : '<p class="crawl-snippet">暂未抽取到 EJU 相关段落，可点击官网链接查看。</p>'}
      ${scores ? `<p class="crawl-scores">${scores}</p>` : ''}
      <div class="crawl-links">
        ${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer">招生/官网 ↗</a>` : ''}
        ${(school.pdfLinks || []).slice(0, 2).map((u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">PDF ↗</a>`).join('')}
      </div>
    `;
    crawlListEl.appendChild(item);
  }
}

async function loadPrograms() {
  const base = import.meta.url.includes('/js/')
    ? new URL('../data/programs.json', import.meta.url)
    : new URL('./data/programs.json', window.location.href);

  const res = await fetch(base);
  if (!res.ok) throw new Error('无法加载学校数据');
  programs = await res.json();
  if (metaEl) {
    metaEl.textContent = `当前数据库含 ${programs.length} 个学部项目（示例数据，仅供参考）`;
  }
}

function updateFieldVisibility() {
  const track = trackSelect.value;
  const isScience = track === 'science';
  scienceFields.hidden = !isScience;
  humanitiesFields.hidden = isScience;
  mathCourseField.hidden = !isScience;
}

/**
 * @param {FormData} fd
 */
function parseForm(fd) {
  const track = /** @type {'science' | 'humanities'} */ (fd.get('track'));
  const japanese = Number(fd.get('japanese'));

  if (Number.isNaN(japanese) || japanese < 0 || japanese > 450) {
    throw new Error('请输入有效的日语分数（0–450）');
  }

  /** @type {import('./recommend.js').UserScores} */
  const user = { track, japanese, mathCourse: 1 };

  if (track === 'science') {
    user.mathCourse = Number(fd.get('mathCourse')) === 2 ? 2 : 1;
    const math = Number(fd.get('math'));
    if (Number.isNaN(math) || math < 0 || math > 200) {
      throw new Error('请输入有效的数学分数（0–200）');
    }

    const parseOptional = (key) => {
      const raw = fd.get(key);
      if (raw == null) return null;
      const s = String(raw).trim();
      if (!s) return null;
      const n = Number(s);
      if (Number.isNaN(n)) return null;
      return n;
    };

    const physics = parseOptional('physics');
    const chemistry = parseOptional('chemistry');
    const biology = parseOptional('biology');

    const validateOpt = (name, v) => {
      if (v == null) return;
      if (Number.isNaN(v) || v < 0 || v > 100) {
        throw new Error(`请输入有效的${name}分数（0–100）`);
      }
    };
    validateOpt('物理', physics);
    validateOpt('化学', chemistry);
    validateOpt('生物', biology);

    const candidates = [physics, chemistry, biology].filter((v) => v != null);
    if (candidates.length === 0) {
      throw new Error('请填写物理/化学/生物至少一项（0–100）');
    }
    user.math = math;
    user.physics = physics;
    user.chemistry = chemistry;
    user.biology = biology;
    // 兼容旧数据：若某些项目仍用“science（取最高一科）”，可直接按最高科计算
    user.science = Math.max(...candidates);
  } else {
    user.mathCourse = 1;
    const japanWorld = Number(fd.get('japanWorld'));
    if (Number.isNaN(japanWorld) || japanWorld < 0 || japanWorld > 200) {
      throw new Error('请输入有效的「日本与世界」分数（0–200）');
    }
    user.japanWorld = japanWorld;
  }

  return user;
}

/**
 * @param {ReturnType<typeof recommend>} items
 */
function renderResults(items) {
  resultsList.innerHTML = '';

  if (items.length === 0) {
    resultsEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent =
      '未找到匹配的学部建议。可尝试调整分数，或当前数据库尚未覆盖您的分数段。';
    return;
  }

  emptyEl.hidden = true;
  resultsEl.hidden = false;

  for (const item of items) {
    const { program, tier, quality, reason, rank } = item;
    const card = document.createElement('article');
    card.className = `result-card tier-${tier}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="rank">#${rank}</span>
        <span class="tier-badge">${fitTierLabel(tier)}</span>
        <span class="quality">综合分 ${quality}</span>
      </div>
      <h3>${program.university} <span class="ja">${program.universityJa}</span></h3>
      <p class="faculty">${program.faculty}</p>
      <p class="reason">${reason}</p>
      <div class="card-footer">
        <a href="${program.sourceUrl}" target="_blank" rel="noopener noreferrer">查看官网 ↗</a>
      </div>
    `;
    resultsList.appendChild(card);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const fd = new FormData(form);
    const user = parseForm(fd);
    const items = recommend(user, programs, 5);
    renderResults(items);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    alert(err.message || '输入有误，请检查后重试');
  }
});

trackSelect.addEventListener('change', updateFieldVisibility);

loadPrograms().catch((err) => {
  console.error(err);
  if (metaEl) metaEl.textContent = '学校数据加载失败，请刷新页面重试';
});

loadLatestCrawl().catch((err) => {
  console.error(err);
  if (crawlMetaEl) crawlMetaEl.textContent = '爬取数据加载失败';
});

updateFieldVisibility();
