/**
 * Materiais do terreno e da água.
 *
 * Partimos dos materiais prontos do Three.js (que já sabem lidar com luz,
 * sombra e neblina) e injetamos pequenos trechos de GLSL com onBeforeCompile:
 *  - terreno: variação de tom por bloco + contorno leve nas arestas, para os
 *    blocos ficarem legíveis mesmo com as faces fundidas pelo greedy meshing;
 *  - água: ondulação animada na normal (reflexo) e no brilho.
 */
import * as THREE from 'three';

const HASH_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}`;

export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <color_vertex>',
        // as cores dos vértices estão em sRGB; a iluminação precisa delas em linear
        '#include <color_vertex>\n  vColor.rgb = pow(vColor.rgb, vec3(2.2));',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWN = normal;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;\n${HASH_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  // bloco ao qual este pixel pertence (anda um pouco para dentro da face)
  vec3 cell = floor(vWPos - vWN * 0.01);
  float tone = hash13(cell);
  diffuseColor.rgb *= 0.92 + 0.14 * tone;
  // "grão" fino dentro da face, como uma textura pintada à mão (8×8 por bloco)
  float grain = hash13(floor(vWPos * 8.0 - vWN * 0.05));
  diffuseColor.rgb *= 0.96 + 0.06 * grain;
  // contorno: escurece perto das arestas de cada bloco (ignora o eixo da normal)
  vec3 f = fract(vWPos);
  vec3 dEdge = min(f, 1.0 - f) + abs(vWN) * 10.0;
  float edge = min(dEdge.x, min(dEdge.y, dEdge.z));
  diffuseColor.rgb *= mix(0.84, 1.0, smoothstep(0.0, 0.06, edge));`,
      );
  };
  return mat;
}

export function createWaterMaterial(time: { value: number }): THREE.MeshPhongMaterial {
  const mat = new THREE.MeshPhongMaterial({
    color: 0x3c87c8,
    specular: 0x9fc8e8,
    shininess: 90,
    transparent: true,
    opacity: 0.72,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <worldpos_vertex>',
        // a superfície fica um pouco abaixo do topo do bloco, como água de verdade
        '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWN = normal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  if (normal.y > 0.5) transformed.y -= 0.12;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  if (vWN.y > 0.5) {
    // soma de ondas senoidais em direções diferentes → ondulação suave
    vec2 p = vWPos.xz;
    float t = uTime;
    vec2 g = vec2(0.0);
    g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * 0.09;
    g += vec2(-0.5, 0.85) * cos(dot(p, vec2(-0.5, 0.85)) * 1.7 + t * 1.9) * 0.05;
    g += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 3.1 + t * 2.6) * 0.03;
    vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  float sh = sin(vWPos.x * 0.7 + uTime * 0.8) * sin(vWPos.z * 0.6 - uTime * 0.7);
  diffuseColor.rgb *= 0.95 + 0.07 * sh;`,
      );
  };
  return mat;
}
