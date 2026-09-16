const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let rawAudioBuffer = null;
let detectedNotes = [];
let renderedBlobUrl = null;

const SAMPLE_MIDIS = [36, 48, 60, 72, 84]; // C2..C6
const pianoBuffers = new Map();

// ---------- Detección de tono (autocorrelación) ----------

function hannWindow(frame) {
  const n = frame.length;
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windowed[i] = frame[i] * w;
  }
  return windowed;
}

function computeRms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function autocorrelationAt(frame, lag) {
  let sum = 0;
  for (let i = 0; i < frame.length - lag; i++) sum += frame[i] * frame[i + lag];
  return sum;
}

function detectPitch(frame, sampleRate) {
  const rms = computeRms(frame);
  const windowed = hannWindow(frame);
  const minLag = Math.floor(sampleRate / 1000); // hasta 1000 Hz
  const maxLag = Math.min(windowed.length - 2, Math.floor(sampleRate / 70)); // desde 70 Hz

  const r0 = autocorrelationAt(windowed, 0);
  if (r0 === 0 || maxLag <= minLag) return { freq: 0, confidence: 0, rms };

  let bestLag = -1;
  let bestR = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const r = autocorrelationAt(windowed, lag);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return { freq: 0, confidence: 0, rms };

  const cPrev = bestLag > minLag ? autocorrelationAt(windowed, bestLag - 1) : bestR;
  const cNext = bestLag < maxLag ? autocorrelationAt(windowed, bestLag + 1) : bestR;
  const denom = cPrev - 2 * bestR + cNext;
  const shift = denom !== 0 ? (0.5 * (cPrev - cNext)) / denom : 0;
  const refinedLag = bestLag + shift;

  const freq = sampleRate / refinedLag;
  const confidence = bestR / r0;
  return { freq, confidence, rms };
}

function mixToMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

