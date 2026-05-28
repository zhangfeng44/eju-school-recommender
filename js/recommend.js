/** @typedef {'science' | 'humanities'} Track */
/** @typedef {'safe' | 'match' | 'reach' | 'ineligible'} FitTier */
/** @typedef {'anyTwo' | 'exact'} ScienceMode */

/**
 * @typedef {Object} Program
 * @property {string} id
 * @property {string} university
 * @property {string} universityJa
 * @property {string} faculty
 * @property {Track} track
 * @property {1 | 2} mathCourse
 * @property {string[]} requiredSubjects
 * @property {ScienceMode} [scienceMode]
 * @property {Array<'physics'|'chemistry'|'biology'>} [requiredScienceSubjects]
 * @property {Record<string, number>} minScores
 * @property {Record<string, number>} pastMin
 * @property {Record<string, number>} pastAvg
 * @property {number} reputationTier
 * @property {number} employmentRate
 * @property {number} employmentYear
 * @property {string} sourceUrl
 * @property {string} [notes]
 */

/**
 * @typedef {Object} UserScores
 * @property {Track} track
 * @property {1 | 2} mathCourse
 * @property {number} japanese
 * @property {number} [math]
 * @property {number} [physics]
 * @property {number} [chemistry]
 * @property {number} [biology]
 * @property {number} [science]
 * @property {number} [japanWorld]
 */

const REACH_BUFFER = 25;
const REPUTATION_WEIGHT = 0.5;
const EMPLOYMENT_WEIGHT = 0.5;

/**
 * @param {Program[]} programs
 * @returns {{ maxTier: number, maxEmployment: number }}
 */
function getNormalizationBounds(programs) {
  let maxTier = 1;
  let maxEmployment = 1;
  for (const p of programs) {
    if (p.reputationTier > maxTier) maxTier = p.reputationTier;
    if (p.employmentRate > maxEmployment) maxEmployment = p.employmentRate;
  }
  return { maxTier, maxEmployment };
}

/**
 * @param {UserScores} user
 * @param {Program} program
 * @returns {boolean}
 */
function matchesTrackAndCourse(user, program) {
  if (user.track !== program.track) return false;
  if (program.track === 'science' && user.mathCourse !== program.mathCourse) {
    return false;
  }
  if (program.track === 'humanities' && program.mathCourse && user.mathCourse !== program.mathCourse) {
    return false;
  }
  return true;
}

/**
 * @param {UserScores} user
 * @param {string} subject
 * @returns {number | null}
 */
function getUserSubjectScore(user, subject) {
  switch (subject) {
    case 'japanese':
      return user.japanese;
    case 'math':
      return user.math ?? null;
    case 'physics':
      return user.physics ?? null;
    case 'chemistry':
      return user.chemistry ?? null;
    case 'biology':
      return user.biology ?? null;
    case 'science':
      return user.science ?? null;
    case 'japanWorld':
      return user.japanWorld ?? null;
    default:
      return null;
  }
}

const SUBJECT_LABELS = {
  japanese: '日语',
  math: '数学',
  science: '理科（最高科）',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  japanWorld: '日本与世界',
};

/**
 * 获取某一理科科目的门槛（允许回退到旧的 `science` 字段）
 * @param {Program} program
 * @param {'physics'|'chemistry'|'biology'} subject
 * @returns {{ min: number | null, pastMin: number | null, pastAvg: number | null }}
 */
function getScienceBenchmarks(program, subject) {
  const min = program.minScores?.[subject] ?? program.minScores?.science ?? null;
  const pastMin =
    program.pastMin?.[subject] ?? program.pastMin?.science ?? (min ?? null);
  const pastAvg =
    program.pastAvg?.[subject] ?? program.pastAvg?.science ?? pastMin ?? null;
  return { min, pastMin, pastAvg };
}

/**
 * @param {UserScores} user
 * @param {Program} program
 * @returns {{ eligible: boolean, gaps: string[] }}
 */
