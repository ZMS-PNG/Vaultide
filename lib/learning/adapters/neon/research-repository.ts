import { createHash, randomUUID } from 'node:crypto';
import type {
  RecordResearchRunInput,
  RecordedResearchRun,
  ResearchCitationReference,
  ResearchRepository,
} from '../../domain/research';
import type { ResearchSourceHealth } from '../../domain/source-quality';
import { getLearningSql } from './client';

function identifier(prefix: 'rrn' | 'rsc'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class NeonResearchRepository implements ResearchRepository {
  async record(input: RecordResearchRunInput): Promise<RecordedResearchRun> {
    const runId = identifier('rrn');
    const createdAt = input.fetchedAt;
    const rows = input.sources.slice(0, 50).map((source, index) => {
      const citationId = source.citationId ?? `S${index + 1}`;
      const title = source.title.trim().slice(0, 500) || source.domain || 'Untitled source';
      const snippet = source.content.trim().slice(0, 1000);
      return {
        id: identifier('rsc'),
        ordinal: index + 1,
        citationId,
        title,
        url: source.url.slice(0, 4096),
        normalizedUrl: source.url.slice(0, 4096),
        domain: (source.domain ?? new URL(source.url).hostname).slice(0, 253),
        snippet,
        snippetHash: sha256(snippet),
        score: Number.isFinite(source.score) ? source.score : 0,
        authority: source.authority ?? 'general',
      };
    });
    if (rows.length === 0) throw new Error('research_run_requires_sources');

    await getLearningSql().query(
      `
        WITH inserted_run AS (
          INSERT INTO research_runs
            (id, owner_id, requested_provider, used_provider, provider_mode, query,
             source_policy, storage_policy, attempts, source_count, response_time_ms,
             fetched_at, created_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, 'citation-metadata-only', $8::jsonb,
             $9, $10, $11, $11)
          RETURNING id, owner_id
        )
        INSERT INTO research_sources
          (id, owner_id, run_id, ordinal, citation_id, title, url, normalized_url,
           domain, snippet, snippet_hash, score, authority, created_at)
        SELECT source.id, inserted_run.owner_id, inserted_run.id, source.ordinal,
               source.citation_id, source.title, source.url, source.normalized_url,
               source.domain, source.snippet, source.snippet_hash, source.score,
               source.authority, $11
        FROM inserted_run
        CROSS JOIN jsonb_to_recordset($12::jsonb) AS source(
          id text,
          ordinal integer,
          citation_id text,
          title text,
          url text,
          normalized_url text,
          domain text,
          snippet text,
          snippet_hash text,
          score double precision,
          authority text
        )
      `,
      [
        runId,
        input.ownerId,
        input.requestedProviderId,
        input.usedProviderId,
        input.providerMode,
        input.query.slice(0, 1000),
        input.sourcePolicy,
        JSON.stringify(input.attempts),
        rows.length,
        Math.max(0, Math.round(input.responseTimeMs)),
        createdAt,
        JSON.stringify(
          rows.map((row) => ({
            id: row.id,
            ordinal: row.ordinal,
            citation_id: row.citationId,
            title: row.title,
            url: row.url,
            normalized_url: row.normalizedUrl,
            domain: row.domain,
            snippet: row.snippet,
            snippet_hash: row.snippetHash,
            score: row.score,
            authority: row.authority,
          })),
        ),
      ],
    );

    const citations: ResearchCitationReference[] = rows.map((row) => ({
      citationId: row.citationId,
      title: row.title,
      url: row.url,
      domain: row.domain,
      authority: row.authority,
      score: row.score,
      snippetHash: row.snippetHash,
      availability: 'unverified',
    }));
    return { id: runId, citations };
  }

  async sourceHealth(ownerId: string, runId: string): Promise<ResearchSourceHealth[]> {
    const rows = (await getLearningSql().query(
      `
        SELECT citation_id, title, url, domain, authority, score, availability,
               checked_at, http_status, final_url, health_error
        FROM research_sources
        WHERE owner_id = $1 AND run_id = $2
        ORDER BY ordinal ASC
        LIMIT 50
      `,
      [ownerId, runId],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      citationId: String(row.citation_id),
      title: String(row.title),
      url: String(row.url),
      domain: String(row.domain),
      authority:
        row.authority === 'primary' || row.authority === 'authoritative'
          ? row.authority
          : 'general',
      score: Number(row.score ?? 0),
      availability:
        row.availability === 'available' ||
        row.availability === 'redirected' ||
        row.availability === 'unreachable' ||
        row.availability === 'unsafe'
          ? row.availability
          : 'unverified',
      ...(row.checked_at ? { checkedAt: new Date(String(row.checked_at)).toISOString() } : {}),
      ...(typeof row.http_status === 'number' ? { httpStatus: row.http_status } : {}),
      ...(row.final_url ? { finalUrl: String(row.final_url) } : {}),
      ...(row.health_error ? { errorKind: String(row.health_error) } : {}),
    }));
  }

  async updateSourceHealth(
    ownerId: string,
    runId: string,
    results: readonly ResearchSourceHealth[],
  ): Promise<ResearchSourceHealth[]> {
    if (results.length === 0) return this.sourceHealth(ownerId, runId);
    const checkedAt = new Date();
    await getLearningSql().query(
      `
        UPDATE research_sources source
        SET availability = result.availability,
            checked_at = result.checked_at,
            http_status = result.http_status,
            final_url = result.final_url,
            health_error = result.health_error
        FROM jsonb_to_recordset($3::jsonb) AS result(
          citation_id text,
          availability text,
          checked_at timestamptz,
          http_status integer,
          final_url text,
          health_error text
        )
        WHERE source.owner_id = $1
          AND source.run_id = $2
          AND source.citation_id = result.citation_id
      `,
      [
        ownerId,
        runId,
        JSON.stringify(
          results.map((result) => ({
            citation_id: result.citationId,
            availability: result.availability,
            checked_at: result.checkedAt ?? checkedAt.toISOString(),
            http_status: result.httpStatus ?? null,
            final_url: result.finalUrl ?? null,
            health_error: result.errorKind?.slice(0, 160) ?? null,
          })),
        ),
      ],
    );
    return this.sourceHealth(ownerId, runId);
  }
}
