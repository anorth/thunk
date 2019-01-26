// Adapted from https://github.com/lafikl/median/blob/master/median.js
// Available under MIT license
export function median(values: number[]): number {
  if (values.length === 1) {
    return values[0];
  }

  values.sort((a, b) => a - b);

  const half = Math.floor(values.length / 2);

  if (values.length % 2) {
    return values[half];
  } else {
    return (values[half - 1] + values[half]) / 2.0;
  }
}
