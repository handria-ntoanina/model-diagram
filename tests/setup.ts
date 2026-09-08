class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

const svgClassNames = new WeakMap<SVGElement, { baseVal: string; animVal: string }>();
Object.defineProperty(SVGElement.prototype, "className", {
  configurable: true,
  get(this: SVGElement) {
    let value = svgClassNames.get(this);
    if (!value) {
      value = { baseVal: "", animVal: "" };
      svgClassNames.set(this, value);
    }
    return value;
  },
  set(this: SVGElement, value: string) {
    svgClassNames.set(this, { baseVal: value, animVal: value });
  },
});

if (!document.createDocumentFragment().nodeName) {
  Object.defineProperty(DocumentFragment.prototype, "nodeName", {
    configurable: true,
    get: () => "#document-fragment",
  });
}

if (!(SVGElement.prototype as SVGElement & { getBBox?: () => DOMRect }).getBBox) {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => new DOMRect(0, 0, 100, 100),
  });
}

if (!Document.prototype.createCDATASection) {
  Object.defineProperty(Document.prototype, "createCDATASection", {
    configurable: true,
    value(this: Document, data: string) {
      return this.createTextNode(data);
    },
  });
}

const createDocument = document.implementation.createDocument.bind(
  document.implementation,
);
document.implementation.createDocument = (...args) => {
  const xml = createDocument(...args);
  if (!xml.createCDATASection) {
    Object.defineProperty(xml, "createCDATASection", {
      configurable: true,
      value: (data: string) => xml.createTextNode(data),
    });
  }
  return xml;
};

const testSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
const svgPointPrototype = Object.getPrototypeOf(testSvg.createSVGPoint()) as object;
if (!(svgPointPrototype as { matrixTransform?: unknown }).matrixTransform) {
  Object.defineProperty(svgPointPrototype, "matrixTransform", {
    configurable: true,
    value(this: DOMPoint, matrix: DOMMatrix) {
      const result = testSvg.createSVGPoint();
      result.x = matrix.a * this.x + matrix.c * this.y + matrix.e;
      result.y = matrix.b * this.x + matrix.d * this.y + matrix.f;
      return result;
    },
  });
}
