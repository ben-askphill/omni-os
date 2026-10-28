import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The Web tab: the channel's own browser in the app, in the same Chrome-like frame as `LiveBrowserView`, with a real web
/// view for the page. Ben's logins and tabs live here. Annotate takes its screenshot from this web view and picks elements out
/// of it, then goes on exactly as it does for the agent's browser.
struct NativeBrowserView: View {
  let model: NativeBrowserModel
  var annotating: Annotating?
  /// Bumped to put the keys in the address bar: the page's Cmd-L.
  @State private var focusAddress = 0
  /// Bumped to hand the keys back to the page: Return or Escape in the address bar, as in Chrome.
  @State private var pageFocus = 0
  /// This view's claim on the web view, against another window's Web tab.
  @State private var hostID = UUID()

  var body: some View {
    let s = model.state
    let here = model.host == nil || model.host == hostID
    VStack(spacing: 0) {
      BrowserTabStrip(state: s, perform: model.perform)

      VStack(spacing: 0) {
        BrowserToolbar(state: s, perform: model.perform, annotating: annotating, focusAddress: focusAddress) { pageFocus += 1 }
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
          NativeWebHost(model: model, active: s.active, here: here, focus: pageFocus, shortcut: shortcut)
            .opacity(shown ? 0 : 1)
            .allowsHitTesting(here && !shown)
            .accessibilityLabel(s.title.isEmpty ? "Web page" : s.title)
          if !here {
            VStack(spacing: z(10)) {
              Text("This browser is open in another window").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
              Button("Show here") { model.claim(hostID) }.buttonStyle(.pill(.secondary, height: 28))
            }
          } else if s.url.isEmpty || s.url == "about:blank" {
            EmptyNote(symbol: "globe", title: "Your own browser", message: "Pages and logins stay on this Mac. The agent uses the Browser tab and can't see this one.")
              .allowsHitTesting(false)
          }
          if let annotating, annotating.model.isActive { BrowserAnnotateLayer(annotating: annotating) }
        }
      }
      .background(Tok.bg)
      .clipShape(RoundedRectangle(cornerRadius: z(14), style: .continuous))
    }
    .onAppear {
      model.claim(hostID)
      #if DEBUG
      BrowserAnnotateProbe.annotating = annotating
      BrowserAnnotateProbe.native = model
      #endif
    }
    .onDisappear {
      model.release(hostID)
      #if DEBUG
      BrowserAnnotateProbe.release(native: model, annotate: annotating?.model)
      #endif
    }
  }

  /// Chrome's own shortcuts from the page. True when handled here rather than sent to the page.
  private func shortcut(_ key: String, shift: Bool) -> Bool {
    switch key {
    case "l": focusAddress += 1
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
/// the Web tab keeps each page as it was.
private struct NativeWebHost: NSViewRepresentable {
  let model: NativeBrowserModel
  /// The active tab: when it changes the host swaps web views.
  let active: String?
  /// False while another window's Web tab shows the page.
  let here: Bool
  /// A new value gives the page the keys.
  let focus: Int
  let shortcut: (_ key: String, _ shift: Bool) -> Bool

  func makeNSView(context: Context) -> HostView {
    let v = HostView()
    v.wantsLayer = true
    v.layer?.masksToBounds = true
    v.focus = focus
    return v
  }

  func updateNSView(_ host: HostView, context: Context) {
    for tab in model.tabs { tab.web.shortcut = shortcut }
    guard here, let web = model.webView else {
      host.subviews.forEach { $0.removeFromSuperview() }
      return
    }
    if web.superview !== host {
      host.subviews.forEach { $0.removeFromSuperview() }
      web.frame = host.bounds
      web.autoresizingMask = [.width, .height]
      host.addSubview(web)
    }
    if host.focus != focus {
      host.focus = focus
      // After SwiftUI has finished with the address bar's focus.
      DispatchQueue.main.async { web.window?.makeFirstResponder(web) }
    }
  }

  final class HostView: NSView {
    var focus = 0
  }
}
