// Vercel 서버리스 함수: GET /api/song-info?songTitle=곡명
// GitHub Pages 프론트에서도 호출할 수 있게 CORS 허용
const { analyzeSongTitle } = require('../lib/gemini-song');

// 같은 곡 반복 조회 시 API 비용 절약용 캐시 (함수 인스턴스 생존 동안 유지)
const cache = new Map();
const CACHE_MAX = 500;

const ALLOWED_ORIGINS = [
  'https://mjn035.github.io',
  'http://localhost:3000',
];

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const songTitle = (req.query.songTitle || '').trim();
  const cacheKey = songTitle.toLowerCase();
  if (cacheKey && cache.has(cacheKey)) {
    return res.status(200).json(cache.get(cacheKey));
  }

  try {
    const { status, body } = await analyzeSongTitle(songTitle);
    if (status === 200) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, body);
    }
    res.status(status).json(body);
  } catch (error) {
    console.error('[song-info]', error.message);
    res.status(502).json({ error: 'AI 분석 요청에 실패했어요. 잠시 후 다시 시도해 주세요.' });
  }
};
