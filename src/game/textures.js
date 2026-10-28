// Texturas generadas con Canvas: no se descarga ninguna imagen externa.
import * as THREE from 'three';
import { mulberry32 } from './utils.js';

function makeCanvasTexture(width, height, draw, { repeat = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/**
 * Dibuja una forma pequeña repetida en los bordes para que la textura case al
 * repetirse a lo largo de la pista.
 */
function wrappedDraw(ctx, w, h, x, y, radius, draw) {
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      const px = x + dx;
      const py = y + dy;
      if (px + radius < 0 || px - radius > w || py + radius < 0 || py - radius > h) continue;
      draw(px, py);
    }
  }
}

/** Asfalto con grano grueso, vetas de rueda, parches y juntas de reparación. */
export function createAsphaltTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(1337);
    ctx.fillStyle = '#444a54';
    ctx.fillRect(0, 0, w, h);

    // Vetas de rodadura: el neumático pule y oscurece dos franjas por carril.
    const wear = ctx.createLinearGradient(0, 0, w, 0);
    wear.addColorStop(0, 'rgba(0,0,0,0.16)');
    wear.addColorStop(0.12, 'rgba(255,255,255,0.04)');
    wear.addColorStop(0.2, 'rgba(0,0,0,0.12)');
    wear.addColorStop(0.3, 'rgba(255,255,255,0.02)');
    wear.addColorStop(0.44, 'rgba(0,0,0,0.06)');
    wear.addColorStop(0.56, 'rgba(0,0,0,0.06)');
    wear.addColorStop(0.7, 'rgba(255,255,255,0.02)');
    wear.addColorStop(0.8, 'rgba(0,0,0,0.12)');
    wear.addColorStop(0.88, 'rgba(255,255,255,0.04)');
    wear.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, w, h);

    // Manchas grandes de asfalto más nuevo o más gastado.
    for (let i = 0; i < 7; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const rx = 30 + rand() * 70;
      const ry = 18 + rand() * 46;
      const light = rand() > 0.55;
      wrappedDraw(ctx, w, h, x, y, rx, (px, py) => {
        const patch = ctx.createRadialGradient(px, py, 1, px, py, rx);
        patch.addColorStop(0, light ? 'rgba(126,134,146,0.13)' : 'rgba(22,25,31,0.16)');
        patch.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate((rand() - 0.5) * 0.6);
        ctx.scale(1, ry / rx);
        ctx.fillStyle = patch;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // Grano fino: miles de piedras con brillo irregular.
    for (let i = 0; i < 11000; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = rand() * 2.4 + 0.35;
      const shade = Math.floor(34 + rand() * 96);
      ctx.fillStyle = `rgba(${shade},${shade + 5},${shade + 12},${0.14 + rand() * 0.42})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    // Gravilla clara suelta: da profundidad al asfalto de cerca.
    for (let i = 0; i < 900; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 0.6 + rand() * 1.5;
      const shade = Math.floor(128 + rand() * 70);
      ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 9},${0.2 + rand() * 0.35})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    // Juntas transversales de reparación.
    ctx.strokeStyle = 'rgba(20,23,28,0.55)';
    ctx.lineWidth = 3.5;
    for (const y of [127, 331, 468]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 2.2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,158,170,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 3);
      ctx.lineTo(w, y + 3);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,23,28,0.55)';
      ctx.lineWidth = 3.5;
    }

    // Grietas capilares.
    ctx.strokeStyle = 'rgba(18,21,26,0.4)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 14; i += 1) {
      ctx.beginPath();
      let x = rand() * w;
      let y = rand() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j += 1) {
        x += (rand() - 0.5) * 34;
        y += 8 + rand() * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Restos de pintura antigua y manchas de aceite.
    for (let i = 0; i < 5; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const radius = 2 + rand() * 4;
      ctx.fillStyle = `rgba(232,236,240,${0.05 + rand() * 0.08})`;
      wrappedDraw(ctx, w, h, x, y, radius, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, radius * 1.6, radius, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    for (let i = 0; i < 4; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const radius = 14 + rand() * 26;
      const stain = ctx.createRadialGradient(x, y, 1, x, y, radius);
      stain.addColorStop(0, 'rgba(8,10,14,0.22)');
      stain.addColorStop(1, 'rgba(8,10,14,0)');
      ctx.fillStyle = stain;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

/** Mapa de relieve en escala de grises para el asfalto (piedras y juntas). */
export function createAsphaltBumpTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    const rand = mulberry32(4441);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 4600; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 0.7 + rand() * 2.6;
      const shade = Math.floor(84 + rand() * 118);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.45 + rand() * 0.45})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    // Las juntas quedan hundidas: una línea oscura con reborde claro.
    for (const y of [64, 166, 234]) {
      ctx.fillStyle = 'rgba(36,36,36,0.9)';
      ctx.fillRect(0, y, w, 2.5);
      ctx.fillStyle = 'rgba(168,168,168,0.5)';
      ctx.fillRect(0, y + 2.5, w, 1);
    }
  });
}

/** Tierra compactada del arcén, con piedras y marcas de ruedas. */
export function createDirtTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    const rand = mulberry32(7711);
    ctx.fillStyle = '#9d8a67';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 26; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const rx = 10 + rand() * 34;
      const ry = 6 + rand() * 20;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(126,108,80,0.16)' : 'rgba(196,178,140,0.18)';
      wrappedDraw(ctx, w, h, x, y, rx, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    for (let i = 0; i < 2600; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 0.6 + rand() * 2;
      const shade = Math.floor(80 + rand() * 96);
      ctx.fillStyle = `rgba(${shade},${shade - 10},${shade - 28},${0.2 + rand() * 0.4})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    for (let i = 0; i < 160; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 1.4 + rand() * 3.2;
      const shade = Math.floor(150 + rand() * 70);
      ctx.fillStyle = `rgba(${shade},${shade - 6},${shade - 22},${0.35 + rand() * 0.4})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

/** Césped cartoon con briznas, tréboles y algún detalle claro. */
export function createGrassTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(2024);
    ctx.fillStyle = '#6cbe4a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6200; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const len = 2 + rand() * 7;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(126,206,58,0.55)' : 'rgba(58,143,54,0.5)';
      ctx.lineWidth = 1 + rand() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y - len);
      ctx.stroke();
    }
    // Manchas de tono para romper la uniformidad.
    for (let i = 0; i < 34; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const rx = 20 + rand() * 60;
      const ry = 14 + rand() * 40;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(120,196,80,0.16)' : 'rgba(55,130,58,0.14)';
      wrappedDraw(ctx, w, h, x, y, rx, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // Tréboles y florecillas: puntos mínimos que dan vida al césped de cerca.
    for (let i = 0; i < 420; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 0.8 + rand() * 1.4;
      const flower = rand() > 0.82;
      ctx.fillStyle = flower
        ? (rand() > 0.5 ? 'rgba(255,246,190,0.75)' : 'rgba(255,214,230,0.6)')
        : 'rgba(48,118,48,0.5)';
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

/** Franjas para pianos y muros con bisel, brillo y desgaste. */
export function createStripeTexture(colorA = '#ef3f3f', colorB = '#f7f4ec') {
  return makeCanvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = colorA;
    ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = colorB;
    ctx.fillRect(w / 2, 0, w / 2, h);

    // Bisel superior claro e inferior oscuro: el piano gana volumen.
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(0, h - 6, w, 6);

    // Junta central y separación entre tramos.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w / 2 - 1.5, 0, 3, h);

    // Brillo diagonal suave: lee como pintura lacada.
    const gloss = ctx.createLinearGradient(0, 0, w, h);
    gloss.addColorStop(0, 'rgba(255,255,255,0.16)');
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    gloss.addColorStop(0.62, 'rgba(0,0,0,0.02)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, w, h);

    // Grano y roces del uso.
    const rand = mulberry32(3311);
    for (let i = 0; i < 130; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 2);
    }
  });
}

/** Arena de la costa: grano fino, ondulaciones y conchas. */
export function createSandTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(9091);
    ctx.fillStyle = '#e7d29a';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 44; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const rx = 30 + rand() * 90;
      const ry = 8 + rand() * 24;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,244,205,0.16)' : 'rgba(190,160,104,0.13)';
      wrappedDraw(ctx, w, h, x, y, rx, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    for (let i = 0; i < 7800; i += 1) {
      const shade = Math.floor(190 + rand() * 55);
      const x = rand() * w;
      const y = rand() * h;
      const size = 1 + rand() * 2;
      ctx.fillStyle = `rgba(${shade},${shade - 18},${shade - 60},${0.12 + rand() * 0.3})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    // Ondulaciones del viento: líneas paralelas con sombra y cresta.
    for (let i = 0; i < 22; i += 1) {
      const y = rand() * h;
      const amp = 3 + rand() * 6;
      const freq = 0.015 + rand() * 0.02;
      ctx.strokeStyle = 'rgba(180,150,95,0.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * freq + i) * amp);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,246,214,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + 2 + Math.sin(x * freq + i) * amp);
      ctx.stroke();
    }

    // Conchas y guijarros claros.
    for (let i = 0; i < 110; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = 1 + rand() * 2.6;
      ctx.fillStyle = rand() > 0.4
        ? `rgba(255,252,240,${0.35 + rand() * 0.35})`
        : `rgba(205,178,132,${0.4 + rand() * 0.3})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, size * 1.4, size * 0.85, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
}

/** Suelo urbano: hormigón oscuro con juntas, charcos y brillo neón. */
export function createCityGroundTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(6060);
    ctx.fillStyle = '#1a2033';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 5600; i += 1) {
      const shade = Math.floor(24 + rand() * 42);
      const x = rand() * w;
      const y = rand() * h;
      const size = 1 + rand() * 2.4;
      ctx.fillStyle = `rgba(${shade},${shade + 6},${shade + 22},${0.2 + rand() * 0.35})`;
      wrappedDraw(ctx, w, h, x, y, size, (px, py) => {
        ctx.fillRect(px, py, size, size);
      });
    }

    // Charcos que reflejan el neón de la ciudad.
    for (let i = 0; i < 7; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const rx = 12 + rand() * 34;
      const ry = 5 + rand() * 16;
      const neon = rand() > 0.5 ? '80, 220, 255' : '190, 110, 255';
      ctx.fillStyle = `rgba(${neon},0.1)`;
      wrappedDraw(ctx, w, h, x, y, rx, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${neon},0.2)`;
        ctx.beginPath();
        ctx.ellipse(px, py, rx * 0.55, ry * 0.45, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(80, 220, 255, 0.1)`;
      });
    }

    // Juntas de hormigón.
    ctx.strokeStyle = 'rgba(8, 12, 26, 0.7)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i += 1) {
      const p = (i / 4) * w;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    // Líneas de neón tenues entre baldosas.
    ctx.strokeStyle = 'rgba(60, 214, 255, 0.14)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i += 1) {
      const p = (i / 4) * w + 5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
    }
    for (let i = 0; i < 110; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(190,110,255,0.1)' : 'rgba(60,220,255,0.1)';
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 2 + rand() * 6);
    }

    // Tapas de registro y marcas de servicio.
    for (let i = 0; i < 5; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const radius = 5 + rand() * 8;
      ctx.fillStyle = 'rgba(40, 47, 66, 1)';
      wrappedDraw(ctx, w, h, x, y, radius, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = 'rgba(90, 110, 140, 0.5)';
      ctx.lineWidth = 1.5;
      wrappedDraw(ctx, w, h, x, y, radius, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, radius * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  });
}

/** Fachada nocturna con ventanas encendidas para los edificios de la ciudad. */
export function createBuildingTexture(base = '#141a2e', windowColor = '#5fe6ff', accent = '#b66cff') {
  return makeCanvasTexture(128, 256, (ctx, w, h) => {
    const rand = mulberry32(5150);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const cols = 6;
    const rows = 16;
    const cw = w / cols;
    const ch = h / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = rand() > 0.42;
        ctx.fillStyle = lit
          ? (rand() > 0.24 ? windowColor : accent)
          : 'rgba(10, 14, 28, 0.85)';
        ctx.fillRect(x * cw + 2, y * ch + 3, cw - 4, ch - 6);
      }
    }

    // Bandas horizontales de neón.
    ctx.fillStyle = accent;
    for (let i = 0; i < 4; i += 1) {
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, (i / 4) * h + 6, w, 3);
    }
    ctx.globalAlpha = 1;
  });
}

/** Línea de meta de cuadros. */
export function createCheckerTexture() {
  return makeCanvasTexture(256, 64, (ctx, w, h) => {
    const cols = 8;
    const rows = 2;
    const cw = w / cols;
    const ch = h / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#101319' : '#f5f3ea';
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  });
}

/** Lona del arco de meta. */
export function createBannerTexture() {
  return makeCanvasTexture(
    1024,
    256,
    (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#16204a');
      grad.addColorStop(0.55, '#3b2a86');
      grad.addColorStop(1, '#1d8fb8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Bordes de cuadros.
      const size = 32;
      for (let y = 0; y < 2; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#101319';
          ctx.fillRect(x * size, y * size, size, size);
          ctx.fillRect(w - (x + 1) * size, y * size, size, size);
          ctx.fillRect(x * size, h - (y + 1) * size, size, size);
          ctx.fillRect(w - (x + 1) * size, h - (y + 1) * size, size, size);
        }
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 96px "Arial Black", Arial, sans-serif';
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#0c1020';
      ctx.strokeText('TURBO CIRCUIT', w / 2, h / 2 - 6);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('TURBO CIRCUIT', w / 2, h / 2 - 6);

      ctx.font = '700 26px "Trebuchet MS", Arial, sans-serif';
      ctx.fillStyle = '#d8f6ff';
      ctx.fillText('CIRCUITO  ·  ARCADE  ·  3 VUELTAS', w / 2, h - 34);
    },
    { repeat: false },
  );
}

/** Cartel de frenada: número grande sobre panel de peligro. */
export function createBrakingBoardTexture(number) {
  return makeCanvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#111722';
      ctx.fillRect(0, 0, w, h);

      // Marco de aviso rojo y blanco.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      for (let i = -h; i < w; i += 44) {
        ctx.fillStyle = '#e23b3b';
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 22, 0);
        ctx.lineTo(i + 22 + h, h);
        ctx.lineTo(i + h, h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f4f1e6';
        ctx.beginPath();
        ctx.moveTo(i + 22, 0);
        ctx.lineTo(i + 44, 0);
        ctx.lineTo(i + 44 + h, h);
        ctx.lineTo(i + 22 + h, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Centro oscuro donde se lee el número.
      ctx.fillStyle = '#0d1220';
      ctx.fillRect(26, 26, w - 52, h - 52);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(26, 26, w - 52, h - 52);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 128px "Arial Black", Arial, sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(String(number), w / 2, h / 2 - 12);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(number), w / 2, h / 2 - 12);

      ctx.font = '700 22px "Trebuchet MS", Arial, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('FRENA', w / 2, h - 42);
    },
    { repeat: false },
  );
}

/** Dorso de los paneles de frenada: franjas de peligro diagonales. */
export function createHazardTexture() {
  return makeCanvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = '#ffcc33';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1b2233';
      for (let i = -h; i < w; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 0);
        ctx.lineTo(i + 16 + h, h);
        ctx.lineTo(i + h, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(4, 4, w - 8, 6);
    },
    { repeat: true },
  );
}

/** Carteles decorativos con texto. */
export function createSignTexture(text, subtitle = '') {
  return makeCanvasTexture(
    512,
    256,
    (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#ff8a2a');
      grad.addColorStop(1, '#e63946');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 14;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 82px "Arial Black", Arial, sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#3b1020';
      ctx.strokeText(text, w / 2, subtitle ? h / 2 - 20 : h / 2);
      ctx.fillStyle = '#fff8e7';
      ctx.fillText(text, w / 2, subtitle ? h / 2 - 20 : h / 2);

      if (subtitle) {
        ctx.font = '700 30px "Trebuchet MS", Arial, sans-serif';
        ctx.fillStyle = '#2a1220';
        ctx.fillText(subtitle, w / 2, h / 2 + 58);
      }
    },
    { repeat: false },
  );
}

/** Campo de energía de las puertas: líneas de barrido repetibles. */
export function createEnergyFieldTexture(accent = '#5fe6ff') {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);

    // Gradiente vertical: el campo es más denso en el centro.
    const base = ctx.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, 'rgba(0, 0, 0, 0.18)');
    base.addColorStop(0.5, 'rgba(30, 60, 90, 0.34)');
    base.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Líneas de barrido horizontales.
    for (let y = 0; y < h; y += 8) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = y % 24 === 0 ? 0.85 : 0.32;
      ctx.fillRect(0, y, w, y % 24 === 0 ? 2 : 1);
    }

    // Chispas verticales dispersas, siempre dentro de la retícula.
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 18; i += 1) {
      const x = ((i * 37) % (w - 10)) + 5;
      const y = (i * 53) % h;
      ctx.fillStyle = i % 3 === 0 ? '#ffffff' : accent;
      ctx.fillRect(x, y, 1.5, 14);
    }
    ctx.globalAlpha = 1;
  });
}

/** Flechas luminosas para las placas de turbo de los circuitos. */
export function createBoostPadTexture(accent = '#5fe6ff') {
  return makeCanvasTexture(
    256,
    512,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);

      // Fondo oscuro translúcido para que la placa se lea sobre el asfalto.
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, 'rgba(3, 10, 24, 0.92)');
      base.addColorStop(0.5, 'rgba(6, 20, 40, 0.96)');
      base.addColorStop(1, 'rgba(3, 10, 24, 0.92)');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);

      // Franjas laterales de aviso.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, 0, 10, h);
      ctx.fillRect(w - 10, 0, 10, h);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.75;
      ctx.strokeRect(22, 14, w - 44, h - 28);

      // Tres chevrones apuntando hacia la salida.
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i += 1) {
        const y = 96 + i * 138;
        ctx.beginPath();
        ctx.moveTo(w * 0.18, y + 52);
        ctx.lineTo(w * 0.5, y);
        ctx.lineTo(w * 0.82, y + 52);
        ctx.lineWidth = 30;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(w * 0.2, y + 44);
        ctx.lineTo(w * 0.5, y - 2);
        ctx.lineTo(w * 0.8, y + 44);
        ctx.lineWidth = 15;
        ctx.strokeStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 20;
        ctx.stroke();

        // Núcleo blanco: mantiene la flecha legible a distancia.
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(w * 0.2, y + 44);
        ctx.lineTo(w * 0.5, y - 2);
        ctx.lineTo(w * 0.8, y + 44);
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
    { repeat: false },
  );
}
