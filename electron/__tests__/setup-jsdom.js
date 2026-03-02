// Polyfill MessageChannel for Ant Design components in jsdom
if (typeof globalThis.MessageChannel === 'undefined') {
  globalThis.MessageChannel = class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close: () => {} };
      this.port2 = { onmessage: null, close: () => {} };
      this.port1.postMessage = (data) => {
        if (this.port2.onmessage) {
          setTimeout(() => this.port2.onmessage({ data }), 0);
        }
      };
      this.port2.postMessage = (data) => {
        if (this.port1.onmessage) {
          setTimeout(() => this.port1.onmessage({ data }), 0);
        }
      };
    }
  };
}

// Polyfill ResizeObserver for Ant Design Select/dropdown components in jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this._callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Suppress Ant Design warnings about missing matchMedia
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
