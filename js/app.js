import { recommend, fitTierLabel } from './recommend.js';

const form = document.getElementById('score-form');
const resultsEl = document.getElementById('results');
const resultsList = document.getElementById('results-list');
const emptyEl = document.getElementById('empty-state');
const metaEl = document.getElementById('data-meta');
const trackSelect = document.getElementById('track');
const mathCourseField = document.getElementById('math-course-field');
const scienceFields = document.getElementById('science-fields');
const humanitiesFields = document.getElementById('humanities-fields');

/** @type {import('./recommend.js').Program[]} */
let programs = [];

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

updateFieldVisibility();
