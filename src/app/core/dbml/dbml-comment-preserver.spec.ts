import { describe, expect, it } from 'vitest';
import { preserveDbmlComments } from './dbml-comment-preserver';

describe('preserveDbmlComments', () => {
  it('keeps standalone and inline comments near their original statements', () => {
    const previous = `// Products
Table products {
  id uuid [pk] // Identifier
  // Current price
  price decimal
}
`;
    const generated = `Table products {
  id uuid [pk]
  price numeric
}
`;

    const result = preserveDbmlComments(previous, generated);
    expect(result).toContain('// Products');
    expect(result).toContain('id uuid [pk] // Identifier');
    expect(result).toContain('// Current price');
    expect(result).toContain('price numeric');
  });

  it('does not treat comment markers inside quoted values as comments', () => {
    const generated = "Table links {\n  url varchar [default: 'https://example.com']\n}\n";
    expect(preserveDbmlComments(generated, generated)).toBe(generated);
  });
});
