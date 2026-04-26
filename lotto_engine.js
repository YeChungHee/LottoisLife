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
  // Google Sheets API 응답이 없을 때 fallback으로 사용
  const SEED_DRAWS = [
    { round: 1221, date: '2026-04-25', nums: [6,13,18,28,30,36],  bonus: 9,  prize: 1_830_800_000 },
    { round: 1220, date: '2026-04-18', nums: [2,22,25,28,34,43],  bonus: 16, prize: 2_114_514_161 },
    { round: 1219, date: '2026-04-11', nums: [1,2,15,28,39,45],   bonus: 31, prize: 2_508_232_844 },
    { round: 1218, date: '2026-04-04', nums: [3,28,31,32,42,45],  bonus: 25, prize: 1_714_482_042 },
    { round: 1217, date: '2026-03-28', nums: [8,10,15,20,29,31],  bonus: 41, prize: 2_179_738_018 },
    { round: 1216, date: '2026-03-21', nums: [3,10,14,15,23,24],  bonus: 25, prize: 2_148_654_000 },
    { round: 1215, date: '2026-03-14', nums: [13,15,19,21,44,45], bonus: 39, prize: 2_210_000_000 },
    { round: 1214, date: '2026-03-07', nums: [10,15,19,27,30,33], bonus: 14, prize: 1_980_000_000 },
    { round: 1213, date: '2026-02-28', nums: [5,11,25,27,36,38],  bonus: 2,  prize: 2_350_000_000 },
    { round: 1212, date: '2026-02-21', nums: [5,8,25,31,41,44],   bonus: 45, prize: 2_640_000_000 },
    { round: 1211, date: '2026-02-14', nums: [23,26,27,35,38,40], bonus: 10, prize: 3_120_000_000 },
    { round: 1210, date: '2026-02-07', nums: [1,7,9,17,27,38],    bonus: 31, prize: 2_890_000_000 },
  ];

  // ── LottoEngine 클래스 ────────────────────────────────────────────────────
  class LottoEngine {
    /**
     * @param {Array} draws - [{round, date, nums:[6], bonus, prize}] 최신순
     */
    constructor(draws = []) {
      this.draws = (draws.length > 0 ? draws : SEED_DRAWS)
        .filter(d => Array.isArray(d.nums) && d.nums.length === 6);
      this.N    = 45;
      this.PICK = 6;
      this._cache = {};
    }

    // ════════════════════════════════════════════════════════════════════════
    // § 1. 학습 — 통계 지표 계산
    // ════════════════════════════════════════════════════════════════════════

    /**
     * 최근 recentN회 번호별 출현 빈도
     * @returns {number[]} freq[1..45]
     */
    getFrequency(recentN) {
      const n = Math.min(recentN ?? this.draws.length, this.draws.length);
      const key = `freq_${n}`;
      if (this._cache[key]) return this._cache[key];

      const freq = new Array(this.N + 1).fill(0);
      for (const d of this.draws.slice(0, n)) {
        for (const num of d.nums) if (num >= 1 && num <= this.N) freq[num]++;
      }
      return (this._cache[key] = freq);
    }

    /**
     * 번호별 마지막 출현 이후 경과 회차 (갭)
     * 한 번도 안 나온 번호 → draws.length + 1
     * @returns {number[]} gap[1..45]
     */
    getGaps() {
      if (this._cache.gaps) return this._cache.gaps;
      const gap = new Array(this.N + 1).fill(this.draws.length + 1);
      for (let i = 0; i < this.draws.length; i++) {
        for (const num of this.draws[i].nums) {
          if (gap[num] === this.draws.length + 1) gap[num] = i; // 첫 출현 위치
        }
      }
      return (this._cache.gaps = gap);
    }

    /**
     * 번호별 평균 출현 간격 (이론값: 약 7.5회)
     */
    get expectedInterval() {
      return (this.N / this.PICK); // ≈ 7.5
    }

    /**
     * 번호별 종합 통계 점수 (0~1)
     * 빈도 점수 60% + 갭 회귀 점수 40%
     */
    getScores() {
      if (this._cache.scores) return this._cache.scores;
      const freq = this.getFrequency(Math.min(15, this.draws.length));
      const gap  = this.getGaps();
      const maxF = Math.max(...freq.slice(1), 1);

      const scores = new Array(this.N + 1).fill(0);
      for (let n = 1; n <= this.N; n++) {
        const freqScore = freq[n] / maxF;
        // 갭이 expectedInterval의 1.5배 이상이면 회귀 기대값 증가
        const gapRatio  = gap[n] / (this.expectedInterval * 1.5);
        const gapScore  = Math.min(gapRatio, 1);
        scores[n] = freqScore * 0.6 + gapScore * 0.4;
      }
      return (this._cache.scores = scores);
    }

    /**
     * 역대 합계 분포 분석
     * @returns {{ mean, std, p10, p90 }}
     */
    getSumStats() {
      if (this._cache.sumStats) return this._cache.sumStats;
      const sums = this.draws.map(d => d.nums.reduce((a, b) => a + b, 0));
      const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
      const variance = sums.reduce((a, b) => a + (b - mean) ** 2, 0) / sums.length;
      const std = Math.sqrt(variance);
      const sorted = [...sums].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 100;
      const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 175;
      return (this._cache.sumStats = { mean, std, p10, p90 });
    }

    // ════════════════════════════════════════════════════════════════════════
    // § 2. 생성 유틸 — 가중치 기반 번호 추출
    // ════════════════════════════════════════════════════════════════════════

    /**
     * 가중치 배열로부터 count개 번호를 비복원 추출
     * isValid 통과할 때까지 maxTries 반복
     */
    _pickWeighted(weights, count = 6, maxTries = 300) {
      for (let attempt = 0; attempt < maxTries; attempt++) {
        const remaining = weights
          .map((w, i) => ({ n: i, w: Math.max(w, 0.01) }))
          .filter(x => x.n >= 1 && x.n <= this.N);
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
      return this._fallbackBalanced(); // 극단적 fallback
    }

    /**
     * 번호 조합 유효성 검사
     * - 합계: 80~200 (역대 범위 내)
     * - 홀수: 1~5개
     * - 구간(9개 단위): 최소 3개 구간 커버
     */
    _isValid(nums) {
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      const zones = new Set(nums.map(n => Math.ceil(n / 9)));
      return sum >= 80 && sum <= 200 && odd >= 1 && odd <= 5 && zones.size >= 3;
    }

    /** 5구간 균등 분포 fallback */
    _fallbackBalanced() {
      const zones = [[1,9],[10,18],[19,27],[28,36],[37,45]];
      const nums = zones.map(([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1)));
      // 6번째: 랜덤 구간에서 추가
      let extra;
      do {
        const z = zones[Math.floor(Math.random() * zones.length)];
        extra = z[0] + Math.floor(Math.random() * (z[1] - z[0] + 1));
      } while (nums.includes(extra));
      return [...nums, extra].sort((a, b) => a - b);
    }

    // ════════════════════════════════════════════════════════════════════════
    // § 3. 신뢰도 점수 계산 (50~95)
    // ════════════════════════════════════════════════════════════════════════

    /**
     * 번호 조합의 통계적 신뢰도 점수
     * @param {number[]} nums - 정렬된 6개 번호
     * @param {'composite'|'hot'|'cold'|'balanced'|'pattern'} strategy
     */
    _calcConfidence(nums, strategy) {
      const sum    = nums.reduce((a, b) => a + b, 0);
      const odd    = nums.filter(n => n % 2 === 1).length;
      const zones  = new Set(nums.map(n => Math.ceil(n / 9)));
      const { mean, std } = this.getSumStats();

      let score = 55;

      // ── 합계 점수 (역대 평균 중심일수록 높음)
      const sumDev = Math.abs(sum - mean) / Math.max(std, 1);
      if (sumDev < 0.5)      score += 15;
      else if (sumDev < 1.0) score += 10;
      else if (sumDev < 1.5) score += 5;

      // ── 홀짝 균형 (2~4개 홀수가 최빈)
      if (odd >= 2 && odd <= 4) score += 8;
      else if (odd === 1 || odd === 5) score += 3;

      // ── 구간 분포
      if (zones.size >= 4) score += 8;
      else if (zones.size === 3) score += 4;

      // ── 연속번호 (1~2쌍 선호, 3쌍 이상 감점)
      let consCount = 0;
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] - nums[i] === 1) consCount++;
      }
      if (consCount === 1 || consCount === 2) score += 5;
      else if (consCount === 0) score += 2;
      else if (consCount >= 3) score -= 8;

      // ── 데이터 품질 보너스
      if (this.draws.length >= 10) score += 3;
      if (this.draws.length >= 20) score += 2;

      // ── 전략별 기본 보정
      const bonus = { composite: 4, balanced: 3, pattern: 2, hot: 1, cold: 0 };
      score += (bonus[strategy] ?? 0);

      return Math.min(Math.max(Math.round(score), 50), 95);
    }

    // ════════════════════════════════════════════════════════════════════════
    // § 4. 추천 전략 5종
    // ════════════════════════════════════════════════════════════════════════

    /** 전략 1: AI 종합 — 빈도 40% + 갭회귀 30% + 교란 30% */
    genComposite() {
      const freq = this.getFrequency(Math.min(15, this.draws.length));
      const gap  = this.getGaps();
      const maxF = Math.max(...freq.slice(1), 1);
      const maxG = Math.max(...gap.slice(1), 1);

      const weights = new Array(this.N + 1).fill(0);
      for (let n = 1; n <= this.N; n++) {
        const freqW = freq[n] / maxF;
        const gapW  = Math.min(gap[n] / (this.expectedInterval * 1.5), 1);
        const randW = 0.25 + Math.random() * 0.5; // 25~75% 교란
        weights[n] = freqW * 0.4 + gapW * 0.3 + randW * 0.3;
      }

      const nums = this._pickWeighted(weights);
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      const conf = this._calcConfidence(nums, 'composite');

      return {
        name: 'AI 종합',
        subtitle: '빈도 · 갭 · 패턴 융합',
        nums,
        conf,
        tags: ['AI 추천', '융합 분석', `합 ${sum}`],
        reasoning: `빈도(40%) + 갭회귀(30%) + 패턴교란(30%) 종합 분석. 합계 ${sum}, 홀${odd}짝${6 - odd}`,
      };
    }

    /** 전략 2: Hot 패턴 — 최근 10회 고빈도 번호 */
    genHot() {
      const freq = this.getFrequency(Math.min(10, this.draws.length));
      // 빈도에 제곱 가중치 (고빈도 번호 강조)
      const weights = freq.map(f => f * f + 0.1);

      const nums = this._pickWeighted(weights);
      const sum  = nums.reduce((a, b) => a + b, 0);
      const conf = this._calcConfidence(nums, 'hot');

      // 상위 Hot 번호 목록
      const topHot = freq
        .map((f, i) => ({ n: i, f }))
        .filter(x => x.n >= 1)
        .sort((a, b) => b.f - a.f)
        .slice(0, 8)
        .map(x => x.n);

      const included = nums.filter(n => topHot.includes(n)).length;

      return {
        name: 'Hot 패턴',
        subtitle: '최근 10회 고빈도 번호',
        nums,
        conf,
        tags: ['고빈도', '최근 트렌드', `Hot ${included}개 포함`],
        reasoning: `최근 10회 출현 횟수 상위 번호(${topHot.slice(0, 5).join(', ')} 등) 가중 선택. 합계 ${sum}`,
      };
    }

    /** 전략 3: Cold 반등 — 장기 미출현 번호의 통계적 회귀 */
    genCold() {
      const gap = this.getGaps();
      // 갭 제곱 가중치 (오래될수록 강조)
      const weights = gap.map(g => (g * g) + 0.1);

      const nums    = this._pickWeighted(weights);
      const sum     = nums.reduce((a, b) => a + b, 0);
      const conf    = this._calcConfidence(nums, 'cold');
      const maxGap  = Math.max(...gap.slice(1));
      const coldTop = gap
        .map((g, i) => ({ n: i, g }))
        .filter(x => x.n >= 1)
        .sort((a, b) => b.g - a.g)
        .slice(0, 5)
        .map(x => x.n);

      return {
        name: 'Cold 반등',
        subtitle: '장기 미출현 번호 회귀 예측',
        nums,
        conf,
        tags: ['미출현', '회귀', `최대 ${maxGap}회 미출현`],
        reasoning: `${maxGap}회 이상 미출현 번호(${coldTop.join(', ')} 등) 포함. 기대 출현 간격 ${this.expectedInterval.toFixed(1)}회`,
      };
    }

    /** 전략 4: 균형형 — 5구간 분산 + 합계 최적화 */
    genBalanced() {
      const ZONES = [[1,9],[10,18],[19,27],[28,36],[37,45]];

      for (let attempt = 0; attempt < 200; attempt++) {
        // 5구간에서 1+1+1+1+2 배분 (순서 랜덤)
        const extraZone = Math.floor(Math.random() * 5);
        const nums = [];

        for (let z = 0; z < 5; z++) {
          const [lo, hi] = ZONES[z];
          const cnt = (z === extraZone) ? 2 : 1;
          const pool = [];
          for (let n = lo; n <= hi; n++) if (!nums.includes(n)) pool.push(n);
          for (let pick = 0; pick < cnt && pool.length > 0; pick++) {
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
              name: '균형형',
              subtitle: '5구간 균등 분포',
              nums: sorted,
              conf,
              tags: ['구간 균형', `합 ${sum}`, '안전형'],
              reasoning: `1-9, 10-18, 19-27, 28-36, 37-45 구간 균등 분배. 합계 ${sum} (역대 평균 ${Math.round(this.getSumStats().mean)} 근접)`,
            };
          }
        }
      }

      // fallback
      const nums = this._fallbackBalanced();
      const sum  = nums.reduce((a, b) => a + b, 0);
      return {
        name: '균형형',
        subtitle: '5구간 균등 분포',
        nums,
        conf: this._calcConfidence(nums, 'balanced'),
        tags: ['구간 균형', `합 ${sum}`],
        reasoning: `5구간 균등 분배. 합계 ${sum}`,
      };
    }

    /** 전략 5: 패턴 분석 — 합계 정규분포 + 홀짝 최빈 + 연속번호 1쌍 포함 */
    genPattern() {
      const { mean, std } = this.getSumStats();
      const freq    = this.getFrequency(Math.min(20, this.draws.length));
      const weights = freq.map((f, i) => (i === 0 ? 0 : Math.max(f, 0.5)));

      for (let attempt = 0; attempt < 500; attempt++) {
        const candidate = this._pickWeighted([...weights], 6, 5);
        if (!candidate || candidate.length !== 6) continue;

        const sum = candidate.reduce((a, b) => a + b, 0);
        const odd = candidate.filter(n => n % 2 === 1).length;

        // 연속번호 1쌍 확인
        let consCount = 0;
        for (let i = 0; i < candidate.length - 1; i++) {
          if (candidate[i + 1] - candidate[i] === 1) consCount++;
        }

        // 합계가 평균 ±1.2σ, 홀짝 2~4, 연속 1~2쌍
        const inRange = Math.abs(sum - mean) <= std * 1.2;
        if (inRange && odd >= 2 && odd <= 4 && consCount >= 1 && consCount <= 2) {
          const conf = this._calcConfidence(candidate, 'pattern');
          return {
            name: '패턴 분석',
            subtitle: '합계·홀짝·연속번호 최적화',
            nums: candidate,
            conf,
            tags: [`합 ${sum}`, `홀${odd}짝${6 - odd}`, '연속 포함'],
            reasoning: `합계 ${sum} (역대 평균 ${Math.round(mean)}±${Math.round(std)}), 홀${odd}짝${6 - odd}, 연속번호 ${consCount}쌍 — 역대 최빈 패턴`,
          };
        }
      }

      // fallback: 패턴 조건 완화
      const nums = this._pickWeighted(weights);
      const sum  = nums.reduce((a, b) => a + b, 0);
      const odd  = nums.filter(n => n % 2 === 1).length;
      return {
        name: '패턴 분석',
        subtitle: '합계·홀짝·연속번호 최적화',
        nums,
        conf: this._calcConfidence(nums, 'pattern'),
        tags: [`합 ${sum}`, `홀${odd}짝${6 - odd}`],
        reasoning: `합계 ${sum}, 홀${odd}짝${6 - odd} — 역대 빈도 기반 생성`,
      };
    }

    // ════════════════════════════════════════════════════════════════════════
    // § 5. 공개 API
    // ════════════════════════════════════════════════════════════════════════

    /** 5세트 추천 번호 생성 (매 호출마다 새로 계산) */
    recommend() {
      this._cache = {}; // 캐시 초기화 → 매주 새 번호
      return [
        this.genComposite(),
        this.genHot(),
        this.genBalanced(),
        this.genPattern(),
        this.genCold(),
      ];
    }

    /**
     * Hot 번호 상위 N개
     * @param {number} topN
     * @returns {number[]}
     */
    getHotNumbers(topN = 5) {
      const freq = this.getFrequency(Math.min(10, this.draws.length));
      return freq
        .map((f, i) => ({ n: i, f }))
        .filter(x => x.n >= 1)
        .sort((a, b) => b.f - a.f)
        .slice(0, topN)
        .map(x => x.n);
    }

    /**
     * Cold 번호 상위 N개 (가장 오래 미출현)
     * @param {number} topN
     * @returns {number[]}
     */
    getColdNumbers(topN = 5) {
      const gap = this.getGaps();
      return gap
        .map((g, i) => ({ n: i, g }))
        .filter(x => x.n >= 1)
        .sort((a, b) => b.g - a.g)
        .slice(0, topN)
        .map(x => x.n);
    }

    /**
     * 1~45 번호별 빈도 막대 데이터 (실제 분석 기반)
     * @returns {{ n, count, bar }[]}
     */
    getFreqBarData() {
      const freq = this.getFrequency();
      const max  = Math.max(...freq.slice(1), 1);
      return Array.from({ length: this.N }, (_, i) => ({
        n:     i + 1,
        count: freq[i + 1],
        bar:   Math.max(Math.round((freq[i + 1] / max) * 7), 1),
      }));
    }

    /**
     * 학습 데이터 요약 (디버그 / 통계 화면용)
     */
    getSummary() {
      const { mean, std, p10, p90 } = this.getSumStats();
      const hot  = this.getHotNumbers(5);
      const cold = this.getColdNumbers(5);
      return {
        dataPoints:  this.draws.length,
        latestRound: this.draws[0]?.round ?? 0,
        sumMean:     Math.round(mean),
        sumStd:      Math.round(std),
        sumP10:      p10,
        sumP90:      p90,
        hotNumbers:  hot,
        coldNumbers: cold,
      };
    }

    /**
     * Google Sheets API 응답으로 데이터 갱신
     * @param {Array} apiDraws - W5Api.getDraws() 반환값
     */
    updateFromApi(apiDraws) {
      if (!Array.isArray(apiDraws) || apiDraws.length === 0) return;
      const mapped = apiDraws.map(d => ({
        round: d.round,
        date:  d.drawDate,
        nums:  d.nums,
        bonus: d.bonus,
        prize: d.prize1st,
      })).filter(d => Array.isArray(d.nums) && d.nums.length === 6);

      if (mapped.length > 0) {
        this.draws  = mapped;
        this._cache = {};
      }
    }

    /**
     * results.json 으로 데이터 갱신
     * @param {Object} resultsJson - results.json 파싱 결과
     */
    updateFromResults(resultsJson) {
      if (!resultsJson?.latest) return;
      const { latest, history } = resultsJson;

      const toEntry = d => ({
        round: d.drwNo,
        date:  d.drwNoDate,
        nums:  [d.drwtNo1, d.drwtNo2, d.drwtNo3, d.drwtNo4, d.drwtNo5, d.drwtNo6],
        bonus: d.bnusNo,
        prize: d.firstWinamnt,
      });

      const draws = (history?.length > 0 ? history : [latest]).map(toEntry);
      if (draws.length > 0) {
        this.draws  = draws;
        this._cache = {};
      }
    }
  }

  // ── 전역 싱글턴 인스턴스 ─────────────────────────────────────────────────
  const engine = new LottoEngine();

  global.LottoEngine = LottoEngine; // 클래스 노출 (커스텀 인스턴스 생성 가능)
  global.lottoEngine = engine;      // 기본 인스턴스 (앱 전역 공유)

})(typeof window !== 'undefined' ? window : global);
