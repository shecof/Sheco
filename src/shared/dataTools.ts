export const dataTextLimit = 1024 * 1024
export const dataOperations = [
  { id: 'json-format', label: 'Format JSON', group: 'Formatting' },
  { id: 'json-minify', label: 'Minify JSON', group: 'Formatting' },
  { id: 'json-validate', label: 'Validate JSON', group: 'Formatting' },
  { id: 'json-quote', label: 'Quote as JSON string', group: 'Formatting' },
  { id: 'json-unquote', label: 'Unquote JSON string', group: 'Formatting' },
  { id: 'json-ndjson', label: 'JSON array → JSON Lines', group: 'Formatting' },
  { id: 'ndjson-json', label: 'JSON Lines → JSON array', group: 'Formatting' },
  { id: 'xml-format', label: 'Format XML', group: 'Formatting' },
  { id: 'xml-minify', label: 'Minify XML', group: 'Formatting' },
  { id: 'csv-json', label: 'CSV → JSON', group: 'Formatting' },
  { id: 'json-csv', label: 'JSON → CSV', group: 'Formatting' },
  { id: 'base64-encode', label: 'Encode Base64', group: 'Encoding' },
  { id: 'base64-decode', label: 'Decode Base64', group: 'Encoding' },
  { id: 'base64url-encode', label: 'Encode Base64url', group: 'Encoding' },
  { id: 'base64url-decode', label: 'Decode Base64url', group: 'Encoding' },
  { id: 'url-encode', label: 'Encode URL component', group: 'Encoding' },
  { id: 'url-decode', label: 'Decode URL component', group: 'Encoding' },
  { id: 'hex-encode', label: 'UTF-8 → Hex', group: 'Encoding' },
  { id: 'hex-decode', label: 'Hex → UTF-8', group: 'Encoding' },
  { id: 'html-encode', label: 'Escape HTML', group: 'Encoding' },
  { id: 'html-decode', label: 'Decode HTML entities', group: 'Encoding' },
  { id: 'sha256', label: 'SHA-256', group: 'Hashes' },
  { id: 'sha512', label: 'SHA-512', group: 'Hashes' },
  { id: 'sha1', label: 'SHA-1', group: 'Hashes' },
  { id: 'crc32', label: 'CRC-32', group: 'Hashes' },
  { id: 'lines-sort', label: 'Sort lines', group: 'Text' },
  { id: 'lines-unique', label: 'Remove duplicate lines', group: 'Text' },
  { id: 'lines-trim', label: 'Trim each line', group: 'Text' },
  { id: 'text-count', label: 'Count text', group: 'Text' },
  { id: 'text-upper', label: 'Uppercase', group: 'Text' },
  { id: 'text-lower', label: 'Lowercase', group: 'Text' },
  { id: 'text-trim', label: 'Trim text', group: 'Text' },
  { id: 'text-collapse', label: 'Collapse whitespace', group: 'Text' },
  { id: 'text-normalize', label: 'Normalize Unicode', group: 'Text' },
  { id: 'lines-empty', label: 'Remove empty lines', group: 'Text' },
  { id: 'lines-reverse', label: 'Reverse lines', group: 'Text' },
  { id: 'lines-natural', label: 'Sort lines naturally', group: 'Text' },
  { id: 'lines-include', label: 'Keep matching lines', group: 'Text' },
  { id: 'lines-exclude', label: 'Remove matching lines', group: 'Text' },
  { id: 'text-replace', label: 'Replace text', group: 'Text' },
  { id: 'text-split', label: 'Split into lines', group: 'Text' },
  { id: 'lines-join', label: 'Join lines', group: 'Text' },
  { id: 'lines-affix', label: 'Add prefix and suffix', group: 'Text' },
  { id: 'lines-lf', label: 'Line endings → LF', group: 'Text' },
  { id: 'lines-crlf', label: 'Line endings → CRLF', group: 'Text' },
] as const
export type DataOperation = (typeof dataOperations)[number]['id']
export type DataOptions = { indent: 2 | 4; csvDelimiter: ',' | ';' | '\t' }
export type DataInput = string | Uint8Array<ArrayBuffer>
export const dataParameterLimit = 1024
export type DataStepOptions = {
  find?: string
  replacement?: string
  delimiter?: string
  prefix?: string
  suffix?: string
  matchCase?: boolean
  normalization?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'
}
export type DataRecipeStep = {
  operation: DataOperation
  paused: boolean
  options?: DataStepOptions
}
export function dataStepDelimiter(operation: DataOperation) {
  return operation === 'lines-join' ? ', ' : ','
}
export const dataRecipeLimit = 32
export class DataRecipeError extends Error {
  constructor(
    message: string,
    readonly stepIndex: number,
    readonly field?: keyof DataStepOptions,
  ) {
    super(message)
  }
}
class DataParameterError extends Error {
  constructor(
    message: string,
    readonly field: keyof DataStepOptions,
  ) {
    super(message)
  }
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
function checkSize(text: string) {
  if (encoder.encode(text).length > dataTextLimit) throw new Error('Data is limited to 1 MB.')
  return text
}
function inputBytes(input: DataInput) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  if (bytes.byteLength > dataTextLimit) throw new Error('Data is limited to 1 MB.')
  return bytes
}
function inputText(input: DataInput) {
  if (typeof input === 'string') return checkSize(input)
  try {
    return decoder.decode(inputBytes(input))
  } catch (error) {
    if (error instanceof TypeError) throw new Error('This action requires a UTF-8 text file.')
    throw error
  }
}
function dataLines(text: string) {
  return text.split(/\r\n|\r|\n/)
}
function boundedJoin(parts: Iterable<string>, separator: string) {
  const chunks: string[] = []
  const gap = encoder.encode(separator).length
  let bytes = 0
  for (const part of parts) {
    bytes += encoder.encode(part).length + (chunks.length ? gap : 0)
    if (bytes > dataTextLimit) throw new Error('Data is limited to 1 MB.')
    chunks.push(part)
  }
  return chunks.join(separator)
}
function checkParameters(options: DataStepOptions) {
  for (const field of ['find', 'replacement', 'delimiter', 'prefix', 'suffix'] as const) {
    const value = options[field]
    if (
      value !== undefined &&
      (typeof value !== 'string' || encoder.encode(value).length > dataParameterLimit)
    )
      throw new DataParameterError('Action settings are limited to 1 KiB.', field)
  }
}
function literalSearch(options: DataStepOptions, all = false) {
  if (!options.find) throw new DataParameterError('Enter the text to find.', 'find')
  return new RegExp(
    options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    (all ? 'g' : '') + (options.matchCase === false ? 'iu' : 'u'),
  )
}
function replaceLiteral(text: string, options: DataStepOptions) {
  const search = literalSearch(options, true)
  function* parts() {
    let end = 0
    for (const match of text.matchAll(search)) {
      yield text.slice(end, match.index)
      yield options.replacement ?? ''
      end = match.index + match[0].length
    }
    yield text.slice(end)
  }
  return boundedJoin(parts(), '')
}
// CRC-32/ISO-HDLC (IEEE), the checksum used by the GZIP format in RFC 1952.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}
function jsonTokens(text: string) {
  try {
    JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON.')
  }
  // Preserve number spellings and duplicate keys rather than round-trip through JS numbers/objects.
  return (
    text.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g,
    ) ?? []
  )
}
function formatJson(text: string, indent: number, minify: boolean) {
  const tokens = jsonTokens(text)
  if (minify) return tokens.join('')
  let depth = 0,
    result = ''
  const line = () => '\n' + ' '.repeat(depth * indent)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '{' || token === '[') {
      result += token
      if (tokens[i + 1] === (token === '{' ? '}' : ']')) result += tokens[++i]
      else {
        if (++depth > 128) throw new Error('Data nesting is too deep.')
        result += line()
      }
    } else if (token === '}' || token === ']') {
      depth--
      result += line() + token
    } else if (token === ',') result += ',' + line()
    else result += token === ':' ? ': ' : token
    if (result.length > dataTextLimit) checkSize(result)
  }
  return result
}
function jsonArrayToLines(text: string) {
  const tokens = jsonTokens(text)
  if (tokens[0] !== '[' || tokens.at(-1) !== ']') throw new Error('Use a JSON array.')
  const rows: string[] = []
  let depth = 1
  let value = ''
  for (const token of tokens.slice(1, -1)) {
    if (token === ',' && depth === 1) {
      rows.push(value)
      value = ''
    } else {
      if (token === '{' || token === '[') depth++
      if (token === '}' || token === ']') depth--
      if (depth > 128) throw new Error('Data nesting is too deep.')
      value += token
    }
    if (rows.length >= 10000) throw new Error('JSON Lines has too many records.')
  }
  if (value) rows.push(value)
  return boundedJoin(rows, '\n')
}
function linesToJsonArray(text: string, indent: number) {
  const rows = dataLines(text).filter((line) => line.trim())
  if (rows.length > 10000) throw new Error('JSON Lines has too many records.')
  return formatJson(
    '[' +
      boundedJoin(
        rows.map((line) => jsonTokens(line).join('')),
        ',',
      ) +
      ']',
    indent,
    false,
  )
}
export function parseCsv(text: string, delimiter: string): string[][] {
  checkSize(text)
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('Invalid CSV delimiter.')
  const rows: string[][] = [],
    row: string[] = []
  let value = '',
    quoted = false,
    closed = false
  function field() {
    row.push(value)
    value = ''
    closed = false
  }
  function end() {
    field()
    rows.push(row.splice(0))
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') value += c
      else if (text[i + 1] === '"') {
        value += '"'
        i++
      } else {
        quoted = false
        closed = true
      }
    } else if (c === delimiter) field()
    else if (c === '\r' || c === '\n') {
      end()
      if (c === '\r' && text[i + 1] === '\n') i++
    } else if (c === '"' && !value && !closed) quoted = true
    else if (closed || c === '"') throw new Error('Invalid CSV quoting.')
    else value += c
    if (rows.length > 10000 || row.length > 1000)
      throw new Error('CSV has too many rows or columns.')
  }
  if (quoted) throw new Error('Invalid CSV quoting.')
  if (value || row.length || closed || !/[\r\n]$/.test(text)) end()
  return rows
}
function csvToJson(text: string, options: DataOptions) {
  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''), options.csvDelimiter)
  if (
    !headers?.length ||
    headers.some((name) => !name.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error('CSV headers must be nonempty and unique.')
  if (rows.some((row) => row.length !== headers.length))
    throw new Error('CSV rows must match the header width.')
  return JSON.stringify(
    rows.map((row) => Object.fromEntries(headers.map((key, i) => [key, row[i]]))),
    null,
    options.indent,
  )
}
function jsonToCsv(text: string, options: DataOptions) {
  jsonTokens(text)
  const rows: unknown = JSON.parse(text, (_key, value, context?: { source?: string }) => {
    if (typeof value !== 'number') return value
    if (context?.source) return context.source
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new Error('JSON number cannot be converted without losing precision.')
    return String(value)
  })
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 10000 ||
    rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new Error('Use a nonempty JSON array of flat objects.')
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  if (
    !headers.length ||
    headers.length > 1000 ||
    rows.some((row) =>
      Object.values(row).some((value) => value !== null && typeof value === 'object'),
    )
  )
    throw new Error('Use a nonempty JSON array of flat objects.')
  function quote(value: unknown) {
    const text = value == null ? '' : String(value)
    return text.includes(options.csvDelimiter) || /["\r\n]/.test(text)
      ? '"' + text.replaceAll('"', '""') + '"'
      : text
  }
  return [
    headers,
    ...rows.map((row) => headers.map((key) => (Object.hasOwn(row, key) ? row[key] : ''))),
  ]
    .map((row) => row.map(quote).join(options.csvDelimiter))
    .join('\r\n')
}
function formatXml(text: string, indent: number, minify: boolean) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('XML declarations with DTD or entities are not supported.')
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (
    [...doc.getElementsByTagNameNS('*', 'parsererror')].some((node) =>
      [
        'http://www.mozilla.org/newlayout/xml/parsererror.xml',
        'http://www.w3.org/1999/xhtml',
      ].includes(node.namespaceURI ?? ''),
    )
  )
    throw new Error('Invalid XML.')
  const serializer = new XMLSerializer()
  let count = 0
  function render(node: Node, depth: number): string {
    if (++count > 20000 || depth > 64) throw new Error('Data nesting is too deep.')
    if (node.nodeType !== 1) return serializer.serializeToString(node)
    const element = node as Element
    const children = [...element.childNodes]
    // Mixed content and xml:space are significant: retain them exactly within the element.
    if (
      !children.length ||
      element.closest('[xml\\:space="preserve"]') ||
      children.some(
        (child) => child.nodeType === 4 || (child.nodeType === 3 && child.textContent?.trim()),
      )
    )
      return serializer.serializeToString(element)
    const useful = children.filter((child) => child.nodeType !== 3 || child.textContent?.trim())
    const shell = element.cloneNode(false) as Element
    const empty = serializer.serializeToString(shell)
    if (!useful.length) return empty
    const opening = empty.replace(/\s*\/>$/, '>')
    const gap = minify ? '' : '\n'
    const prefix = minify ? '' : ' '.repeat((depth + 1) * indent)
    const closing = minify ? '' : ' '.repeat(depth * indent)
    return (
      opening +
      gap +
      useful.map((child) => prefix + render(child, depth + 1)).join(gap) +
      gap +
      closing +
      `</${element.tagName}>`
    )
  }
  const declaration = text.match(/^\uFEFF?\s*(<\?xml\s[\s\S]*?\?>)/)?.[1]
  const body = [...doc.childNodes]
    .filter((node) => node.nodeType !== 3 || node.textContent?.trim())
    .map((node) => render(node, 0))
    .join(minify ? '' : '\n')
  return declaration ? declaration + (minify ? '' : '\n') + body : body
}
function base64Encode(bytes: Uint8Array, url: boolean) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  const result = btoa(binary)
  return url ? result.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : result
}
function base64Decode(text: string, url: boolean) {
  let value = text.replace(/\s/g, '')
  if (url) {
    if (!/^[\w-]*={0,2}$/.test(value)) throw new Error('Invalid Base64.')
    value = value.replaceAll('-', '+').replaceAll('_', '/')
    value += '='.repeat((4 - (value.length % 4)) % 4)
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid Base64.')
  try {
    return decoder.decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))
  } catch {
    throw new Error('The decoded bytes are not valid UTF-8.')
  }
}
export async function transformData(
  operation: DataOperation,
  input: DataInput,
  options: DataOptions,
  stepOptions: DataStepOptions = {},
): Promise<string> {
  const bytes = inputBytes(input)
  checkParameters(stepOptions)
  if (!dataOperations.some((item) => item.id === operation))
    throw new Error('Unknown data operation.')
  if (operation === 'sha1' || operation === 'sha256' || operation === 'sha512') {
    const algorithm =
      operation === 'sha1' ? 'SHA-1' : operation === 'sha256' ? 'SHA-256' : 'SHA-512'
    return [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  if (operation === 'crc32') return crc32(bytes)
  if (operation === 'base64-encode' || operation === 'base64url-encode')
    return checkSize(base64Encode(bytes, operation === 'base64url-encode'))
  if (operation === 'hex-encode')
    return checkSize([...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
  const text = inputText(input)
  let result: string
  switch (operation) {
    case 'json-format':
      result = formatJson(text, options.indent, false)
      break
    case 'json-minify':
      result = formatJson(text, options.indent, true)
      break
    case 'json-validate':
      jsonTokens(text)
      result = text
      break
    case 'json-quote':
      result = JSON.stringify(text)
      break
    case 'json-unquote': {
      jsonTokens(text)
      const value: unknown = JSON.parse(text)
      if (typeof value !== 'string') throw new Error('Use a JSON string.')
      result = value
      break
    }
    case 'json-ndjson':
      result = jsonArrayToLines(text)
      break
    case 'ndjson-json':
      result = linesToJsonArray(text, options.indent)
      break
    case 'xml-format':
      result = formatXml(text, options.indent, false)
      break
    case 'xml-minify':
      result = formatXml(text, options.indent, true)
      break
    case 'csv-json':
      result = csvToJson(text, options)
      break
    case 'json-csv':
      result = jsonToCsv(text, options)
      break
    case 'base64-decode':
    case 'base64url-decode':
      result = base64Decode(text, operation === 'base64url-decode')
      break
    case 'url-encode':
      result = encodeURIComponent(text)
      break
    case 'url-decode':
      try {
        result = decodeURIComponent(text)
      } catch {
        throw new Error('Invalid URL encoding.')
      }
      break
    case 'hex-decode': {
      const value = text.replace(/\s/g, '').replace(/^0x/i, '')
      if (!/^(?:[\da-fA-F]{2})*$/.test(value)) throw new Error('Invalid hexadecimal bytes.')
      try {
        result = decoder.decode(
          Uint8Array.from(value.match(/../g) ?? [], (byte) => parseInt(byte, 16)),
        )
      } catch {
        throw new Error('The decoded bytes are not valid UTF-8.')
      }
      break
    }
    case 'html-encode':
      result = text.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
      )
      break
    case 'html-decode': {
      // Protect literal markup while decoding entities; the detached document is never rendered.
      const doc = new DOMParser().parseFromString(
        '<body>' + text.replaceAll('<', '&lt;') + '</body>',
        'text/html',
      )
      result = doc.body.textContent ?? ''
      break
    }
    case 'lines-sort':
      result = dataLines(text).sort().join('\n')
      break
    case 'lines-unique':
      result = [...new Set(dataLines(text))].join('\n')
      break
    case 'lines-trim':
      result = dataLines(text)
        .map((line) => line.trim())
        .join('\n')
      break
    case 'text-upper':
      result = text.toUpperCase()
      break
    case 'text-lower':
      result = text.toLowerCase()
      break
    case 'text-trim':
      result = text.trim()
      break
    case 'text-collapse':
      result = text.replace(/\s+/gu, ' ').trim()
      break
    case 'text-normalize': {
      const form = stepOptions.normalization ?? 'NFC'
      if (!['NFC', 'NFD', 'NFKC', 'NFKD'].includes(form))
        throw new DataParameterError('Choose a valid Unicode form.', 'normalization')
      result = text.normalize(form)
      break
    }
    case 'lines-empty':
      result = dataLines(text)
        .filter((line) => line.trim())
        .join('\n')
      break
    case 'lines-reverse':
      result = dataLines(text).reverse().join('\n')
      break
    case 'lines-natural':
      result = dataLines(text)
        .sort(new Intl.Collator('en', { numeric: true }).compare)
        .join('\n')
      break
    case 'lines-include':
    case 'lines-exclude': {
      const search = literalSearch(stepOptions)
      result = dataLines(text)
        .filter((line) => search.test(line) === (operation === 'lines-include'))
        .join('\n')
      break
    }
    case 'text-replace':
      result = replaceLiteral(text, stepOptions)
      break
    case 'text-split': {
      const delimiter = stepOptions.delimiter ?? dataStepDelimiter(operation)
      if (!delimiter) throw new DataParameterError('Enter a separator.', 'delimiter')
      result = boundedJoin(text.split(delimiter), '\n')
      break
    }
    case 'lines-join':
      result = boundedJoin(dataLines(text), stepOptions.delimiter ?? dataStepDelimiter(operation))
      break
    case 'lines-affix': {
      function* lines() {
        for (const line of dataLines(text))
          yield (stepOptions.prefix ?? '') + line + (stepOptions.suffix ?? '')
      }
      result = boundedJoin(lines(), '\n')
      break
    }
    case 'lines-lf':
      result = text.replace(/\r\n|\r|\n/g, '\n')
      break
    case 'lines-crlf':
      result = text.replace(/\r\n|\r|\n/g, '\r\n')
      break
    case 'text-count':
      result = JSON.stringify(
        {
          characters: [...text].length,
          words: text.trim() ? text.trim().split(/\s+/u).length : 0,
          lines: text ? dataLines(text).length : 0,
          utf8Bytes: encoder.encode(text).length,
        },
        null,
        options.indent,
      )
      break
  }
  return checkSize(result)
}

export async function transformDataRecipe(
  steps: readonly DataRecipeStep[],
  input: DataInput,
  options: DataOptions,
  signal?: AbortSignal,
): Promise<string> {
  inputBytes(input)
  if (steps.length > dataRecipeLimit) throw new Error('A recipe can contain up to 32 actions.')
  let value = input
  for (let index = 0; index < steps.length; index++) {
    signal?.throwIfAborted()
    const step = steps[index]
    if (step.paused) continue
    try {
      value = await transformData(step.operation, value, options, step.options)
    } catch (error) {
      signal?.throwIfAborted()
      throw new DataRecipeError(
        error instanceof Error ? error.message : 'Could not transform data.',
        index,
        error instanceof DataParameterError ? error.field : undefined,
      )
    }
  }
  signal?.throwIfAborted()
  return inputText(value)
}
