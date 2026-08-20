export function checkExpressionError(expression: string): string | null {
  const value = expression.trim();
  if (!value) return 'Enter a logical expression.';
  if (value.length > 500) return 'The expression cannot exceed 500 characters.';
  if (/;|--|\/\*/.test(value)) return 'Statements and SQL comments are not allowed.';

  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === quote) {
        if (value[index + 1] === quote) index += 1;
        else quote = null;
      } else if (character === '\\') index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) return 'There is an unmatched closing parenthesis.';
    }
  }
  if (quote) return 'There is an unclosed quoted value.';
  if (depth) return 'There is an unclosed parenthesis.';
  if (!/(?:[=!<>]=?|<>|\b(?:is|in|like|between|and|or|not)\b)/i.test(value)) {
    return 'The expression must contain a logical or comparison operator.';
  }
  return null;
}
