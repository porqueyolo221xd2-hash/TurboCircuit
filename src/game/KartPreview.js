// Previsualización 3D del kart seleccionado en el menú.
// Usa un renderizador pequeño e independiente del juego para no tocar la
// escena principal ni el estado de la carrera.
import * as THREE from 'three';
import { Kart } from './Kart.js';

export class KartPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.disposed = false;
    this.kart = null;
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1.3, 0.1, 60);
    this.camera.position.set(4.1, 2.6, 4.9);

    this.scene.add(new THREE.HemisphereLight(0xdff3ff, 0x223355, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(4.5, 7, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x3fe0ff, 1.6);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.camera.lookAt(0, 0.82, 0);

    this.handleResize = () => this.resize();
    this.resizeObserver = null;
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
    this.resize();
  }

  setKart(spec) {
    if (this.kart) {
      this.turntable.remove(this.kart.group);
      this.kart.dispose();
      this.kart = null;
    }
    if (!spec) return;
    this.kart = new Kart({ ...spec, isPlayer: true });
    this.kart.group.position.set(0, 0, 0);
    this.turntable.add(this.kart.group);
    this.turntable.rotation.y = -0.55;
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || 260);
    const height = Math.max(1, this.canvas.clientHeight || 170);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // En paneles estrechos, la cámara se aleja un poco para no cortar el kart.
    const distance = this.camera.aspect < 1.15 ? 7.3 : 6.3;
    this.camera.position.set(distance * 0.66, distance * 0.42, distance * 0.79);
    this.camera.lookAt(0, 0.82, 0);
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.kart) return;
    this.time += dt;
    this.turntable.rotation.y += dt * 0.5;
    this.kart.group.position.y = Math.sin(this.time * 1.7) * 0.025;
  }

  render() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this.handleResize);
    if (this.kart) {
      this.turntable.remove(this.kart.group);
      this.kart.dispose();
      this.kart = null;
    }
    this.renderer.dispose();
  }
}
