/**
 * Desenho das criaturas com InstancedMesh.
 *
 * Cada espécie é um "boneco" feito de cubos (corpo, cabeça, orelhas, pernas...).
 * Cada PARTE é um InstancedMesh com uma instância por criatura: 300 coelhos
 * custam 12 chamadas de desenho (uma por parte), não 3600.
 *
 * As posições chegam do worker ~20×/s; aqui interpolamos entre os dois últimos
 * quadros para o movimento ficar suave a 60 fps.
 */
import * as THREE from 'three';
import { FLAG, SNAP } from '../workers/simProtocol';

type ColorMode = 'body' | 'dark' | 'light' | number;
type Kind = 'none' | 'head' | 'legF' | 'legB' | 'ear' | 'male';

interface PartDef {
  size: [number, number, number];
  pos: [number, number, number];
  color: ColorMode;
  kind?: Kind;
  /** parte da cabeça: abaixa quando come/bebe */
  head?: boolean;
  /** desenhada também de longe (LOD): só corpo e cabeça */
  far?: boolean;
}

/** espelha uma parte no eixo Z (lado esquerdo/direito) */
const pair = (p: PartDef): PartDef[] => [p, { ...p, pos: [p.pos[0], p.pos[1], -p.pos[2]] }];

// Modelos virados para +X, em blocos, para um adulto de tamanho 1.
const RABBIT: PartDef[] = [
  { size: [0.8, 0.55, 0.55], pos: [0, 0.42, 0], color: 'body', far: true },
  { size: [0.42, 0.4, 0.4], pos: [0.5, 0.68, 0], color: 'body', head: true, far: true },
  ...pair({ size: [0.1, 0.42, 0.12], pos: [0.44, 1.08, 0.1], color: 'dark', head: true, kind: 'ear' }),
  ...pair({ size: [0.06, 0.08, 0.08], pos: [0.72, 0.74, 0.13], color: 0x1a1410, head: true }),
  { size: [0.05, 0.06, 0.08], pos: [0.73, 0.63, 0], color: 0xd98c8c, head: true },
  { size: [0.18, 0.18, 0.18], pos: [-0.46, 0.55, 0], color: 0xf3efe6 },
  ...pair({ size: [0.14, 0.22, 0.12], pos: [0.28, 0.11, 0.16], color: 'dark', kind: 'legF' }),
  ...pair({ size: [0.3, 0.2, 0.16], pos: [-0.22, 0.1, 0.2], color: 'dark', kind: 'legB' }),
];

const DEER: PartDef[] = [
  { size: [1.2, 0.55, 0.5], pos: [0, 1.0, 0], color: 'body', far: true },
  { size: [0.24, 0.6, 0.24], pos: [0.55, 1.4, 0], color: 'body', head: true, far: true },
  { size: [0.42, 0.28, 0.28], pos: [0.75, 1.75, 0], color: 'body', head: true, far: true },
  { size: [0.1, 0.14, 0.16], pos: [0.98, 1.72, 0], color: 0x2a1d14, head: true },
  ...pair({ size: [0.05, 0.07, 0.07], pos: [0.84, 1.82, 0.15], color: 0x15100c, head: true }),
  ...pair({ size: [0.08, 0.18, 0.14], pos: [0.62, 1.93, 0.15], color: 'dark', head: true, kind: 'ear' }),
  { size: [0.1, 0.2, 0.12], pos: [-0.63, 1.15, 0], color: 0xf0e6d8 },
  { size: [1.0, 0.12, 0.42], pos: [0, 0.74, 0], color: 'light' }, // barriga clara
  ...pair({ size: [0.13, 0.75, 0.13], pos: [0.45, 0.375, 0.16], color: 'dark', kind: 'legF' }),
  ...pair({ size: [0.13, 0.75, 0.13], pos: [-0.45, 0.375, 0.16], color: 'dark', kind: 'legB' }),
  // galhada: só nos machos
  ...pair({ size: [0.06, 0.42, 0.06], pos: [0.7, 2.08, 0.12], color: 0xd8c8a8, head: true, kind: 'male' }),
  ...pair({ size: [0.3, 0.06, 0.06], pos: [0.76, 2.22, 0.17], color: 0xd8c8a8, head: true, kind: 'male' }),
  ...pair({ size: [0.06, 0.16, 0.06], pos: [0.88, 2.32, 0.17], color: 0xd8c8a8, head: true, kind: 'male' }),
];

