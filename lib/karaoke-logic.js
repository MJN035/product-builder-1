// 키 추천·검색·음계 변환 핵심 로직 (MCP 서버용)
// 주의: main.js의 동명 함수들과 로직을 동기화할 것 (브라우저는 모듈 시스템 없이 로드)

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KO_NAMES = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];

function midiToNote(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
// 한국식: 2옥타브 도 = C4 (MIDI 60)
function midiToKorean(midi) {
  return `${Math.floor(midi / 12) - 3}옥타브 ${KO_NAMES[midi % 12]}`;
}
function midiToFull(midi) {
  return `${midiToNote(midi)} (${midiToKorean(midi)})`;
}

// "2옥타브 라#", "A4", "69" 등 다양한 표기를 MIDI로
function parseNote(input) {
  if (typeof input === "number") return Math.round(input);
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return parseInt(s);
  const ko = s.match(/(\d)\s*옥타브\s*(도#?|레#?|미|파#?|솔#?|라#?|시)/);
  if (ko) return KO_NAMES.indexOf(ko[2]) + (parseInt(ko[1]) + 3) * 12;
  const sci = s.toUpperCase().match(/^([A-G]#?)(\d)$/);
  if (sci) return NOTE_NAMES.indexOf(sci[1]) + (parseInt(sci[2]) + 1) * 12;
  return null;
}

function normalize(s) {
  return String(s).toLowerCase().replace(/[\s'"“”‘’!?.,()\-]/g, "");
}

function scoreSong(song, q) {
  const t = normalize(song.title);
  const a = normalize(song.artist);
  if (t === q || a + t === q || t + a === q) return 100;
  const hasTitle = t.length >= 2 && q.includes(t);
  const hasArtist = a.length >= 2 && q.includes(a);
  if (hasTitle && hasArtist) return 95;
  if (hasTitle && t.length >= 4) return 72;
  if (q.length >= 2 && t.startsWith(q)) return 70;
  if (q.length >= 2 && t.includes(q)) return 65;
  if (a === q) return 55;
  if (q.length >= 2 && a.includes(q)) return 45;
  return 0;
}

function searchDB(db, query) {
  const q = normalize(query);
  if (!q) return [];
  return db
    .map((song) => ({ song, score: scoreSong(song, q) }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score);
}

// 노래방 기계 키 조절 한계 (±9키 가정)
const MACHINE_KEY_LIMIT = 9;

function recommendKey(songMax, chest, falsetto, songUsesFalsetto) {
  const diff = songMax - chest;

  if (diff <= 0) {
    if (diff <= -3) {
      return { level: "ok", keyChange: 0, headroom: -diff,
        title: "원키 가창 가능 (여유 있음)",
        detail: `곡 최고음이 진성 최고음보다 ${-diff}키 낮음. 최대 +${Math.min(-diff, MACHINE_KEY_LIMIT)}키까지 올려도 됨.` };
    }
    return { level: "ok", keyChange: 0, headroom: -diff,
      title: "원키 가창 가능",
      detail: "곡 최고음이 진성 음역대 안에 있음." };
  }

  if (falsetto != null && songMax <= falsetto) {
    return { level: "warn", keyChange: 0, needFalsetto: true,
      altKeyChange: -Math.min(diff, MACHINE_KEY_LIMIT),
      title: songUsesFalsetto ? "원키 가능 (원곡도 가성 구간)" : "원키 가능 (가성 필요)",
      detail: `최고음(${midiToKorean(songMax)})은 진성보다 ${diff}키 높지만 가성 음역대 안. ` +
        (songUsesFalsetto ? "원곡도 가성 처리하는 구간." : `안정적으로 부르려면 ${Math.min(diff, MACHINE_KEY_LIMIT)}키 낮춤.`) };
  }

  if (diff <= MACHINE_KEY_LIMIT) {
    return { level: "warn", keyChange: -diff,
      title: `${diff}키 낮춤 권장 (-${diff})`,
      detail: `키를 ${diff} 내리면 곡 최고음이 진성 최고음(${midiToKorean(chest)})에 맞음.` };
  }

  return { level: "danger", keyChange: -12, octaveDown: true,
    title: "한 옥타브 낮춰 부르기 제안",
    detail: `진성 기준 ${diff}키 차이로 기계 키 조절 범위(±${MACHINE_KEY_LIMIT})를 초과. ` +
      `한 옥타브(12키) 아래로 부르면 최고음이 ${midiToKorean(songMax - 12)}가 됨.` };
}

module.exports = { midiToNote, midiToKorean, midiToFull, parseNote, searchDB, recommendKey, MACHINE_KEY_LIMIT };
