/**
 * Global setup file for Vitest: Apply TextEncoder/TextDecoder shim
 * This runs BEFORE any test transformation to fix esbuild invariant violation.
 * 
 * Error without shim:
 * "Invariant violation: "new TextEncoder().encode("") instanceof Uint8Array" is incorrectly false"
 * 
 * Supports both environments:
 * - jsdom: Wraps existing TextEncoder to ensure proper Uint8Array conversion
 * - node: Uses util.TextEncoder as fallback
 */

// Ensure TextEncoder/TextDecoder exist and work correctly with esbuild
async function setupShim() {
  try {
    // Check if we're in jsdom (has window) or Node.js
    const isJsdom = typeof globalThis.window !== 'undefined';
    
    if (isJsdom) {
      // jsdom environment: wrap existing TextEncoder to ensure Uint8Array conversion
      const OriginalTextEncoder = (globalThis as any).TextEncoder;
      if (OriginalTextEncoder) {
        (globalThis as any).TextEncoder = class TextEncoderShim {
          private _enc: any;
          constructor() {
            this._enc = new OriginalTextEncoder();
          }
          encode(str: string) {
            const result = this._enc.encode(str);
            // Ensure result is a proper Uint8Array instance
            return result instanceof Uint8Array ? result : Uint8Array.from(result);
          }
        };
      }
      
      const OriginalTextDecoder = (globalThis as any).TextDecoder;
      if (OriginalTextDecoder) {
        (globalThis as any).TextDecoder = class TextDecoderShim {
          private _dec: any;
          constructor(...args: any[]) {
            this._dec = new OriginalTextDecoder(...args);
          }
          decode(buf: any) {
            return this._dec.decode(buf);
          }
        };
      }
    } else {
      // Node.js environment: use util module TextEncoder/TextDecoder
      const util = await import('util');
      const UE = (util as any).TextEncoder;
      const UD = (util as any).TextDecoder;
      
      if (UE && typeof (globalThis as any).TextEncoder === 'undefined') {
        (globalThis as any).TextEncoder = class TextEncoderShim {
          private _enc: any;
          constructor() {
            this._enc = new UE();
          }
          encode(str: string) {
            return Uint8Array.from(this._enc.encode(str));
          }
        };
      }
      
      if (UD && typeof (globalThis as any).TextDecoder === 'undefined') {
        (globalThis as any).TextDecoder = class TextDecoderShim {
          private _dec: any;
          constructor() {
            this._dec = new UD();
          }
          decode(buf: any) {
            return this._dec.decode(Buffer.from(buf));
          }
        };
      }
    }
  } catch (e) {
    console.warn('TextEncoder/TextDecoder shim setup failed (non-critical):', e);
    // ignore if util not available - will fall back to built-ins
  }
}

// Execute setup immediately when this file is loaded
setupShim().catch(err => console.error('Critical error in setup-shim:', err));

