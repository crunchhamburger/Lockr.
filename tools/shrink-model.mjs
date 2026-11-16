// Web-size a textured Hunyuan3D model: textures to 1024px WebP, calmer material.
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp
//   node tools/shrink-model.mjs raw.glb app/public/models/reg.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const t of doc.getRoot().listTextures()) {
  const buf = Buffer.from(t.getImage());
  const meta = await sharp(buf).metadata();
  console.log(' texture', t.getMimeType(), meta.format, meta.width, meta.height, buf.length);
  t.setImage(await sharp(buf).resize(1024, 1024, { fit: 'inside' }).webp({ quality: 82 }).toBuffer()).setMimeType('image/webp');
}
// The generated metal map makes glass and stone read as chrome under studio light: keep roughness, cap the metal.
for (const m of doc.getRoot().listMaterials()) { m.setMetallicFactor(Math.min(m.getMetallicFactor(), 0.25)); console.log(' material', m.getName(), m.getMetallicFactor(), m.getRoughnessFactor()); }
await doc.transform(dedup(), prune());
await io.write(out, doc);
