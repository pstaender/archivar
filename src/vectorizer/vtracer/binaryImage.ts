import { BoundingRect } from "./geometry";

/** visioncortex `BinaryImage`: one byte per pixel, 1 = set. */
export class BinaryImage {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(width * height);
  }

  get(x: number, y: number): boolean {
    return this.data[y * this.width + x] === 1;
  }

  /** Out of bounds is unset. */
  getSafe(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.data[y * this.width + x] === 1;
  }

  set(x: number, y: number, value: boolean): void {
    this.data[y * this.width + x] = value ? 1 : 0;
  }

  negative(): BinaryImage {
    const data = new Uint8Array(this.data.length);
    for (let i = 0; i < data.length; i++) data[i] = this.data[i] === 1 ? 0 : 1;
    return new BinaryImage(this.width, this.height, data);
  }

  clone(): BinaryImage {
    return new BinaryImage(this.width, this.height, this.data.slice());
  }

  /** Top left pixel in scan order, where the boundary walk starts (`Shape::image_boundary_and_position_length`). */
  firstPixel(): { x: number; y: number } | null {
    const i = this.data.indexOf(1);
    return i < 0 ? null : { x: i % this.width, y: Math.floor(i / this.width) };
  }

  /** Connected components of the set pixels (`BinaryImage::to_clusters`). */
  toClusters(diagonal: boolean): BinaryCluster[] {
    const { width, height } = this;
    const clusters: BinaryCluster[] = [];
    const labels = new Uint32Array(width * height);
    let next = 0;

    const combine = (from: number, to: number) => {
      const source = clusters[from]!;
      const target = clusters[to]!;
      for (let k = 0; k < source.xs.length; k++) {
        labels[source.ys[k]! * width + source.xs[k]!] = to;
        target.xs.push(source.xs[k]!);
        target.ys.push(source.ys[k]!);
      }
      source.xs = [];
      source.ys = [];
      target.rect.merge(source.rect);
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = this.getSafe(x, y);
        const up = this.getSafe(x, y - 1);
        const left = this.getSafe(x - 1, y);
        const upLeft = this.getSafe(x - 1, y - 1);
        let clusterUp = y > 0 ? labels[(y - 1) * width + x]! : 0;
        let clusterLeft = x > 0 ? labels[y * width + x - 1]! : 0;
        const clusterUpLeft = x > 0 && y > 0 ? labels[(y - 1) * width + x - 1]! : 0;
        if ((v || diagonal) && up && left && clusterLeft !== clusterUp) {
          if (clusters[clusterLeft]!.size <= clusters[clusterUp]!.size) {
            combine(clusterLeft, clusterUp);
            if (next > 0 && clusterLeft === next - 1 && next === clusters.length) next--;
            clusterLeft = clusterUp;
          } else {
            combine(clusterUp, clusterLeft);
            clusterUp = clusterLeft;
          }
        }
        if (!v) continue;
        let label: number;
        if (up) label = clusterUp;
        else if (left) label = clusterLeft;
        else if (upLeft && diagonal) label = clusterUpLeft;
        else {
          const cluster = new BinaryCluster();
          if (next < clusters.length) clusters[next] = cluster;
          else clusters.push(cluster);
          label = next++;
        }
        labels[y * width + x] = label;
        clusters[label]!.add(x, y);
      }
    }
    return clusters.filter((c) => c.size > 0);
  }
}

/** A connected group of pixels in the coordinates of the image it was found in (`clusters::Cluster`). */
export class BinaryCluster {
  xs: number[] = [];
  ys: number[] = [];
  readonly rect = new BoundingRect();

  get size(): number {
    return this.xs.length;
  }

  add(x: number, y: number): void {
    this.xs.push(x);
    this.ys.push(y);
    this.rect.addXY(x, y);
  }

  toBinaryImage(): BinaryImage {
    const { left, top } = this.rect;
    const image = new BinaryImage(this.rect.width, this.rect.height);
    for (let k = 0; k < this.xs.length; k++) image.set(this.xs[k]! - left, this.ys[k]! - top, true);
    return image;
  }
}
