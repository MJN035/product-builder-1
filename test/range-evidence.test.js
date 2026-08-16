const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseNoteMentions,
  extractPeakClaims,
  buildConsensus,
} = require('../lib/range-evidence.js');
const { findGroundedEvidence } = require('../lib/gemini-song.js');

test('한국식·과학식·MIDI 음표를 같은 값으로 해석한다', () => {
  const notes = parseNoteMentions('2옥타브 라 = A4 = MIDI 69');
  assert.deepEqual(notes.map((note) => note.midi), [69, 69, 69]);
});

test('최고음 문맥의 직접 주장만 추출하고 불확실 문장은 제외한다', () => {
  const claims = extractPeakClaims([
    '정규 멜로디 진성 최고음: A4 (MIDI 69).',
    '최고음은 G#4로 추측되지만 직접 근거 없음.',
    '곡의 조성은 E Major다.',
  ].join('\n'));
  assert.deepEqual(claims.map((claim) => claim.midi), [69]);
});

test('독립된 신뢰 악보 출처 둘이 일치하면 verified가 된다', () => {
  const consensus = buildConsensus([
    { midi: 69, sourceUrl: 'https://www.akbobada.com/a', sourceTitle: '보컬 악보', method: 'grounded-search' },
    { midi: 69, sourceUrl: 'https://www.musicscore.co.kr/b', sourceTitle: '멜로디 악보', method: 'grounded-search' },
    { midi: 76, sourceUrl: 'https://example.com/wrong', sourceTitle: '블로그', method: 'grounded-search' },
  ]);
  assert.equal(consensus.midi, 69);
  assert.equal(consensus.status, 'verified');
  assert.equal(consensus.rejected.length, 1);
});

test('AI 기억 표본만으로는 검증 등급을 올리지 않는다', () => {
  const consensus = buildConsensus([
    { midi: 68, method: 'model-memory' },
    { midi: 68, method: 'model-memory' },
    { midi: 69, method: 'model-memory' },
  ]);
  assert.equal(consensus.status, 'unverified');
});

test('증거 워크플로우는 강한 합의가 있어도 최소 6회 실행한다', async () => {
  const strategies = Array.from({ length: 8 }, (_, index) => ({ id: `loop-${index + 1}`, query: 'test' }));
  let calls = 0;
  const result = await findGroundedEvidence('테스트 곡', 69, [], {
    strategies,
    runIteration: async (_title, _midi, strategy) => {
      calls += 1;
      const host = calls % 2 ? 'www.akbobada.com' : 'www.musicscore.co.kr';
      return {
        strategy: strategy.id,
        sources: [],
        claims: [{
          midi: 69,
          excerpt: '진성 최고음 A4',
          sourceUrl: `https://${host}/${calls}`,
          sourceTitle: '보컬 악보',
          method: 'grounded-search',
          strategy: strategy.id,
        }],
      };
    },
  });
  assert.equal(calls, 6);
  assert.equal(result.iterations.length, 6);
  assert.equal(result.status, 'verified');
});
