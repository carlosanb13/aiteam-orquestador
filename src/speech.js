// Dictado sin internet: transcripción local con Whisper sobre sherpa-onnx (el mismo motor que usa Orca).
// Los modelos se descargan una vez a data/speech-models y después todo funciona sin conexión.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { execFile } from 'node:child_process';
import { DATA_DIR, loadConfig } from './config.js';

const require = createRequire(import.meta.url);
const MODELS_DIR = path.join(DATA_DIR, 'speech-models');
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 28; // Whisper procesa como mucho ~30 s de audio por pasada

export const MODELS = [
  { id: 'tiny', label: 'Whisper tiny', size: '116 MB', note: 'El más rápido; precisión básica' },
  { id: 'base', label: 'Whisper base', size: '208 MB', note: 'Recomendado: buen equilibrio' },
  { id: 'small', label: 'Whisper small', size: '640 MB', note: 'El más preciso; más lento' },
];

// Frases que Whisper "alucina" con silencio o ruido (aprendidas de subtítulos).
const HALLUCINATIONS = [/amara\.org/i, /subt[ií]tulos (realizados|por)/i, /^gracias( por ver)?\.?$/i, /suscr[ií]bete/i, /^\W*$/];

const events = new EventEmitter();
export const onSpeechChange = (fn) => events.on('change', fn);
const downloads = new Map(); // id -> { received, total, phase, error }
let recognizer = null; // { key, rec }
let engineError = null;

function engine() {
  try {
    return require('sherpa-onnx-node');
  } catch (err) {
    engineError = `No se pudo cargar el motor de voz (sherpa-onnx-node): ${err.message}. Ejecuta "npm install" en la carpeta de AITeam.`;
    return null;
  }
}

const modelDir = (id) => path.join(MODELS_DIR, id);

function modelFiles(id) {
  const dir = modelDir(id);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const pick = (part) => files.find((f) => f.includes(part) && f.endsWith('.int8.onnx')) ?? files.find((f) => f.includes(part) && f.endsWith('.onnx'));
  const encoder = pick('encoder');
  const decoder = pick('decoder');
  const tokens = files.find((f) => f.endsWith('tokens.txt'));
  if (!encoder || !decoder || !tokens) return null;
  return { encoder: path.join(dir, encoder), decoder: path.join(dir, decoder), tokens: path.join(dir, tokens) };
}

export function speechStatus() {
  const cfg = loadConfig().speech ?? {};
  const available = Boolean(engine());
  return {
    engine: cfg.engine ?? 'browser',
    model: cfg.model ?? 'base',
    language: cfg.language ?? 'es',
    available,
    error: available ? null : engineError,
    models: MODELS.map((m) => ({
      ...m,
      installed: Boolean(modelFiles(m.id)),
      download: downloads.get(m.id) ?? null,
    })),
  };
}

function emit() {
  events.emit('change', speechStatus());
}

/** Descarga y descomprime un modelo (una sola vez). El progreso se emite como evento. */
export async function downloadModel(id) {
  if (!MODELS.some((m) => m.id === id)) throw new Error('Modelo desconocido.');
  if (downloads.has(id) && !downloads.get(id).error) throw new Error('Ese modelo ya se está descargando.');
  if (modelFiles(id)) return speechStatus();
  const state = { received: 0, total: 0, phase: 'descargando', error: null };
  downloads.set(id, state);
  emit();

  // Sin await: la descarga sigue en segundo plano y la interfaz recibe el progreso por eventos.
  (async () => {
    const tmp = path.join(MODELS_DIR, `${id}.download`);
    const archive = path.join(tmp, `${id}.tar.bz2`);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      const res = await fetch(`${RELEASE}/sherpa-onnx-whisper-${id}.tar.bz2`);
      if (!res.ok || !res.body) throw new Error(`La descarga falló (HTTP ${res.status}).`);
      state.total = Number(res.headers.get('content-length')) || 0;
      let lastEmit = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          state.received += chunk.length;
          if (Date.now() - lastEmit > 400) {
            lastEmit = Date.now();
            emit();
          }
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(archive));

      state.phase = 'descomprimiendo';
      emit();
      // tar viene con Windows 10/11 y entiende .tar.bz2. Se usa el de System32: el de Git confunde "C:" con un host remoto.
      const systemTar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      const tarBin = fs.existsSync(systemTar) ? systemTar : 'tar';
      await new Promise((resolve, reject) =>
        execFile(tarBin, ['-xjf', archive, '-C', tmp], { windowsHide: true, maxBuffer: 1 << 20 }, (err, _o, stderr) =>
          err ? reject(new Error(`No se pudo descomprimir: ${stderr || err.message}`)) : resolve(),
        ),
      );
      const extracted = fs.readdirSync(tmp).map((f) => path.join(tmp, f)).find((p) => fs.statSync(p).isDirectory());
      if (!extracted) throw new Error('El archivo descargado no contiene el modelo.');
      // Solo se conservan las versiones int8 (más pequeñas y rápidas) y los tokens.
      for (const f of fs.readdirSync(extracted)) {
        const keep = f.endsWith('.int8.onnx') || f.endsWith('tokens.txt');
        if (!keep) fs.rmSync(path.join(extracted, f), { recursive: true, force: true });
      }
      fs.rmSync(modelDir(id), { recursive: true, force: true });
      fs.renameSync(extracted, modelDir(id));
      fs.rmSync(tmp, { recursive: true, force: true });
      downloads.delete(id);
    } catch (err) {
      state.error = err.message;
      state.phase = 'error';
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    emit();
  })();
  return speechStatus();
}

