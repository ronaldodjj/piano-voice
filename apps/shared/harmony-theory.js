const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Intervalos en semitonos desde la tónica para cada modo
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
};

// Pasos (en grados de escala, no semitonos) para cada voz de coro
const VOICE_STEPS = {
  "3up": 2,
  "3down": -2,
  "5up": 4,
  "5down": -4,
};

let scaleDegrees = [];

function buildScaleDegrees(tonicIndex, modeKey) {
  const intervals = SCALES[modeKey];
  const midiSet = new Set();
  for (let o = -1; o <= 9; o++) {
    const base = (o + 1) * 12;
    intervals.forEach((iv) => {
      const midi = base + tonicIndex + iv;
      if (midi >= 0 && midi <= 127) midiSet.add(midi);
    });
  }
  return Array.from(midiSet).sort((a, b) => a - b);
}

function nearestDegreeIndex(midi) {
  let bestIndex = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < scaleDegrees.length; i++) {
    const diff = Math.abs(scaleDegrees[i] - midi);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function transposeDiatonic(midi, steps) {
  const index = nearestDegreeIndex(midi);
  const newIndex = Math.min(Math.max(index + steps, 0), scaleDegrees.length - 1);
  return scaleDegrees[newIndex];
}

function noteIdParts(id) {
  const match = id.match(/^([A-G]#?)(\d)$/);
  return { note: match[1], octave: Number(match[2]) };
}

function noteIdToMidi(id) {
  const { note, octave } = noteIdParts(id);
  return (octave + 1) * 12 + NOTES.indexOf(note);
}

function midiToNoteId(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTES[((midi % 12) + 12) % 12];
  return `${note}${octave}`;
}

function freqFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
