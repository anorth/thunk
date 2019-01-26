/**
 * Operates on batches from sequences.
 */
export class Batch {
  public static ofSize(batchSize: number) {
    return new Batch(batchSize);
  }

  private readonly number: number;

  constructor(batchSize: number) {
    this.number = batchSize;
  }

  /** Splits an array in arrays of at most batch size. */
  public seq<T>(src: T[]): T[][] {
    const ret: T[][] = [];
    for (let i = 0; i < src.length; i += this.number) {
      ret.push(src.slice(i, i + this.number));
    }
    return ret;
  }
}