export function deleteModel(id) {
  if (recognizer?.key.startsWith(`${id}:`)) recognizer = null;
  fs.rmSync(modelDir(id), { recursive: true, force: true });
  downloads.delete(id);
  emit();
  return speechStatus();
}

async function getRecognizer() {
  const { model = 'base', language = 'es' } = loadConfig().speech ?? {};
  const files = modelFiles(model);
  if (!files) throw new Error(`El modelo ${model} no está descargado. Descárgalo en Ajustes → Dictado por voz.`);
  const key = `${model}:${language}`;
  if (recognizer?.key === key) return recognizer.rec;
  const sherpa = engine();
  if (!sherpa) throw new Error(engineError);
  const rec = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: files.encoder, decoder: files.decoder, language: language === 'auto' ? '' : language, task: 'transcribe' },
      tokens: files.tokens,
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
    },
  });
  recognizer = { key, rec };
  return rec;
}

/**
 * Corta el audio en ventanas de hasta WINDOW_SECONDS, buscando el punto más silencioso
 * en los últimos segundos de cada ventana para no partir palabras (mismo enfoque que Orca).
 */
function splitWindows(samples) {
  const limit = WINDOW_SECONDS * SAMPLE_RATE;
  const search = 4 * SAMPLE_RATE;
  const win = Math.round(0.1 * SAMPLE_RATE);
  const out = [];
  let start = 0;
  while (samples.length - start > limit) {
    const end = start + limit;
    let best = end;
    let bestEnergy = Infinity;
    for (let s = end - search; s + win <= end; s += win / 2) {
      let e = 0;
      for (let i = s; i < s + win; i++) e += samples[i] * samples[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = s + win / 2;
      }
    }
    out.push(samples.subarray(start, best));
    start = best;
  }
  out.push(samples.subarray(start));
  return out;
}

// Whisper no conoce los nombres propios del equipo: se corrigen las confusiones habituales.
const NAME_FIXES = [
  // "acodecs" ("a Codex" pegado) conserva la preposición.
  [/\b(a)?(?:c[oó]dex|codecs?|k[oó]dex|c[oó]decs|codesk?)\b/gi, (_m, a) => `${a ? 'a ' : ''}Codex`],
  [/\b(?:claud|clode|clod|clau|cloud|klaus|proud|cloude|clóud)\b/gi, 'Claude'],
  [/\b(?:anti\s?gravit[iy]|antigravedad|anti\s?gravity|antigr[aá]biti)\b/gi, 'Antigravity'],
  [/\b(?:ai\s?team|ei\s?ai\s?tim|a\s?i\s?tim|aitim|eitim|ay\s?team)\b/gi, 'AITeam'],
  [/\bchat\s?(?:g\s?p\s?t|yipiti|yi\s?pi\s?ti|gepeté)\b/gi, 'ChatGPT'],
];

function fixNames(text) {
  let out = text;
  for (const [re, name] of NAME_FIXES) out = out.replace(re, name);
  // Tras "a" pegada al nombre: "acodecs" → "a Codex".
  return out.replace(/\ba(Codex|Claude|Antigravity)\b/g, 'a $1');
}

/** Transcribe audio mono de 16 kHz (Float32). */
export async function transcribe(samples) {
  if (!samples.length) return '';
  const rec = await getRecognizer();
  const parts = [];
  for (const chunk of splitWindows(samples)) {
    const stream = rec.createStream();
    // Un poco de silencio al final ayuda a Whisper a cerrar la última palabra.
    const padded = new Float32Array(chunk.length + SAMPLE_RATE / 2);
    padded.set(chunk);
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: padded });
    const result = await rec.decodeAsync(stream);
    const text = String(result?.text ?? '').trim();
    if (text && !HALLUCINATIONS.some((re) => re.test(text))) parts.push(text);
  }
  return fixNames(parts.join(' '));
}
