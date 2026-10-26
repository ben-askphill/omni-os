import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The channel's own browser, in the app: the same Chrome-like frame as `LiveBrowserView`, with a real web view for the page.
/// Ben's logins and tabs live here. Annotate takes its screenshot from this web view and picks elements out of it, then goes on
/// exactly as it does for the agent's browser.
struct NativeBrowserView: View {
  let model: NativeBrowserModel
  var trailing: AnyView = AnyView(EmptyView())
  var annotating: Annotating?
  @State private var focusTick = 0

  var body: some View {
    let s = model.state
    VStack(spacing: 0) {
      BrowserTabStrip(state: s, perform: model.perform)

      VStack(spacing: 0) {
        BrowserToolbar(state: s, perform: model.perform, annotating: annotating, focusTick: focusTick, trailing: trailing)
        BrowserLoadingRule(loading: s.loading)

        if let notice = model.notice {
          HStack(spacing: z(8)) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Tok.fg3)
            Text(notice).font(.omni(size: 12)).foregroundStyle(Tok.fg2).frame(maxWidth: .infinity, alignment: .leading)
            Button("Dismiss") { model.say(nil) }.buttonStyle(.pill(.secondary, height: 26))
          }
          .padding(.horizontal, z(12))
          .padding(.vertical, z(8))
          Tok.line.frame(height: 1)
        }

        ZStack {
          Tok.bg
          // While the screenshot is shown, the page is not given any input: it is hidden, and its keys go nowhere.
          let shown = annotating.map { if case .picking = $0.model.phase { true } else { false } } ?? false
          NativeWebHost(model: model, active: s.active, shortcut: shortcut)
            .opacity(shown ? 0 : 1)
            .allowsHitTesting(!shown)
            .accessibilityLabel(s.title.isEmpty ? "Browser page" : s.title)
          if s.url.isEmpty || s.url == "about:blank" {
            Text("Search or type an address")
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .allowsHitTesting(false)
          }
          if let annotating, annotating.model.isActive { BrowserAnnotateLayer(annotating: annotating) }
        }
      }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
    .onAppear {
      #if DEBUG
      BrowserAnnotateProbe.annotating = annotating
      BrowserAnnotateProbe.native = model
      #endif
    }
    .onDisappear {
      #if DEBUG
      BrowserAnnotateProbe.annotating = nil
      BrowserAnnotateProbe.native = nil
      #endif
    }
  }

  /// Chrome's own shortcuts from the page. True when handled here rather than sent to the page.
  private func shortcut(_ key: String, shift: Bool) -> Bool {
    switch key {
    case "l": focusTick += 1
    case "t": model.perform(.newTab)
    case "w": if let id = model.state.active { model.perform(.closeTab(id)) }
    case "r": model.perform(.reload)
    case "[": model.perform(.back)
    case "]": model.perform(.forward)
    default: return false
    }
    return true
  }
}

/// Holds whichever tab's web view is active, filling the view. The web views live in the model, so switching tabs or leaving
/// the Browser tab keeps each page as it was.
private struct NativeWebHost: NSViewRepresentable {
  let model: NativeBrowserModel
  /// The active tab: when it changes the host swaps web views.
  let active: String?
  let shortcut: (_ key: String, _ shift: Bool) -> Bool

  func makeNSView(context: Context) -> NSView {
    let v = NSView()
    v.wantsLayer = true
    v.layer?.masksToBounds = true
    return v
  }

  func updateNSView(_ host: NSView, context: Context) {
    for tab in model.tabs { tab.web.shortcut = shortcut }
    guard let web = model.webView else { return }
    if web.superview !== host {
      host.subviews.forEach { $0.removeFromSuperview() }
      web.frame = host.bounds
      web.autoresizingMask = [.width, .height]
      host.addSubview(web)
    }
  }
}