async function analyzeAudioBuffer(buffer) {
  const channelData = mixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const FRAME_SIZE = 2048;
  const HOP_SIZE = 512;

  const frames = [];
  const totalFrames = Math.max(0, Math.floor((channelData.length - FRAME_SIZE) / HOP_SIZE));

  for (let i = 0; i <= totalFrames; i++) {
    const start = i * HOP_SIZE;
    const frame = channelData.subarray(start, start + FRAME_SIZE);
    frames.push(detectPitch(frame, sampleRate));
    if (i % 60 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const hopSeconds = HOP_SIZE / sampleRate;
  return segmentNotes(frames, hopSeconds);
}

// ---------- Segmentación en notas discretas ----------

const CONFIDENCE_THRESHOLD = 0.6;
const RMS_THRESHOLD = 0.02;
const DEBOUNCE_FRAMES = 3;
const MIN_NOTE_DURATION = 0.08;

function segmentNotes(frames, hopSeconds) {
  const notes = [];
  let current = null;
  let candidateMidi = null;
  let candidateCount = 0;
  let silenceCount = 0;

  const pushCurrent = (endIndexExclusive) => {
    if (!current) return;
    const startTime = current.startIndex * hopSeconds;
    const duration = (endIndexExclusive - current.startIndex) * hopSeconds;
    notes.push({ midiNote: current.midi, startTime, duration });
    current = null;
  };

  frames.forEach((f, i) => {
    const voiced = f.rms >= RMS_THRESHOLD && f.confidence >= CONFIDENCE_THRESHOLD && f.freq > 0;

    if (!voiced) {
      silenceCount++;
      candidateMidi = null;
      candidateCount = 0;
      if (current && silenceCount >= DEBOUNCE_FRAMES) pushCurrent(i - silenceCount + 1);
      return;
    }
    silenceCount = 0;
    const midi = Math.round(69 + 12 * Math.log2(f.freq / 440));

    if (!current) {
      current = { midi, startIndex: i };
      return;
    }
    if (midi === current.midi) {
      candidateMidi = null;
      candidateCount = 0;
      return;
    }
    if (candidateMidi === midi) {
      candidateCount++;
    } else {
      candidateMidi = midi;
      candidateCount = 1;
    }
    if (candidateCount >= DEBOUNCE_FRAMES) {
      pushCurrent(i - candidateCount + 1);
      current = { midi: candidateMidi, startIndex: i - candidateCount + 1 };
      candidateMidi = null;
      candidateCount = 0;
    }
  });
  if (current) pushCurrent(frames.length);

  return mergeShortNotes(notes);
}

function mergeShortNotes(notes) {
  const result = [];
  notes.forEach((note) => {
    if (note.duration >= MIN_NOTE_DURATION || result.length === 0) {
      result.push(note);
    } else {
      result[result.length - 1].duration += note.duration;
    }
  });
  return result.filter((n) => n.duration >= MIN_NOTE_DURATION * 0.5);
}

// ---------- Piano roll (vista previa) ----------

function renderPianoRoll(notes) {
  const pianoRollEl = document.getElementById("piano-roll");
  pianoRollEl.innerHTML = "";
  if (!notes.length) return;

  const PX_PER_SECOND = 80;
  const ROW_HEIGHT = 6;
  const minMidi = Math.min(...notes.map((n) => n.midiNote)) - 2;
  const maxMidi = Math.max(...notes.map((n) => n.midiNote)) + 2;
  const totalDuration = Math.max(...notes.map((n) => n.startTime + n.duration));

  pianoRollEl.style.width = `${Math.max(200, totalDuration * PX_PER_SECOND)}px`;
  pianoRollEl.style.height = `${(maxMidi - minMidi) * ROW_HEIGHT}px`;

  notes.forEach((note) => {
    const bar = document.createElement("div");
    bar.className = "roll-note";
    bar.style.left = `${note.startTime * PX_PER_SECOND}px`;
    bar.style.width = `${Math.max(2, note.duration * PX_PER_SECOND)}px`;
    bar.style.bottom = `${(note.midiNote - minMidi) * ROW_HEIGHT}px`;
    bar.title = midiToNoteId(note.midiNote);
    pianoRollEl.appendChild(bar);
  });
}

// ---------- Entrada de audio (mic / archivo) ----------

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let isRecording = false;

function setInputStatus(text) {
  document.getElementById("input-status").textContent = text;
}

async function loadTakeFromBlob(blob) {
  const rawAudioEl = document.getElementById("raw-audio");
  rawAudioEl.src = URL.createObjectURL(blob);
  rawAudioEl.hidden = false;

  setInputStatus("Analizando…");
  document.getElementById("generate-btn").disabled = true;

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  rawAudioBuffer = buffer;
  detectedNotes = await analyzeAudioBuffer(buffer);
  renderPianoRoll(detectedNotes);

  if (detectedNotes.length) {
    setInputStatus(`Se detectaron ${detectedNotes.length} notas.`);
    document.getElementById("generate-btn").disabled = false;
  } else {
    setInputStatus("No se detectaron notas claras. Intenta con una toma más limpia y sostenida.");
  }
}

async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener("stop", async () => {
    mediaStream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    await loadTakeFromBlob(blob);
  });
  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

function setupRecording() {
  const recordBtn = document.getElementById("record-btn");
  recordBtn.addEventListener("click", async () => {
    if (!isRecording) {
      try {
        await startRecording();
        isRecording = true;
        recordBtn.textContent = "Detener";
        recordBtn.classList.add("recording");
        setInputStatus("Grabando…");
      } catch (err) {
        setInputStatus(`No se pudo acceder al micrófono: ${err.message}`);
      }
    } else {
      stopRecording();
      isRecording = false;
      recordBtn.textContent = "Grabar";
      recordBtn.classList.remove("recording");
    }
  });
}

function setupFileUpload() {
  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await loadTakeFromBlob(file);
  });
}

// ---------- Controles de escala (tónica + modo) ----------

function setupScaleControls() {
  const tonicSelect = document.getElementById("tonic");
  const modeSelect = document.getElementById("mode");

  NOTES.forEach((note, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = note;
    tonicSelect.appendChild(option);
  });
  tonicSelect.value = 0;

  const recompute = () => {
    scaleDegrees = buildScaleDegrees(Number(tonicSelect.value), modeSelect.value);
  };

  tonicSelect.addEventListener("change", recompute);
  modeSelect.addEventListener("change", recompute);
  recompute();
}

function getActiveVoiceTypes() {
  return Array.from(document.querySelectorAll("[data-voice]:checked")).map((cb) => cb.dataset.voice);
}

