// 노래방 인기곡 최고음 데이터베이스
// maxMidi: 곡 최고음 MIDI 번호 (C4 = 60). 커뮤니티 수집 데이터로 ±1키(반음) 오차가 있을 수 있음.
// falsetto: 최고음 구간이 원곡에서 가성으로 처리되는 곡이면 true
// gender: 'M' 남성곡, 'F' 여성곡, 'G' 그룹/혼성
window.SONG_DB = [
  // ── 남성 발라드 ──
  { title: "옛사랑", artist: "이문세", gender: "M", tag: "발라드", maxMidi: 62, falsetto: false },
  { title: "서른 즈음에", artist: "김광석", gender: "M", tag: "발라드", maxMidi: 65, falsetto: false },
  { title: "걱정말아요 그대", artist: "이적", gender: "M", tag: "발라드", maxMidi: 67, falsetto: false },
  { title: "좋은 사람", artist: "토이(김연우)", gender: "M", tag: "발라드", maxMidi: 68, falsetto: false },
  { title: "거리에서", artist: "성시경", gender: "M", tag: "발라드", maxMidi: 68, falsetto: false },
  { title: "너의 모든 순간", artist: "성시경", gender: "M", tag: "발라드", maxMidi: 67, falsetto: false },
  { title: "모든 날, 모든 순간", artist: "폴킴", gender: "M", tag: "발라드", maxMidi: 68, falsetto: false },
  { title: "너를 위해", artist: "임재범", gender: "M", tag: "발라드", maxMidi: 69, falsetto: false },
  { title: "고해", artist: "임재범", gender: "M", tag: "발라드", maxMidi: 70, falsetto: false },
  { title: "눈의 꽃", artist: "박효신", gender: "M", tag: "발라드", maxMidi: 71, falsetto: false },
  { title: "야생화", artist: "박효신", gender: "M", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "보고싶다", artist: "김범수", gender: "M", tag: "발라드", maxMidi: 73, falsetto: false },
  { title: "사랑한다는 흔한 말", artist: "김연우", gender: "M", tag: "발라드", maxMidi: 73, falsetto: false },
  { title: "바람기억", artist: "나얼", gender: "M", tag: "발라드", maxMidi: 74, falsetto: false },
  { title: "어디에도", artist: "엠씨더맥스", gender: "M", tag: "발라드", maxMidi: 75, falsetto: false },
  { title: "그대라는 사치", artist: "한동근", gender: "M", tag: "발라드", maxMidi: 74, falsetto: false },
  { title: "이 소설의 끝을 다시 써보려 해", artist: "한동근", gender: "M", tag: "발라드", maxMidi: 75, falsetto: false },
  { title: "선물", artist: "멜로망스", gender: "M", tag: "발라드", maxMidi: 71, falsetto: false },
  { title: "사건의 지평선", artist: "윤하", gender: "F", tag: "락발라드", maxMidi: 71, falsetto: false },

  // ── 남성 락/밴드 ──
  { title: "가시", artist: "버즈", gender: "M", tag: "락", maxMidi: 71, falsetto: false },
  { title: "겁쟁이", artist: "버즈", gender: "M", tag: "락", maxMidi: 70, falsetto: false },
  { title: "체념", artist: "빅마마", gender: "F", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "돌덩이", artist: "하현우", gender: "M", tag: "락", maxMidi: 73, falsetto: false },
  { title: "Lazenca, Save Us", artist: "넥스트", gender: "M", tag: "락", maxMidi: 76, falsetto: false },
  { title: "해야 (HEYA)", artist: "아이브", gender: "F", tag: "댄스", maxMidi: 73, falsetto: false },
  { title: "주저하는 연인들을 위해", artist: "잔나비", gender: "M", tag: "밴드", maxMidi: 68, falsetto: true },
  { title: "봄이 좋냐??", artist: "10CM", gender: "M", tag: "밴드", maxMidi: 69, falsetto: false },
  { title: "흔들리는 꽃들 속에서 네 샴푸향이 느껴진거야", artist: "장범준", gender: "M", tag: "밴드", maxMidi: 66, falsetto: false },
  { title: "벚꽃 엔딩", artist: "버스커 버스커", gender: "M", tag: "밴드", maxMidi: 66, falsetto: false },

  // ── 남성 팝/힙합/R&B ──
  { title: "instagram", artist: "DEAN", gender: "M", tag: "R&B", maxMidi: 69, falsetto: true },
  { title: "D (half moon)", artist: "DEAN", gender: "M", tag: "R&B", maxMidi: 68, falsetto: true },
  { title: "밤하늘의 별을", artist: "경서", gender: "F", tag: "발라드", maxMidi: 71, falsetto: false },
  { title: "Love poem", artist: "아이유", gender: "F", tag: "발라드", maxMidi: 71, falsetto: false },
  { title: "에잇", artist: "아이유", gender: "F", tag: "팝", maxMidi: 69, falsetto: false },

  // ── 여성 발라드/팝 ──
  { title: "밤편지", artist: "아이유", gender: "F", tag: "발라드", maxMidi: 65, falsetto: false },
  { title: "좋은 날", artist: "아이유", gender: "F", tag: "팝", maxMidi: 78, falsetto: false },
  { title: "인연", artist: "이선희", gender: "F", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "Tears", artist: "소찬휘", gender: "F", tag: "락", maxMidi: 75, falsetto: false },
  { title: "만약에", artist: "태연", gender: "F", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "기억상실", artist: "거미", gender: "F", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "첫눈처럼 너에게 가겠다", artist: "에일리", gender: "F", tag: "발라드", maxMidi: 73, falsetto: false },
  { title: "시간을 거슬러", artist: "린", gender: "F", tag: "발라드", maxMidi: 72, falsetto: false },
  { title: "총 맞은 것처럼", artist: "백지영", gender: "F", tag: "발라드", maxMidi: 71, falsetto: false },
  { title: "우주를 줄게", artist: "볼빨간사춘기", gender: "F", tag: "팝", maxMidi: 69, falsetto: false },
  { title: "롤린 (Rollin')", artist: "브레이브걸스", gender: "F", tag: "댄스", maxMidi: 70, falsetto: false },

  // ── 그룹/댄스 ──
  { title: "Ditto", artist: "NewJeans", gender: "F", tag: "팝", maxMidi: 67, falsetto: false },
  { title: "Hype Boy", artist: "NewJeans", gender: "F", tag: "팝", maxMidi: 68, falsetto: false },
  { title: "사랑을 했다", artist: "iKON", gender: "G", tag: "팝", maxMidi: 65, falsetto: false },
  { title: "아무노래", artist: "지코", gender: "M", tag: "힙합", maxMidi: 64, falsetto: false },
  { title: "Celebrity", artist: "아이유", gender: "F", tag: "팝", maxMidi: 70, falsetto: true },
  { title: "봄날", artist: "방탄소년단", gender: "G", tag: "팝", maxMidi: 71, falsetto: false },
];
