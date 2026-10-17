import { z } from 'zod'

export interface DocNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: DocNode[]
}
export const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().max(80),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() }))
      .optional(),
    content: z.array(nodeSchema).optional(),
  }),
)
