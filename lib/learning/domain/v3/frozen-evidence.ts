import { createHash } from 'node:crypto'

const LABEL_PATTERN = /\[(S\d+)\]/giu
const MAX_LABELLED_EVIDENCE_CHARS = 8_000

export interface FrozenEvidenceEntry {
  label: string
  text: string
  sha256: string
}

export interface FrozenEvidenceSet {
  version: 'frozen-evidence-v3'
  sourceSetId: string
  sourceText: string
  entries: FrozenEvidenceEntry[]
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalize(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim()
}

function uniqueEntries(entries: FrozenEvidenceEntry[]): FrozenEvidenceEntry[] {
  const labels = new Set<string>()
  return entries.filter((entry) => {
    if (!entry.text || labels.has(entry.label)) return false
    labels.add(entry.label)
    return true
  })
}

function entriesFromExistingLabels(source: string): FrozenEvidenceEntry[] {
  const matches = [...source.matchAll(LABEL_PATTERN)]
  if (matches.length === 0) return []

  return uniqueEntries(
    matches.map((match, index) => {
      const label = match[1].toLocaleUpperCase()
      const start = match.index ?? 0
      const end = matches[index + 1]?.index ?? source.length
      // A selected primary source (notably a GitHub README) can contain its
      // installation, security, and recovery evidence in different sections.
      // Retaining a full bounded document is necessary for a course to teach
      // those distinct decisions instead of repeatedly citing its first line.
      const text = normalize(source.slice(start, end).replace(LABEL_PATTERN, '')).slice(0, MAX_LABELLED_EVIDENCE_CHARS)
      return { label, text, sha256: hash(text) }
    }),
  )
}

function sourceSections(source: string): string[] {
  const sections = source
    .split(/\n{2,}|(?=^#{1,6}\s)/gmu)
    .map(normalize)
    .filter((section) => section.length >= 80)

  if (sections.length > 0) return sections
  return source ? [source] : []
}

function entriesFromUnlabeledSource(source: string): FrozenEvidenceEntry[] {
  const sections = sourceSections(source)
  const chunks: string[] = []
  for (const section of sections) {
    for (let offset = 0; offset < section.length && chunks.length < 16; offset += 2_800) {
      const chunk = section.slice(offset, offset + 2_800).trim()
      if (chunk) chunks.push(chunk)
    }
    if (chunks.length >= 16) break
  }

  return chunks.map((text, index) => ({
    label: `S${index + 1}`,
    text,
    sha256: hash(text),
  }))
}

/**
 * Turns the already-selected canonical source set into immutable, auditable
 * evidence blocks. It never searches, summarizes, or invents evidence; when
 * the upstream source lacks labels, it adds labels around exact excerpts.
 */
export function freezeCanonicalEvidence(sourceText: string): FrozenEvidenceSet {
  const source = normalize(sourceText)
  const entries = entriesFromExistingLabels(source)
  const selected = entries.length > 0 ? entries : entriesFromUnlabeledSource(source)
  const rendered = selected
    .map((entry) => `## Frozen evidence [${entry.label}]\n${entry.text}`)
    .join('\n\n')
    .trim()

  return {
    version: 'frozen-evidence-v3',
    sourceSetId: `src_${hash(rendered).slice(0, 32)}`,
    sourceText: rendered,
    entries: selected,
  }
}
