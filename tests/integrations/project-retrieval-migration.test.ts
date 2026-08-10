import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  // Git may materialize the same immutable SQL with LF or CRLF depending on
  // checkout policy. Hash canonical SQL text so the guard detects semantic
  // edits instead of reporting a platform-only line-ending change.
  return readFileSync(resolve('db/migrations/learning', name), 'utf8').replace(/\r\n/gu, '\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('0010 project retrieval migration contract', () => {
  it('keeps the already-applied project migrations immutable', () => {
    expect(sha256(migration('0008_learning_projects_sources.sql'))).toBe(
      'f4c607505ee4ced61bdca54c21a87d5db75958e87d9185453013872e486ea346',
    );
    expect(sha256(migration('0009_learning_project_propagation.sql'))).toBe(
      'd379963ca53f3911535e27842396b396e4169a21350c7ceea8cd2a4aa3c73f62',
    );
  });

  it('adds versioned lexical chunks, frozen runs, and owner-scoped citation integrity', () => {
    const sql = migration('0010_project_chunk_retrieval.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_source_indexes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS learning_source_chunks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS project_retrieval_runs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS project_retrieval_items');
    expect(sql).toContain('UNIQUE (owner_id, id)');
    expect(sql).toContain('FOREIGN KEY (owner_id, source_chunk_id)');
    expect(sql).toContain('REFERENCES learning_source_chunks(owner_id, id)');
    expect(sql).toContain("strategy IN ('lexical-diverse-v1')");
    expect(sql).toContain("index_version IN ('markdown-lexical-v1')");
  });
});
