export function columnNumberToLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1) {
    throw new RangeError('column must be a positive integer')
  }
  let remaining = column
  let letters = ''
  while (remaining > 0) {
    remaining -= 1
    letters = String.fromCharCode(65 + (remaining % 26)) + letters
    remaining = Math.floor(remaining / 26)
  }
  return letters
}

export function cellAddress(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 1) {
    throw new RangeError('row must be a positive integer')
  }
  return `${columnNumberToLetters(column)}${row}`
}

