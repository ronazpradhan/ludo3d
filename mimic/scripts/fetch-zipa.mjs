// Puts Mimic's word judge into dist/mimic/client (runs as part of `npm run build`):
//
//   zipa/<rev>/model.int8.onnx   the ZIPA small CTC phone recogniser (70 MB, int8), downloaded once from its
//                                official Hugging Face release into mimic/sounds/.cache (never committed).
//                                ZIPA: Zhu et al., ACL 2025, https://github.com/lingjzhu/zipa (weights CC BY 4.0).
//
// The path carries the model's revision, so browsers can cache it for good. Keep ZIPA_REV in step with
// mimic/client/src/lib/judge.ts. (The onnxruntime-web runtime is bundled by Vite.)
import { copyFileSync, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ZIPA_REV = 'dfe87c97662606fa6db90ad06f627d4363314744';
const MODEL_URL = `https://huggingface.co/anyspeech/zipa-small-crctc-500k/resolve/${ZIPA_REV}/model.int8.onnx`;
const MODEL_BYTES = 70_677_672;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

export async function fetchZipa({ cacheDir = path.join(here, '..', 'sounds', '.cache'), publicDir = path.join(root, 'dist', 'mimic', 'client'), log = console.log } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `zipa-${ZIPA_REV.slice(0, 8)}.int8.onnx`);
  if (!existsSync(cached) || statSync(cached).size !== MODEL_BYTES) {
    log('Mimic word judge: downloading the ZIPA model (70 MB)…');
    const res = await fetch(MODEL_URL);
    if (!res.ok || !res.body) throw new Error(`ZIPA model: HTTP ${res.status}`);
    const tmp = `${cached}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    if (statSync(tmp).size !== MODEL_BYTES) throw new Error('ZIPA model: download incomplete');
    renameSync(tmp, cached);
  }
  const modelDir = path.join(publicDir, 'zipa', ZIPA_REV.slice(0, 8));
  mkdirSync(modelDir, { recursive: true });
  copyFileSync(cached, path.join(modelDir, 'model.int8.onnx'));
  log(`Mimic word judge: ZIPA ${ZIPA_REV.slice(0, 8)} ready`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  fetchZipa().catch(err => {
    // Without the judge the game still works: everyone is scored without the words part.
    console.warn(`Mimic word judge unavailable: ${err.message}`);
  });
}
