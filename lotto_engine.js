/**
 * lotto_engine.js — Week 5ive 로또 번호 추천 엔진 v1.0
 * =====================================================
 * 학습: 역대 추첨 데이터를 분석하여 번호별 통계 지표를 계산
 * 추천: 5가지 독립 전략으로 매주 새로운 번호 5세트 생성
 *
 * 전략:
 *   1. AI 종합   — 빈도 40% + 갭회귀 30% + 패턴교란 30%
 *   2. Hot 패턴  — 최근 10회 고빈도 번호 중심
 *   3. Cold 반등 — 장기 미출현 번호의 통계적 회귀
 *   4. 균형형    — 5구간 균등 분포 (합계 110~165)
 *   5. 패턴 분석 — 역대 합계·홀짝·연속번호 분포 최적화
 */

(function (global) {
  'use strict';

  // ── 내장 시드 데이터 (실제 당첨 결과, 최신순) ────────────────────────────
  const SEED_DRAWS = [
    { round: 1221, date: '2026-04-25', nums: [6,13,18,28,30,36],  bonus: 9,  prize: 1830800000 },
    { round: 1220, date: '2026-04-18', nums: [2,22,25,28,34,43],  bonus: 16, prize: 2114514161 },
    { round: 1219, date: '2026-04-11', nums: [1,2,15,28,39,45],   bonus: 31, prize: 2508232844 },
    { round: 1218, date: '2026-04-04', nums: [3,28,31,32,42,45],  bonus: 25, prize: 1714482042 },
    { round: 1217, date: '2026-03-28', nums: [8,10,15,20,29,31],  bonus: 41, prize: 2179738018 },
    { round: 1216, date: '2026-03-21', nums: [3,10,14,15,23,24],  bonus: 25, prize: 2148654000 },
    { round: 1215, date: '2026-03-14', nums: [13,15,19,21,44,45], bonus: 39, prize: 2210000000 },
    { round: 1214, date: '2026-03-07', nums: [10,15,19,27,30,33], bonus: 14, prize: 1980000000 },
    { round: 1213, date: '2026-02-28', nums: [5,11,25,27,36,38],  bonus: 2,  prize: 2350000000 },
    { round: 1212, date: '2026-02-21', nums: [5,8,25,31,41,44],   bonus: 45, prize: 2640000000 },
    { round: 1211, date: '2026-02-14', nums: [23,26,27,35,38,40], bonus: 10, prize: 3120000000 },
    { round: 1210, date: '2026-02-07', nums: [1,7,9,17,27,38],    bonus: 31, prize: 2890000000 },
  ];

  class LottoEngine {
    constructor(draws = []) {
      this.draws = (draws.length > 0 ? draws : SEED_DRAWS)
        .filter(d => Array.isArray(d.nums) && d.nums.length === 6);
      this.N    = 45;
      this.PICK = 6;
      this._cache = {};
    }

    // § 1. 학습 — 통계 지표 계산

    getFrequency(recentN) {
      const n = Math.min(recentN != null ? recentN : this.draws.length, this.draws.length);
      const key = 'freq_' + n;
      if (this._cache[key]) return this._cache[key];
      const freq = new Array(this.N + 1).fill(0);
      for (const d of this.draws.slice(0, n)) {
        for (const num of d.nums) if (num >= 1 && num <= this.N) freq[num]++;
      }
      return (this._cache[key] = freq);
    }

    getGaps() {
      if (this._cache.gaps) return this._cache.gaps;
      const gap = new Array(this.N + 1).fill(this.draws.length + 1);
      for (let i = 0; i < this.draws.length; i++) {
        for (const num of this.draws[i].nums) {
          if (gap[num] === this.draws.length + 1) gap[num] = i;
        }
      }
      return (this._cache.gaps = gap);
    }

    get expectedInterval() { return this.N / this.PICK; }

    getScores() {
      if (this._cache.scores) return this._cache.scores;
      const freq = this.getFrequency(Math.min(15, this.draws.length));
      const gap  = this.getGaps();
      const maxF = Math.max.apply(null, freq.slice(1).concat([1]));
      const scores = new Array(this.N + 1).fill(0);
      for (let n = 1; n <= this.N; n++) {
        const freqScore = freq[n] / maxF;
        const gapScore  = Math.min(gap[n] / (this.expectedInterval * 1.5), 1);
        scores[n] = freqScore * 0.6 + gapScore * 0.4;
      }
      return (this._cache.scores = scores);
    }

    getSumStats() {
      if (this._cache.sumStats) return this._cache.sumStats;
      const sums = this.draws.map(d => d.nums.reduce((a, b) => a + b, 0));
      const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
      const variance = sums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / sums.length;
      const std = Math.sqrt(variance);
      const sorted = sums.slice().sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)] || 100;
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 175;
      return (this._cache.sumStats = { mean, std, p10, p90 });
    }

    // § 2. 생성 유틸

    _pickWeighted(weights, count, maxTries) {
      count    = count    || 6;
      maxTries = maxTries || 300;
      for (let attempt = 0; attempt < maxTries; attempt++) {
        const remaining = [];
        for (let i = 1; i <= this.N; i++) {
          remaining.push({ n: i, w: Math.max(weights[i] || 0, 0.01) });
        }
        const picked = [];
        while (picked.length < count && remaining.length > 0) {
          const totalW = remaining.reduce((a, x) => a + x.w, 0);
          let rand = Math.random() * totalW;
          let idx = 0;
          while (idx < remaining.length - 1 && rand > remaining[idx].w) {
            rand -= remaining[idx].w;
            idx++;
          }
          picked.push(remaining[idx].n);
          remaining.splice(idx, 1);
        }
        if (picked.length === count) {
          const sorted = picked.sort((a, b) => a - b);
          if (this._isValid(sorted)) return sorted;
        }
      }
      return this._fallbackBalanced();
    }

    _isValid(nums) {
      const sum   = nums.reduce((a, b) => a + b, 0);
      const odd   = nums.filter(n => n % 2 === 1).length;
      const zones = {};
      nums.forEach(n => { zones[Math.ceil(n / 9)] = 1; });
      return sum >= 80 && sum <= 200 && odd >= 1 && odd <= 5 && Object.keys(zones).length >= 3;
    }

    _fallbackBalanced() {
      const zones = [[1,9],[10,18],[19,27],[28,36],[37,45]];
      const nums  = zones.map(function(z) { return z[0] + Math.floor(Math.random() * (z[1] - z[0] + 1)); });
      let extra;
      do {
        const z = zones[Math.floor(Math.random() * zones.length)];
        extra = z[0] + Math.floor(Math.random() * (z[1] - z[0] + 1));
      } while (nums.indexOf(extra) !== -1);
      return nums.concat([extra]).sort((a, b) => a - b);
    }

    // § 3. 신뢰도 점수

    _calcConfidence(nums, strategy) {
      const sum   = nums.reduce((a, b) => a + b, 0);
      const odd   = nums.filter(n => n % 2 === 1).length;
      const zones = {};
      nums.forEach(n => { zones[Math.ceil(n / 9)] = 1; });
      const zoneCount = Object.keys(zones).length;
      const stats  = this.getSumStats();
      let score = 55;

      const sumDev = Math.abs(sum - stats.mean) / Math.max(stats.std, 1);
      if (sumDev < 0.5)      score += 15;
      else if (sumDev < 1.0) score += 10;
      else if (sumDev < 1.5) score += 5;

      if (odd >= 2 && odd <= 4)       score += 8;
      else if (odd === 1 || odd === 5) score += 3;

      if (zoneCount >= 4) score += 8;
      else if (zoneCount === 3) score += 4;

      let consCount = 0;
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] - nums[i] === 1) consCount++;
      }
      if (consCount === 1 || consCount === 2) score += 5;
      else if (consCount === 0)  score += 2;
      else if (consCount >= 3)   score -= 8;

      if (this.draws.length >= 10) score += 3;
      if (this.draws.length >= 20) score += 2;

      var bonus = { composite: 4, balanced: 3, pattern: 2, hot: 1, cold: 0 };
      score += (bonus[strategy] || 0);

      return Math.min(Math.max(Math.round(score), 50), 95);
    }

    // § 4. 추천 전략 5종

    genComposite() {
      const freq = this.getFrequency(Math.min(15, this.draws.length));
      const gap  = this.getGaps();
      const maxF = Math.max.apply(null, freq.slice(1).concat([1]));
      const weights = new Array(this.N + 1).fill(0);
      for (let n = 1; n <= this.N; n++) {
        const freqW = freq[n] / maxF;
        const gapW  = Math.min(gap[n] / (this.expectedInterval * 1.5), 1);
        const randW = 0.25 + Math.random() * 0.5;
        weights[n]  = freqW * 0.4 + gapW * 0.3 + randW * 0.3;
      }
      const nums = this._pickWeighted(weights);
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      const conf = this._calcConfidence(nums, 'composite');
      return {
        name: 'AI 종합', subtitle: '빈도 · 갭 · 패턴 융합', nums, conf,
        tags: ['AI 추천', '융합 분석', '합 ' + sum],
        reasoning: '빈도(40%) + 갭회귀(30%) + 패턴교란(30%) 종합. 합계 ' + sum + ', 홀' + odd + '짝' + (6 - odd),
      };
    }

    genHot() {
      const freq    = this.getFrequency(Math.min(10, this.draws.length));
      const weights = freq.map(f => f * f + 0.1);
      const nums    = this._pickWeighted(weights);
      const sum     = nums.reduce((a, b) => a + b, 0);
      const conf    = this._calcConfidence(nums, 'hot');
      const topHot  = freq.map((f, i) => ({ n: i, f })).filter(x => x.n >= 1)
        .sort((a, b) => b.f - a.f).slice(0, 8).map(x => x.n);
      const included = nums.filter(n => topHot.indexOf(n) !== -1).length;
      return {
        name: 'Hot 패턴', subtitle: '최근 10회 고빈도 번호', nums, conf,
        tags: ['고빈도', '최근 트렌드', 'Hot ' + included + '개 포함'],
        reasoning: '최근 10회 출현 상위 번호(' + topHot.slice(0,5).join(', ') + ' 등). 합계 ' + sum,
      };
    }

    genCold() {
      const gap     = this.getGaps();
      const weights = gap.map(g => g * g + 0.1);
      const nums    = this._pickWeighted(weights);
      const sum     = nums.reduce((a, b) => a + b, 0);
      const conf    = this._calcConfidence(nums, 'cold');
      const maxGap  = Math.max.apply(null, gap.slice(1));
      const coldTop = gap.map((g, i) => ({ n: i, g })).filter(x => x.n >= 1)
        .sort((a, b) => b.g - a.g).slice(0, 5).map(x => x.n);
      return {
        name: 'Cold 반등', subtitle: '장기 미출현 번호 회귀 예측', nums, conf,
        tags: ['미출현', '회귀', '최대 ' + maxGap + '회 미출현'],
        reasoning: maxGap + '회 이상 미출현 번호(' + coldTop.join(', ') + ' 등). 기대 간격 ' + this.expectedInterval.toFixed(1) + '회',
      };
    }

    genBalanced() {
      const ZONES = [[1,9],[10,18],[19,27],[28,36],[37,45]];
      for (let attempt = 0; attempt < 200; attempt++) {
        const extraZone = Math.floor(Math.random() * 5);
        const nums = [];
        for (let z = 0; z < 5; z++) {
          const lo = ZONES[z][0], hi = ZONES[z][1];
          const cnt  = (z === extraZone) ? 2 : 1;
          const pool = [];
          for (let n = lo; n <= hi; n++) if (nums.indexOf(n) === -1) pool.push(n);
          for (let p = 0; p < cnt && pool.length > 0; p++) {
            const idx = Math.floor(Math.random() * pool.length);
            nums.push(pool.splice(idx, 1)[0]);
          }
        }
        if (nums.length === 6) {
          const sorted = nums.sort((a, b) => a - b);
          const sum = sorted.reduce((a, b) => a + b, 0);
          if (sum >= 100 && sum <= 170 && this._isValid(sorted)) {
            const conf = this._calcConfidence(sorted, 'balanced');
            return {
              name: '균형형', subtitle: '5구간 균등 분포', nums: sorted, conf,
              tags: ['구간 균형', '합 ' + sum, '안전형'],
              reasoning: '1-9, 10-18, 19-27, 28-36, 37-45 구간 균등 분배. 합계 ' + sum + ' (역대 평균 ' + Math.round(this.getSumStats().mean) + ' 근접)',
            };
          }
        }
      }
      const nums = this._fallbackBalanced();
      const sum  = nums.reduce((a, b) => a + b, 0);
      return {
        name: '균형형', subtitle: '5구간 균등 분포', nums,
        conf: this._calcConfidence(nums, 'balanced'),
        tags: ['구간 균형', '합 ' + sum],
        reasoning: '5구간 균등 분배. 합계 ' + sum,
      };
    }

    genPattern() {
      const stats   = this.getSumStats();
      const freq    = this.getFrequency(Math.min(20, this.draws.length));
      const weights = freq.map((f, i) => (i === 0 ? 0 : Math.max(f, 0.5)));
      for (let attempt = 0; attempt < 500; attempt++) {
        const candidate = this._pickWeighted(weights.slice(), 6, 5);
        if (!candidate || candidate.length !== 6) continue;
        const sum = candidate.reduce((a, b) => a + b, 0);
        const odd = candidate.filter(n => n % 2 === 1).length;
        let consCount = 0;
        for (let i = 0; i < candidate.length - 1; i++) {
          if (candidate[i + 1] - candidate[i] === 1) consCount++;
        }
        const inRange = Math.abs(sum - stats.mean) <= stats.std * 1.2;
        if (inRange && odd >= 2 && odd <= 4 && consCount >= 1 && consCount <= 2) {
          const conf = this._calcConfidence(candidate, 'pattern');
          return {
            name: '패턴 분석', subtitle: '합계·홀짝·연속번호 최적화', nums: candidate, conf,
            tags: ['합 ' + sum, '홀' + odd + '짝' + (6-odd), '연속 포함'],
            reasoning: '합계 ' + sum + ' (평균 ' + Math.round(stats.mean) + '±' + Math.round(stats.std) + '), 홀' + odd + '짝' + (6-odd) + ', 연속 ' + consCount + '쌍',
          };
        }
      }
      const nums = this._pickWeighted(weights);
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      return {
        name: '패턴 분석', subtitle: '합계·홀짝·연속번호 최적화', nums,
        conf: this._calcConfidence(nums, 'pattern'),
        tags: ['합 ' + sum, '홀' + odd + '짝' + (6-odd)],
        reasoning: '합계 ' + sum + ', 홀' + odd + '짝' + (6-odd),
      };
    }

    // § 5. 공개 API

    recommend() {
      this._cache = {};
      return [
        this.genComposite(),
        this.genHot(),
        this.genBalanced(),
        this.genPattern(),
        this.genCold(),
      ];
    }

    getHotNumbers(topN) {
      topN = topN || 5;
      const freq = this.getFrequency(Math.min(10, this.draws.length));
      return freq.map((f, i) => ({ n: i, f })).filter(x => x.n >= 1)
        .sort((a, b) => b.f - a.f).slice(0, topN).map(x => x.n);
    }

    getColdNumbers(topN) {
      topN = topN || 5;
      const gap = this.getGaps();
      return gap.map((g, i) => ({ n: i, g })).filter(x => x.n >= 1)
        .sort((a, b) => b.g - a.g).slice(0, topN).map(x => x.n);
    }

    getFreqBarData() {
      const freq = this.getFrequency();
      const max  = Math.max.apply(null, freq.slice(1).concat([1]));
      var result = [];
      for (var i = 1; i <= this.N; i++) {
        result.push({ n: i, count: freq[i], bar: Math.max(Math.round((freq[i] / max) * 7), 1) });
      }
      return result;
    }

    getSummary() {
      const stats = this.getSumStats();
      return {
        dataPoints:  this.draws.length,
        latestRound: this.draws[0] ? this.draws[0].round : 0,
        sumMean:     Math.round(stats.mean),
        sumStd:      Math.round(stats.std),
        sumP10:      stats.p10,
        sumP90:      stats.p90,
        hotNumbers:  this.getHotNumbers(5),
        coldNumbers: this.getColdNumbers(5),
      };
    }

    updateFromApi(apiDraws) {
      if (!Array.isArray(apiDraws) || apiDraws.length === 0) return;
      const mapped = apiDraws.map(d => ({
        round: d.round, date: d.drawDate, nums: d.nums, bonus: d.bonus, prize: d.prize1st,
      })).filter(d => Array.isArray(d.nums) && d.nums.length === 6);
      if (mapped.length > 0) { this.draws = mapped; this._cache = {}; }
    }

    updateFromResults(resultsJson) {
      if (!resultsJson || !resultsJson.latest) return;
      const toEntry = d => ({
        round: d.drwNo, date: d.drwNoDate,
        nums: [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
        bonus: d.bnusNo, prize: d.firstWinamnt,
      });
      const src   = (resultsJson.history && resultsJson.history.length > 0) ? resultsJson.history : [resultsJson.latest];
      const draws = src.map(toEntry);
      if (draws.length > 0) { this.draws = draws; this._cache = {}; }
    }
  }

  const engine = new LottoEngine();
  global.LottoEngine = LottoEngine;
  global.lottoEngine = engine;

})(typeof window !== 'undefined' ? window : global);
