import './style.css';
import { App } from './ui/app';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

try {
  const app = new App(canvas, ui);
  app.start();
  (window as unknown as { app: App }).app = app;
} catch (e) {
  console.error(e);
  ui.innerHTML = '<div class="modal-bg"><div class="panel modal"><h2>Sorry!</h2><p>This device could not start the 3D view. Try a newer browser, or turn on WebGL.</p></div></div>';
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}