const WOLF: PartDef[] = [
  { size: [1.1, 0.5, 0.46], pos: [0, 0.78, 0], color: 'body', far: true },
  { size: [0.42, 0.38, 0.36], pos: [0.68, 0.98, 0], color: 'body', head: true, far: true },
  { size: [0.26, 0.18, 0.2], pos: [0.95, 0.9, 0], color: 'light', head: true }, // focinho
  { size: [0.06, 0.06, 0.18], pos: [1.08, 0.94, 0], color: 0x1b1b1d, head: true }, // nariz
  ...pair({ size: [0.05, 0.06, 0.06], pos: [0.88, 1.04, 0.11], color: 0xe6c04a, head: true }), // olhos amarelos
  ...pair({ size: [0.08, 0.2, 0.11], pos: [0.6, 1.24, 0.11], color: 'dark', head: true, kind: 'ear' }),
  { size: [0.9, 0.1, 0.38], pos: [0, 0.54, 0], color: 'light' }, // barriga
  { size: [0.5, 0.15, 0.15], pos: [-0.76, 0.82, 0], color: 'dark' }, // rabo
  ...pair({ size: [0.13, 0.55, 0.13], pos: [0.38, 0.275, 0.15], color: 'dark', kind: 'legF' }),
  ...pair({ size: [0.13, 0.55, 0.13], pos: [-0.38, 0.275, 0.15], color: 'dark', kind: 'legB' }),
];

const FOX: PartDef[] = [
  { size: [0.85, 0.38, 0.34], pos: [0, 0.55, 0], color: 'body', far: true },
  { size: [0.32, 0.3, 0.3], pos: [0.54, 0.72, 0], color: 'body', head: true, far: true },
  { size: [0.24, 0.13, 0.15], pos: [0.76, 0.66, 0], color: 'light', head: true }, // focinho claro
  { size: [0.05, 0.05, 0.08], pos: [0.88, 0.69, 0], color: 0x161210, head: true },
  ...pair({ size: [0.05, 0.05, 0.05], pos: [0.7, 0.78, 0.09], color: 0x161210, head: true }),
  ...pair({ size: [0.07, 0.2, 0.1], pos: [0.49, 0.95, 0.09], color: 0x2a1c14, head: true, kind: 'ear' }),
  { size: [0.14, 0.26, 0.26], pos: [0.42, 0.5, 0], color: 0xf2ece2 }, // peito branco
  { size: [0.55, 0.2, 0.2], pos: [-0.66, 0.6, 0], color: 'body' }, // rabo felpudo
  { size: [0.16, 0.18, 0.18], pos: [-0.98, 0.6, 0], color: 0xf2ece2 }, // ponta branca
  ...pair({ size: [0.1, 0.36, 0.1], pos: [0.28, 0.18, 0.11], color: 0x2a1c14, kind: 'legF' }),
  ...pair({ size: [0.1, 0.36, 0.1], pos: [-0.28, 0.18, 0.11], color: 0x2a1c14, kind: 'legB' }),
];

/** altura da cabeça (para a câmera "olhos do bicho") e do marcador, por espécie */
export const HEAD_HEIGHT = [0.75, 1.85, 1.05, 0.78];
const MARKER_TOP = [1.3, 2.6, 1.5, 1.2];
/** quanto a cabeça desce ao comer/beber */
const HEAD_DROP = [0.22, 0.75, 0.45, 0.3];

/** modelo + escala base de cada espécie (índice = Species) */
const SPECIES_MODELS: { parts: PartDef[]; scale: number; shadow: number }[] = [
  { parts: RABBIT, scale: 0.6, shadow: 0.7 },
  { parts: DEER, scale: 1.0, shadow: 1.5 },
  { parts: WOLF, scale: 0.95, shadow: 1.3 },
  { parts: FOX, scale: 0.75, shadow: 0.9 },
];

const MAX = 2000;

interface SpeciesMeshes {
  meshes: THREE.InstancedMesh[];
  /** id da criatura desenhada em cada instância (para o clique) */
  ids: Int32Array;
  count: number;
  /** quantas instâncias cada parte tem neste quadro (parte longe/escondida não entra) */
  partCount: Int32Array;
}

export interface CreaturePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  species: number;
}

export class CreatureRenderer {
  readonly group = new THREE.Group();
  private readonly species: SpeciesMeshes[] = [];
  private readonly shadows: THREE.InstancedMesh;
  private readonly marker: THREE.Mesh;

  private cur: Float32Array = new Float32Array(0);
  private curCount = 0;
  private prev: Float32Array = new Float32Array(0);
  private prevIndex = new Map<number, number>();
  private frameAt = 0;
  private interval = 50;

