export type AttributeMarkerMode = "requiredness" | "visibility" | "none";

export type ClassContentMode = "full" | "name-only";

export function validateAttributeMarkerMode(
  value: unknown,
): AttributeMarkerMode {
  if (value === "requiredness" || value === "visibility" || value === "none") {
    return value;
  }
  throw new TypeError(`Unsupported attribute marker mode "${String(value)}"`);
}

export function validateClassContentMode(value: unknown): ClassContentMode {
  if (value === "full" || value === "name-only") return value;
  throw new TypeError(`Unsupported class content mode "${String(value)}"`);
}
