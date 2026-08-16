const { parseNote } = require('./karaoke-logic.js');

const MIDI_MIN = 45;
const MIDI_MAX = 96;

const SOURCE_RULES = [
  { hosts: ['akbobada.com', 'musicscore.co.kr', 'mymusic5.com', 'mymusicfive.com'], kind: 'vocal-score', weight: 5 },
  { hosts: ['tjmedia.com', 'kyentertainment.kr'], kind: 'karaoke', weight: 4 },
  { hosts: ['youtube.com', 'youtu.be'], kind: 'official-media', weight: 2 },
];

const EVIDENCE_STRATEGIES = [
  { id: 'explicit-peak', query: '정규 멜로디 진성 최고음 정확한 음이름 옥타브' },
  { id: 'vocal-score', query: '원키 보컬 멜로디 악보에서 가장 높은 음' },
  { id: 'karaoke', query: 'TJ 금영 노래방 최고음 음역대' },
  { id: 'scientific-pitch', query: 'highest chest note scientific pitch A4 B4 MIDI' },
  { id: 'range-table', query: '보컬 음역 최저음 최고음 표 진성 가성 구분' },
  { id: 'contradiction', query: '최고음 다른 자료 비교 애드리브 가성 제외' },
  { id: 'score-crosscheck', query: '멜로디 1단 악보 원조 E키 최고 음표 확인' },
  { id: 'live-crosscheck', query: '원곡 스튜디오 버전 라이브 버전 최고음 차이' },
];

function hostFromUrl(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function classifySource(url, title = '') {
  const host = hostFromUrl(url);
  const rule = SOURCE_RULES.find(({ hosts }) => hosts.some((item) => host === item || host.endsWith(`.${item}`)));
  const text = `${title} ${url}`.toLowerCase();
  if (rule) return { host, kind: rule.kind, weight: rule.weight, trusted: true };
  if (/악보|score|sheet|보컬|melody/.test(text)) return { host, kind: 'score-index', weight: 3, trusted: false };
  if (/최고음|음역|range|highest/.test(text)) return { host, kind: 'range-reference', weight: 2.5, trusted: false };
  return { host, kind: 'web', weight: 1, trusted: false };
}

function parseNoteMentions(text) {
  if (!text) return [];
  const patterns = [
    /([0-4]\s*옥(?:타브)?\s*(?:도|레|미|파|솔|라|시)#?)/gi,
    /\b([A-G]#?[0-8])\b/g,
    /\bMIDI\s*(?:번호|number|note)?\s*[:=]?\s*(\d{2})\b/gi,
  ];
  const mentions = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      const normalized = raw.replace(/(\d)\s*옥(?!타브)/, '$1옥타브 ');
      const midi = /^\d{2}$/.test(raw) ? Number(raw) : parseNote(normalized);
      if (Number.isInteger(midi) && midi >= MIDI_MIN && midi <= MIDI_MAX) {
        mentions.push({ raw, midi, index: match.index });
      }
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

function extractPeakClaims(text) {
  const lines = String(text || '').split(/\r?\n|(?<=[.!?。])\s+/);
  const claims = [];
  for (const line of lines) {
    const isPeakContext = /최고음|가장\s*높|진성|육성|chest\s*(?:voice|note)|highest\s*(?:note|pitch)|vocal\s*peak/i.test(line);
    if (!isPeakContext) continue;
    const isExcluded = /근거\s*없|확인\s*불가|알\s*수\s*없|추측|불확실|not\s+(?:known|confirmed)/i.test(line);
    if (isExcluded) continue;
    const mentions = parseNoteMentions(line);
    const uniqueMidi = [...new Set(mentions.map((item) => item.midi))];
    // 같은 문장에 A4, 2옥타브 라, MIDI 69처럼 동일한 값이 반복돼도 주장 하나로 취급한다.
    for (const midi of uniqueMidi) claims.push({ midi, excerpt: line.trim(), direct: true });
  }
  return claims;
}

function weightedMedian(items) {
  const sorted = [...items].sort((a, b) => a.midi - b.midi);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let accumulated = 0;
  for (const item of sorted) {
    accumulated += item.weight;
    if (accumulated >= total / 2) return item.midi;
  }
  return sorted.at(-1)?.midi ?? null;
}

function buildConsensus(rawClaims) {
  const valid = rawClaims.filter((claim) => Number.isInteger(claim.midi) && claim.midi >= MIDI_MIN && claim.midi <= MIDI_MAX);
  if (valid.length === 0) return { midi: null, status: 'unverified', confidence: 0, claims: [], rejected: [] };

  const enriched = valid.map((claim) => {
    const source = classifySource(claim.sourceUrl || '', claim.sourceTitle || '');
    const aiOnly = claim.method === 'model-memory';
    return { ...claim, ...source, weight: aiOnly ? 0.25 : source.weight };
  });
  const center = weightedMedian(enriched);
  const accepted = enriched.filter((claim) => Math.abs(claim.midi - center) <= 2);
  const rejected = enriched.filter((claim) => Math.abs(claim.midi - center) > 2);
  const midi = weightedMedian(accepted);

  const supporting = accepted.filter((claim) => Math.abs(claim.midi - midi) <= 1 && claim.method !== 'model-memory');
  const independentHosts = new Set(supporting.map((claim) => claim.host).filter(Boolean));
  const trustedHosts = new Set(supporting.filter((claim) => claim.trusted).map((claim) => claim.host));
  const totalWeight = supporting.reduce((sum, claim) => sum + claim.weight, 0);
  const spread = supporting.length ? Math.max(...supporting.map((c) => c.midi)) - Math.min(...supporting.map((c) => c.midi)) : Infinity;

  let status = 'unverified';
  if (trustedHosts.size >= 2 && independentHosts.size >= 2 && totalWeight >= 8 && spread <= 1) status = 'verified';
  else if (independentHosts.size >= 2 && totalWeight >= 5 && spread <= 2) status = 'corroborated';
  else if (supporting.length > 0) status = 'provisional';

  const confidence = Math.max(0, Math.min(1,
    (Math.min(totalWeight, 12) / 12) * 0.55 +
    (Math.min(independentHosts.size, 3) / 3) * 0.3 +
    (spread <= 1 ? 0.15 : spread <= 2 ? 0.08 : 0)
  ));
  return { midi, status, confidence: Number(confidence.toFixed(2)), spread, independentHosts: [...independentHosts], claims: accepted, rejected };
}

module.exports = {
  EVIDENCE_STRATEGIES,
  classifySource,
  parseNoteMentions,
  extractPeakClaims,
  buildConsensus,
};
