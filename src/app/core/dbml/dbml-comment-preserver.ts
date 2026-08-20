interface Anchor {
  code: string;
  occurrence: number;
}

interface PreservedComment {
  text: string;
  inline: boolean;
  own?: Anchor;
  previous?: Anchor;
  next?: Anchor;
}

export function preserveDbmlComments(previous: string, generated: string): string {
  const comments = extractComments(previous);
  if (!comments.length) return generated;

  const generatedLines = generated.replace(/\n$/, '').split(/\r?\n/);
  const anchors = indexAnchors(generatedLines);
  const before = new Map<number, string[]>();
  const after = new Map<number, string[]>();
  const inline = new Map<number, string[]>();
  const unmatched: string[] = [];

  for (const comment of comments) {
    const ownIndex = resolveAnchor(comment.own, anchors);
    const nextIndex = resolveAnchor(comment.next, anchors);
    const previousIndex = resolveAnchor(comment.previous, anchors);
    if (comment.inline && ownIndex !== undefined) append(inline, ownIndex, comment.text);
    else if (nextIndex !== undefined) append(before, nextIndex, comment.text);
    else if (previousIndex !== undefined) append(after, previousIndex, comment.text);
    else unmatched.push(comment.text);
  }

  const output = [...unmatched];
  for (const [index, line] of generatedLines.entries()) {
    output.push(...(before.get(index) ?? []));
    const inlineComments = inline.get(index);
    output.push(inlineComments?.length ? `${line} ${inlineComments.join(' ')}` : line);
    output.push(...(after.get(index) ?? []));
  }
  return `${output.join('\n')}\n`;
}

function extractComments(source: string): PreservedComment[] {
  const lines = source.split(/\r?\n/);
  const lineAnchors = anchorsForLines(lines);
  const comments: PreservedComment[] = [];
  for (const [index, line] of lines.entries()) {
    const commentIndex = findLineComment(line);
    if (commentIndex < 0) continue;
    const code = line.slice(0, commentIndex).trim();
    const text = line.slice(commentIndex).trimEnd();
    comments.push({
      text,
      inline: Boolean(code),
      ...(code ? { own: lineAnchors[index] } : {}),
      previous: nearestAnchor(lineAnchors, index, -1),
      next: nearestAnchor(lineAnchors, index, 1),
    });
  }
  return comments;
}

function anchorsForLines(lines: string[]): Array<Anchor | undefined> {
  const counts = new Map<string, number>();
  return lines.map((line) => {
    const commentIndex = findLineComment(line);
    const code = normalizeCode(commentIndex < 0 ? line : line.slice(0, commentIndex));
    if (!code) return undefined;
    const occurrence = counts.get(code) ?? 0;
    counts.set(code, occurrence + 1);
    return { code, occurrence };
  });
}

function indexAnchors(lines: string[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const [index, line] of lines.entries()) {
    const code = normalizeCode(line);
    if (code) append(result, code, index);
  }
  return result;
}

function resolveAnchor(
  anchor: Anchor | undefined,
  indexes: Map<string, number[]>,
): number | undefined {
  return anchor ? indexes.get(anchor.code)?.[anchor.occurrence] : undefined;
}

function nearestAnchor(
  anchors: Array<Anchor | undefined>,
  start: number,
  direction: -1 | 1,
): Anchor | undefined {
  for (let index = start + direction; index >= 0 && index < anchors.length; index += direction) {
    if (anchors[index]) return anchors[index];
  }
  return undefined;
}

function findLineComment(line: string): number {
  let quote: "'" | '"' | '`' | null = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index]!;
    if (quote) {
      if (character === quote && line[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '/' && line[index + 1] === '/') return index;
  }
  return -1;
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}
