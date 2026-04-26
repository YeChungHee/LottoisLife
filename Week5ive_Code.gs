// ============================================================================
// Week 5ive — Google Apps Script API
// 스프레드시트 ID: 1r3zsz_LxlR8YkXHSzfMcgNGoBrSeThLCNJ69NwGA1c0
//
// [배포 방법]
// 1. 구글 시트 열기 → 확장 프로그램 → Apps Script
// 2. 이 코드 전체 붙여넣기 → 저장
// 3. 배포 → 새 배포 → 유형: 웹 앱
//    - 설명: Week5ive API v1
//    - 실행 계정: 나(본인)
//    - 액세스 권한: 모든 사용자
// 4. 배포 → URL 복사 → Week5ive.html 의 SCRIPT_URL 에 붙여넣기
// 5. 최초 1회: 아래 setupSheets() 함수를 직접 실행해서 시트 탭 생성
// ============================================================================

const SHEET_ID = '1r3zsz_LxlR8YkXHSzfMcgNGoBrSeThLCNJ69NwGA1c0';
const ss = SpreadsheetApp.openById(SHEET_ID);

// ── 시트 탭 이름 상수 ──────────────────────────────────────────────────────
const TAB = {
  USERS:   '회원',        // userID | email | name | plan | joinDate | expireDate | pwHash
  NUMBERS: '저장번호',    // id | userID | round | name | n1~n6 | savedAt | result(match,prize)
  DRAWS:   '추첨결과',    // round | drawDate | n1~n6 | bonus | prize1st
  NOTICES: '공지사항',    // id | tag | date | title | content | active
};

// ─────────────────────────────────────────────────────────────────────────────
// 최초 설정: 시트 탭 + 헤더 자동 생성
// Apps Script 편집기에서 직접 실행하세요
// ─────────────────────────────────────────────────────────────────────────────
function setupSheets() {
  // 회원
  ensureSheet(TAB.USERS,
    ['userID','email','name','plan','joinDate','expireDate','pwHash']);

  // 저장번호
  ensureSheet(TAB.NUMBERS,
    ['id','userID','round','name','n1','n2','n3','n4','n5','n6',
     'savedAt','matchCount','prize']);

  // 추첨결과
  ensureSheet(TAB.DRAWS,
    ['round','drawDate','n1','n2','n3','n4','n5','n6','bonus','prize1st']);

  // 공지사항
  ensureSheet(TAB.NOTICES,
    ['id','tag','date','title','content','active']);

  // 샘플 추첨 데이터 삽입
  const drawSheet = ss.getSheetByName(TAB.DRAWS);
  if (drawSheet.getLastRow() < 2) {
    const sampleDraws = [
      [1198, '2024-11-16', 7,12,23,31,38,44, 5, 2780000000],
      [1197, '2024-11-09', 3,14,19,25,32,41, 7, 3320000000],
      [1196, '2024-11-02', 2, 9,17,24,31,40,12, 2840000000],
      [1195, '2024-10-26', 5,11,22,29,36,43,18, 4510000000],
      [1194, '2024-10-19', 1, 8,16,27,33,45,22, 1960000000],
    ];
    drawSheet.getRange(2, 1, sampleDraws.length, sampleDraws[0].length)
             .setValues(sampleDraws);
  }

  // 샘플 공지 데이터
  const noticeSheet = ss.getSheetByName(TAB.NOTICES);
  if (noticeSheet.getLastRow() < 2) {
    const now = new Date().toISOString().slice(0,10);
    const sampleNotices = [
      ['N001','공지',     now,     '1198회 추첨 결과 분석 리포트 도착', '이번 주 추천 번호의 적중 현황을 확인하세요.', true],
      ['N002','이벤트',   now,     '🎉 친구 초대하면 5ive Pro 1개월 무료', '친구 1명 초대 성공 시 Pro 1개월 무료 제공.', true],
      ['N003','업데이트', now,     'AI 추천 엔진 v2.4 — 패턴 분석 정확도 +12%', '핫/콜드 분석 알고리즘 대폭 개선.', true],
    ];
    noticeSheet.getRange(2, 1, sampleNotices.length, sampleNotices[0].length)
               .setValues(sampleNotices);
  }

  SpreadsheetApp.flush();
  Logger.log('✅ Week5ive 시트 설정 완료');
}

