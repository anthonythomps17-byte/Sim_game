// Shared materials and procedurally drawn textures (bricks, planks, tiles...).
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';

export function hex(c: string): Color3 {
  return Color3.FromHexString(c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);
}

function shade(c: string, f: number): string {
  const col = hex(c);
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255 * f)));
  return `rgb(${k(col.r)},${k(col.g)},${k(col.b)})`;
}

export class Materials {
  private cache = new Map<string, StandardMaterial>();
  readonly vertexColor: StandardMaterial;

  constructor(private scene: Scene) {
    this.vertexColor = new StandardMaterial('vc', scene);
    this.vertexColor.diffuseColor = new Color3(1, 1, 1);
    this.vertexColor.specularColor = new Color3(0.08, 0.08, 0.08);
    this.vertexColor.maxSimultaneousLights = 8;
  }

  color(c: string, opts: { emissive?: number; alpha?: number; spec?: number } = {}): StandardMaterial {
    const key = `c:${c}:${opts.emissive ?? 0}:${opts.alpha ?? 1}:${opts.spec ?? 0}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new StandardMaterial(key, this.scene);
      m.diffuseColor = hex(c);
      m.specularColor = new Color3(opts.spec ?? 0.06, opts.spec ?? 0.06, opts.spec ?? 0.06);
      if (opts.emissive) m.emissiveColor = hex(c).scale(opts.emissive);
      if (opts.alpha !== undefined && opts.alpha < 1) m.alpha = opts.alpha;
      m.maxSimultaneousLights = 8;
      this.cache.set(key, m);
    }
    return m;
  }

  /** A patterned material. `pattern` is one of planks, tiles, check, bricks, stripes, panels, plain, grass. */
  pattern(id: string, pattern: string | undefined, color: string, repeat = 1, repeatV = repeat): StandardMaterial {
    const key = `p:${id}:${repeat}:${repeatV}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new StandardMaterial(key, this.scene);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    m.maxSimultaneousLights = 8;
    if (!pattern || pattern === 'plain') {
      m.diffuseColor = hex(color);
    } else {
      const tex = new DynamicTexture(key + 't', { width: 128, height: 128 }, this.scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      drawPattern(ctx, pattern, color);
      tex.update();
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.WRAP_ADDRESSMODE;
      tex.uScale = repeat;
      tex.vScale = repeatV;
      tex.anisotropicFilteringLevel = 4;
      m.diffuseTexture = tex;
    }
    this.cache.set(key, m);
    return m;
  }
}

function drawPattern(ctx: CanvasRenderingContext2D, pattern: string, color: string) {
  const S = 128;
  ctx.fillStyle = shade(color, 1);
  ctx.fillRect(0, 0, S, S);
  switch (pattern) {
    case 'planks': {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = shade(color, 0.9 + ((i * 37) % 3) * 0.06);
        ctx.fillRect(0, i * 32, S, 31);
        ctx.fillStyle = shade(color, 0.7);
        ctx.fillRect(0, i * 32 + 31, S, 1);
        ctx.fillRect(((i * 53) % 96) + 16, i * 32, 1, 31);
      }
      break;
    }
    case 'tiles': {
      ctx.fillStyle = shade(color, 0.78);
      for (let i = 0; i <= 2; i++) { ctx.fillRect(i * 64 - 1, 0, 2, S); ctx.fillRect(0, i * 64 - 1, S, 2); }
      break;
    }
    case 'check': {
      ctx.fillStyle = '#ece8df';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillRect(64, 64, 64, 64);
      break;
    }
    case 'bricks': {
      const rows = 8, h = S / rows;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? 0 : 16;
        for (let c = -1; c < 4; c++) {
          ctx.fillStyle = shade(color, 0.88 + (((r * 7 + c * 13) % 5) * 0.05));
          ctx.fillRect(c * 32 + off + 1, r * h + 1, 30, h - 2);
        }
      }
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#d9cfc2';
      ctx.fillRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'stripes': {
      ctx.fillStyle = shade(color, 0.82);
      for (let i = 0; i < 8; i += 2) ctx.fillRect(i * 16, 0, 16, S);
      break;
    }
    case 'panels': {
      ctx.fillStyle = shade(color, 0.8);
      ctx.fillRect(0, 60, S, 4);
      for (let i = 0; i < 2; i++) {
        ctx.strokeStyle = shade(color, 0.75);
        ctx.lineWidth = 3;
        ctx.strokeRect(i * 64 + 8, 72, 48, 48);
      }
      break;
    }
    case 'grass': {
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = shade(color, 0.85 + Math.random() * 0.3);
        ctx.fillRect(Math.random() * S, Math.random() * S, 2, 3);
      }
      break;
    }
    case 'slate': {
      for (let r = 0; r < 8; r++) {
        ctx.fillStyle = shade(color, r % 2 ? 0.9 : 1.05);
        ctx.fillRect(0, r * 16, S, 15);
      }
      break;
    }
  }
}
