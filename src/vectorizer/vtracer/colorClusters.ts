/**
 * Hierarchical color clustering (visioncortex `color_clusters`): stage 1 groups neighbouring pixels of the same color,
 * stage 2 merges clusters into their most similar neighbour, smallest first, and keeps the ones that differ enough
 * as layers of their own.
 */
import { BinaryImage } from "./binaryImage";
import { BoundingRect } from "./geometry";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

export interface ClusterConfig {
  diagonal: boolean;
  /** Minimum area (px) of a cluster kept as a layer; 0 also turns off the rejection of thread-like clusters. */
  goodMinArea: number;
  goodMaxArea: number;
  /** Bits dropped before colors are compared. */
  isSameColorA: number;
  isSameColorB: number;
  /** Minimum color difference to the closest neighbour for a cluster to become a layer. */
  deepenDiff: number;
  hollowNeighbours: number;
}

class ColorSum {
  r = 0;
  g = 0;
  b = 0;
  counter = 0;

  add(r: number, g: number, b: number): void {
    this.r += r;
    this.g += g;
    this.b += b;
    this.counter++;
  }

  merge(other: ColorSum): void {
    this.r += other.r;
    this.g += other.g;
    this.b += other.b;
    this.counter += other.counter;
  }

  clear(): void {
    this.r = this.g = this.b = this.counter = 0;
  }

  copyFrom(other: ColorSum): void {
    this.r = other.r;
    this.g = other.g;
    this.b = other.b;
    this.counter = other.counter;
  }

  average(): Color {
    const n = this.counter;
    return { r: Math.floor(this.r / n), g: Math.floor(this.g / n), b: Math.floor(this.b / n) };
  }
}

class Cluster {
  indices: number[] = [];
  holes: number[] = [];
  readonly sum = new ColorSum();
  readonly residueSum = new ColorSum();
  readonly rect = new BoundingRect();

  get area(): number {
    return this.indices.length;
  }

  add(i: number, r: number, g: number, b: number, x: number, y: number): void {
    this.indices.push(i);
    this.sum.add(r, g, b);
    this.rect.addXY(x, y);
  }
}

/** A layer of the result: its pixels (holes not punched) and its color. */
export interface ColorLayer {
  mask: BinaryImage;
  left: number;
  top: number;
  color: Color;
}

const ZERO = 0;

export function colorDiff(a: Color, b: Color): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Runs both stages and returns the layers bottom (largest) to top. */
export function clusterColors(image: RgbaImage, config: ClusterConfig): ColorLayer[] {
  return new ClusterBuilder(image, config).run();
}

class ClusterBuilder {
  private readonly width: number;
  private readonly height: number;
  private readonly pixels: Uint8Array | Uint8ClampedArray;
  private readonly clusters: Cluster[] = [new Cluster()];
  private readonly clusterIndices: Uint32Array;
  private clusterAreas: { area: number; count: number }[] = [];
  /** Clusters by area, so stage 2 does not scan all clusters for every area; entries may be stale. */
  private readonly byArea = new Map<number, number[]>();
  private readonly output: number[] = [];
  private nextIndex = 1;

  constructor(
    image: RgbaImage,
    private readonly config: ClusterConfig,
  ) {
    this.width = image.width;
    this.height = image.height;
    this.pixels = image.data;
    this.clusterIndices = new Uint32Array(image.width * image.height);
  }

  run(): ColorLayer[] {
    this.stage1();
    this.prepareStage2();
    for (let level = 0; level < this.clusterAreas.length; level++) this.stage2(level);
    return this.layers();
  }

  private isSame(a: number, b: number): boolean {
    if (a < 0 || b < 0) return false;
    const shift = this.config.isSameColorA;
    const threshold = this.config.isSameColorB;
    const p = this.pixels;
    return (
      Math.abs((p[a]! >> shift) - (p[b]! >> shift)) <= threshold &&
      Math.abs((p[a + 1]! >> shift) - (p[b + 1]! >> shift)) <= threshold &&
      Math.abs((p[a + 2]! >> shift) - (p[b + 2]! >> shift)) <= threshold
    );
  }

