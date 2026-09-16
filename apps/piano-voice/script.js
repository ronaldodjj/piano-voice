const WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_AFTER = { C: "C#", D: "D#", F: "F#", G: "G#", A: "A#" };
const OCTAVES = [2, 3, 4, 5, 6];

const IS_SMALL_SCREEN = window.matchMedia("(max-width: 600px)").matches;
const WHITE_KEY_WIDTH = IS_SMALL_SCREEN ? 34 : 44;
const BLACK_KEY_WIDTH = IS_SMALL_SCREEN ? 20 : 28;
const PIANO_PADDING = IS_SMALL_SCREEN ? 8 : 10;

// Mapea el teclado del computador a las octavas 4 y 5 (zona central del piano)
const KEYBOARD_MAP = {
  a: "C4", w: "C#4", s: "D4", e: "D#4", d: "E4",
  f: "F4", t: "F#4", g: "G4", y: "G#4", h: "A4",
  u: "A#4", j: "B4",
  k: "C5", o: "C#5", l: "D5", p: "D#5", ";": "E5",
};

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const activeVoices = new Map();

function playNote(id, freq) {
  if (activeVoices.has(id)) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(freq, now);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3500, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.3);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start(now);

  activeVoices.set(id, { oscillator, gain });
}

function stopNote(id) {
  const voice = activeVoices.get(id);
  if (!voice) return;
  const now = audioCtx.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + 0.15);
  voice.oscillator.stop(now + 0.16);
  activeVoices.delete(id);
}

function buildPiano() {
  const piano = document.getElementById("piano");
  const keyElements = {};
  let whiteIndex = 0;

  OCTAVES.forEach((octave) => {
    WHITE_NOTES.forEach((note) => {
      const id = `${note}${octave}`;
      const whiteKey = document.createElement("div");
      whiteKey.className = "key white";
      whiteKey.dataset.note = id;
      whiteKey.style.width = `${WHITE_KEY_WIDTH}px`;

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = note === "C" ? `C${octave}` : "";
      whiteKey.appendChild(label);

      piano.appendChild(whiteKey);
      keyElements[id] = whiteKey;
      whiteIndex++;

      if (BLACK_AFTER[note]) {
        const blackNote = BLACK_AFTER[note];
        const blackId = `${blackNote}${octave}`;
        const blackKey = document.createElement("div");
        blackKey.className = "key black";
        blackKey.dataset.note = blackId;
        blackKey.style.width = `${BLACK_KEY_WIDTH}px`;
        blackKey.style.left = `${PIANO_PADDING + whiteIndex * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2}px`;

        piano.appendChild(blackKey);
        keyElements[blackId] = blackKey;
      }
    });
  });

  return keyElements;
}

function setupInteractions(keyElements) {
  const activeVoiceTypes = new Set();
  const pressedMelody = new Map();
  const muteMelodyCheckbox = document.getElementById("mute-melody");

  document.querySelectorAll("[data-voice]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const voice = checkbox.dataset.voice;
      if (checkbox.checked) activeVoiceTypes.add(voice);
      else activeVoiceTypes.delete(voice);
    });
  });

  const press = (melodyId) => {
    if (pressedMelody.has(melodyId)) return;
    const melodyEl = keyElements[melodyId];
    if (!melodyEl) return;

    const melodyMidi = noteIdToMidi(melodyId);
    if (!muteMelodyCheckbox.checked) {
      playNote(`orig:${melodyId}`, freqFromMidi(melodyMidi));
    }
    melodyEl.classList.add("active");

    const harmonyEntries = [];
    activeVoiceTypes.forEach((voiceType) => {
      const harmonyMidi = transposeDiatonic(melodyMidi, VOICE_STEPS[voiceType]);
      const harmonyId = `${voiceType}:${melodyId}`;
      playNote(harmonyId, freqFromMidi(harmonyMidi));

      const harmonyNoteId = midiToNoteId(harmonyMidi);
      const harmonyEl = keyElements[harmonyNoteId];
      if (harmonyEl) harmonyEl.classList.add(`harmony-${voiceType}`);

      harmonyEntries.push({ id: harmonyId, el: harmonyEl, voiceType });
    });

    pressedMelody.set(melodyId, harmonyEntries);
  };

  const release = (melodyId) => {
    const melodyEl = keyElements[melodyId];
    if (!melodyEl) return;
    if (!pressedMelody.has(melodyId)) return;

    stopNote(`orig:${melodyId}`);
    melodyEl.classList.remove("active");

    const harmonyEntries = pressedMelody.get(melodyId);
    harmonyEntries.forEach(({ id, el, voiceType }) => {
      stopNote(id);
      if (el) el.classList.remove(`harmony-${voiceType}`);
    });

    pressedMelody.delete(melodyId);
  };

  Object.entries(keyElements).forEach(([id, el]) => {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      press(id);
    });
    el.addEventListener("pointerup", () => release(id));
    el.addEventListener("pointercancel", () => release(id));
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") release(id);
    });
  });

  const pressedKeys = new Set();
  window.addEventListener("keydown", (e) => {
    const id = KEYBOARD_MAP[e.key.toLowerCase()];
    if (!id || pressedKeys.has(e.key)) return;
    pressedKeys.add(e.key);
    press(id);
  });

  window.addEventListener("keyup", (e) => {
    const id = KEYBOARD_MAP[e.key.toLowerCase()];
    if (!id) return;
    pressedKeys.delete(e.key);
    release(id);
  });
}

function setupScaleControls() {
  const tonicSelect = document.getElementById("tonic");
  const modeSelect = document.getElementById("mode");

  NOTES.forEach((note, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = note;
    tonicSelect.appendChild(option);
  });
  tonicSelect.value = 0; // C por defecto

  const recompute = () => {
    const tonicIndex = Number(tonicSelect.value);
    scaleDegrees = buildScaleDegrees(tonicIndex, modeSelect.value);
  };

  tonicSelect.addEventListener("change", recompute);
  modeSelect.addEventListener("change", recompute);
  recompute();
}

function setupInstallPrompt() {
  const installBtn = document.getElementById("install-btn");
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    installBtn.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    installBtn.hidden = true;
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

setupScaleControls();
const keyElements = buildPiano();
setupInteractions(keyElements);
setupInstallPrompt();
registerServiceWorker();
