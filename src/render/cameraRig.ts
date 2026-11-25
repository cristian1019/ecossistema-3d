/**
 * Câmera com dois modos:
 *  - Órbita: gira em volta de um ponto (botão esquerdo), arrasta (botão direito),
 *    zoom (roda). WASD move o ponto de foco pelo mapa.
 *  - Voo livre: arraste com o mouse para olhar, WASD para andar, Espaço/Q para subir
 *    e descer, Shift para acelerar.
 * Nos dois modos a câmera não atravessa o chão nem sai muito do mapa.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type CameraMode = 'orbit' | 'fly';

export class CameraRig {
  mode: CameraMode = 'orbit';
  readonly orbit: OrbitControls;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  flySpeed = 30;
  /** altura do chão (ou da água) em x,z; vem do mapa gerado */
  groundAt: (x: number, z: number) => number = () => 0;
  onModeChange: (m: CameraMode) => void = () => {};

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly sizeX: number,
    private readonly sizeZ: number,
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.47;
    this.orbit.minDistance = 6;
    this.orbit.maxDistance = 800;
    this.orbit.screenSpacePanning = false; // arrastar move no plano do chão
    this.orbit.zoomToCursor = true;

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.setMode(this.mode === 'orbit' ? 'fly' : 'orbit');
      if (this.mode === 'fly' && e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'fly') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.lastY) * 0.0035, -1.5, 1.5);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener('wheel', (e) => {
      if (this.mode !== 'fly') return;
      this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * (e.deltaY > 0 ? 0.85 : 1.18), 4, 300);
    }, { passive: true });
  }

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'fly') {
      this.orbit.enabled = false;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    } else {
      // volta para órbita olhando o ponto do chão que estava à frente
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.orbit.target.copy(this.groundHit(this.camera.position, dir));
      this.orbit.enabled = true;
      this.orbit.update();
    }
    this.onModeChange(m);
  }

  /** Coloca a câmera de órbita olhando para (x, z) de uma certa distância */
  lookAt(x: number, z: number, dist: number): void {
    const y = this.groundAt(x, z);
    this.orbit.target.set(x, y, z);
    this.camera.position.set(x + dist * 0.55, y + dist * 0.62, z + dist * 0.55);
    this.orbit.update();
  }

  /** Ponto para onde a câmera está olhando (usado para centrar as sombras) */
  focus(out: THREE.Vector3): THREE.Vector3 {
    if (this.mode === 'orbit') return out.copy(this.orbit.target);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return out.copy(this.groundHit(this.camera.position, dir, 120));
  }

  /** Distância da câmera até o foco */
  viewDistance(): number {
    if (this.mode === 'orbit') return this.camera.position.distanceTo(this.orbit.target);
    // no voo: quanto mais alto, mais longe se enxerga (neblina e sombra acompanham)
    const ground = this.groundAt(this.camera.position.x, this.camera.position.z);
    return Math.min(400, Math.max(40, (this.camera.position.y - ground) * 1.5));
  }

  update(dt: number): void {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const cam = this.camera;

    if (this.mode === 'orbit') {
      if (fwd || side) {
        // move o foco no plano do chão, na direção para onde a câmera aponta
        const az = this.orbit.getAzimuthalAngle();
        const speed = Math.max(20, this.viewDistance() * 0.9) * dt * (k.has('ShiftLeft') ? 2.5 : 1);
        const dx = (-Math.sin(az) * fwd + Math.cos(az) * side) * speed;
        const dz = (-Math.cos(az) * fwd - Math.sin(az) * side) * speed;
        this.orbit.target.x += dx; this.orbit.target.z += dz;
        cam.position.x += dx; cam.position.z += dz;
      }
      // mantém o foco dentro do mapa e "grudado" no chão
      const t = this.orbit.target;
      const cx = THREE.MathUtils.clamp(t.x, 0, this.sizeX), cz = THREE.MathUtils.clamp(t.z, 0, this.sizeZ);
      cam.position.x += cx - t.x; cam.position.z += cz - t.z;
      t.x = cx; t.z = cz;
      const gy = this.groundAt(t.x, t.z);
      const dy = (gy - t.y) * Math.min(1, dt * 6);
      t.y += dy; cam.position.y += dy;
      this.orbit.update();
    } else {
      const speed = this.flySpeed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1) * dt;
      const up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') || k.has('KeyC') ? 1 : 0);
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      cam.position.addScaledVector(dir, fwd * speed).addScaledVector(right, side * speed);
      cam.position.y += up * speed;
      cam.lookAt(cam.position.clone().add(dir));
    }

    // limites: dentro de uma margem do mapa e sempre acima do chão
    const m = 120;
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, -m, this.sizeX + m);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -m, this.sizeZ + m);
    cam.position.y = THREE.MathUtils.clamp(cam.position.y, this.groundAt(cam.position.x, cam.position.z) + 1.6, 600);
  }

  /** Marcha ao longo de um raio até encontrar o chão (pelo mapa de altura) */
  private groundHit(from: THREE.Vector3, dir: THREE.Vector3, fallback = 60): THREE.Vector3 {
    const p = from.clone();
    for (let s = 0; s < 400; s++) {
      p.addScaledVector(dir, 2);
      if (p.y <= this.groundAt(p.x, p.z)) return p;
    }
    return from.clone().addScaledVector(dir, fallback);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
