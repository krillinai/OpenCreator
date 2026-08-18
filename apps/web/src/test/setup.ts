import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

Object.defineProperty(window.navigator, 'language', {
  configurable: true,
  value: 'zh-CN'
});
Object.defineProperty(window.navigator, 'languages', {
  configurable: true,
  value: ['zh-CN']
});

Object.defineProperty(window, 'confirm', {
  configurable: true,
  writable: true,
  value: () => true
});

type RectLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  toJSON(): Record<string, number>;
};

function createRect(): RectLike {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      };
    }
  };
}

function createRectList(rects: RectLike[] = []) {
  return {
    length: rects.length,
    item(index: number) {
      return rects[index] ?? null;
    },
    [Symbol.iterator]: function* iterator() {
      yield* rects;
    }
  };
}

const rangePrototype = document.createRange().constructor.prototype as Range;

if (typeof rangePrototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(rangePrototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return createRect();
    }
  });
}

if (typeof rangePrototype.getClientRects !== 'function') {
  Object.defineProperty(rangePrototype, 'getClientRects', {
    configurable: true,
    value() {
      return createRectList();
    }
  });
}
