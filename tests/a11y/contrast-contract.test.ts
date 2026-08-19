import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  expect(matches, `missing CSS rule for ${selector}`).not.toHaveLength(0)
  return matches.map((match) => match[1]!).join(';')
}

function exactDeclarations(selector: string): string {
  const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((match) => match[1]!.split(',').some((candidate) => candidate.trim() === selector))
  expect(matches, `missing exact CSS rule for ${selector}`).not.toHaveLength(0)
  return matches.map((match) => match[2]!).join(';')
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{3,8})`, 'i'))
  expect(match, `missing solid --${name} token`).not.toBeNull()
  return match![1]!
}

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const raw = hex.slice(1)
  const expanded = raw.length === 3 ? [...raw].map((value) => value.repeat(2)).join('') : raw.slice(0, 6)
  const channels = expanded.match(/.{2}/g)!.map((value) => channel(Number.parseInt(value, 16)))
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe('conversational generation surface contract', () => {
  it('keeps modal and drawer scrims stationary while visible controls receive restrained spatial feedback', () => {
    const globalHover = exactDeclarations('button:hover:not(:disabled)')
    const globalActive = exactDeclarations('button:active:not(:disabled)')
    const visibleHover = exactDeclarations('.activity-ribbon button:hover:not(:disabled)')
    const visibleActive = exactDeclarations('.activity-ribbon button:active:not(:disabled)')
    const scrims = declarations('.modal-scrim,.drawer-scrim')

    expect(globalHover).not.toMatch(/transform\s*:/)
    expect(globalActive).not.toMatch(/transform\s*:/)
    expect(visibleHover).toMatch(/transform\s*:\s*translateY\(-1px\)/)
    expect(visibleActive).toMatch(/transform\s*:\s*translateY\(0\)\s+scale\(\.985\)/)
    expect(scrims).not.toMatch(/transform\s*:/)
  })

  it('keeps paper-row hit boxes fixed while hover and selection use tonal accent feedback', () => {
    const list = declarations('.paper-list')
    const hover = exactDeclarations('.paper-list-item:hover:not(:disabled)')
    const selected = exactDeclarations('.paper-list-item[aria-selected="true"]')

    expect(list).not.toMatch(/overflow-x\s*:\s*hidden/)
    expect(hover).not.toMatch(/transform\s*:/)
    expect(selected).not.toMatch(/transform\s*:/)
    expect(hover).toMatch(/box-shadow\s*:/)
    expect(selected).toMatch(/background\s*:/)
    expect(selected).toMatch(/inset\s+3px\s+0\s+var\(--accent\)/)
  })

  it('enters the evidence drawer from the right and the explorer from the left', () => {
    const compactMotion = css.match(/@media \(max-width:799px\)\{([^]*?)\}\n@media \(prefers-reduced-motion/)?.[1] ?? ''

    expect(compactMotion).toContain('.library-pane{animation:paprv-drawer-left-in')
    expect(compactMotion).toContain('.evidence-pane{animation:paprv-drawer-right-in')
    expect(compactMotion).toMatch(/@keyframes paprv-drawer-left-in\{from\{[^}]*translateX\(-8px\)/)
    expect(compactMotion).toMatch(/@keyframes paprv-drawer-right-in\{from\{[^}]*translateX\(8px\)/)
  })

  it('disables entrance animations and nonessential spatial transforms for reduced motion', () => {
    const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'))

    expect(reducedMotion).toContain('animation:none!important')
    expect(reducedMotion).toContain('transition:none!important')
    expect(reducedMotion).toContain('transform:none!important')
    expect(reducedMotion).not.toContain('animation-duration:0.01ms')
    expect(reducedMotion).not.toContain('transition-duration:0.01ms')
  })

  it('uses tonal depth and restrained motion instead of static border-only chrome', () => {
    const shell = declarations('.app-shell')
    const topbar = declarations('.app-topbar')
    const activeTab = declarations('.active-document-tab[aria-selected="true"]')
    const dialog = declarations('.transform-dialog')
    const composer = declarations('.chat-composer')

    expect(shell).toMatch(/isolation\s*:\s*isolate/)
    expect(topbar).toMatch(/box-shadow\s*:/)
    expect(activeTab).toMatch(/box-shadow\s*:/)
    expect(dialog).toMatch(/box-shadow\s*:/)
    expect(dialog).toMatch(/animation\s*:/)
    expect(composer).toMatch(/box-shadow\s*:/)
  })

  it('keeps dialog chrome fixed while the conversation alone scrolls', () => {
    const dialog = declarations('.transform-dialog')
    const chrome = declarations('.dialog-heading,.dialog-actions')
    const conversation = declarations('.agent-conversation')

    expect(dialog).toMatch(/max-height\s*:\s*calc\(100dvh\s*-\s*32px\)/)
    expect(dialog).toMatch(/overflow\s*:\s*hidden/)
    expect(chrome).toMatch(/flex\s*:\s*none/)
    expect(conversation).toMatch(/min-width\s*:\s*0/)
    expect(conversation).toMatch(/min-height\s*:\s*0/)
    expect(conversation).toMatch(/overflow-y\s*:\s*auto/)
    expect(conversation).toMatch(/overflow-x\s*:\s*hidden/)
  })

  it('reflows one composer instead of provider and task fieldsets', () => {
    const composer = declarations('.chat-composer')
    const request = declarations('.chat-request')
    const controls = declarations('.chat-composer-controls')
    const compactControl = declarations('.chat-compact-control')
    const messages = declarations('.chat-message,.transform-error')

    expect(composer).toMatch(/display\s*:\s*grid/)
    expect(composer).toMatch(/min-width\s*:\s*0/)
    expect(request).toMatch(/width\s*:\s*100%/)
    expect(request).toMatch(/resize\s*:\s*none/)
    expect(controls).toMatch(/display\s*:\s*flex/)
    expect(controls).toMatch(/flex-wrap\s*:\s*wrap/)
    expect(compactControl).toMatch(/min-width\s*:\s*0/)
    expect(messages).toMatch(/overflow-wrap\s*:\s*anywhere/)
  })

  it('keeps document renaming inline and gives the textarea the remaining editor height', () => {
    const workspace = declarations('.document-workspace')
    const name = declarations('.document-name-input')
    const focus = declarations('.document-name-input:focus-visible')

    expect(workspace).toMatch(/grid-template-rows\s*:\s*28px\s+minmax\(0\s*,\s*1fr\)\s+auto/)
    expect(name).toMatch(/background\s*:\s*transparent/)
    expect(name).toMatch(/border\s*:\s*0/)
    expect(name).toMatch(/min-width\s*:\s*0/)
    expect(focus).toMatch(/outline\s*:\s*2px\s+solid\s+var\(--focus\)/)
  })
})

describe('document tab target and overlap contract', () => {
  it('reserves a separate 28px close column and truncates the title before it', () => {
    const item = declarations('.document-tab-item')
    const tab = declarations('.document-tab-item .active-document-tab')
    const title = declarations('.active-document-tab>span:not(.tab-close)')
    const close = declarations('.document-tab-item .tab-close')

    expect(item).toMatch(/display\s*:\s*grid/)
    expect(item).toMatch(/grid-template-columns\s*:\s*minmax\(0\s*,\s*1fr\)\s+28px/)
    expect(tab).toMatch(/min-width\s*:\s*0/)
    expect(tab).toMatch(/overflow\s*:\s*hidden/)
    expect(title).toMatch(/text-overflow\s*:\s*ellipsis/)
    expect(close).toMatch(/position\s*:\s*static/)
    expect(close).toMatch(/(?:^|;)width\s*:\s*28px/)
    expect(close).toMatch(/min-width\s*:\s*28px/)
    expect(close).toMatch(/(?:^|;)height\s*:\s*28px/)
    expect(close).toMatch(/min-height\s*:\s*28px/)
  })
})

describe('deterministic color contrast contract', () => {
  it.each(['dark', 'light'])('%s muted and accent text remains at least 4.5:1 on every solid surface', (theme) => {
    const themeBlock = declarations(`[data-theme="${theme}"]`)
    const surfaces = ['bg-app', 'bg-chrome', 'bg-panel', 'bg-editor', 'bg-raised', 'bg-hover', 'bg-selected']
      .map((name) => [name, token(themeBlock, name)] as const)
    const muted = token(themeBlock, 'text-muted')
    const accent = token(themeBlock, 'accent')
    const accentForeground = token(themeBlock, 'accent-foreground')

    for (const [surfaceName, surface] of surfaces) {
      expect(contrast(muted, surface), `${theme} --text-muted on --${surfaceName}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(accentForeground, accent), `${theme} accent foreground`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps Markdown placeholder text fully opaque and uses the contrast-tested muted token', () => {
    const placeholder = declarations('.markdown-editor::placeholder')
    expect(placeholder).toMatch(/color\s*:\s*var\(--text-muted\)/)
    expect(placeholder).toMatch(/opacity\s*:\s*1(?:\D|$)/)
  })

  it('uses the theme-specific foreground token on primary accent buttons', () => {
    expect(declarations('.primary-button')).toMatch(/color\s*:\s*var\(--accent-foreground\)/)
  })
})
