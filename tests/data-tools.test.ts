import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import {
  dataTextLimit,
  parseCsv,
  transformData,
  transformDataRecipe,
  DataRecipeError,
  type DataRecipeStep,
  dataParameterLimit,
} from '../src/shared/dataTools'

const options = { indent: 2, csvDelimiter: ',' } as const
describe('Local data tools', () => {
  it('validates JSON without changing it and round-trips quoted literal text', async () => {
    const original = ' {"n":999999999999999999999,"n":1e1000} '
    expect(await transformData('json-validate', original, options)).toBe(original)
    await expect(transformData('json-validate', '{bad}', options)).rejects.toThrow('Invalid JSON')
    const text = 'Привет 👋\n"quoted" \\path <script>literal</script>'
    expect(
      await transformData(
        'json-unquote',
        await transformData('json-quote', text, options),
        options,
      ),
    ).toBe(text)
    for (const value of ['true', '123', '{}', '[]'])
      await expect(transformData('json-unquote', value, options)).rejects.toThrow('JSON string')
  })
  it('converts JSON Lines losslessly for nested values, numeric spellings and duplicate keys', async () => {
    const array =
      '[{"id":999999999999999999999,"id":-0,"note":"a,b\\n[]"},1e1000,[true,null],"Иван"]'
    const lines =
      '{"id":999999999999999999999,"id":-0,"note":"a,b\\n[]"}\n1e1000\n[true,null]\n"Иван"'
    expect(await transformData('json-ndjson', array, options)).toBe(lines)
    const roundTrip = await transformData(
      'ndjson-json',
      '\n' + lines.replaceAll('\n', '\r\n') + '\n  ',
      options,
    )
    expect(await transformData('json-minify', roundTrip, options)).toBe(array)
    expect(await transformData('json-ndjson', '[]', options)).toBe('')
    expect(await transformData('ndjson-json', ' \n ', options)).toBe('[]')
    await expect(transformData('json-ndjson', '{}', options)).rejects.toThrow('JSON array')
    await expect(transformData('ndjson-json', '1 2\n{}', options)).rejects.toThrow('Invalid JSON')
    await expect(transformData('ndjson-json', '{}\n'.repeat(10001), options)).rejects.toThrow(
      'too many records',
    )
  })
  it('handles Unicode case, whitespace and normalization forms', async () => {
    expect(await transformData('text-upper', 'Привет ß', options)).toBe('ПРИВЕТ SS')
    expect(await transformData('text-lower', 'ПРИВЕТ', options)).toBe('привет')
    expect(await transformData('text-trim', ' \n a \n b \n ', options)).toBe('a \n b')
    expect(await transformData('text-collapse', ' a\t b\r\n  c ', options)).toBe('a b c')
    expect(await transformData('text-normalize', 'е\u0308', options)).toBe('ё')
    expect(await transformData('text-normalize', 'ё', options, { normalization: 'NFD' })).toBe(
      'е\u0308',
    )
    expect(await transformData('text-normalize', '①', options, { normalization: 'NFKC' })).toBe('1')
    expect(await transformData('text-normalize', 'é', options, { normalization: 'NFKD' })).toBe(
      'e\u0301',
    )
    await expect(
      transformData('text-normalize', 'a', options, { normalization: 'bad' as 'NFC' }),
    ).rejects.toThrow('Unicode form')
  })
  it('removes empty lines, reverses order and sorts embedded numbers naturally', async () => {
    expect(await transformData('lines-empty', '\n a \r\n\t\rb\n', options)).toBe(' a \nb')
    expect(await transformData('lines-reverse', 'abc\r\nПривет\rc', options)).toBe('c\nПривет\nabc')
    expect(await transformData('lines-natural', 'item10\nitem2\nitem1', options)).toBe(
      'item1\nitem2\nitem10',
    )
  })
  it('filters literal matches and honors case without treating patterns as code', async () => {
    const input = 'A.* one\na.* two\nother\nA.* three'
    expect(await transformData('lines-include', input, options, { find: 'A.*' })).toBe(
      'A.* one\nA.* three',
    )
    expect(
      await transformData('lines-include', input, options, { find: 'A.*', matchCase: false }),
    ).toBe('A.* one\na.* two\nA.* three')
    expect(
      await transformData('lines-exclude', input, options, { find: 'a.*', matchCase: false }),
    ).toBe('other')
    await expect(transformData('lines-include', input, options)).rejects.toThrow('text to find')
  })
  it('replaces all literal matches and preserves special replacement syntax as text', async () => {
    expect(
      await transformData('text-replace', 'a.* A.* a.*', options, {
        find: 'a.*',
        replacement: '$& $1 {{name}}',
        matchCase: false,
      }),
    ).toBe('$& $1 {{name}} $& $1 {{name}} $& $1 {{name}}')
    expect(await transformData('text-replace', 'ababa', options, { find: 'a' })).toBe('bb')
    expect(
      await transformData('text-replace', '[x] (x) $x +x', options, {
        find: '(x)',
        replacement: '\\$&',
      }),
    ).toBe('[x] \\$& $x +x')
    await expect(transformData('text-replace', 'a', options, { find: '' })).rejects.toThrow(
      'text to find',
    )
  })
  it('splits and joins literal separators and decorates every line with literal affixes', async () => {
    expect(await transformData('text-split', '::a::b::', options, { delimiter: '::' })).toBe(
      '\na\nb\n',
    )
    expect(await transformData('text-split', 'a,b,c', options)).toBe('a\nb\nc')
    expect(await transformData('lines-join', 'a\r\nb\rc', options)).toBe('a, b, c')
    expect(await transformData('lines-join', 'a\nb', options, { delimiter: '' })).toBe('ab')
    expect(
      await transformData('lines-affix', 'a\n\nb', options, { prefix: '$(', suffix: '){{name}}' }),
    ).toBe('$(a){{name}}\n$(){{name}}\n$(b){{name}}')
    await expect(transformData('text-split', 'a', options, { delimiter: '' })).rejects.toThrow(
      'separator',
    )
  })
  it('normalizes all line-ending styles, including lone CR in files and text counts', async () => {
    expect(await transformData('lines-lf', 'a\rb\r\nc\n', options)).toBe('a\nb\nc\n')
    expect(await transformData('lines-crlf', 'a\rb\r\nc\n', options)).toBe('a\r\nb\r\nc\r\n')
    expect(await transformData('lines-sort', new TextEncoder().encode('b\ra\r\nc'), options)).toBe(
      'a\nb\nc',
    )
    expect(JSON.parse(await transformData('text-count', 'a\rb\r\nc', options)).lines).toBe(3)
  })
  it('calculates CRC-32 for exact bytes independently verified against GZIP trailers', async () => {
    for (const bytes of [
      new Uint8Array(),
      new TextEncoder().encode('123456789'),
      new TextEncoder().encode('Привет 👋'),
      new Uint8Array([239, 187, 191, 0, 255, 128, 13, 10]),
    ]) {
      const compressed = gzipSync(bytes)
      const expected = compressed
        .readUInt32LE(compressed.length - 8)
        .toString(16)
        .padStart(8, '0')
      expect(await transformData('crc32', bytes, options)).toBe(expected)
    }
    expect(await transformData('crc32', '123456789', options)).toBe('cbf43926')
  })
  it('bounds parameter-driven expansion before allocating very large outputs', async () => {
    await expect(
      transformData('text-replace', 'x'.repeat(dataTextLimit), options, {
        find: 'x',
        replacement: 'я'.repeat(512),
      }),
    ).rejects.toThrow('1 MB')
    await expect(
      transformData('lines-affix', '\n'.repeat(65536), options, { prefix: 'x'.repeat(1024) }),
    ).rejects.toThrow('1 MB')
    await expect(
      transformData('lines-join', '\n'.repeat(65536), options, { delimiter: 'я'.repeat(512) }),
    ).rejects.toThrow('1 MB')
    await expect(
      transformData('text-replace', 'abc', options, { find: 'x'.repeat(dataParameterLimit + 1) }),
    ).rejects.toThrow('1 KiB')
    const steps: DataRecipeStep[] = [
      { operation: 'lines-include', paused: false, options: { find: 'WARN' } },
      {
        operation: 'text-replace',
        paused: false,
        options: { find: 'WARN', replacement: 'warning' },
      },
      { operation: 'lines-join', paused: false, options: { delimiter: ' | ' } },
    ]
    const original = structuredClone(steps)
    expect(await transformDataRecipe(steps, 'INFO start\nWARN first\nWARN second', options)).toBe(
      'warning first | warning second',
    )
    expect(steps).toEqual(original)
    await expect(
      transformDataRecipe([{ operation: 'text-replace', paused: false }], 'input', options),
    ).rejects.toMatchObject({ stepIndex: 0, field: 'find' })
    await expect(
      transformDataRecipe(
        [{ operation: 'text-split', paused: false, options: { delimiter: '' } }],
        'input',
        options,
      ),
    ).rejects.toMatchObject({ stepIndex: 0, field: 'delimiter' })
  })
  it('formats and minifies JSON without rounding numbers or dropping duplicate keys', async () => {
    const input = '{"n":999999999999999999999,"n":1e1000,"zero":-0,"text":"a \\\" b","a":[{},[]]}'
    const formatted = await transformData('json-format', input, options)
    expect(formatted).toContain('999999999999999999999')
    expect(formatted).toContain('1e1000')
    expect(formatted).toContain('-0')
    expect(formatted.match(/"n":/g)).toHaveLength(2)
    expect(await transformData('json-minify', formatted, options)).toBe(input)
    expect(await transformData('json-format', '[1,{"two":2}]', { ...options, indent: 4 })).toBe(
      '[\n    1,\n    {\n        "two": 2\n    }\n]',
    )
  })
  it('rejects malformed JSON, deep indentation and oversized UTF-8 or output', async () => {
    await expect(transformData('json-format', '{bad}', options)).rejects.toThrow('Invalid JSON')
    await expect(
      transformData('json-format', '['.repeat(129) + '0' + ']'.repeat(129), options),
    ).rejects.toThrow('nesting')
    await expect(
      transformData('base64-encode', 'я'.repeat(dataTextLimit / 2 + 1), options),
    ).rejects.toThrow('1 MB')
    await expect(
      transformData('base64-encode', 'x'.repeat(dataTextLimit), options),
    ).rejects.toThrow('1 MB')
  })
  it('reads RFC-style CSV with quotes, Unicode, multiline fields and blank cells', async () => {
    const text = 'name,note,empty\r\n"Иван","a,b\n""quoted""",\r\n'
    expect(parseCsv(text, ',')).toEqual([
      ['name', 'note', 'empty'],
      ['Иван', 'a,b\n"quoted"', ''],
    ])
    expect(JSON.parse(await transformData('csv-json', text, options))).toEqual([
      { name: 'Иван', note: 'a,b\n"quoted"', empty: '' },
    ])
    expect(
      await transformData(
        'json-csv',
        '[{"name":"Иван","note":"a,b\\n\\"quoted\\"","empty":""}]',
        options,
      ),
    ).toBe('name,note,empty\r\nИван,"a,b\n""quoted""",')
  })
  it('supports semicolons and tabs and rejects ambiguous CSV structure', async () => {
    expect(
      JSON.parse(await transformData('csv-json', 'a;b\n1;2', { ...options, csvDelimiter: ';' })),
    ).toEqual([{ a: '1', b: '2' }])
    expect(
      JSON.parse(await transformData('csv-json', 'a\tb\n1\t2', { ...options, csvDelimiter: '\t' })),
    ).toEqual([{ a: '1', b: '2' }])
    for (const input of ['a,a\n1,2', 'a,b\n1', 'a,b\n"x"tail,2', 'a,b\n"unfinished,2'])
      await expect(transformData('csv-json', input, options)).rejects.toThrow()
  })
  it('preserves large JSON number spellings in CSV and does not mutate prototypes', async () => {
    expect(
      await transformData('json-csv', '[{"id":999999999999999999999,"value":1e1000}]', options),
    ).toBe('id,value\r\n999999999999999999999,1e1000')
    const converted = JSON.parse(
      await transformData('csv-json', '__proto__,constructor\nliteral,safe', options),
    )
    expect(Object.hasOwn(converted[0], '__proto__')).toBe(true)
    expect(converted[0].__proto__).toBe('literal')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    await expect(transformData('json-csv', '[{"nested":{}}]', options)).rejects.toThrow(
      'flat objects',
    )
  })
  it('round-trips Unicode through Base64, Base64url, URL components and hex', async () => {
    const input = 'Привет 👋 / + &=\n'
    for (const [encode, decode] of [
      ['base64-encode', 'base64-decode'],
      ['base64url-encode', 'base64url-decode'],
      ['url-encode', 'url-decode'],
      ['hex-encode', 'hex-decode'],
    ] as const)
      expect(
        await transformData(decode, await transformData(encode, input, options), options),
      ).toBe(input)
    expect(await transformData('base64url-encode', 'a', options)).toBe('YQ')
  })
  it('rejects invalid encodings and invalid UTF-8 without replacement characters', async () => {
    for (const [operation, input] of [
      ['base64-decode', '!!!'],
      ['base64-decode', '/w=='],
      ['base64url-decode', 'Y'],
      ['url-decode', '%xx'],
      ['hex-decode', '0'],
      ['hex-decode', 'ff'],
    ] as const)
      await expect(transformData(operation, input, options)).rejects.toThrow()
    expect(await transformData('html-encode', '<a "x">&\'', options)).toBe(
      '&lt;a &quot;x&quot;&gt;&amp;&#39;',
    )
  })
  it('calculates standard SHA digests for UTF-8 text', async () => {
    for (const operation of ['sha1', 'sha256', 'sha512'] as const)
      expect(await transformData(operation, 'Привет 👋', options)).toBe(
        createHash(operation).update('Привет 👋').digest('hex'),
      )
    expect(await transformData('sha256', '', options)).toBe(createHash('sha256').digest('hex'))
  })
  it('processes lines and counts code points and UTF-8 bytes', async () => {
    expect(await transformData('lines-unique', 'b\r\na\r\nb', options)).toBe('b\na')
    expect(await transformData('lines-sort', 'b\na\nc', options)).toBe('a\nb\nc')
    expect(await transformData('lines-trim', ' a \n b ', options)).toBe('a\nb')
    expect(JSON.parse(await transformData('text-count', 'я 👋\n', options))).toEqual({
      characters: 4,
      words: 2,
      lines: 2,
      utf8Bytes: 8,
    })
  })
  it('hashes and encodes exact file bytes, including BOM and non-UTF-8 bytes', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0, 0xff, 0x80, 13, 10])
    const original = bytes.slice()
    for (const operation of ['sha1', 'sha256', 'sha512'] as const)
      expect(await transformData(operation, bytes, options)).toBe(
        createHash(operation).update(bytes).digest('hex'),
      )
    expect(await transformData('base64-encode', bytes, options)).toBe(
      Buffer.from(bytes).toString('base64'),
    )
    expect(await transformData('base64url-encode', bytes, options)).toBe(
      Buffer.from(bytes).toString('base64url'),
    )
    expect(await transformData('hex-encode', bytes, options)).toBe('efbbbf00ff800d0a')
    await expect(transformData('lines-trim', bytes, options)).rejects.toThrow('UTF-8 text file')
    expect(bytes).toEqual(original)
  })
  it('formats UTF-8 files and rejects oversized files and expanded byte output', async () => {
    expect(
      await transformData('json-minify', new TextEncoder().encode('\uFEFF{ "a": 1 }'), options),
    ).toBe('{"a":1}')
    await expect(
      transformData('sha256', new Uint8Array(dataTextLimit + 1), options),
    ).rejects.toThrow('1 MB')
    await expect(
      transformData('hex-encode', new Uint8Array(dataTextLimit), options),
    ).rejects.toThrow('1 MB')
  })
  it('runs ordered recipes, retaining paused steps and allowing duplicate operations', async () => {
    const steps: DataRecipeStep[] = [
      { operation: 'lines-trim', paused: false },
      { operation: 'json-format', paused: true },
      { operation: 'lines-unique', paused: false },
      { operation: 'lines-sort', paused: false },
      { operation: 'base64-encode', paused: false },
      { operation: 'base64-encode', paused: false },
    ]
    const original = structuredClone(steps)
    expect(await transformDataRecipe(steps, ' b \n a \n b ', options)).toBe('WVFwaQ==')
    expect(steps).toEqual(original)
    expect(await transformDataRecipe([], ' unchanged ', options)).toBe(' unchanged ')
    expect(
      await transformDataRecipe(
        steps.map((step) => ({ ...step, paused: true })),
        '',
        options,
      ),
    ).toBe('')
    expect(
      await transformDataRecipe(
        [
          { operation: 'json-format', paused: true },
          { operation: 'sha256', paused: false },
          { operation: 'base64-encode', paused: false },
        ],
        new Uint8Array([255, 0]),
        options,
      ),
    ).toBe(
      Buffer.from(
        createHash('sha256')
          .update(new Uint8Array([255, 0]))
          .digest('hex'),
      ).toString('base64'),
    )
  })
  it('reports the failing step and bounds every intermediate result and recipe length', async () => {
    const failure = await transformDataRecipe(
      [
        { operation: 'lines-trim', paused: false },
        { operation: 'json-format', paused: false },
        { operation: 'base64-encode', paused: false },
      ],
      ' broken ',
      options,
    ).catch((error) => error)
    expect(failure).toBeInstanceOf(DataRecipeError)
    expect(failure.stepIndex).toBe(1)
    expect(failure.message).toBe('Invalid JSON.')
    await expect(
      transformDataRecipe(
        [
          { operation: 'hex-encode', paused: false },
          { operation: 'sha256', paused: false },
        ],
        'x'.repeat(dataTextLimit),
        options,
      ),
    ).rejects.toMatchObject({ stepIndex: 0 })
    await expect(
      transformDataRecipe(
        Array.from({ length: 33 }, () => ({ operation: 'sha256', paused: true })),
        '',
        options,
      ),
    ).rejects.toThrow('32 actions')
  })
  it('stops an aborted recipe after a pending digest instead of continuing its steps', async () => {
    const abort = new AbortController()
    let finish!: (value: ArrayBuffer) => void
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    )
    try {
      const result = transformDataRecipe(
        [
          { operation: 'sha256', paused: false },
          { operation: 'sha512', paused: false },
        ],
        'old input',
        options,
        abort.signal,
      )
      abort.abort()
      finish(new Uint8Array([1, 2]).buffer)
      await expect(result).rejects.toMatchObject({ name: 'AbortError' })
      expect(digest).toHaveBeenCalledTimes(1)
      await expect(transformDataRecipe([], '', options, abort.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
    } finally {
      digest.mockRestore()
    }
  })
})