function checkEligibility(user, program) {
  const gaps = [];
  const nonScienceRequired = program.requiredSubjects.filter(
    (s) => s !== 'science' && s !== 'physics' && s !== 'chemistry' && s !== 'biology'
  );

  // 1) 先检查非理科科目（例如日语/数学）
  for (const subject of nonScienceRequired) {
    const score = getUserSubjectScore(user, subject);
    const min = program.minScores[subject];
    if (score == null) {
      gaps.push(`缺少${SUBJECT_LABELS[subject] || subject}成绩`);
      continue;
    }
    if (min != null && score < min - REACH_BUFFER) {
      gaps.push(
        `${SUBJECT_LABELS[subject] || subject} ${score} 分，低于参考线 ${min} 分较多`
      );
    }
  }

  const nonScienceHardFail = nonScienceRequired.some((subject) => {
    const score = getUserSubjectScore(user, subject);
    const min = program.minScores[subject];
    return score == null || (min != null && score < min - REACH_BUFFER);
  });
  if (nonScienceHardFail) return { eligible: false, gaps };

  // 2) 若没有 scienceMode，则走旧逻辑（requiredSubjects 里可能包含 science）
  if (!program.scienceMode || !program.requiredScienceSubjects) {
    const hardFail = program.requiredSubjects.some((subject) => {
      const score = getUserSubjectScore(user, subject);
      const min = program.minScores[subject];
      return score == null || (min != null && score < min - REACH_BUFFER);
    });
    return { eligible: !hardFail, gaps };
  }

  // 3) 新逻辑：按 scienceMode 校验物化生
  const required = program.requiredScienceSubjects;
  const passEligibleThresholdCount = required.filter((s) => {
    const score = getUserSubjectScore(user, s);
    const { min } = getScienceBenchmarks(program, s);
    if (score == null || min == null) return false;
    return score >= min - REACH_BUFFER;
  }).length;

  if (program.scienceMode === 'anyTwo') {
    const eligible = passEligibleThresholdCount >= 2;
    if (!eligible) {
      gaps.push('理科（物化生）达标科目不足');
    }
    return { eligible, gaps };
  }

  // exact
  const eligible = required.every((s) => {
    const score = getUserSubjectScore(user, s);
    const { min } = getScienceBenchmarks(program, s);
    if (score == null || min == null) return false;
    return score >= min - REACH_BUFFER;
  });
  if (!eligible) gaps.push('理科（物化生）达标科目不足');
  return { eligible, gaps };
}

/**
 * @param {UserScores} user
 * @param {Program} program
 * @returns {FitTier}
 */
function computeFitTier(user, program) {
  const nonScienceRequired = program.requiredSubjects.filter(
    (s) => s !== 'science' && s !== 'physics' && s !== 'chemistry' && s !== 'biology'
  );

  // 旧逻辑：没有 scienceMode 就继续按 requiredSubjects 计算
  if (!program.scienceMode || !program.requiredScienceSubjects) {
    const benchmarks = program.pastAvg || program.pastMin || program.minScores;
    let allSafe = true;
    let allReachOrBetter = true;

    for (const subject of program.requiredSubjects) {
      const score = getUserSubjectScore(user, subject);
      if (score == null) return 'ineligible';

      const avg = benchmarks[subject];
      const min = (program.pastMin && program.pastMin[subject]) ?? program.minScores[subject];

      if (avg != null && score < avg - 15) allSafe = false;
      if (min != null && score < min - REACH_BUFFER) allReachOrBetter = false;
    }

    if (!allReachOrBetter) return 'ineligible';
    if (allSafe) return 'safe';

    let aboveMinCount = 0;
    for (const subject of program.requiredSubjects) {
      const score = getUserSubjectScore(user, subject);
      const min = (program.pastMin && program.pastMin[subject]) ?? program.minScores[subject];
      if (min != null && score >= min) aboveMinCount += 1;
    }

    if (aboveMinCount === program.requiredSubjects.length) return 'match';
    return 'reach';
  }

  // 新逻辑：先算非理科是否达标（safe / match 的前提）
  let nonScienceSafeAll = true;
  let nonScienceMinAll = true;

  for (const subject of nonScienceRequired) {
    const score = getUserSubjectScore(user, subject);
    if (score == null) return 'ineligible';
    const { min, pastMin, pastAvg } = {
      min: program.minScores?.[subject] ?? null,
      pastMin: program.pastMin?.[subject] ?? null,
      pastAvg: program.pastAvg?.[subject] ?? null,
    };

    const avg = pastAvg ?? pastMin ?? min;
    const thresholdMin = pastMin ?? min;

    if (avg != null && score < avg - 15) nonScienceSafeAll = false;
    if (thresholdMin != null && score < thresholdMin) nonScienceMinAll = false;
  }

  // 再算理科（物化生）
  const required = program.requiredScienceSubjects;
  let scienceSafeCount = 0;
  let scienceMinPassCount = 0;

  for (const s of required) {
    const score = getUserSubjectScore(user, s);
    if (score == null) continue;
    const { min, pastAvg } = getScienceBenchmarks(program, s);
    const avg = pastAvg ?? min;
    const thresholdMin = min;

    if (avg != null && score >= avg - 15) scienceSafeCount += 1;
    if (thresholdMin != null && score >= thresholdMin) scienceMinPassCount += 1;
  }

  if (program.scienceMode === 'anyTwo') {
    if (nonScienceSafeAll && scienceSafeCount >= 2) return 'safe';
    if (nonScienceMinAll && scienceMinPassCount >= 2) return 'match';
    return 'reach';
  }

  // exact
  const scienceExactSafe = required.every((s) => {
    const score = getUserSubjectScore(user, s);
    if (score == null) return false;
    const { min, pastAvg } = getScienceBenchmarks(program, s);
    const avg = pastAvg ?? min;
    return avg != null && score >= avg - 15;
  });

  if (nonScienceSafeAll && scienceExactSafe) return 'safe';

  const scienceExactMin = required.every((s) => {
    const score = getUserSubjectScore(user, s);
    if (score == null) return false;
    const { min } = getScienceBenchmarks(program, s);
    return min != null && score >= min;
  });

  if (nonScienceMinAll && scienceExactMin) return 'match';
  return 'reach';
}

