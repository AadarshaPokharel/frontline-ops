import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CharacterKit } from './character.js';

const BASE = import.meta.env.BASE_URL;
export const MODEL_KEYS = ['crate', 'ammo', 'barrel', 'barrier', 'jerrycan'];

// Bake a glTF scene into plain float geometries sitting on y=0 and centred on x/z, ready for InstancedMesh.
// (Meshopt files use quantized attributes, which cannot be transformed in place.)
function normalize(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3());
  const parts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const src = o.geometry, g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      const out = new Float32Array(attr.count * attr.itemSize), get = [attr.getX, attr.getY, attr.getZ, attr.getW];
      for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = get[k].call(attr, i);
      g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    if (src.index) g.setIndex(Array.from(src.index.array));
    g.applyMatrix4(o.matrixWorld);
    g.translate(-center.x, -box.min.y, -center.z);
    g.computeBoundingSphere();
    parts.push({ geometry: g, material: o.material });
  });
  return { parts, size: box.getSize(new THREE.Vector3()) };
}

export class Assets {
  constructor(renderer) {
    this.models = {};
    this.textureSets = new Map();
    this.gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.textures = new THREE.TextureLoader();
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  async loadModels(onProgress) {
    let done = 0;
    await Promise.all(MODEL_KEYS.map(async key => {
      const gltf = await this.gltf.loadAsync(`${BASE}models/${key}.glb`);
      this.models[key] = normalize(gltf.scene);
      onProgress?.(++done / MODEL_KEYS.length);
    }));
  }

  // Human characters (tools/build-characters.mjs). If they are not installed the game uses built-in soldiers.
  async loadCharacters() {
    try {
      const [male, female, anims] = await Promise.all(['soldier_m', 'soldier_f', 'animations'].map(n => this.gltf.loadAsync(`${BASE}characters/${n}.glb`)));
      this.characters = new CharacterKit([male, female], anims);
    } catch (err) {
      console.info(`Character models unavailable (${err.message}); using built-in soldiers.`);
      this.characters = null;
    }
    return this.characters;
  }

  // A Three.js object built from a model's parts (shares geometry and materials with every other copy).
  instance(key, castShadow = true) {
    const group = new THREE.Group();
    for (const { geometry, material } of this.models[key].parts) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = castShadow;
      group.add(mesh);
    }
    return group;
  }

  // Floor/wall texture set: colour, normal and roughness maps. Loaded once and cached.
  textureSet(name) {
    if (!this.textureSets.has(name)) {
      const load = (suffix, srgb) => this.textures.loadAsync(`${BASE}textures/${name}_${suffix}.webp`).then(t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.anisotropy;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
      this.textureSets.set(name, Promise.all([load('diff', true), load('nor', false), load('rough', false)])
        .then(([map, normalMap, roughnessMap]) => ({ map, normalMap, roughnessMap })));
    }
    return this.textureSets.get(name);
  }
}