  /** Byte offset of the pixel, -1 outside the image (only up and left are asked for). */
  private offset(x: number, y: number): number {
    return x < 0 || y < 0 ? -1 : (y * this.width + x) * 4;
  }

  private stage1(): void {
    const { width, clusters, clusterIndices } = this;
    const { diagonal } = this.config;
    const p = this.pixels;
    for (let i = 0; i < clusterIndices.length; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const color = this.offset(x, y);
      const up = this.offset(x, y - 1);
      const left = this.offset(x - 1, y);
      const upLeft = this.offset(x - 1, y - 1);
      let clusterUp = y > 0 ? clusterIndices[i - width]! : ZERO;
      let clusterLeft = x > 0 ? clusterIndices[i - 1]! : ZERO;
      const clusterUpLeft = x > 0 && y > 0 ? clusterIndices[i - width - 1]! : ZERO;

      if (clusterLeft !== clusterUp && this.isSame(left, up) && (diagonal || (this.isSame(color, left) && this.isSame(color, up)))) {
        if (clusters[clusterLeft]!.area <= clusters[clusterUp]!.area) {
          this.combine(clusterLeft, clusterUp);
          if (clusterLeft === this.nextIndex - 1 && this.nextIndex === clusters.length) this.nextIndex--;
          clusterLeft = clusterUp;
        } else {
          this.combine(clusterUp, clusterLeft);
          clusterUp = clusterLeft;
        }
      }

      const r = p[color]!;
      const g = p[color + 1]!;
      const b = p[color + 2]!;
      let target: number;
      if (this.isSame(color, up) && this.isSame(color, upLeft)) target = clusterUp;
      else if (this.isSame(color, left) && this.isSame(color, upLeft)) target = clusterLeft;
      else if (diagonal && this.isSame(color, upLeft)) target = clusterUpLeft;
      else {
        const cluster = new Cluster();
        if (this.nextIndex < clusters.length) clusters[this.nextIndex] = cluster;
        else clusters.push(cluster);
        target = this.nextIndex++;
      }
      clusterIndices[i] = target;
      clusters[target]!.add(i, r, g, b, x, y);
    }
  }

  private prepareStage2(): void {
    const counts = new Map<number, number>();
    this.clusters.forEach((cluster, index) => {
      cluster.residueSum.copyFrom(cluster.sum);
      if (cluster.area === 0) return;
      counts.set(cluster.area, (counts.get(cluster.area) ?? 0) + 1);
      this.bucket(cluster.area).push(index);
    });
    this.clusterAreas = [...counts].map(([area, count]) => ({ area, count })).sort((a, b) => a.area - b.area);
  }

  private bucket(area: number): number[] {
    let list = this.byArea.get(area);
    if (!list) this.byArea.set(area, (list = []));
    return list;
  }

  private stage2(level: number): void {
    const { area: currentArea, count } = this.clusterAreas[level]!;
    if (count === 0) return;
    const candidates = [...new Set(this.byArea.get(currentArea) ?? [])].sort((a, b) => a - b);
    this.byArea.delete(currentArea);
    for (const index of candidates) {
      const cluster = this.clusters[index]!;
      if (cluster.area !== currentArea) continue;
      const color = cluster.sum.average();
      const infos = this.neighbours(cluster, index)
        // Merged-away clusters have no sum left to rank.
        .filter((other) => this.clusters[other]!.sum.counter > 0)
        .map((other) => ({ index: other, diff: colorDiff(color, this.clusters[other]!.sum.average()) }));

      if (infos.length === 0) {
        // The final background, which has nothing left to merge into.
        if (level === this.clusterAreas.length - 1) this.output.push(index);
        continue;
      }
      infos.sort((a, b) => a.diff * 65535 + a.index - (b.diff * 65535 + b.index));
      const target = infos[0]!.index;
      const deepen = infos[0]!.diff > this.config.deepenDiff && this.patchGood(cluster);
      const hollow = infos.length <= this.config.hollowNeighbours;
      if (deepen) this.output.push(index);

      const targetArea = this.clusters[target]!.area;
      this.clusterAreas[this.findArea(targetArea)]!.count--;
      this.mergeInto(index, target, deepen, hollow);
      const updated = this.clusters[target]!.area;
      const position = this.findArea(updated);
      if (this.clusterAreas[position]?.area === updated) this.clusterAreas[position]!.count++;
      else this.clusterAreas.splice(position, 0, { area: updated, count: 1 });
      this.bucket(updated).push(target);
    }
  }

