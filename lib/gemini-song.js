// Gemini로 곡 최고음을 분석하는 공통 로직 (로컬 Express 서버와 Vercel 함수가 공유)
// 정확도 전략 (무료 티어 — 검색 그라운딩 불가):
//   1) 검증된 곡들을 기준점(few-shot)으로 제공해 한국식 표기↔MIDI 변환을 보정
//   2) 같은 곡을 3회 병렬 질의 → 진성 최고음의 중앙값 채택
//   3) 세 응답의 편차(spread)를 신뢰도로 환산: ≤1키 high, ≤3키 medium, 그 이상 low
const { GoogleGenAI, Type } = require('@google/genai');

// 사람 가창 범위를 벗어난 값은 환각으로 간주하고 거부
const MIDI_MIN = 45; // A2
const MIDI_MAX = 96; // C7
const VOTES = 3;

let ai = null;
function getAI() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

async function callWithRetry(params) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getAI().models.generateContent(params);
    } catch (e) {
      lastError = e;
      const transient = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|500|fetch failed|ECONNRESET/i.test(e.message);
      if (!transient || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  throw lastError;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN, description: '곡을 확실히 알면 true, 모르면 false' },
    title: { type: Type.STRING, description: '곡의 정확한 제목' },
    artist: { type: Type.STRING, description: '가수 이름' },
    chestNoteMidi: {
      type: Type.INTEGER,
      description: '진성(육성) 최고음의 MIDI 번호. 애드리브 제외, 정규 멜로디 기준.',
    },
    falsettoNoteMidi: {
      type: Type.INTEGER,
      nullable: true,
      description: '가성 최고음의 MIDI 번호 (가성 구간이 없으면 null)',
    },
    climaxIsFalsetto: { type: Type.BOOLEAN, description: '곡의 가장 높은 음이 가성으로 불리면 true' },
  },
  required: ['found', 'title', 'chestNoteMidi'],
};

// 검증된 기준점 — 표기 변환과 난이도 감각을 보정한다
const CALIBRATION =
  `기준점 (검증된 값):\n` +
  `- 김광석 "서른 즈음에" 진성 최고음 2옥타브 파 = F4 = MIDI 65\n` +
  `- 임재범 "고해" 진성 최고음 2옥타브 라# = A#4 = MIDI 70\n` +
  `- 박효신 "야생화" 진성 최고음 3옥타브 도 = C5 = MIDI 72\n` +
  `- 소찬휘 "Tears" 진성 최고음 3옥타브 레# = D#5 = MIDI 75\n` +
  `- 아이유 "좋은 날" 진성 최고음 3옥타브 파# = F#5 = MIDI 78\n` +
  `변환 공식: 한국식 N옥타브 도 = C(N+2). 2옥타브 도=60, 반음마다 +1.`;

async function askOnce(songTitle) {
  const r = await callWithRetry({
    model: 'gemini-3.5-flash',
    contents:
      `노래 "${songTitle}"의 보컬 최고음을 분석해줘.\n${CALIBRATION}\n` +
      `- 진성(육성) 최고음과 가성 최고음(있다면)을 구분해서 MIDI 번호로.\n` +
      `- 애드리브·백코러스 제외, 메인 보컬 정규 멜로디 기준.\n` +
      `- 확실히 아는 곡이 아니면 추측하지 말고 found=false.\n` +
      `- 동명의 곡이 여럿이면 가장 유명한 곡 기준으로 답하고 artist를 명시해.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.7, // 표본 다양성 확보 → 중앙값 투표의 의미가 생김
    },
  });
  return JSON.parse(r.text);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// 성공 시 { status, body } 반환 — HTTP 프레임워크에 독립적
async function analyzeSongTitle(songTitle) {
  if (!songTitle) return { status: 400, body: { error: 'songTitle is required' } };
  if (songTitle.length > 100) return { status: 400, body: { error: '곡 제목이 너무 깁니다.' } };
  if (!getAI()) return { status: 503, body: { error: 'AI 분석이 설정되지 않았어요. (GEMINI_API_KEY 누락)' } };

  let samples;
  try {
    samples = await Promise.all(
      Array.from({ length: VOTES }, () => askOnce(songTitle).catch((e) => ({ __err: e.message })))
    );
  } catch (e) {
    samples = [{ __err: e.message }];
  }

  const errs = samples.filter((s) => s.__err);
  if (errs.length === samples.length) {
    if (errs.some((s) => /429|RESOURCE_EXHAUSTED/i.test(s.__err))) {
      return { status: 429, body: { error: 'AI 분석 요청이 잠시 몰렸어요. 몇 초 뒤 다시 시도해 주세요.' } };
    }
    throw new Error(errs[0].__err);
  }

  // 오류 표본(429 등)은 투표 분모에서 제외 — 정상 응답만으로 판단한다
  const answered = samples.filter((s) => !s.__err);
  const ok = answered.filter(
    (s) => s.found && Number.isInteger(s.chestNoteMidi) &&
      s.chestNoteMidi >= MIDI_MIN && s.chestNoteMidi <= MIDI_MAX
  );

  if (answered.length === 0 || ok.length < Math.ceil(answered.length / 2)) {
    // 정상 응답의 과반이 "모르는 곡" → 모르는 곡으로 처리 (환각 방지)
    if (answered.length > 0) {
      return { status: 404, body: { found: false, error: 'AI가 확실히 아는 곡이 아니에요. 가수 이름과 함께 검색해 보세요.' } };
    }
    return { status: 429, body: { error: 'AI 분석 요청이 잠시 몰렸어요. 몇 초 뒤 다시 시도해 주세요.' } };
  }

  const chests = ok.map((s) => s.chestNoteMidi);
  const chest = median(chests);
  const spread = Math.max(...chests) - Math.min(...chests);
  const confidence = spread <= 1 ? 'high' : spread <= 3 ? 'medium' : 'low';

  const falsettos = ok.map((s) => s.falsettoNoteMidi)
    .filter((f) => Number.isInteger(f) && f >= chest && f <= MIDI_MAX);
  const falsetto = falsettos.length >= Math.ceil(ok.length / 2) ? median(falsettos) : null;

  const climaxFalsettoVotes = ok.filter((s) => s.climaxIsFalsetto).length;

  return {
    status: 200,
    body: {
      found: true,
      title: ok[0].title || songTitle,
      artist: ok[0].artist || '',
      // 하위 호환: highestNoteMidi = 진성 최고음 (중앙값)
      highestNoteMidi: chest,
      falsettoNoteMidi: falsetto,
      isFalsetto: climaxFalsettoVotes > ok.length / 2,
      confidence,
      votes: chests,
      source: `Gemini AI ${ok.length}회 교차검증 (편차 ${spread}키)`,
    },
  };
}

module.exports = { analyzeSongTitle };
