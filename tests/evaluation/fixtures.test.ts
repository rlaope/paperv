import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generationErrorCodeSchema } from '../../src/api/generation'
import { generationErrorCopy } from '../../src/features/transform/TransformDialog'

const paper = z.object({
  id: z.string().min(1), title: z.string().min(1), authors: z.array(z.string()).min(1),
  year: z.number().int(), domain: z.string().min(1), sourceUrl: z.string().url(),
  fixtureKind: z.literal('metadata-placeholder'), rightsNote: z.string().min(1)
}).strict()
const rubric = z.object({ blind: z.literal(true), scale: z.tuple([z.literal(1), z.literal(5)]), dimensions: z.array(z.object({ id: z.string(), description: z.string(), anchors: z.object({ '1': z.string(), '3': z.string(), '5': z.string() }) })).min(5) })

describe('evaluation corpus contract', () => {
  it('versions exactly five safe metadata-only paper fixtures', () => {
    const data = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/golden-papers.json'), 'utf8')) as unknown
    const parsed = z.array(paper).length(5).parse(data)
    expect(new Set(parsed.map((item) => item.domain)).size).toBe(5)
  })

  it('provides an anchored blind human evaluation rubric', () => {
    const data = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/human-rubric.json'), 'utf8')) as unknown
    expect(rubric.parse(data).blind).toBe(true)
  })

  it('keeps every closed transform failure family bounded and actionable', () => {
    for (const code of generationErrorCodeSchema.options) {
      const copy = generationErrorCopy(code)
      expect(copy.length, code).toBeGreaterThan(10)
      expect(copy.length, code).toBeLessThanOrEqual(120)
      expect(copy, code).not.toContain(code)
      expect(copy, code).not.toMatch(/stderr|stdout|\/tmp|stack trace/iu)
    }
  })
})
