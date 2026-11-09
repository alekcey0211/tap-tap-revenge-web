// Native when available; otherwise load the pinned same-origin polyfill, never a CDN.
export const Temporal = globalThis.Temporal ?? (await import('./vendor/temporal-0.5.1.js')).Temporal;
