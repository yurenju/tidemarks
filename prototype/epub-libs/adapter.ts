// PROTOTYPE — throwaway. Common seam every library adapter implements so the
// harness can drive them identically.

export interface TocEntry {
  label: string;
  target: unknown;
}

export interface RelocateInfo {
  /** whole-book progress 0..1, or null if the library cannot provide one */
  fraction: number | null;
  raw: unknown;
}

export interface AdapterHandle {
  next(): void | Promise<void>;
  prev(): void | Promise<void>;
  toc(): TocEntry[];
  goTo(target: unknown): void | Promise<void>;
  /** opaque position token for the roundtrip test */
  currentLocator(): unknown | null;
  goToLocator(loc: unknown): void | Promise<void>;
  /** attempt a highlight; resolve with a human-readable note, throw on failure */
  highlight(): Promise<string>;
  destroy(): void;
}

export interface LoadOpts {
  vertical: boolean;
  log: (msg: string) => void;
  onRelocate: (info: RelocateInfo) => void;
}

export interface Adapter {
  id: string;
  label: string;
  load(mount: HTMLElement, data: ArrayBuffer, opts: LoadOpts): Promise<AdapterHandle>;
}
