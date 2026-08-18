import "@testing-library/jest-dom";

// Radix UI primitives (Select, Popover, etc.) call pointer-capture APIs that
// jsdom does not implement.  Polyfill them so Radix components open correctly
// in the test environment without throwing.
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
}
if (!window.HTMLElement.prototype.setPointerCapture) {
  window.HTMLElement.prototype.setPointerCapture = () => {};
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}
// ResizeObserver is used by some Radix layout primitives.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// Radix Select calls scrollIntoView on the highlighted option.
if (!window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = () => {};
}
