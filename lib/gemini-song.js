// Gemini로 곡 최고음을 분석하는 공통 로직 (로컬 Express 서버와 Vercel 함수가 공유)
const { GoogleGenAI, Type } = require('@google/genai');

// 사람 가창 범위를 벗어난 값은 환각으로 간주하고 거부
const MIDI_MIN = 45; // A2
const MIDI_MAX = 96; // C7

let ai = null;
function getAI() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN, description: '곡을 확실히 알고 있으면 true, 모르는 곡이면 false' },
    title: { type: Type.STRING, description: '곡의 정확한 제목' },
    artist: { type: Type.STRING, description: '가수 이름' },
    highestNoteMidi: {
      type: Type.INTEGER,
      description: '원곡 보컬 최고음의 MIDI 번호 (C4=60, A4=69). 애드리브 제외, 정규 멜로디 기준.',
    },
    highestNoteName: { type: Type.STRING, description: "최고음의 음명 (예: 'A4', 'C#5')" },
    isFalsetto: { type: Type.BOOLEAN, description: '최고음 구간이 원곡에서 가성으로 불리면 true' },
    confidence: {
      type: Type.STRING,
      enum: ['high', 'medium', 'low'],
      description: '이 곡의 최고음 정보에 대한 확신 수준',
    },
  },
  required: ['found', 'title', 'highestNoteMidi', 'confidence'],
  propertyOrdering: ['found', 'title', 'artist', 'highestNoteMidi', 'highestNoteName', 'isFalsetto', 'confidence'],
};

// 성공 시 { status, body } 반환 — HTTP 프레임워크에 독립적
async function analyzeSongTitle(songTitle) {
  if (!songTitle) return { status: 400, body: { error: 'songTitle is required' } };
  if (songTitle.length > 100) return { status: 400, body: { error: '곡 제목이 너무 깁니다.' } };
  if (!getAI()) return { status: 503, body: { error: 'AI 분석이 설정되지 않았어요. (GEMINI_API_KEY 누락)' } };

  const response = await getAI().models.generateContent({
    model: 'gemini-3.5-flash',
    contents:
      `노래 "${songTitle}"의 원곡 보컬 최고음을 분석해줘.\n` +
      `- 정규 멜로디 기준 최고음의 MIDI 번호를 알려줘 (C4=60, A4=69, C5=72).\n` +
      `- 확실히 아는 곡이 아니면 추측하지 말고 found=false로 답해.\n` +
      `- 애드리브나 백코러스는 제외하고, 메인 보컬이 실제로 부르는 최고음 기준.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.1,
    },
  });

  const data = JSON.parse(response.text);

  if (!data.found) {
    return { status: 404, body: { found: false, error: 'AI가 확실히 아는 곡이 아니에요.' } };
  }

  const midi = data.highestNoteMidi;
  if (!Number.isInteger(midi) || midi < MIDI_MIN || midi > MIDI_MAX) {
    return {
      status: 422,
      body: { found: false, error: `AI 분석값(${midi})이 사람 가창 범위를 벗어나 신뢰할 수 없어요.` },
    };
  }

  return {
    status: 200,
    body: {
      found: true,
      title: data.title || songTitle,
      artist: data.artist || '',
      highestNoteMidi: midi,
      highestNoteName: data.highestNoteName || '',
      isFalsetto: !!data.isFalsetto,
      confidence: data.confidence || 'low',
      source: 'Gemini AI',
    },
  };
}

module.exports = { analyzeSongTitle };
