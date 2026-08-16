// 원격 MCP 서버 (Streamable HTTP) — Claude 앱/웹/Code/Desktop에서 커넥터로 연결
// 엔드포인트: https://karaoke-key-master.vercel.app/api/mcp
const { createMcpHandler } = require('mcp-handler');
const { z } = require('zod');
const SONG_DB = require('../songs.js');
const { midiToFull, midiToKorean, parseNote, searchDB, recommendKey } = require('../lib/karaoke-logic.js');
const { analyzeSongTitle } = require('../lib/gemini-song.js');

function songLine(s) {
  return `${s.title} — ${s.artist} · 최고음 ${midiToFull(s.maxMidi)}` +
    `${s.falsetto ? ' (클라이맥스 가성)' : ''}${s.tag ? ` [${s.tag}]` : ''}`;
}
function text(t) {
  return { content: [{ type: 'text', text: t }] };
}
const NOTE_DESC = '음 표기: "2옥타브 라", "A4", MIDI 번호(69) 모두 허용';

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'search_songs',
      {
        title: '노래방 곡 검색',
        description: '검증된 노래방 곡 데이터베이스(163곡, 최고음 포함)에서 곡을 검색한다. 곡명·가수명 모두 가능.',
        inputSchema: z.object({ query: z.string().describe('곡 제목 또는 가수 이름') }),
      },
      async ({ query }) => {
        const hits = searchDB(SONG_DB, query).slice(0, 10);
        if (hits.length === 0) {
          return text(`"${query}" 검색 결과 없음. analyze_song 도구로 AI 분석을 시도해 보세요.`);
        }
        return text(hits.map((h) => songLine(h.song)).join('\n'));
      }
    );

    server.registerTool(
      'analyze_song',
      {
        title: '곡 최고음 분석 + 키 추천',
        description: '곡의 최고음을 분석하고, 사용자 음역대가 주어지면 노래방 키 조절까지 추천한다. 검증된 DB 우선, 없으면 AI(3회 교차검증) 분석.',
        inputSchema: z.object({
          title: z.string().describe('곡 제목 (가수 이름을 함께 쓰면 정확도가 올라감)'),
          chest_max: z.string().optional().describe(`사용자 진성 최고음. ${NOTE_DESC}`),
          falsetto_max: z.string().optional().describe(`사용자 가성 최고음. ${NOTE_DESC}`),
        }),
      },
      async ({ title, chest_max, falsetto_max }) => {
        let song, sourceNote;
        const hits = searchDB(SONG_DB, title);
        const strong = hits.filter((h) => h.score >= 90);

        if (strong.length === 1) {
          song = strong[0].song;
          sourceNote = '검증된 DB';
        } else if (strong.length > 1) {
          return text(`동명의 곡이 여러 개입니다. 가수를 지정해 주세요:\n${strong.map((h) => songLine(h.song)).join('\n')}`);
        } else {
          const r = await analyzeSongTitle(title);
          if (r.status !== 200) {
            const near = hits.slice(0, 4).map((h) => songLine(h.song)).join('\n');
            return text(`${r.body.error}${near ? `\n\n비슷한 DB 곡:\n${near}` : ''}`);
          }
          song = {
            title: r.body.title, artist: r.body.artist, maxMidi: r.body.highestNoteMidi,
            falsetto: r.body.isFalsetto, falsettoMidi: r.body.falsettoNoteMidi,
          };
          sourceNote = `AI 분석 (${r.body.source}, 신뢰도 ${r.body.confidence})`;
        }

        let out = `${song.title} — ${song.artist}\n진성 최고음: ${midiToFull(song.maxMidi)}` +
          `${song.falsettoMidi ? `\n가성 최고음: ${midiToFull(song.falsettoMidi)}` : ''}` +
          `${song.falsetto ? '\n(클라이맥스는 원곡에서 가성 처리)' : ''}\n출처: ${sourceNote}`;

        const chest = chest_max ? parseNote(chest_max) : null;
        if (chest) {
          const fal = falsetto_max ? parseNote(falsetto_max) : null;
          const rec = recommendKey(song.maxMidi, chest, fal, song.falsetto);
          out += `\n\n[키 추천 — 진성 ${midiToKorean(chest)}${fal ? `, 가성 ${midiToKorean(fal)}` : ''} 기준]\n` +
            `${rec.title}\n${rec.detail}`;
        }
        return text(out);
      }
    );

    server.registerTool(
      'recommend_key',
      {
        title: '노래방 키 판정',
        description: '곡 최고음과 사용자 음역대로 노래방 키 조절을 판정한다 (1키 = 반음).',
        inputSchema: z.object({
          song_max: z.string().describe(`곡 최고음. ${NOTE_DESC}`),
          chest_max: z.string().describe(`사용자 진성 최고음. ${NOTE_DESC}`),
          falsetto_max: z.string().optional().describe(`사용자 가성 최고음. ${NOTE_DESC}`),
          song_uses_falsetto: z.boolean().optional().describe('곡의 최고음 구간이 원곡에서 가성이면 true'),
        }),
      },
      async ({ song_max, chest_max, falsetto_max, song_uses_falsetto }) => {
        const sm = parseNote(song_max), cm = parseNote(chest_max);
        if (sm == null || cm == null) return text('음 표기를 해석하지 못했습니다. 예: "2옥타브 라", "A4", 69');
        const fal = falsetto_max ? parseNote(falsetto_max) : null;
        const rec = recommendKey(sm, cm, fal, !!song_uses_falsetto);
        return text(`${rec.title}\n${rec.detail}\n권장 키 조절: ${rec.keyChange === 0 ? '원키' : rec.keyChange}`);
      }
    );

    server.registerTool(
      'estimate_range',
      {
        title: '음역대 역산',
        description: '사용자가 부르는 곡과 낮추는 키 수 목록으로 진성 최고음(음역대)을 역산한다.',
        inputSchema: z.object({
          songs: z.array(z.object({
            title: z.string().describe('곡 제목 (가수 포함 권장)'),
            key_down: z.number().describe('낮추는 키 수 (원키면 0, 3키 낮추면 3)'),
          })).describe('부르는 곡 목록'),
        }),
      },
      async ({ songs }) => {
        const lines = [], implied = [];
        for (const item of songs) {
          const hits = searchDB(SONG_DB, item.title).filter((h) => h.score >= 90);
          if (hits.length !== 1) {
            lines.push(`- ${item.title}: DB에서 특정 실패 (가수를 함께 적어주세요)`);
            continue;
          }
          const s = hits[0].song;
          const eff = s.maxMidi - Math.abs(item.key_down);
          implied.push(eff);
          lines.push(`- ${s.title}(${s.artist}): 원키 ${midiToKorean(s.maxMidi)} − ${Math.abs(item.key_down)}키 → ${midiToFull(eff)}`);
        }
        if (implied.length === 0) return text(lines.join('\n') || '계산할 곡이 없습니다.');
        const maxImplied = Math.max(...implied);
        return text(
          `${lines.join('\n')}\n\n추정 진성 최고음: ${midiToFull(maxImplied)} 부근\n` +
          `프로필 적용 링크: https://karaoke-key-master.vercel.app/?chest=${maxImplied}`
        );
      }
    );

    server.registerTool(
      'list_favorites',
      {
        title: '애창곡 목록',
        description: '사용자의 애창곡 목록(실제 부르는 키 포함)을 반환한다.',
        inputSchema: z.object({}),
      },
      async () => {
        const favs = SONG_DB.filter((s) => s.favorite);
        if (favs.length === 0) return text('등록된 애창곡이 없습니다.');
        return text(favs.map((s) => `${songLine(s)} · 내 키: ${s.myKey === 0 ? '원키' : s.myKey}`).join('\n'));
      }
    );
  },
  {
    serverInfo: { name: 'karaoke-key-master', version: '1.0.0' },
  }
);

module.exports = handler;
module.exports.GET = handler;
module.exports.POST = handler;
module.exports.DELETE = handler;
