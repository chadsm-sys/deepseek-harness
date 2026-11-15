import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

function declarations(selector: string): Map<string, string> | undefined {
  const media = /@media \(max-width: 560px\), \(max-width: 1023px\) and \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1]
  if (media === undefined) return undefined
  const rules = media.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectors = '', body = ''] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').map(value => value.trim()).includes(selector)) continue
    return new Map(body.split(';').flatMap(part => {
      const colon = part.indexOf(':')
      return colon === -1 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()]]
    }))
  }
  return undefined
}

describe('Rows.module.css touch layout', () => {
  it('reserves session and search actions before the first touch', () => {
    for (const selector of ['.sessionRow .rowActions', '.searchResultRow .rowActions']) {
      expect(declarations(selector)?.get('display')).toBe('inline-flex')
    }
  })

  it('keeps the session trailing cell stable on touch hover', () => {
    for (const selector of ['.sessionRow .time', '.sessionRow .pinIndicator']) {
      expect(declarations(selector)?.get('display')).toBe('none')
    }
    for (const selector of ['.sessionRow .title', '.sessionRow:hover .title', '.sessionRow.menuOpen .title']) {
      expect(declarations(selector)?.get('text-overflow')).toBe('ellipsis')
    }
  })
})
