/* ============================================================
   Karaoke Key Master — App Logic
   1) 음계 변환 유틸 (MIDI ↔ 음명 ↔ 한국식 옥타브 표기)
   2) 사용자 음역대 프로필 (localStorage 저장)
   3) 곡 검색: 로컬 DB 우선 → AI 폴백(검증 포함)
   4) 키 추천 알고리즘 (진성/가성 구분, 옥타브 다운 제안)
   5) 마이크 음역대 측정 (자기상관 피치 감지)
   6) 피아노 시각화 / 맞춤 추천곡
   ============================================================ */

"use strict";

/* ──────────────────────────────
   1. 음계 변환 유틸
   ────────────────────────────── */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KO_NAMES = ["도", "도#", "레", "레#", "미", "파", "파#", "솔", "솔#", "라", "라#", "시"];

function midiToNote(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
// 한국식: 2옥타브 도 = C4 (MIDI 60) → 옥타브 = floor(midi/12) - 3
function midiToKorean(midi) {
  return `${Math.floor(midi / 12) - 3}옥타브 ${KO_NAMES[midi % 12]}`;
}
function midiToFull(midi) {
  return `${midiToNote(midi)} (${midiToKorean(midi)})`;
}
function freqToMidiFloat(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

/* ──────────────────────────────
   2. 사용자 프로필
   ────────────────────────────── */
const DEFAULT_PROFILE = { chestMax: 67, falsettoMax: 74, gender: "M", name: "" };

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem("kkm-profile"));
    if (p && Number.isInteger(p.chestMax)) return { ...DEFAULT_PROFILE, ...p };
  } catch (e) { /* corrupt data → default */ }
  return { ...DEFAULT_PROFILE };
}
let profile = loadProfile();

function saveProfile() {
  localStorage.setItem("kkm-profile", JSON.stringify(profile));
  renderProfileSummary();
}

