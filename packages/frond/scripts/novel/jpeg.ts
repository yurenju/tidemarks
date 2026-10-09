import type { GrayscaleImage } from "../../src/test-fixtures/png.ts";

/**
 * A deterministic baseline JPEG writer, greyscale only.
 *
 * The novel-length books need real-sized illustrations — a full-page plate is around
 * 600×900 — and `png.ts` writes stored (uncompressed) deflate on purpose, which would put
 * one plate at half a megabyte. The books are committed, so their size is paid in every
 * clone. JPEG is also what illustrated novels actually carry, so the decode cost the reader
 * pays matches a real book more closely than a PNG would.
 *
 * Hand-written for the same reason `png.ts` is: the bytes must be a function of the input
 * alone. Everything here is integer bookkeeping around one float DCT, and V8's `Math.cos`
 * is the same fdlibm port on every platform — as are the `Math.hypot` and `Math.exp` the
 * pictures in `novel.ts` are drawn with — so regenerating on another machine leaves no diff.
 * If one day it does, the generator did not change: the engine did, and the committed books
 * stay as they are.
 *
 * Deliberately unsupported: colour, chroma subsampling, progressive scans, restart markers,
 * optimised Huffman tables. A baseline decoder reads all of what is written.
 */

/** Natural (row-major) index of the k-th coefficient in zigzag order. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** The luminance quantisation table from Annex K of the JPEG spec, in natural order. */
const BASE_LUMINANCE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** Annex K's luminance DC table: how many codes of each length 1–16, then the symbols. */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Annex K's luminance AC table. */
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

const END_OF_BLOCK = 0x00;
const ZERO_RUN_16 = 0xf0;

interface HuffmanCode {
  readonly code: number;
  readonly length: number;
}

/** Canonical Huffman codes, assigned the way the spec's Annex C does. */
function huffmanTable(bits: readonly number[], values: readonly number[]): HuffmanCode[] {
  const table: HuffmanCode[] = [];
  let code = 0;
  let at = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let count = 0; count < bits[length - 1]!; count += 1) {
      table[values[at]!] = { code, length };
      code += 1;
      at += 1;
    }
    code <<= 1;
  }
  return table;
}

const DC_TABLE = huffmanTable(DC_BITS, DC_VALUES);
const AC_TABLE = huffmanTable(AC_BITS, AC_VALUES);

/** `COSINES[x * 8 + u]` = cos((2x + 1)uπ / 16), the DCT-II kernel. */
const COSINES = Float64Array.from({ length: 64 }, (_, index) =>
  Math.cos(((2 * Math.floor(index / 8) + 1) * (index % 8) * Math.PI) / 16),
);

class BitWriter {
  readonly #bytes: number[] = [];
  #buffer = 0;
  #count = 0;

  write({ code, length }: HuffmanCode): void {
    this.bits(code, length);
  }

  bits(value: number, length: number): void {
    for (let bit = length - 1; bit >= 0; bit -= 1) {
      this.#buffer = (this.#buffer << 1) | ((value >> bit) & 1);
      this.#count += 1;
      if (this.#count === 8) this.#emit();
    }
  }

  /** Pads the last byte with 1s, as the spec asks. */
  finish(): number[] {
    while (this.#count !== 0) this.bits(1, 1);
    return this.#bytes;
  }

  #emit(): void {
    this.#bytes.push(this.#buffer);
    // A 0xFF inside entropy-coded data would read as a marker; the spec stuffs a zero.
    if (this.#buffer === 0xff) this.#bytes.push(0x00);
    this.#buffer = 0;
    this.#count = 0;
  }
}

/** How many bits a coefficient's magnitude needs — JPEG calls it the category. */
function category(value: number): number {
  let magnitude = Math.abs(value);
  let bits = 0;
  while (magnitude > 0) {
    magnitude >>= 1;
    bits += 1;
  }
  return bits;
}

/** The extra bits after a category: the value itself, or its ones' complement if negative. */
function amplitude(value: number, bits: number): number {
  return value >= 0 ? value : value + (1 << bits) - 1;
}

function quantisation(quality: number): number[] {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  return BASE_LUMINANCE.map((base) =>
    Math.min(255, Math.max(1, Math.floor((base * scale + 50) / 100))),
  );
}

/** One 8×8 block through the DCT, quantised, in zigzag order. */
function transformBlock(samples: Float64Array, table: readonly number[]): Int32Array {
  const rows = new Float64Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let x = 0; x < 8; x += 1) sum += samples[y * 8 + x]! * COSINES[x * 8 + u]!;
      rows[y * 8 + u] = sum * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  const out = new Int32Array(64);
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) sum += rows[y * 8 + u]! * COSINES[y * 8 + v]!;
      const coefficient = (sum * (v === 0 ? Math.SQRT1_2 : 1)) / 4;
      out[v * 8 + u] = Math.round(coefficient / table[v * 8 + u]!);
    }
  }
  const zigzag = new Int32Array(64);
  for (let k = 0; k < 64; k += 1) zigzag[k] = out[ZIGZAG[k]!]!;
  return zigzag;
}

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

export function encodeJpeg(image: GrayscaleImage, quality = 75): Uint8Array {
  const table = quantisation(quality);
  const { width, height } = image;

  const header = [
    0xff,
    0xd8, // SOI
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]), // JFIF 1.1
    ...segment(0xdb, [0x00, ...ZIGZAG.map((natural) => table[natural]!)]),
    // SOF0: 8-bit precision, one component (id 1, no subsampling, quantisation table 0).
    ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xc4, [0x00, ...DC_BITS, ...DC_VALUES]),
    ...segment(0xc4, [0x10, ...AC_BITS, ...AC_VALUES]),
    // SOS: one component using DC table 0 and AC table 0, full spectral range.
    ...segment(0xda, [1, 1, 0x00, 0, 63, 0]),
  ];

  const writer = new BitWriter();
  const samples = new Float64Array(64);
  let previousDc = 0;

  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          // Partial blocks at the right and bottom edges repeat the last row and column.
          const sampleX = Math.min(blockX + x, width - 1);
          const sampleY = Math.min(blockY + y, height - 1);
          samples[y * 8 + x] = (image.sample(sampleX, sampleY) & 0xff) - 128;
        }
      }
      const block = transformBlock(samples, table);

      const difference = block[0]! - previousDc;
      previousDc = block[0]!;
      const dcBits = category(difference);
      writer.write(DC_TABLE[dcBits]!);
      writer.bits(amplitude(difference, dcBits), dcBits);

      let run = 0;
      for (let k = 1; k < 64; k += 1) {
        const value = block[k]!;
        if (value === 0) {
          run += 1;
          continue;
        }
        while (run > 15) {
          writer.write(AC_TABLE[ZERO_RUN_16]!);
          run -= 16;
        }
        const acBits = category(value);
        writer.write(AC_TABLE[(run << 4) | acBits]!);
        writer.bits(amplitude(value, acBits), acBits);
        run = 0;
      }
      if (run > 0) writer.write(AC_TABLE[END_OF_BLOCK]!);
    }
  }

  return Uint8Array.from([...header, ...writer.finish(), 0xff, 0xd9]);
}