  /** Index of the area, or where it would be inserted. */
  private findArea(area: number): number {
    let low = 0;
    let high = this.clusterAreas.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.clusterAreas[mid]!.area < area) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private neighbours(cluster: Cluster, myself: number): number[] {
    const { width, height, clusterIndices } = this;
    const found = new Set<number>();
    for (const i of cluster.indices) {
      const x = i % width;
      const y = (i - x) / width;
      const up = y > 0 ? clusterIndices[i - width]! : ZERO;
      const down = y < height - 1 ? clusterIndices[i + width]! : ZERO;
      const left = x > 0 ? clusterIndices[i - 1]! : ZERO;
      const right = x < width - 1 ? clusterIndices[i + 1]! : ZERO;
      if (up !== ZERO && up !== myself) found.add(up);
      if (down !== ZERO && down !== myself) found.add(down);
      if (left !== ZERO && left !== myself) found.add(left);
      if (right !== ZERO && right !== myself) found.add(right);
    }
    return [...found].sort((a, b) => a - b);
  }

  /** Large enough, and not thread-like (thinner than 2 px). */
  private patchGood(cluster: Cluster): boolean {
    const { goodMinArea, goodMaxArea } = this.config;
    if (!(goodMinArea < cluster.area && cluster.area < goodMaxArea)) return false;
    return goodMinArea === 0 || this.perimeter(cluster) < cluster.area;
  }

  /** Number of boundary pixels of the cluster with its holes punched out. */
  private perimeter(cluster: Cluster): number {
    const { rect } = cluster;
    const w = rect.width;
    const h = rect.height;
    const mask = new Uint8Array(w * h);
    const local = (i: number) => {
      const x = i % this.width;
      return ((i - x) / this.width - rect.top) * w + x - rect.left;
    };
    for (const i of cluster.indices) mask[local(i)] = 1;
    for (const i of cluster.holes) mask[local(i)] = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (mask[k] !== 1) continue;
        if (x === 0 || mask[k - 1] !== 1 || x === w - 1 || mask[k + 1] !== 1 || y === 0 || mask[k - w] !== 1 || y === h - 1 || mask[k + w] !== 1) count++;
      }
    }
    return count;
  }

  private mergeInto(from: number, to: number, deepen: boolean, hollow: boolean): void {
    const source = this.clusters[from]!;
    const target = this.clusters[to]!;
    if (!deepen) {
      target.residueSum.merge(source.residueSum);
      this.combine(from, to);
      return;
    }
    // The cluster stays a layer of its own, so it keeps its pixels, color and bounds while its area joins the target.
    const sum = new ColorSum();
    sum.copyFrom(source.sum);
    const rect = source.rect.clone();
    const indices = source.indices.slice();
    this.combine(from, to);
    source.sum.copyFrom(sum);
    source.rect.merge(rect);
    source.indices = indices;
    if (hollow) for (const i of indices) target.holes.push(i);
  }

  private combine(from: number, to: number): void {
    const source = this.clusters[from]!;
    const target = this.clusters[to]!;
    for (const i of source.indices) {
      this.clusterIndices[i] = to;
      target.indices.push(i);
    }
    source.indices = [];
    target.sum.merge(source.sum);
    target.rect.merge(source.rect);
    source.sum.clear();
    source.rect.clear();
  }

  private layers(): ColorLayer[] {
    const layers: ColorLayer[] = [];
    // A cluster can be merged away after being output, which leaves it empty.
    const output = this.output.filter((index) => this.clusters[index]!.sum.counter > 0);
    for (let k = output.length - 1; k >= 0; k--) {
      const cluster = this.clusters[output[k]!]!;
      const { left, top, width } = cluster.rect;
      const mask = new BinaryImage(width, cluster.rect.height);
      for (const i of cluster.indices) {
        const x = i % this.width;
        mask.data[((i - x) / this.width - top) * width + x - left] = 1;
      }
      layers.push({ mask, left, top, color: cluster.residueSum.average() });
    }
    return layers;
  }
}