// 음 선택 <select> 채우기 (C2~C6)
function fillNotePicker(sel, from, to, selected) {
  sel.innerHTML = "";
  for (let m = from; m <= to; m++) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = midiToFull(m);
    if (m === selected) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderProfileSummary() {
  document.getElementById("profile-chest").textContent = midiToFull(profile.chestMax);
  document.getElementById("profile-falsetto").textContent = midiToFull(profile.falsettoMax);
  const summary = document.getElementById("home-range-summary");
  if (summary) summary.textContent = `진성 ${midiToKorean(profile.chestMax)} · 가성 ${midiToKorean(profile.falsettoMax)}`;
}

/* ──────────────────────────────
   3. 곡 검색 (로컬 DB → AI 폴백)
   ────────────────────────────── */
function normalize(s) {
  return s.toLowerCase().replace(/[\s'"“”‘’!?.,()\-]/g, "");
}

/* 점수 체계 (엄격한 순):
   100 제목 완전 일치 / 가수+제목 완전 일치
    95 검색어에 제목과 가수가 모두 포함 ("박효신 야생화")
    72 검색어에 4자 이상 제목이 포함
    70 제목이 검색어로 시작 (2자 이상)
    65 제목에 검색어 포함 (2자 이상)
    55 가수 완전 일치 (곡 목록 제시용)
    45 가수에 검색어 포함 (2자 이상)
   90 이상만 자동 분석, 그 미만은 후보 목록으로 제시 → 오매칭 방지 */
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

// [{song, score}] 를 점수순으로 반환
function searchLocalDB(query) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const song of window.SONG_DB) {
    const score = scoreSong(song, q);
    if (score > 0) scored.push({ song, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored;
}

/* ──────────────────────────────
   4. 키 추천 알고리즘
   ──────────────────────────────
   songMax  : 곡 최고음 (MIDI)
   chestMax : 사용자 진성 최고음
   falsettoMax : 사용자 가성 최고음
   노래방 기준: 1키 = 반음(semitone). 기계 조절 범위 ±9키 가정.
   판정 순서:
     diff = songMax - chestMax
     ① diff ≤ -3 : 원키 여유. 취향껏 키 올려도 됨(+diff 여유)
     ② diff ≤ 0  : 원키 적정
     ③ 곡 최고음 ≤ falsettoMax(곡이 가성 처리 가능 구간) : 원키 가능하나 가성 필요
     ④ diff 1~9 : diff만큼 키 낮춤 (조절 후 최고음 = chestMax)
     ⑤ diff > 9 : 기계 한계 초과 → 한 옥타브(-12) 아래 가창 제안
   */
const MACHINE_KEY_LIMIT = 9;

function recommendKey(songMax, chest, falsetto, songUsesFalsetto) {
  const diff = songMax - chest;
  const result = { diff, songMax, chest, falsetto };

  if (diff <= 0) {
    if (diff <= -3) {
      return { ...result, level: "ok", keyChange: 0, headroom: -diff,
        title: "원키 가창 가능 (여유 있음)",
        detail: `곡 최고음이 진성 최고음보다 ${-diff}키 낮아요. 최대 +${Math.min(-diff, MACHINE_KEY_LIMIT)}키까지 올려 불러도 됩니다.` };
    }
    return { ...result, level: "ok", keyChange: 0, headroom: -diff,
      title: "원키 가창 가능",
      detail: "곡 최고음이 진성 음역대 안에 있어요. 자신 있게 원키로 부르세요!" };
  }

  if (songMax <= falsetto) {
    return { ...result, level: "warn", keyChange: 0, needFalsetto: true,
      title: songUsesFalsetto ? "원키 가능 (원곡도 가성 구간)" : "원키 가능 (가성 필요)",
      detail: `최고음 구간(${midiToKorean(songMax)})은 진성으로는 ${diff}키 높지만 가성 음역대 안에 있어요. ` +
        (songUsesFalsetto
          ? "원곡도 이 구간을 가성으로 처리하니 그대로 따라 부르면 됩니다."
          : `가성으로 전환하거나, 안정적으로 부르려면 ${Math.min(diff, MACHINE_KEY_LIMIT)}키 낮추세요.`),
      altKeyChange: -Math.min(diff, MACHINE_KEY_LIMIT) };
  }

  if (diff <= MACHINE_KEY_LIMIT) {
    return { ...result, level: "warn", keyChange: -diff,
      title: `${diff}키 낮춤 권장 (-${diff})`,
      detail: `키를 ${diff} 내리면 곡 최고음이 정확히 진성 최고음(${midiToKorean(chest)})에 맞아요. ` +
        `노래방 리모컨에서 음정(♭)을 ${diff}번 누르세요.` };
  }

  return { ...result, level: "danger", keyChange: -12, octaveDown: true,
    title: "한 옥타브 낮춰 부르기 제안",
    detail: `진성 기준 ${diff}키 차이로 기계 키 조절 범위(±${MACHINE_KEY_LIMIT})를 넘어요. ` +
      `최고음 구간을 한 옥타브(12키) 아래로 부르거나, 다른 곡을 추천드려요. ` +
      `옥타브를 내리면 최고음이 ${midiToKorean(songMax - 12)}가 되어 부담 없이 부를 수 있습니다.` };
}

/* ──────────────────────────────
   분석 실행 + 결과 렌더
   ────────────────────────────── */
let lastAnalyzed = null;

// GitHub Pages(정적)에서는 별도 API 서버로, 그 외(로컬/Vercel)는 같은 호스트로 요청
const API_BASE = location.hostname.endsWith("github.io")
  ? "https://karaoke-key-master.vercel.app"
  : "";

async function analyzeSong(queryOverride) {
  const input = document.getElementById("song-query");
  const query = (queryOverride || input.value).trim();
  const resultsEl = document.getElementById("analyze-results");
  hideAutocomplete();
  if (!query) {
    resultsEl.innerHTML = `<div class="card card-pad text-secondary">곡 제목을 입력해 주세요.</div>`;
    return;
  }
  if (queryOverride) input.value = queryOverride;

  const scored = searchLocalDB(query);

  // 확실한 매칭(90점 이상)이 정확히 하나일 때만 자동 분석
  const strong = scored.filter((s) => s.score >= 90);
  if (strong.length === 1) {
    renderAnalysis(strong[0].song, "verified");
    return;
  }
  if (strong.length > 1) {
    renderCandidates(strong.map((s) => s.song), query, false);
    return;
  }
  // 애매한 매칭 → 후보 목록으로 제시 (오매칭 방지)
  if (scored.length > 0) {
    renderCandidates(scored.slice(0, 6).map((s) => s.song), query, true);
    return;
  }
  // DB에 전혀 없음 → AI 폴백
  analyzeWithAI(query);
}

function renderCandidates(songs, query, offerAI) {
  const resultsEl = document.getElementById("analyze-results");
  let html = `<div class="section-header">"${escapeHtml(query)}" — 이 곡을 찾으셨나요?</div><div class="card">`;
  songs.forEach((s) => {
    html += `
      <div class="song-row" onclick="analyzeFromList(${window.SONG_DB.indexOf(s)})">
        <div class="song-art" style="background:var(--tint)">${escapeHtml(s.title[0])}</div>
        <div class="song-meta">
          <div class="song-name">${escapeHtml(s.title)}</div>
          <div class="song-artist">${escapeHtml(s.artist)} · 최고음 ${midiToKorean(s.maxMidi)}</div>
        </div>
        <span class="cell-value">›</span>
      </div>`;
  });
  html += `</div>`;
  if (offerAI) {
    html += `
      <button class="btn btn-secondary mt-12" onclick="analyzeWithAI(${JSON.stringify(query).replace(/"/g, "&quot;")})">
        찾는 곡이 없어요 — AI로 분석하기
      </button>`;
  }
  resultsEl.innerHTML = html;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function analyzeWithAI(query) {
  const resultsEl = document.getElementById("analyze-results");
  resultsEl.innerHTML = `
    <div class="card card-pad" style="text-align:center">
      <div class="spinner"></div>
      <p class="text-secondary text-sm mt-12">DB에 없는 곡이라 AI로 분석 중…<br>결과는 참고용이에요.</p>
    </div>`;
  try {
    const res = await fetch(`${API_BASE}/api/song-info?songTitle=${encodeURIComponent(query)}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      throw new Error("AI 분석 서버가 아직 연결되지 않았어요. 검증된 곡 데이터베이스에서 검색하거나 추천 탭을 이용해 주세요.");
    }
    const data = await res.json();
    if (!res.ok || !data.found) throw new Error(data.error || "곡 정보를 찾지 못했어요.");
    renderAnalysis(
      { title: data.title, artist: data.artist || "-", maxMidi: data.highestNoteMidi,
        falsetto: !!data.isFalsetto, tag: "AI 분석", gender: "?" },
      data.confidence || "low"
    );
  } catch (err) {
    const msg = err.message.startsWith("AI 분석 서버") || err.message.includes("찾지 못")
      ? err.message
      : "AI 분석 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";
    resultsEl.innerHTML = `
      <div class="verdict danger">
        <div class="v-icon">😢</div>
        <div><p class="v-title">이 곡은 아직 DB에 없어요</p>
        <p class="v-sub">${escapeHtml(msg)}</p></div>
      </div>`;
  }
}

const CONFIDENCE_LABEL = {
  verified: { text: "검증된 데이터", color: "var(--green)" },
  high: { text: "AI 분석 · 신뢰도 높음", color: "var(--green)" },
  medium: { text: "AI 분석 · 신뢰도 보통", color: "var(--orange)" },
  low: { text: "AI 분석 · 참고용", color: "var(--red)" },
};

function renderAnalysis(song, confidence) {
  lastAnalyzed = song;
  const rec = recommendKey(song.maxMidi, profile.chestMax, profile.falsettoMax, song.falsetto);
  const conf = CONFIDENCE_LABEL[confidence] || CONFIDENCE_LABEL.low;
  const iconMap = { ok: "✅", warn: "⚠️", danger: "🚨" };
  const keyText =
    rec.keyChange === 0 ? "원키" :
    rec.octaveDown ? "옥타브 ↓" :
    `${rec.keyChange}키`;

  const resultsEl = document.getElementById("analyze-results");
  resultsEl.innerHTML = `
    <div class="section-header">분석 결과</div>
    <div class="card card-pad">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px">
        <div>
          <div style="font-size:20px; font-weight:700">${escapeHtml(song.title)}</div>
          <div class="text-secondary">${escapeHtml(song.artist)}<span class="chip">${escapeHtml(song.tag || "")}</span></div>
          <div class="text-sm mt-8" style="color:${conf.color}; font-weight:600">● ${conf.text}</div>
        </div>
        <div class="keychip">${keyText}</div>
      </div>

      <div class="stat-grid mt-16">
        <div class="stat">
          <div class="s-label">곡 최고음</div>
          <div class="s-value">${midiToNote(song.maxMidi)}</div>
          <div class="s-sub">${midiToKorean(song.maxMidi)}${song.falsetto ? " · 원곡 가성 처리" : ""}</div>
        </div>
        <div class="stat">
          <div class="s-label">내 진성 최고음</div>
          <div class="s-value">${midiToNote(profile.chestMax)}</div>
          <div class="s-sub">${midiToKorean(profile.chestMax)}</div>
        </div>
      </div>
    </div>

    <div class="verdict ${rec.level} mt-12">
      <div class="v-icon">${iconMap[rec.level]}</div>
      <div>
        <p class="v-title">${rec.title}</p>
        <p class="v-sub">${rec.detail}</p>
      </div>
    </div>

    <div class="section-header">음역대 비교</div>
    <div class="card card-pad">
      <div class="piano-wrap">${renderPiano(song.maxMidi)}</div>
      <div class="piano-legend">
        <span><span class="dot" style="background:color-mix(in srgb, var(--tint) 30%, #fff)"></span>내 진성 음역대</span>
        <span><span class="dot" style="background:var(--tint)"></span>내 최고음</span>
        <span><span class="dot" style="background:var(--pink)"></span>곡 최고음</span>
      </div>
    </div>
    ${confidence !== "verified" ? `<p class="section-footer">AI 분석 결과는 실제와 다를 수 있어요. 검증된 곡은 추천 탭에서 확인하세요.</p>` : ""}
  `;
  // 좁은 화면에서 곡 최고음 건반이 보이도록 피아노를 오른쪽 끝까지 스크롤
  const pw = resultsEl.querySelector(".piano-wrap");
  if (pw) pw.scrollLeft = pw.scrollWidth;
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ──────────────────────────────
   피아노 시각화 (C3 ~ B5)
   ────────────────────────────── */
function renderPiano(songMax) {
  const LOW = 48, HIGH = 83; // C3..B5
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  let html = `<div class="piano">`;
  const whites = [];
  for (let m = LOW; m <= HIGH; m++) if (!isBlack(m)) whites.push(m);
  const wCount = whites.length;

  whites.forEach((m, i) => {
    let cls = "pk-white";
    if (m <= profile.chestMax) cls += " in-user";
    if (m === profile.chestMax) cls = "pk-white user-max";
    if (m === songMax) cls = "pk-white song-max";
    const label = m % 12 === 0 ? `C${Math.floor(m / 12) - 1}` : "";
    html += `<div class="${cls}">${label ? `<span class="pk-label">${label}</span>` : ""}</div>`;
    // 검은 건반: 이 흰 건반과 다음 흰 건반 사이
    const next = m + 1;
    if (next <= HIGH && isBlack(next)) {
      let bCls = "pk-black";
      if (next <= profile.chestMax) bCls += " in-user";
      if (next === profile.chestMax) bCls = "pk-black user-max";
      if (next === songMax) bCls = "pk-black song-max";
      const leftPct = ((i + 1) / wCount) * 100;
      html += `<div class="${bCls}" style="left:calc(${leftPct}% - ${100 / wCount / 3.2}%); width:${100 / wCount * 0.62}%"></div>`;
    }
  });
  html += `</div>`;
  return html;
}

/* ──────────────────────────────
   추천곡 (음역대 맞춤)
   ────────────────────────────── */
let recFilter = "fit"; // fit | all | challenge

function renderRecommendations() {
  const listEl = document.getElementById("rec-list");
  const chest = profile.chestMax;
  const songs = [...window.SONG_DB].sort((a, b) => a.maxMidi - b.maxMidi);

  let filtered;
  if (recFilter === "fit") filtered = songs.filter((s) => s.maxMidi <= chest);
  else if (recFilter === "challenge") filtered = songs.filter((s) => s.maxMidi > chest && s.maxMidi <= chest + 4);
  else filtered = songs;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="card card-pad text-secondary">조건에 맞는 곡이 없어요. 음역대 탭에서 최고음을 측정해 보세요.</div>`;
    return;
  }

  const ART_COLORS = ["#5856d6", "#af52de", "#ff2d55", "#ff9500", "#34c759", "#007aff", "#ff3b30", "#00c7be"];
  let html = `<div class="card">`;
  filtered.forEach((s, i) => {
    const diff = s.maxMidi - chest;
    const badge =
      diff <= 0 ? `<span class="song-badge ok">원키 OK</span>` :
      diff <= 4 ? `<span class="song-badge warn">-${diff}키</span>` :
      `<span class="song-badge danger">-${diff}키</span>`;
    const color = ART_COLORS[(s.artist.charCodeAt(0) + i) % ART_COLORS.length];
    html += `
      <div class="song-row" onclick="analyzeFromList(${window.SONG_DB.indexOf(s)})">
        <div class="song-art" style="background:${color}">${escapeHtml(s.title[0])}</div>
        <div class="song-meta">
          <div class="song-name">${escapeHtml(s.title)}</div>
          <div class="song-artist">${escapeHtml(s.artist)} · 최고음 ${midiToKorean(s.maxMidi)}</div>
        </div>
        ${badge}
      </div>`;
  });
  html += `</div>`;
  listEl.innerHTML = html;
}

function analyzeFromList(idx) {
  const s = window.SONG_DB[idx];
  switchTab("analyze");
  document.getElementById("song-query").value = `${s.artist} ${s.title}`;
  renderAnalysis(s, "verified");
}

/* ──────────────────────────────
   5. 마이크 음역대 측정 (자기상관 피치 감지)
   ──────────────────────────────
   AnalyserNode의 시간 영역 샘플에 자기상관(autocorrelation)을
   적용해 기본 주파수를 추정. 8프레임 연속 ±0.6반음 이내로
   안정된 음만 유효 최고음으로 인정 → 순간 삑사리 배제.
   */
let audioCtx = null, analyser = null, micStream = null, rafId = null;
let sessionMax = -1, stableBuf = [];

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.012) return -1; // 무음

  // 신호 양 끝의 저에너지 구간 트리밍
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  const trimmed = buf.slice(r1, r2);
  const N = trimmed.length;
  if (N < 64) return -1;

  const c = new Float32Array(N);
  for (let lag = 0; lag < N; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  let d = 0;
  while (d < N - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < N; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return -1;

  // 포물선 보간으로 정밀도 향상
  let T0 = maxpos;
  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  const freq = sampleRate / T0;
  if (freq < 60 || freq > 1500) return -1; // 사람 가창 범위 밖
  return freq;
}

async function startRangeTest() {
  const btn = document.getElementById("mic-btn");
  const status = document.getElementById("mic-status");
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    status.innerHTML = `마이크 권한이 필요해요. 브라우저 주소창의 🔒 아이콘에서 허용해 주세요.`;
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  sessionMax = -1;
  stableBuf = [];
  btn.textContent = "측정 종료";
  btn.classList.remove("btn-primary");
  btn.classList.add("btn-danger");
  btn.onclick = stopRangeTest;
  status.innerHTML = `<span class="rec-dot"></span>낮은 음부터 천천히 올라가며 "아—" 소리를 내보세요.`;
  document.getElementById("pitch-live").classList.remove("hidden");
  tick();
}

function tick() {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = autoCorrelate(buf, audioCtx.sampleRate);

  const noteEl = document.getElementById("pitch-note");
  const koEl = document.getElementById("pitch-korean");
  const meterEl = document.getElementById("pitch-meter-fill");

  if (freq > 0) {
    const mf = freqToMidiFloat(freq);
    const midi = Math.round(mf);

    // 안정성 검사: 최근 8프레임이 같은 반음 안에 있어야 인정
    stableBuf.push(mf);
    if (stableBuf.length > 8) stableBuf.shift();
    const spread = Math.max(...stableBuf) - Math.min(...stableBuf);
    const stable = stableBuf.length === 8 && spread < 0.6;

    noteEl.textContent = midiToNote(midi);
    koEl.textContent = `${midiToKorean(midi)} · ${freq.toFixed(1)} Hz${stable ? " ✓" : ""}`;
    meterEl.style.width = `${Math.min(100, Math.max(0, ((mf - 45) / 36) * 100))}%`;

    if (stable && midi > sessionMax) {
      sessionMax = midi;
      document.getElementById("session-max").textContent = midiToFull(sessionMax);
      document.getElementById("apply-max-wrap").classList.remove("hidden");
    }
  } else {
    noteEl.textContent = "–";
    koEl.textContent = "소리를 감지하는 중…";
    meterEl.style.width = "0%";
    stableBuf = [];
  }
  rafId = requestAnimationFrame(tick);
}

function stopRangeTest() {
  if (rafId) cancelAnimationFrame(rafId);
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  rafId = null; micStream = null; audioCtx = null;

  const btn = document.getElementById("mic-btn");
  btn.textContent = "측정 시작";
  btn.classList.add("btn-primary");
  btn.classList.remove("btn-danger");
  btn.onclick = startRangeTest;
  document.getElementById("mic-status").textContent =
    sessionMax > 0 ? `측정 완료! 이번 세션 최고음: ${midiToFull(sessionMax)}` : "측정이 종료되었어요.";
}

function applySessionMax(type) {
  if (sessionMax <= 0) return;
  if (type === "chest") profile.chestMax = sessionMax;
  else profile.falsettoMax = Math.max(sessionMax, profile.chestMax);
  saveProfile();
  syncProfilePickers();
  renderRecommendations();
  document.getElementById("mic-status").textContent =
    `${type === "chest" ? "진성" : "가성"} 최고음이 ${midiToFull(sessionMax)}(으)로 저장됐어요.`;
}

/* ──────────────────────────────
   자동완성
   ────────────────────────────── */
function onQueryInput() {
  const q = document.getElementById("song-query").value.trim();
  const box = document.getElementById("ac-list");
  if (q.length < 1) { hideAutocomplete(); return; }
  const matches = searchLocalDB(q).slice(0, 8).map((s) => s.song);
  if (matches.length === 0) { hideAutocomplete(); return; }
  box.innerHTML = matches
    .map((s) => `<div class="ac-item" onmousedown="analyzeFromList(${window.SONG_DB.indexOf(s)})">
        ${escapeHtml(s.title)} <span class="a-artist">— ${escapeHtml(s.artist)}</span></div>`)
    .join("");
  box.classList.remove("hidden");
}
function hideAutocomplete() {
  document.getElementById("ac-list").classList.add("hidden");
}

/* ──────────────────────────────
   탭 / 테마 / 초기화
   ────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${name}`));
  document.querySelectorAll(".tab-item").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("nav-title").textContent = {
    analyze: "곡 분석", range: "내 음역대", recs: "추천곡", info: "정보",
  }[name];
  if (name === "recs") renderRecommendations();
  if (name !== "range" && micStream) stopRangeTest();
  window.scrollTo({ top: 0 });
}

function initTheme() {
  const saved = localStorage.getItem("kkm-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  updateThemeMeta();
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("kkm-theme", next);
  updateThemeMeta();
}
function updateThemeMeta() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#000000" : "#f2f2f7";
  document.getElementById("theme-btn").textContent = dark ? "☀️" : "🌙";
}

function syncProfilePickers() {
  fillNotePicker(document.getElementById("picker-chest"), 48, 84, profile.chestMax);
  fillNotePicker(document.getElementById("picker-falsetto"), 48, 90, profile.falsettoMax);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ── boot ── */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderProfileSummary();
  syncProfilePickers();
  renderRecommendations();

  document.getElementById("theme-btn").addEventListener("click", toggleTheme);
  document.querySelectorAll(".tab-item").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)));

  const query = document.getElementById("song-query");
  query.addEventListener("input", onQueryInput);
  query.addEventListener("keydown", (e) => { if (e.key === "Enter") analyzeSong(); });
  query.addEventListener("blur", () => setTimeout(hideAutocomplete, 150));

  document.getElementById("picker-chest").addEventListener("change", (e) => {
    profile.chestMax = parseInt(e.target.value);
    if (profile.falsettoMax < profile.chestMax) profile.falsettoMax = profile.chestMax;
    saveProfile(); syncProfilePickers(); renderRecommendations();
  });
  document.getElementById("picker-falsetto").addEventListener("change", (e) => {
    profile.falsettoMax = Math.max(parseInt(e.target.value), profile.chestMax);
    saveProfile(); syncProfilePickers();
  });

  document.getElementById("rec-segment").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      recFilter = b.dataset.filter;
      document.querySelectorAll("#rec-segment button").forEach((x) => x.classList.toggle("active", x === b));
      renderRecommendations();
    }));

  window.addEventListener("scroll", () => {
    document.body.classList.toggle("scrolled", window.scrollY > 40);
  });

  // 공유 링크: ?q=곡명 으로 접속하면 자동 분석
  const q = new URLSearchParams(location.search).get("q");
  if (q) analyzeSong(q);
});
