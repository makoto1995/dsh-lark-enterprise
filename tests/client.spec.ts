// @vitest-environment jsdom
// Tests for the browser half of the bundle (dsh/client.js): the composer
// image-upload entry. jsdom covers the DOM helpers (toolbarOf, injectPicker);
// the synthetic paste event is exercised with stubbed DataTransfer /
// ClipboardEvent since jsdom does not implement ClipboardEventInit.clipboardData.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '..', 'dsh', 'client.js'), 'utf8')

// Load the lazy-CJS bundle factory in isolation and capture its exports.
function loadClient(): any {
  const captured: { result?: any } = {}
  const prev = globalThis.window as any
  ;(globalThis as any).window = globalThis
  try {
    // Present the contract dsh injects: window.__ModuleLoader__.load.
    ;(globalThis as any).__ModuleLoader__ = {
      load(descriptor: any) {
        captured.result = descriptor.factory(() => {
          throw new Error('no requires in this plugin')
        })
      },
    }
    // The bundle body runs as a plain script; eval in a function scope so its
    // `var` declarations do not leak into this module.
    const run = new Function('window', `${clientSource}\nreturn window`)
    run(globalThis)
  } finally {
    delete (globalThis as any).__ModuleLoader__
    ;(globalThis as any).window = prev
  }
  return captured.result
}

describe('dsh/client.js image-upload entry', () => {
  let client: any
  beforeEach(() => {
    client = loadClient()
  })

  it('loads under the __ModuleLoader__ bundle protocol', () => {
    expect(client).toBeTruthy()
    expect(typeof client.apply).toBe('function')
    expect(Array.isArray(client.inject)).toBe(true)
  })

  it('toolbarOf finds the composer tools row via data-input-scroll', () => {
    document.body.innerHTML =
      '<div data-input-scroll><div><textarea></textarea></div></div>' +
      '<div><div class="tools"></div></div>'
    const textarea = document.querySelector('textarea')
    // dsh shape: textarea sits inside the scroll container, whose sibling is
    // the row whose first child is the tools element.
    const tools = document.querySelector('.tools')
    expect(client.__pick.toolbarOf(textarea)).toBe(tools)
  })

  it('toolbarOf falls back to the textarea parent', () => {
    document.body.innerHTML = '<div><textarea></textarea></div>'
    const textarea = document.querySelector('textarea')
    expect(client.__pick.toolbarOf(textarea)).toBe(textarea!.parentElement)
  })

  it('toolbarOf handles a missing textarea', () => {
    expect(client.__pick.toolbarOf(null)).toBeNull()
  })

  it('injectPicker adds one icon button + hidden file input, idempotently', () => {
    document.body.innerHTML = '<div class="tools"></div>'
    const toolbar = document.querySelector('.tools') as HTMLElement
    const first = client.__pick.injectPicker(toolbar)
    expect(first).toBeTruthy()
    expect(first.getAttribute('data-dsh-upload-image')).toBe('1')
    expect(toolbar.querySelector('input[type=file]')).toBeTruthy()
    expect((toolbar.querySelector('input[type=file]') as HTMLInputElement).accept).toBe('image/*')
    expect((toolbar.querySelector('input[type=file]') as HTMLInputElement).multiple).toBe(true)
    // idempotent: second call adds nothing
    const second = client.__pick.injectPicker(toolbar)
    expect(second).toBeNull()
  })

  it('injectPicker ignores a null toolbar', () => {
    expect(client.__pick.injectPicker(null)).toBeNull()
  })

  it('pasteEventFromFiles keeps only image files and builds a clipboard event', () => {
    const list: any[] = []
    const items = {
      list,
      add: (file: any) => {
        list.push(file)
      },
      get length() {
        return list.length
      },
    }
    const dtStub = { items }
    let ctorArgs: any[] | null = null
    const ClipboardEventStub = vi.fn(function (...args: any[]) {
      ctorArgs = args
    })
    const DataTransferStub = vi.fn(function () {
      return dtStub
    })
    vi.stubGlobal('DataTransfer', DataTransferStub)
    vi.stubGlobal('ClipboardEvent', ClipboardEventStub)
    try {
      const files = [
        { type: 'image/png', name: 'a.png' },
        { type: 'text/plain', name: 'note.txt' },
        { type: 'image/jpeg', name: 'b.jpg' },
      ]
      const event = client.__pick.pasteEventFromFiles(files)
      expect(event).toBeTruthy()
      expect(items.list.map((f: any) => f.name)).toEqual(['a.png', 'b.jpg'])
      expect(ctorArgs![0]).toBe('paste')
      expect(ctorArgs![1].bubbles).toBe(true)
      expect(ctorArgs![1].cancelable).toBe(true)
      expect(ctorArgs![1].clipboardData).toBe(dtStub)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pasteEventFromFiles returns null with no image files', () => {
    vi.stubGlobal(
      'DataTransfer',
      vi.fn(function () {
        return { items: { add() {}, length: 0 } }
      }),
    )
    vi.stubGlobal('ClipboardEvent', vi.fn())
    try {
      const event = client.__pick.pasteEventFromFiles([{ type: 'text/plain', name: 'n.txt' }])
      expect(event).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})