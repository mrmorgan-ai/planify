// Names are compared by their words, not their spelling: "Feature stores",
// "feature-store" and "Feature Store" are one name. Everything that matches a
// skill against text — the catalog's aliases, a suggestion, a closest name —
// reads both sides through here, so they can never disagree on what matches.

/** A text as the words it is compared by: lowercase, unaccented, singular. */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .map(singular)
}

/** The words of a name as one string: what two spellings of a name share. */
export function keyOf(name: string): string {
  return wordsOf(name).join(' ')
}

/** Whether `phrase` appears in `text`, word for word and in order. */
export function mentions(text: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > text.length) return false
  for (let start = 0; start + phrase.length <= text.length; start++) {
    if (phrase.every((word, offset) => text[start + offset] === word)) return true
  }
  return false
}

// Short words are left alone: "AWS", "k8s" and "MPS" are names, not plurals.
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}
