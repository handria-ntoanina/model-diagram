import type {
  DiagramEventListener,
  DiagramEventMap,
  DiagramEventType,
  Unsubscribe,
} from "./types.js";

export class TypedEventEmitter {
  private readonly listeners = new Map<
    DiagramEventType,
    Set<(event: DiagramEventMap[DiagramEventType]) => void>
  >();

  on<K extends DiagramEventType>(
    type: K,
    listener: DiagramEventListener<K>,
  ): Unsubscribe {
    let listenersForType = this.listeners.get(type);
    if (!listenersForType) {
      listenersForType = new Set();
      this.listeners.set(type, listenersForType);
    }
    const erasedListener = listener as (
      event: DiagramEventMap[DiagramEventType],
    ) => void;
    listenersForType.add(erasedListener);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listenersForType?.delete(erasedListener);
      if (listenersForType?.size === 0) this.listeners.delete(type);
    };
  }

  emit<K extends DiagramEventType>(type: K, event: DiagramEventMap[K]): void {
    const snapshot = [...(this.listeners.get(type) ?? [])];
    for (const listener of snapshot) listener(event);
  }

  clear(): void {
    this.listeners.clear();
  }
}