  /** pose interpolada da criatura acompanhada (seguir / olhos do bicho) */
  readonly tracked: CreaturePose = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, species: 0 };
  trackedVisible = false;

  // objetos reaproveitados (evita criar lixo a cada quadro)
  private readonly m = new THREE.Matrix4();
  private readonly base = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    for (const model of SPECIES_MODELS) {
      const meshes = model.parts.map(() => {
        const im = new THREE.InstancedMesh(box, mat, MAX);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, new THREE.Color());
        im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        im.count = 0;
        im.frustumCulled = false; // as instâncias se espalham pelo mapa todo
        im.receiveShadow = true;
        this.group.add(im);
        return im;
      });
      this.species.push({ meshes, ids: new Int32Array(MAX), count: 0, partCount: new Int32Array(model.parts.length) });
    }

    // sombra "blob": um quadrado com degradê escuro sob cada bicho (barato e fica bonito)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
    }), MAX);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 2;
    this.group.add(this.shadows);

    // marcador sobre a criatura selecionada: um losango verde girando
    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshBasicMaterial({ color: 0x9be15d }),
    );
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  /** chega um quadro novo do worker */
  pushFrame(buf: Float32Array, count: number, now: number): void {
    this.prev = this.cur;
    this.prevIndex.clear();
    for (let k = 0; k < this.curCount; k++) this.prevIndex.set(this.prev[k * SNAP.STRIDE + SNAP.ID], k);
    this.cur = buf;
    this.curCount = count;
    if (this.frameAt > 0) this.interval = this.interval * 0.8 + Math.min(200, now - this.frameAt) * 0.2;
    this.frameAt = now;
  }

  /**
   * Monta as matrizes de todas as instâncias.
   * @param smooth interpolar entre quadros (desligado nas velocidades altas)
   * @param animate animar pernas/orelhas
   */
  update(now: number, time: number, smooth: boolean, animate: boolean, selectedId: number | null, hideId: number | null, camera: THREE.Camera): void {
    const alpha = smooth ? Math.min(1, (now - this.frameAt) / this.interval) : 1;
    for (const sp of this.species) { sp.count = 0; sp.partCount.fill(0); }
    let shadowCount = 0;
    this.trackedVisible = false;
    const S = SNAP.STRIDE, buf = this.cur, prev = this.prev;
    // só monta quem a câmera vê (frustum culling) e simplifica quem está longe (LOD)
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const FAR2 = 90 * 90;

    for (let k = 0; k < this.curCount; k++) {
      const o = k * S;
      const id = buf[o + SNAP.ID];
      let x = buf[o + SNAP.X], y = buf[o + SNAP.Y], z = buf[o + SNAP.Z], yaw = buf[o + SNAP.YAW];
      const pk = alpha < 1 ? this.prevIndex.get(id) : undefined;
      if (pk !== undefined) {
        const p = pk * S;
        x = prev[p + SNAP.X] + (x - prev[p + SNAP.X]) * alpha;
        y = prev[p + SNAP.Y] + (y - prev[p + SNAP.Y]) * alpha;
        z = prev[p + SNAP.Z] + (z - prev[p + SNAP.Z]) * alpha;
        let dy = yaw - prev[p + SNAP.YAW];
        dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // menor ângulo
        yaw = prev[p + SNAP.YAW] + dy * alpha;
      }
      const species = buf[o + SNAP.SPECIES];
      const model = SPECIES_MODELS[species];
      const sp = this.species[species];
      if (!model || !sp) continue;
      const scale = buf[o + SNAP.SCALE] * model.scale;

      if (id === selectedId) {
        const t = this.tracked;
        t.x = x; t.y = y; t.z = z; t.yaw = yaw; t.scale = scale; t.species = species;
        this.trackedVisible = true;
      }
      if (id === hideId) continue;
      this.sphere.center.set(x, y + scale, z);
      this.sphere.radius = 2 * scale + 0.5;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const far = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 > FAR2;

      const flags = buf[o + SNAP.FLAGS];
      const speed = buf[o + SNAP.SPEED];
      const sleeping = (flags & FLAG.SLEEP) !== 0;
      const headDown = (flags & (FLAG.EAT | FLAG.DRINK | FLAG.NURSE)) !== 0;
      const lunge = (flags & FLAG.ATTACK) !== 0;
      const male = (flags & FLAG.MALE) !== 0;
      // passada: fase avança com a velocidade; cada bicho tem sua própria fase (id)
      const anim = animate && !far;
      const phase = anim ? time * (4 + speed * 2.2) + id * 1.7 : 0;
      const stride = anim && !sleeping ? Math.min(1, speed / 2.5) : 0;
      const bob = species === 0 ? Math.abs(Math.sin(phase)) * 0.18 * stride : 0; // coelho saltita

      // matriz base: posição, rotação (yaw) e escala do bicho
      this.q.setFromAxisAngle(this.up, -yaw);
      this.v.set(x, y + bob * scale - (sleeping ? 0.12 * scale : 0), z);
      this.s.set(scale, sleeping ? scale * 0.8 : scale, scale);
      this.base.compose(this.v, this.q, this.s);

      sp.ids[sp.count++] = id;
      this.c.setHex(buf[o + SNAP.COLOR]);

      const parts = model.parts;
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        if (far && !part.far) continue;
        if (part.kind === 'male' && !male) continue;
        if (sleeping && (part.kind === 'legF' || part.kind === 'legB')) continue;
        const mesh = sp.meshes[pi];
        const n = sp.partCount[pi]++;
        let px = part.pos[0], py = part.pos[1];
        if (part.head && headDown) { px += 0.12; py -= HEAD_DROP[species]; }
        if (part.head && lunge) { px += 0.25; py -= 0.1; } // bote: a cabeça avança
        if (part.head && sleeping) { py -= species === 0 ? 0.1 : 0.45; }
        const w = part.size[0], h = part.size[1], d = part.size[2];
        if (part.kind === 'legF' || part.kind === 'legB') {
          // perna gira em torno do quadril (topo da perna)
          const side = part.pos[2] > 0 ? 0 : Math.PI * 0.5;
          const ang = stride === 0 ? 0 : Math.sin(phase + (part.kind === 'legB' ? Math.PI : 0) + side) * 0.6 * stride;
          this.local.makeTranslation(px, py + h / 2, part.pos[2]);
          if (ang !== 0) { this.tmp.makeRotationAxis(this.zAxis, ang); this.local.multiply(this.tmp); }
          this.tmp.makeTranslation(0, -h / 2, 0);
          this.local.multiply(this.tmp);
        } else if (part.kind === 'ear' && anim) {
          this.local.makeTranslation(px, py, part.pos[2]);
          this.tmp.makeRotationAxis(this.zAxis, Math.sin(time * 3 + id) * 0.12);
          this.local.multiply(this.tmp);
        } else {
          this.local.makeTranslation(px, py, part.pos[2]);
        }
        this.tmp.makeScale(w, h, d);
        this.local.multiply(this.tmp);
        this.m.multiplyMatrices(this.base, this.local);
        mesh.setMatrixAt(n, this.m);

        if (part.color === 'body') mesh.setColorAt(n, this.c);
        else if (part.color === 'dark') mesh.setColorAt(n, this.c2.copy(this.c).multiplyScalar(0.72));
        else if (part.color === 'light') mesh.setColorAt(n, this.c2.copy(this.c).lerp(WHITE, 0.45));
        else mesh.setColorAt(n, this.c2.setHex(part.color));
      }

      // sombra no chão
      const ss = scale * model.shadow;
      this.m.makeScale(ss * 1.3, 1, ss);
      this.tmp.makeRotationY(-yaw);
      this.m.premultiply(this.tmp);
      this.m.setPosition(x, y + 0.02, z);
      this.shadows.setMatrixAt(shadowCount++, this.m);
    }

    for (const sp of this.species) {
      sp.meshes.forEach((mesh, pi) => {
        mesh.count = sp.partCount[pi];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
    this.shadows.count = shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;

    // marcador da selecionada
    this.marker.visible = this.trackedVisible && hideId === null;
    if (this.marker.visible) {
      const t = this.tracked;
      const top = MARKER_TOP[t.species] ?? 2;
      this.marker.position.set(t.x, t.y + t.scale * top + 0.5 + Math.sin(time * 3) * 0.12, t.z);
      this.marker.rotation.y = time * 2;
    }
  }

  /** Clique: devolve o id da criatura atingida pelo raio (ou null). */
  pick(ray: THREE.Raycaster): number | null {
    let best: { d: number; id: number } | null = null;
    this.species.forEach((sp) => {
      // testa o corpo (a instância n do corpo é a criatura sp.ids[n])
      for (const mesh of sp.meshes.slice(0, 1)) {
        if (mesh.count === 0) continue;
        mesh.boundingSphere = null; // recalcula com as posições atuais
        mesh.computeBoundingSphere();
        const hits = ray.intersectObject(mesh, false);
        for (const h of hits) {
          if (h.instanceId === undefined) continue;
          if (!best || h.distance < best.d) best = { d: h.distance, id: sp.ids[h.instanceId] };
        }
      }
    });
    return best ? (best as { d: number; id: number }).id : null;
  }

  /** existe essa criatura no último quadro? */
  has(id: number): boolean {
    for (let k = 0; k < this.curCount; k++) if (this.cur[k * SNAP.STRIDE + SNAP.ID] === id) return true;
    return false;
  }
}

const WHITE = new THREE.Color(0xffffff);
