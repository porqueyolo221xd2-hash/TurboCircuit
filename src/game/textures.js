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

/** Asfalto con ruido y dos bandas de rodadura más claras. */
export function createAsphaltTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(1337);
    ctx.fillStyle = '#4a505a';
    ctx.fillRect(0, 0, w, h);

    // Bandas suaves donde suelen pasar las ruedas.
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(0.32, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Granulado.
    for (let i = 0; i < 7000; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const size = rand() * 2.6 + 0.4;
      const shade = Math.floor(40 + rand() * 80);
      ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 10},${0.18 + rand() * 0.35})`;
      ctx.fillRect(x, y, size, size);
    }

    // Alguna grieta sutil.
    ctx.strokeStyle = 'rgba(25,28,33,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      let x = rand() * w;
      let y = rand() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j += 1) {
        x += (rand() - 0.5) * 40;
        y += rand() * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

/** Césped cartoon con briznas de varios tonos. */
export function createGrassTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(2024);
    ctx.fillStyle = '#6cbe4a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i += 1) {
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
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(120,196,80,0.16)' : 'rgba(55,130,58,0.14)';
      ctx.beginPath();
      ctx.ellipse(rand() * w, rand() * h, 20 + rand() * 60, 14 + rand() * 40, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Franjas para pianos y muros. Los colores se adaptan a cada circuito. */
export function createStripeTexture(colorA = '#ef3f3f', colorB = '#f7f4ec') {
  return makeCanvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = colorA;
    ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = colorB;
    ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, 4, h);
    ctx.fillRect(w / 2, 0, 4, h);
  });
}

/** Arena de la costa: grano fino y ondulaciones suaves. */
export function createSandTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(9091);
    ctx.fillStyle = '#e7d29a';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 34; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,244,205,0.16)' : 'rgba(190,160,104,0.13)';
      ctx.beginPath();
      ctx.ellipse(
        rand() * w,
        rand() * h,
        30 + rand() * 90,
        8 + rand() * 24,
        rand() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    for (let i = 0; i < 6500; i += 1) {
      const shade = Math.floor(190 + rand() * 55);
      ctx.fillStyle = `rgba(${shade},${shade - 18},${shade - 60},${0.12 + rand() * 0.3})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }

    // Pequeñas marcas de rastrillo.
    ctx.strokeStyle = 'rgba(180,150,95,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i += 1) {
      const y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 6);
      ctx.stroke();
    }
  });
}

/** Suelo urbano: hormigón oscuro con juntas y un brillo neón muy sutil. */
export function createCityGroundTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const rand = mulberry32(6060);
    ctx.fillStyle = '#1a2033';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 5200; i += 1) {
      const shade = Math.floor(24 + rand() * 42);
      ctx.fillStyle = `rgba(${shade},${shade + 6},${shade + 22},${0.2 + rand() * 0.35})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2.4, 1 + rand() * 2.4);
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
    for (let i = 0; i < 90; i += 1) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(190,110,255,0.1)' : 'rgba(60,220,255,0.1)';
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 2 + rand() * 6);
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
