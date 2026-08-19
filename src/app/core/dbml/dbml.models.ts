import { DatabaseSchema } from '../schema';

export interface DbmlParser {
  parse(source: string): DbmlParseResult;
}

export interface DbmlGenerator {
  generate(schema: DatabaseSchema): string;
}

export interface DbmlParseResult {
  schema?: DatabaseSchema;
  errors: DbmlParseError[];
}

export interface DbmlParseError {
  message: string;
  line?: number;
  column?: number;
}
