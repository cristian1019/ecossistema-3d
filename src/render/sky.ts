/**
 * Céu, sol, lua, estrelas, luzes e neblina — tudo controlado pela hora do dia.
 *
 * Hora do dia t ∈ [0, 1): 0 = meia-noite, 0,25 = nascer do sol, 0,5 = meio-dia,
 * 0,75 = pôr do sol. O sol gira num círculo inclinado; a lua fica do lado oposto.
 * As cores do céu são interpoladas entre "paradas" conforme a altura do sol.
 */
import * as THREE from 'three';

interface SkyStop {
  e: number; // elevação do sol (seno do ângulo)
  top: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
}

const c = (hex: number) => new THREE.Color(hex);
const STOPS: SkyStop[] = [
  { e: -0.4, top: c(0x060a1a), horizon: c(0x0d1430), sun: c(0x000000) },
  { e: -0.1, top: c(0x161d45), horizon: c(0x353762), sun: c(0x000000) },
  { e: 0.02, top: c(0x4a5a95), horizon: c(0xf2995c), sun: c(0xff9a5a) },
  { e: 0.2, top: c(0x4d8ddb), horizon: c(0xbdd8ee), sun: c(0xffdcb4) },
  { e: 0.55, top: c(0x3a7ed8), horizon: c(0xa9d0f2), sun: c(0xfff6e8) },
];

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // sempre no fundo (profundidade máxima)
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uStars;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// coordenadas 2D de d no plano perpendicular a "axis" (para desenhar discos quadrados)
vec2 facePlane(vec3 d, vec3 axis) {
  vec3 up = abs(axis.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, axis));
  vec3 t2 = cross(axis, t1);
  return vec2(dot(d, t1), dot(d, t2));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // abaixo do horizonte (visto quando a câmera está alta): o próprio horizonte, um pouco mais escuro
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.5)) : mix(uHorizon, uHorizon * 0.72, pow(min(-h * 2.0, 1.0), 0.8));

  // brilho em volta do sol
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 18.0) * 0.45 + pow(sd, 3.0) * 0.08);

  // estrelas: pontos em uma grade de direções, só à noite
  if (uStars > 0.0 && h > 0.0) {
    float s = hash13(floor(d * 260.0));
    if (s > 0.9975) col += vec3(0.9, 0.93, 1.0) * uStars * (s - 0.9975) / 0.0025;
  }

  // sol quadrado (estilo blocos)
  if (dot(d, uSunDir) > 0.0) {
    vec2 q = facePlane(d, uSunDir);
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.05) col = mix(vec3(1.0, 0.95, 0.8) * 1.6, uSunColor * 1.4, smoothstep(0.03, 0.05, m));
  }
  // lua quadrada com "crateras" em pixels
  if (dot(d, uMoonDir) > 0.0) {
    vec2 q = facePlane(d, uMoonDir);
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.035) {
      float crater = hash13(vec3(floor(q * 90.0), 1.0));
      col = vec3(0.86, 0.88, 0.95) * (crater > 0.75 ? 0.78 : 1.0);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class DayNight {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0.0);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a3c2a, 1.0);
  readonly fog = new THREE.Fog(0xa9d0f2, 150, 600);
  readonly sky: THREE.Mesh;
  private readonly uniforms;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** quão "dia" está: 0 noite, 1 dia pleno */
  daylight = 1;

  private shadowSize = 128;
  private readonly shadowFocus = new THREE.Vector2(NaN, NaN);
  private readonly shadowSunDir = new THREE.Vector3();
  private shadowDirty = true;
  private framesSinceShadow = 99;
  /** mínimo de quadros entre atualizações da sombra (maior nas velocidades altas) */
  shadowInterval = 3;

  constructor(scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    renderer.shadowMap.autoUpdate = false;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // sombras: mapa 2048² cobrindo a região em volta do foco da câmera
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowSize; sc.right = this.shadowSize;
    sc.top = this.shadowSize; sc.bottom = -this.shadowSize;
    sc.near = 1; sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.radius = 1; // raio maior fica mais suave, mas custa ~3 ms a mais numa GPU integrada
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);
    scene.fog = this.fog;
  }

  /**
   * @param t hora do dia (0..1)
   * @param focus ponto que a câmera está olhando (as sombras ficam centradas nele)
   * @param camPos posição da câmera (o céu acompanha a câmera)
   * @param viewDist distância de visão, usada para ajustar a neblina
   */
  update(t: number, focus: THREE.Vector3, camPos: THREE.Vector3, viewDist: number): void {
    const ang = (t - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.38).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const e = this.sunDir.y;

    // interpola as cores entre as paradas
    const top = this.uniforms.uTop.value, hor = this.uniforms.uHorizon.value, sunC = this.uniforms.uSunColor.value;
    let i = 0;
    while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    const k = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
    top.lerpColors(a.top, b.top, k);
    hor.lerpColors(a.horizon, b.horizon, k);
    sunC.lerpColors(a.sun, b.sun, k);

    this.daylight = THREE.MathUtils.smoothstep(e, -0.12, 0.25);
    const night = 1 - THREE.MathUtils.smoothstep(e, -0.25, 0.02);
    this.uniforms.uStars.value = night;

    this.sun.color.copy(sunC);
    this.sun.intensity = THREE.MathUtils.smoothstep(e, -0.03, 0.18) * 3.0;
    this.moon.intensity = night * 0.45;
    this.hemi.intensity = 0.3 + this.daylight * 1.1;
    this.hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.setHex(0x4a3c2a).multiplyScalar(0.4 + this.daylight * 0.6);

    // neblina com a cor do horizonte; afasta quando a câmera está longe
    this.fog.color.copy(hor);
    this.fog.far = Math.max(380, viewDist * 2.2 + 200);
    this.fog.near = this.fog.far * 0.35;

    this.sky.position.copy(camPos);

    this.updateShadow(focus, viewDist);
  }

  /**
   * Sombras em cache: desenhar o mapa de sombra custa quase tanto quanto desenhar
   * a cena inteira, e ele só muda quando o sol anda ou a região em foco muda.
   * Girar a câmera não muda a sombra. Então só pedimos uma nova sombra quando:
   *  - o sol andou mais de ~0,35°, ou
   *  - o foco saiu da "célula" atual (1/6 da área de sombra), ou
   *  - o zoom mudou o tamanho da área de sombra, ou
   *  - chegaram chunks novos (invalidateShadow).
   * Além disso, no máximo 1 atualização a cada 3 quadros.
   */
  private updateShadow(focus: THREE.Vector3, viewDist: number): void {
    this.framesSinceShadow++;
    // área coberta acompanha o zoom (em degraus, para não mudar a todo quadro)
    const size = THREE.MathUtils.clamp(Math.ceil((viewDist * 0.8) / 32) * 32, 64, 320);
    const cell = size / 3;
    const fx = Math.round(focus.x / cell) * cell;
    const fz = Math.round(focus.z / cell) * cell;
    const moved = fx !== this.shadowFocus.x || fz !== this.shadowFocus.y;
    const resized = size !== this.shadowSize;
    const sunMoved = this.sunDir.dot(this.shadowSunDir) < 0.99998; // ~0,35°
    const due = this.framesSinceShadow >= this.shadowInterval;
    if (!((moved || resized || sunMoved || this.shadowDirty) && due)) return;

    if (resized) {
      this.shadowSize = size;
      const sc = this.sun.shadow.camera;
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
      sc.updateProjectionMatrix();
      // texel maior → precisa de mais "folga" para evitar manchas (shadow acne)
      this.sun.shadow.normalBias = 0.2 + size / 700;
    }
    this.shadowFocus.set(fx, fz);
    this.shadowSunDir.copy(this.sunDir);
    this.shadowDirty = false;
    this.framesSinceShadow = 0;

    const y = 40;
    this.sun.target.position.set(fx, y, fz);
    this.sun.position.set(fx, y, fz).addScaledVector(this.sunDir, 400);
    this.moon.target.position.set(fx, y, fz);
    this.moon.position.set(fx, y, fz).addScaledVector(this.moonDir, 400);
    this.sun.target.updateMatrixWorld();
    this.moon.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** chame quando a geometria mudar (chunks novos) */
  invalidateShadow(): void {
    this.shadowDirty = true;
  }
}