function ensureSheet(name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
         .setBackground('#0E1726').setFontColor('#F4B400')
         .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS 헤더 (모든 응답에 포함)
// ─────────────────────────────────────────────────────────────────────────────
function corsResponse(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function ok(data) {
  return corsResponse({ ok: true, data });
}

function fail(msg) {
  return corsResponse({ ok: false, error: msg });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET 핸들러
// action: getDraws | getNotices | getMyNumbers | checkLogin
// ─────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    switch (action) {

      // ── 추첨 결과 목록 ────────────────────────────────────────────────────
      case 'getDraws': {
        const sheet = ss.getSheetByName(TAB.DRAWS);
        const rows  = getRows(sheet);
        const draws = rows.map(r => ({
          round:   Number(r.round),
          drawDate: r.drawDate,
          nums:    [r.n1,r.n2,r.n3,r.n4,r.n5,r.n6].map(Number),
          bonus:   Number(r.bonus),
          prize1st: Number(r.prize1st),
        }));
        return ok(draws);
      }

      // ── 공지사항 목록 ─────────────────────────────────────────────────────
      case 'getNotices': {
        const sheet   = ss.getSheetByName(TAB.NOTICES);
        const rows    = getRows(sheet);
        const notices = rows
          .filter(r => r.active === true || r.active === 'TRUE' || r.active === 'true')
          .map(r => ({
            id:      r.id,
            tag:     r.tag,
            date:    r.date,
            title:   r.title,
            content: r.content,
          }));
        return ok(notices);
      }

      // ── 내 저장 번호 ─────────────────────────────────────────────────────
      case 'getMyNumbers': {
        const userID = e.parameter.userID;
        if (!userID) return fail('userID 필요');
        const sheet = ss.getSheetByName(TAB.NUMBERS);
        const rows  = getRows(sheet);
        const mine  = rows
          .filter(r => r.userID === userID)
          .map(r => ({
            id:    r.id,
            round: Number(r.round),
            name:  r.name,
            nums:  [r.n1,r.n2,r.n3,r.n4,r.n5,r.n6].map(Number),
            savedAt:    r.savedAt,
            matchCount: r.matchCount !== '' ? Number(r.matchCount) : null,
            prize:      r.prize || null,
          }));
        return ok(mine);
      }

      // ── 로그인 확인 ──────────────────────────────────────────────────────
      case 'checkLogin': {
        const email  = e.parameter.email;
        const pwHash = e.parameter.pwHash;
        if (!email || !pwHash) return fail('email, pwHash 필요');
        const sheet = ss.getSheetByName(TAB.USERS);
        const rows  = getRows(sheet);
        const user  = rows.find(r => r.email === email && r.pwHash === pwHash);
        if (!user) return fail('이메일 또는 비밀번호가 올바르지 않습니다');
        return ok({
          userID:     user.userID,
          name:       user.name,
          plan:       user.plan,
          expireDate: user.expireDate,
        });
      }

      default:
        return fail('알 수 없는 action: ' + action);
    }
  } catch(err) {
    return fail('서버 오류: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST 핸들러
// action: register | saveNumbers | deleteNumber | updatePlan
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || '';

    switch (action) {

      // ── 회원가입 ─────────────────────────────────────────────────────────
      case 'register': {
        const { email, name, pwHash } = body;
        if (!email || !name || !pwHash) return fail('email, name, pwHash 필요');
        const sheet = ss.getSheetByName(TAB.USERS);
        const rows  = getRows(sheet);
        if (rows.find(r => r.email === email)) return fail('이미 등록된 이메일입니다');
        const userID    = 'U' + Date.now();
        const joinDate  = new Date().toISOString().slice(0,10);
        const expDate   = addDays(joinDate, 7); // 7일 무료체험
        sheet.appendRow([userID, email, name, 'free_trial',
                         joinDate, expDate, pwHash]);
        return ok({ userID, name, plan: 'free_trial', expireDate: expDate });
      }

      // ── 번호 저장 ────────────────────────────────────────────────────────
      case 'saveNumbers': {
        const { userID, round, name, nums } = body;
        if (!userID || !round || !nums || nums.length !== 6)
          return fail('userID, round, name, nums(6개) 필요');
        const sheet   = ss.getSheetByName(TAB.NUMBERS);
        const id      = 'N' + Date.now();
        const savedAt = new Date().toISOString().slice(0,10);
        sheet.appendRow([id, userID, round, name || 'AI 추천',
                         ...nums, savedAt, '', '']);
        return ok({ id, savedAt });
      }

      // ── 번호 삭제 ────────────────────────────────────────────────────────
      case 'deleteNumber': {
        const { id, userID } = body;
        if (!id || !userID) return fail('id, userID 필요');
        const sheet = ss.getSheetByName(TAB.NUMBERS);
        const data  = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === id && data[i][1] === userID) {
            sheet.deleteRow(i + 1);
            return ok({ deleted: true });
          }
        }
        return fail('해당 번호를 찾을 수 없습니다');
      }

      // ── 플랜 업그레이드 ──────────────────────────────────────────────────
      case 'updatePlan': {
        const { userID, plan, months } = body;
        if (!userID || !plan) return fail('userID, plan 필요');
        const sheet = ss.getSheetByName(TAB.USERS);
        const data  = sheet.getDataRange().getValues();
        const headers = data[0];
        const planCol   = headers.indexOf('plan') + 1;
        const expCol    = headers.indexOf('expireDate') + 1;
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === userID) {
            const today  = new Date().toISOString().slice(0,10);
            const newExp = addDays(today, 30 * (months || 1));
            sheet.getRange(i + 1, planCol).setValue(plan);
            sheet.getRange(i + 1, expCol).setValue(newExp);
            return ok({ plan, expireDate: newExp });
          }
        }
        return fail('회원을 찾을 수 없습니다');
      }

      default:
        return fail('알 수 없는 action: ' + action);
    }
  } catch(err) {
    return fail('서버 오류: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────
function getRows(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

// 간단 비밀번호 해시 (Apps Script 환경용)
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).toUpperCase();
}
