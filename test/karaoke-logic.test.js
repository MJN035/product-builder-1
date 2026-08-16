const test = require('node:test');
const assert = require('node:assert/strict');

const SONG_DB = require('../songs.js');
const {
  buildFavoriteProfile,
  recommendNewSongs,
} = require('../lib/karaoke-logic.js');
const { extractGroundingSources } = require('../lib/gemini-song.js');

test('애창곡의 실제 키에서 음역대 프로필을 계산한다', () => {
  const profile = buildFavoriteProfile(SONG_DB);

  assert.equal(profile.favorites.length, 13);
  assert.equal(profile.comfortableMax, 65);
  assert.equal(profile.demonstratedMax, 68);
  assert.equal(profile.tagCounts['밴드'], 5);
  assert.equal(SONG_DB.find((song) => song.artist === '적재' && song.title === '그리워').myKey, -4);
  assert.equal(SONG_DB.find((song) => song.artist === '적재' && song.title === '나랑 같이 걸을래').myKey, -3);
});

test('검색 그라운딩 URL을 추출하고 신뢰 출처를 구분한다', () => {
  const sources = extractGroundingSources({
    candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { title: '악보바다', uri: 'https://www.akbobada.com/musicDetail.html?id=1' } },
      { web: { title: '블로그', uri: 'https://example.com/post' } },
    ] } }],
  });

  assert.equal(sources.length, 2);
  assert.equal(sources[0].trusted, true);
  assert.equal(sources[1].trusted, false);
});

test('새 노래 추천에서 애창곡을 제외하고 시작 키를 제시한다', () => {
  const result = recommendNewSongs(SONG_DB, {
    referenceSong: '적재 그리워',
    mood: '어쿠스틱',
    limit: 8,
  });
  const favorites = new Set(result.profile.favorites.map((song) => `${song.artist}/${song.title}`));

  assert.equal(result.referenceArtist, '적재');
  assert.equal(result.songs.length, 8);
  assert.equal(result.songs[0].song.title, '별 보러 가자');
  for (const recommendation of result.songs) {
    assert.equal(favorites.has(`${recommendation.song.artist}/${recommendation.song.title}`), false);
    assert.ok(recommendation.keyChange <= 0 && recommendation.keyChange >= -9);
  }
});