// ---------- Síntesis con muestras de piano ----------

async function loadPianoSamples() {
  await Promise.all(
    SAMPLE_MIDIS.map(async (midi) => {
      const name = midiToNoteId(midi);
      const response = await fetch(`samples/piano-${name}.mp3`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuffer);
      pianoBuffers.set(midi, buffer);
    })
  );
}

function nearestSampleMidi(midi) {
  return SAMPLE_MIDIS.reduce((best, candidate) =>
    Math.abs(candidate - midi) < Math.abs(best - midi) ? candidate : best
  );
}

function schedulePianoNote(ctx, destination, midi, startTime, duration) {
  const sampleMidi = nearestSampleMidi(midi);
  const buffer = pianoBuffers.get(sampleMidi);
  if (!buffer) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);

  const gain = ctx.createGain();
  const attack = 0.005;
  const holdEnd = startTime + Math.max(duration, 0.15);
  const releaseEnd = holdEnd + 0.3;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.9, startTime + attack);
  gain.gain.linearRampToValueAtTime(0.35, startTime + 0.15);
  gain.gain.linearRampToValueAtTime(0, releaseEnd);

  source.connect(gain);
  gain.connect(destination);

  source.start(startTime);
  source.stop(releaseEnd + 0.05);
}

// ---------- Render + exportación MP3 ----------

function setGenerateStatus(text) {
  document.getElementById("generate-status").textContent = text;
}

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function encodeToMp3(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
  const right = floatTo16BitPCM(audioBuffer.getChannelData(1));

  const encoder = new lamejs.Mp3Encoder(2, sampleRate, 128);
  const blockSize = 1152;
  const mp3Data = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const rightChunk = right.subarray(i, i + blockSize);
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }
  const end = encoder.flush();
  if (end.length > 0) mp3Data.push(end);

  return new Blob(mp3Data, { type: "audio/mp3" });
}

async function generateHarmony() {
  if (!detectedNotes.length) return;

  const generateBtn = document.getElementById("generate-btn");
  const downloadBtn = document.getElementById("download-btn");
  generateBtn.disabled = true;
  downloadBtn.hidden = true;

  try {
    setGenerateStatus("Cargando piano…");
    if (pianoBuffers.size === 0) await loadPianoSamples();

    const activeVoices = getActiveVoiceTypes();
    const muteMelody = document.getElementById("mute-melody").checked;

    const events = [];
    detectedNotes.forEach((note) => {
      if (!muteMelody) {
        events.push({ midi: note.midiNote, startTime: note.startTime, duration: note.duration });
      }
      activeVoices.forEach((voiceType) => {
        const harmonyMidi = transposeDiatonic(note.midiNote, VOICE_STEPS[voiceType]);
        events.push({ midi: harmonyMidi, startTime: note.startTime, duration: note.duration });
      });
    });

    if (!events.length) {
      setGenerateStatus("Selecciona al menos una voz de coro, o desactiva \"silenciar melodía\".");
      return;
    }

    const lastEnd = Math.max(...events.map((e) => e.startTime + e.duration));
    const totalSeconds = lastEnd + 1.0;
    const sampleRate = audioCtx.sampleRate;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalSeconds * sampleRate), sampleRate);

    events.forEach((e) => schedulePianoNote(offlineCtx, offlineCtx.destination, e.midi, e.startTime, e.duration));

    setGenerateStatus("Renderizando…");
    const renderedBuffer = await offlineCtx.startRendering();

    setGenerateStatus("Codificando MP3…");
    const blob = encodeToMp3(renderedBuffer);

    if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
    renderedBlobUrl = URL.createObjectURL(blob);

    const resultAudioEl = document.getElementById("result-audio");
    resultAudioEl.src = renderedBlobUrl;
    resultAudioEl.hidden = false;

    downloadBtn.href = renderedBlobUrl;
    downloadBtn.hidden = false;

    setGenerateStatus("Listo.");
  } catch (err) {
    setGenerateStatus(`Error: ${err.message}`);
  } finally {
    generateBtn.disabled = false;
  }
}

function setupGenerate() {
  document.getElementById("generate-btn").addEventListener("click", generateHarmony);
}

setupRecording();
setupFileUpload();
setupScaleControls();
setupGenerate();