/**
 * @param {Program} program
 * @param {{ maxTier: number, maxEmployment: number }} bounds
 * @returns {number}
 */
function computeQualityScore(program, bounds) {
  const rep = program.reputationTier / bounds.maxTier;
  const emp = program.employmentRate / bounds.maxEmployment;
  return REPUTATION_WEIGHT * rep + EMPLOYMENT_WEIGHT * emp;
}

/**
 * @param {FitTier} tier
 * @returns {string}
 */
export function fitTierLabel(tier) {
  const map = {
    safe: '稳妥',
    match: '匹配',
    reach: '冲刺',
    ineligible: '不符合',
  };
  return map[tier] || tier;
}

/**
 * @param {UserScores} user
 * @param {Program} program
 * @param {FitTier} tier
 * @param {number} quality
 * @returns {string}
 */
function buildReason(user, program, tier, quality) {
  const parts = [];
  if (tier === 'safe') {
    parts.push('您的分数整体高于近年合格者平均水平，属于较有把握的区间');
  } else if (tier === 'match') {
    parts.push('您的分数接近近年合格者水平，建议认真准备书类与面试');
  } else if (tier === 'reach') {
    parts.push('您的分数略低于往年参考线，可作为冲刺志愿');
  }

  parts.push(
    `该校${program.faculty}声誉档位 ${program.reputationTier}/5，就业率约 ${program.employmentRate}%（${program.employmentYear}）`
  );

  if (quality >= 0.85) {
    parts.push('在同分数带中综合口碑与就业表现突出');
  } else if (quality >= 0.65) {
    parts.push('在同分数带中综合表现良好');
  }

  if (program.notes) {
    parts.push(program.notes);
  }

  return parts.join('；') + '。';
}

/**
 * @param {UserScores} user
 * @param {Program[]} programs
 * @param {number} [limit=5]
 * @returns {Array<{ program: Program, tier: FitTier, quality: number, reason: string, rank: number }>}
 */
export function recommend(user, programs, limit = 5) {
  const bounds = getNormalizationBounds(programs);
  const candidates = [];

  for (const program of programs) {
    if (!matchesTrackAndCourse(user, program)) continue;

    const { eligible } = checkEligibility(user, program);
    if (!eligible) continue;

    const tier = computeFitTier(user, program);
    if (tier === 'ineligible') continue;

    const quality = computeQualityScore(program, bounds);
    candidates.push({
      program,
      tier,
      quality,
      reason: buildReason(user, program, tier, quality),
      fitOrder: { safe: 0, match: 1, reach: 2 }[tier],
    });
  }

  candidates.sort((a, b) => {
    if (a.fitOrder !== b.fitOrder) return a.fitOrder - b.fitOrder;
    if (b.quality !== a.quality) return b.quality - a.quality;
    return b.program.reputationTier - a.program.reputationTier;
  });

  const picked = [];
  const usedUniversities = new Set();

  const buckets = { safe: [], match: [], reach: [] };
  for (const c of candidates) {
    buckets[c.tier].push(c);
  }

  const targetMix = [
    { tier: 'safe', count: 2 },
    { tier: 'match', count: 2 },
    { tier: 'reach', count: 1 },
  ];

  function pickFromBucket(tier, maxCount) {
    let n = 0;
    for (const c of buckets[tier]) {
      if (picked.length >= limit || n >= maxCount) break;
      if (usedUniversities.has(c.program.university)) continue;
      picked.push(c);
      usedUniversities.add(c.program.university);
      n += 1;
    }
  }

  for (const { tier, count } of targetMix) {
    pickFromBucket(tier, count);
  }

  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (usedUniversities.has(c.program.university)) continue;
    picked.push(c);
    usedUniversities.add(c.program.university);
  }

  return picked.slice(0, limit).map((item, index) => ({
    program: item.program,
    tier: item.tier,
    quality: Math.round(item.quality * 100),
    reason: item.reason,
    rank: index + 1,
  }));
}
