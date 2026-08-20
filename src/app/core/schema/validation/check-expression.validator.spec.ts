import { describe, expect, it } from 'vitest';
import { checkExpressionError } from './check-expression.validator';

describe('checkExpressionError', () => {
  it('accepts common logical SQL expressions', () => {
    expect(checkExpressionError('price > 0')).toBeNull();
    expect(checkExpressionError("status in ('draft', 'published')")).toBeNull();
    expect(checkExpressionError('(stock >= 0 and stock < 10000)')).toBeNull();
  });

  it('reports incomplete or unsafe expressions', () => {
    expect(checkExpressionError('')).toContain('logical expression');
    expect(checkExpressionError('(price > 0')).toContain('parenthesis');
    expect(checkExpressionError("status = 'draft")).toContain('quoted');
    expect(checkExpressionError('price > 0; drop table products')).toContain('not allowed');
  });
});
