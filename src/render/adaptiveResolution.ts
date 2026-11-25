import type * as THREE from 'three';

/**
 * Resolução dinâmica: se a média do último segundo ficar abaixo de ~52 FPS,
 * desenha com menos pixels (até 60%); se ficar folgado por 3 s, volta a subir.
 * Em GPUs integradas o custo é dominado pelos pixels, então isso segura os 60 FPS.
 */
export class AdaptiveResolution {
  scale: number;
  private acc = 0;
  private n = 0;
  private good = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly max = Math.min(window.devicePixelRatio || 1, 1.5),
    private readonly min = 0.6,
  ) {
    this.scale = this.max;
    renderer.setPixelRatio(this.scale);
  }

  frame(dt: number): void {
    // ignora quadros "travados" (aba em segundo plano, janela minimizada, carregamento)
    if (dt > 0.2 || document.hidden) return;
    this.acc += dt;
    this.n++;
    if (this.acc < 1) return;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    if (avg > 1 / 52 && this.scale > this.min) {
      this.set(this.scale - 0.1);
      this.good = 0;
    } else if (avg < 1 / 58) {
      if (++this.good >= 3 && this.scale < this.max) {
        this.set(this.scale + 0.1);
        this.good = 0;
      }
    } else this.good = 0;
  }

  private set(s: number): void {
    this.scale = Math.round(Math.min(this.max, Math.max(this.min, s)) * 100) / 100;
    this.renderer.setPixelRatio(this.scale);
  }
}
