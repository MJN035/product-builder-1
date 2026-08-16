// 로컬 개발용 서버: 정적 파일 + AI 폴백 API
// 배포는 Vercel(정적 + api/song-info.js 서버리스 함수)로 한다.
const express = require('express');
require('dotenv').config();
const { analyzeSongTitle } = require('./lib/gemini-song');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('.'));

const cache = new Map();
const CACHE_MAX = 500;

app.get('/api/song-info', async (req, res) => {
  const songTitle = (req.query.songTitle || '').trim();
  const cacheKey = songTitle.toLowerCase();
  if (cacheKey && cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
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
});

app.listen(port, () => {
  console.log(`Karaoke Key Master listening at http://localhost:${port}`);
});
