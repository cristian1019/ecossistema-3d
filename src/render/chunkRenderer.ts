import * as THREE from 'three';
import type { MeshBuffers } from '../world/mesher';
import { createTerrainMaterial, createWaterMaterial } from './materials';

/** Guarda as malhas de cada chunk (terreno opaco + água) e as troca quando o chunk muda. */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  /** textura da grama (1 byte por bloco), atualizada pela simulação */
  readonly grass: { value: THREE.DataTexture };
  private readonly terrainMat: THREE.Material;
  private readonly waterMat = createWaterMaterial(this.time);
  private readonly chunks = new Map<string, { opaque?: THREE.Mesh; water?: THREE.Mesh }>();
  quads = 0;

  constructor(private readonly chunkSize: number, sizeX: number, sizeZ: number) {
    this.group.name = 'terreno';
    // começa com toda a grama cheia (255) até a simulação mandar a primeira textura
    const tex = new THREE.DataTexture(new Uint8Array(sizeX * sizeZ).fill(255), sizeX, sizeZ, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.grass = { value: tex };
    this.terrainMat = createTerrainMaterial(this.grass, new THREE.Vector2(sizeX, sizeZ));
  }

  /** troca os dados da textura da grama (vindos do worker da simulação) */
  setGrass(bytes: Uint8Array): void {
    const tex = this.grass.value;
    (tex.image.data as Uint8Array).set(bytes);
    tex.needsUpdate = true;
  }

  get count(): number {
    return this.chunks.size;
  }

  setChunk(cx: number, cz: number, opaque: MeshBuffers | null, water: MeshBuffers | null): void {
    const key = `${cx},${cz}`;
    this.removeChunk(key);
    const entry: { opaque?: THREE.Mesh; water?: THREE.Mesh } = {};
    if (opaque) {
      entry.opaque = this.makeMesh(opaque, this.terrainMat, cx, cz);
      entry.opaque.castShadow = true;
      entry.opaque.receiveShadow = true;
      this.quads += opaque.quads;
    }
    if (water) {
      entry.water = this.makeMesh(water, this.waterMat, cx, cz);
      entry.water.receiveShadow = true;
      entry.water.renderOrder = 1; // água depois do terreno (é transparente)
      this.quads += water.quads;
    }
    this.chunks.set(key, entry);
  }

  private makeMesh(b: MeshBuffers, mat: THREE.Material, cx: number, cz: number): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(b.colors, 3, true));
    geo.setAttribute('aGrass', new THREE.BufferAttribute(b.grass, 1, true));
    geo.setIndex(new THREE.BufferAttribute(b.indices, 1));
    geo.computeBoundingSphere(); // usado pelo frustum culling (só desenha o que a câmera vê)
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    (mesh.userData as { quads: number }).quads = b.quads;
    this.group.add(mesh);
    return mesh;
  }

  private removeChunk(key: string): void {
    const e = this.chunks.get(key);
    if (!e) return;
    for (const m of [e.opaque, e.water]) {
      if (!m) continue;
      this.quads -= (m.userData as { quads: number }).quads;
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.chunks.delete(key);
  }

  clear(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
    this.quads = 0;
  }
}
