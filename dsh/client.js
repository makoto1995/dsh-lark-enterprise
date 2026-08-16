// Browser half of the dsh-lark-enterprise bundle: an image-upload entry
// for the web composer.
//
// dsh's composer (dsh-client-ui-conversation InputBar) accepts image files
// natively through paste and drop, but ships no file-picker button. This
// client plugin adds one: pick image files, then replay them into the
// composer as a synthetic `paste` event carrying the bytes.
//
// Why a synthetic paste instead of calling into conversation internals:
//   - the host's own onPaste intake (limits, admission, draft thumbnails)
//     runs unchanged, so the picked files behave exactly like pasted ones;
//   - when the selected model is text-only, modlens' capture-phase paste
//     listener (if mounted) takes the paste over and routes it through
//     /modlens/paste -> path text, which is the correct behaviour for a
//     model that cannot receive image blocks;
//   - when the model declares image input (e.g. the modlens vision wrapper
//     `modlens-opencode-go`), the paste stays native: draft image -> sent
//     image block -> the wrapper converts it to evidence text at request
//     time. Both routes converge on a working image conversation.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step and no
// imports from dsh client packages — the same zero-dependency stance as
// modlens' own client half and this plugin's host half.
window.__ModuleLoader__.load({
  id: 'dsh-lark-enterprise',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ── helpers (exported for the repo's node tests) ─────────────────────

    /** The composer toolbar container (`.tools` row) hosting the "+" button. */
    function toolbarOf(textarea) {
      if (!textarea) return null
      var scroll = textarea.closest('[data-input-scroll]')
      if (scroll) {
        // dsh InputBar shape: the scroll container's sibling is the toolbar
        // row whose first child is the `.tools` element.
        var sibling = scroll.nextElementSibling
        if (sibling && sibling.firstElementChild) return sibling.firstElementChild
        for (var i = 0; i < scroll.parentElement.children.length; i += 1) {
          var child = scroll.parentElement.children[i]
          if (child !== scroll && child.firstElementChild) return child.firstElementChild
        }
      }
      return textarea.parentElement
    }

    /** Build the paste event carrying the picked image files. */
    function pasteEventFromFiles(files) {
      var dt = new DataTransfer()
      for (var i = 0; i < files.length; i += 1) {
        var file = files[i]
        if (/^image\//.test(file.type)) dt.items.add(file)
      }
      if (dt.items.length === 0) return null
      return new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      })
    }

    /**
     * Inject the picker button + hidden file input into one toolbar.
     * Idempotent per toolbar (guarded by a data attribute).
     * @returns the created button, or null when no toolkit element existed.
     */
    function injectPicker(toolbar, handlers) {
      if (!toolbar) return null
      if (toolbar.querySelector('[data-dsh-upload-image]')) return null

      var input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = true
      input.hidden = true
      input.setAttribute('data-dsh-upload-image-input', '1')

      var button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('data-dsh-upload-image', '1')
      button.title = '上传图片'
      button.setAttribute('aria-label', '上传图片')
      button.style.cssText =
        'appearance:none;border:0;background:none;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,0.8));' +
        'width:28px;height:28px;border-radius:8px;flex:none;place-items:center;display:grid;padding:0;' +
        'cursor:pointer;margin-right:2px'
      // hover/focus styling mirroring the native toolbar buttons
      var onHover = function (on) {
        button.style.background = on ? 'var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12))' : 'none'
      }
      button.addEventListener('mouseenter', function () { onHover(true) })
      button.addEventListener('mouseleave', function () { onHover(false) })
      button.addEventListener('focus', function () { onHover(true) })
      button.addEventListener('blur', function () { onHover(false) })
      button.innerHTML =
        '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" ' +
        'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/>' +
        '<circle cx="5.2" cy="6" r="1.4"/>' +
        '<path d="M1.8 11.5l3.4-3.2 2.6 2.4 2.7-2.5 3.7 3.4"/>' +
        '</svg>'

      input.addEventListener('change', function () {
        var files = Array.from(input.files || [])
        input.value = ''
        if (files.length === 0) return
        var target = document.querySelector('textarea')
        if (!target) return
        var event = pasteEventFromFiles(files)
        if (event) target.dispatchEvent(event)
      })
      button.addEventListener('click', function () { input.click() })

      if (handlers && typeof handlers.onInject === 'function') handlers.onInject(button, input)
      toolbar.appendChild(input)
      toolbar.appendChild(button)
      return button
    }

    // ── plugin surface ────────────────────────────────────────────────────

    function apply(ctx) {
      var timer = null
      var scan = function () {
        var ta = document.querySelector('textarea')
        var toolbar = ta ? toolbarOf(ta) : null
        if (!ta || !toolbar) return
        injectPicker(toolbar)
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
      }
      // The composer mounts after the app renders; wait for it.
      timer = setInterval(scan, 800)
      if (typeof ctx.effect === 'function') {
        ctx.effect(
          function () {
            return function () {
              if (timer !== null) clearInterval(timer)
            }
          },
          'dsh-lark-enterprise: image upload entry',
        )
      }
    }

    exports.apply = apply
    // `slots` is optional, so it is not required here; nothing is injected.
    exports.inject = []
    // Exposed for the repo's node tests only; not part of the plugin contract.
    exports.__pick = { toolbarOf: toolbarOf, pasteEventFromFiles: pasteEventFromFiles, injectPicker: injectPicker }
    return module.exports
  },
})