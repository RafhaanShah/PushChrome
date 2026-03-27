// Custom ESM loader that mocks modules requiring browser APIs (IndexedDB, etc.)
// Usage: node --import ./tests/loader.js --test tests/lib/storage.test.js

import { register } from 'node:module';

register(new URL('./hooks.js', import.meta.url));
