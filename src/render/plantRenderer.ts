/**
 * Arbustos (com frutas vermelhas quando estão produzindo), também com InstancedMesh.
 * A grama não é desenhada aqui: ela pinta o próprio chão pelo shader do terreno.
 */
import * as THREE from 'three';
import { BUSH_STRIDE, CARCASS_STRIDE } from '../workers/simProtocol';

const MAX = 4096;
/** posições das (até 4) frutas em volta da copa */
const FRUIT_POS: [number, number, number][] = [
  [0.36, 0.55, 0.12], [-0.2, 0.68, 0.36], [-0.3, 0.45, -0.28], [0.15, 0.78, -0.3],
];

export class PlantRenderer {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly top: THREE.InstancedMesh;
  private readonly fruit: THREE.InstancedMesh;
  /** carcaças: um bloco vermelho-escuro achatado que encolhe conforme é comido */
  private readonly carcass: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    this.body = new THREE.InstancedMesh(box, mat, MAX);
    this.top = new THREE.InstancedMesh(box, mat, MAX);
    this.fruit = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xd8342c, emissive: 0x3a0606 }), MAX * 4);
    this.carcass = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0x6e1f1a }), 512);
    for (const im of [this.body, this.top, this.fruit, this.carcass]) {
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      this.group.add(im);
    }
    this.body.setColorAt(0, this.c);
    this.top.setColorAt(0, this.c);
  }

  /** recebe a lista de arbustos do worker: [x, y, z, crescimento, frutas] × n */
  set(bushes: Float32Array): void {
    const n = Math.min(MAX, bushes.length / BUSH_STRIDE);
    let nf = 0;
    for (let k = 0; k < n; k++) {
      const o = k * BUSH_STRIDE;
      const x = bushes[o] + 0.5, y = bushes[o + 1], z = bushes[o + 2] + 0.5;
      const g = bushes[o + 3], fruits = bushes[o + 4];
      const s = 0.35 + 0.6 * g;
      // tom de verde varia por posição (cada arbusto um pouco diferente)
      const hue = ((x * 13.1 + z * 7.7) % 10) / 10;
      this.c.setRGB(0.18 + 0.06 * hue, 0.42 + 0.12 * hue, 0.16);
      this.m.makeScale(0.9 * s, 0.6 * s, 0.9 * s).setPosition(x, y + 0.3 * s, z);
      this.body.setMatrixAt(k, this.m);
      this.body.setColorAt(k, this.c);
      this.c.multiplyScalar(1.15);
      this.m.makeScale(0.6 * s, 0.4 * s, 0.6 * s).setPosition(x + 0.05, y + 0.75 * s, z - 0.04);
      this.top.setMatrixAt(k, this.m);
      this.top.setColorAt(k, this.c);
      for (let f = 0; f < fruits && f < 4; f++) {
        const p = FRUIT_POS[f];
        this.m.makeScale(0.16, 0.16, 0.16).setPosition(x + p[0] * s, y + p[1] * s, z + p[2] * s);
        this.fruit.setMatrixAt(nf++, this.m);
      }
    }
    this.body.count = this.top.count = n;
    this.fruit.count = nf;
    for (const im of [this.body, this.top, this.fruit]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  setCarcasses(data: Float32Array): void {
    const n = Math.min(512, data.length / CARCASS_STRIDE);
    for (let k = 0; k < n; k++) {
      const o = k * CARCASS_STRIDE;
      const big = data[o + 4] === 1 ? 1.4 : 0.7; // cervo é maior
      const s = big * (0.4 + 0.6 * data[o + 3]);
      this.m.makeScale(s, 0.25 * s, 0.6 * s).setPosition(data[o], data[o + 1] + 0.12 * s, data[o + 2]);
      this.carcass.setMatrixAt(k, this.m);
    }
    this.carcass.count = n;
    this.carcass.instanceMatrix.needsUpdate = true;
  }

  get count(): number {
    return this.body.count;
  }
}
