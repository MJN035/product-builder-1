const express = require('express');
const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// GEMINI_API_KEY 환경변수 필요 (.env 참고).
// 키가 없어도 정적 사이트는 동작해야 하므로 지연 초기화한다.
let ai = null;
function getAI() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

app.use(express.static('.'));

// 같은 곡 반복 조회 시 API 비용 절약용 인메모리 캐시
const cache = new Map();
const CACHE_MAX = 500;

// 사람 가창 범위를 벗어난 값은 환각으로 간주하고 거부
const MIDI_MIN = 45; // A2 (0옥타브 라)
const MIDI_MAX = 96; // C7

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

app.get('/api/song-info', async (req, res) => {
  const songTitle = (req.query.songTitle || '').trim();

  if (!songTitle) {
    return res.status(400).json({ error: 'songTitle is required' });
  }
  if (songTitle.length > 100) {
    return res.status(400).json({ error: '곡 제목이 너무 깁니다.' });
  }
  if (!getAI()) {
    return res.status(503).json({ error: 'AI 분석이 설정되지 않았어요. (GEMINI_API_KEY 누락)' });
  }

  const cacheKey = songTitle.toLowerCase();
  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
  }

  try {
    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-flash',
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
      return res.status(404).json({ found: false, error: 'AI가 확실히 아는 곡이 아니에요.' });
    }

    const midi = data.highestNoteMidi;
    if (!Number.isInteger(midi) || midi < MIDI_MIN || midi > MIDI_MAX) {
      return res.status(422).json({
        found: false,
        error: `AI 분석값(${midi})이 사람 가창 범위를 벗어나 신뢰할 수 없어요.`,
      });
    }

    const result = {
      found: true,
      title: data.title || songTitle,
      artist: data.artist || '',
      highestNoteMidi: midi,
      highestNoteName: data.highestNoteName || '',
      isFalsetto: !!data.isFalsetto,
      confidence: data.confidence || 'low',
      source: 'Gemini AI',
    };

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('[song-info]', error.message);
    res.status(502).json({ error: 'AI 분석 요청에 실패했어요. 잠시 후 다시 시도해 주세요.' });
  }
});

app.listen(port, () => {
  console.log(`Karaoke Key Master listening at http://localhost:${port}`);
});
