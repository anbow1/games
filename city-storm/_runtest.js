// Boot file for the headless test: install the mock resolve hook, then load
// the game module (it runs as side-effects and sets window.__CITYSTORM).
import { register } from 'node:module';

register(new URL('./_loader.mjs', import.meta.url));
await import('./game.js');
