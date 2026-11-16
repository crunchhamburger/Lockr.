#!/usr/bin/env node
// Turn one photograph of a building into a textured 3D model with Tencent's Hunyuan3D-2,
// through its public demo on Hugging Face (no GPU needed here).
//
//   node tools/hunyuan3d.mjs <photo.jpg> <out.glb> [--v21] [--shape-only] [--seed 1234] [--steps 30]
//
// The free demo gives each visitor a small daily GPU allowance. Set HF_TOKEN to a Hugging Face
// token to use your own account's allowance instead of the anonymous one.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), flag = n => args.includes('--' + n), opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const [photo, out] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(seed|steps|space)$/));
if (!photo || !out) { console.error('usage: node tools/hunyuan3d.mjs <photo.jpg> <out.glb> [--shape-only] [--seed n] [--steps n]'); process.exit(2); }

const BASE = opt('space', flag('v21') ? 'https://tencent-hunyuan3d-2-1.hf.space' : 'https://tencent-hunyuan3d-2.hf.space');
const endpoint = flag('shape-only') ? 'shape_generation' : 'generation_all';
const auth = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};

async function upload(file) {
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form, headers: auth });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

// The demo's queue: join it, then read its event stream until the run completes.
// The two demos number their functions differently. 2.1 (--v21) makes textured models; its first input is unused.
const FN = BASE.includes('2-1') ? { shape_generation: 2, generation_all: 5 } : { shape_generation: 5, generation_all: 8 };
async function call(name, data) {
  const session_hash = Math.random().toString(36).slice(2);
  const res = await fetch(`${BASE}/queue/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ data, fn_index: FN[name], session_hash }) });
  if (!res.ok) throw new Error(`${name} was refused: ${res.status} ${await res.text()}`);
  const stream = await fetch(`${BASE}/queue/data?session_hash=${session_hash}`, { headers: auth });
  let buf = '';
  for await (const chunk of stream.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const msg = JSON.parse(line.slice(5));
      if (msg.msg === 'estimation' && msg.rank != null) console.error(`in the queue, place ${msg.rank + 1}`);
      if (msg.msg === 'process_completed') {
        if (!msg.success) throw new Error(`${name} failed: ${msg.output?.error || JSON.stringify(msg.output)}`);
        return msg.output.data;
      }
    }
  }
  throw new Error(`${name} ended without a result`);
}

const remote = await upload(photo);
console.error(`uploaded ${photo}; running ${endpoint} (this takes one to three minutes)`);
const file = { path: remote, meta: { _type: 'gradio.FileData' } };
// caption, image, four multi-view slots, steps, guidance, seed, octree resolution, remove background, chunks, random seed
const result = await call(endpoint, [null, file, null, null, null, null, +opt('steps', 30), 5, +opt('seed', 1234), 256, true, 8000, false]);
const mesh = flag('shape-only') ? result[0] : result[1];
const url = mesh?.url || (mesh?.path && `${BASE}/file=${mesh.path}`) || (mesh?.value?.path && `${BASE}/file=${mesh.value.path}`);
if (!url) throw new Error('no model in the result: ' + JSON.stringify(result).slice(0, 400));
const glb = await fetch(url, { headers: auth });
if (!glb.ok) throw new Error(`download failed: ${glb.status}`);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.from(await glb.arrayBuffer()));
console.error(`saved ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
