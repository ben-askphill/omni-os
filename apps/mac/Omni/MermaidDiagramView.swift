import AppKit
import SwiftUI
import WebKit

/// Only mermaid fences create a web view or load the bundled renderer. The native code block stays
/// visible until rendering succeeds, including for an incomplete fence during a streamed reply.
struct MermaidDiagramView<Fallback: View>: View {
  let source: String
  @ViewBuilder let fallback: () -> Fallback
  @Environment(\.colorScheme) private var scheme
  @State private var height: CGFloat?
  @State private var failed = false

  var body: some View {
    ZStack(alignment: .topLeading) {
      if height == nil || failed { fallback() }
      if !failed {
        MermaidWebView(source: source, dark: scheme == .dark, height: $height, failed: $failed)
          .frame(height: height ?? 1)
          .opacity(height == nil ? 0 : 1)
          .accessibilityLabel("Mermaid diagram")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(14)))
    .clipShape(RoundedRectangle(cornerRadius: z(14)))
    .overlay(RoundedRectangle(cornerRadius: z(14)).strokeBorder(Tok.line))
    .onChange(of: source) { height = nil; failed = false }
  }
}

private struct MermaidWebView: NSViewRepresentable {
  let source: String
  let dark: Bool
  @Binding var height: CGFloat?
  @Binding var failed: Bool

  func makeCoordinator() -> Host { Host(self) }

  func makeNSView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.userContentController.add(context.coordinator, name: "diagramHeight")
    if let url = Bundle.main.url(forResource: "mermaid.min", withExtension: "js"),
      let script = try? String(contentsOf: url, encoding: .utf8)
    {
      config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator
    web.setValue(false, forKey: "drawsBackground")
    // No remote resources, navigation, credentials, or model-supplied HTML. Source goes through JS arguments.
    web.loadHTMLString("""
      <!doctype html><meta name="viewport" content="width=device-width">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'">
      <style>body{margin:0;padding:12px 14px;font:14px -apple-system,sans-serif}svg{display:block;max-width:100%;height:auto;margin:auto}</style>
      <div id="diagram" role="img" aria-label="Mermaid diagram"></div>
      """, baseURL: nil)
    return web
  }

  func updateNSView(_ web: WKWebView, context: Context) {
    context.coordinator.view = self
    context.coordinator.render(web)
  }

  static func dismantleNSView(_ web: WKWebView, coordinator: Host) {
    web.configuration.userContentController.removeScriptMessageHandler(forName: "diagramHeight")
    web.navigationDelegate = nil
  }

  @MainActor final class Host: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var view: MermaidWebView
    private var ready = false
    private var revision = 0
    private var last: String?

    init(_ view: MermaidWebView) { self.view = view }

    func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
      ready = true
      render(web)
    }

    func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
    }

    func webView(_ web: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) { view.failed = true }
    func webView(_ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { view.failed = true }
    func webViewWebContentProcessDidTerminate(_ web: WKWebView) { view.failed = true }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard let body = message.body as? [String: Double], body["revision"] == Double(revision),
        let height = body["height"], height.isFinite, height > 0 else { return }
      view.height = CGFloat(height)
    }

    func render(_ web: WKWebView) {
      let key = "\(view.dark):\(view.source)"
      guard ready, last != key else { return }
      last = key
      revision += 1
      let current = revision
      // Resolve the app's existing dynamic tokens in the requested appearance.
      let appearance = NSAppearance(named: view.dark ? .darkAqua : .aqua)!
      var background = "", foreground = ""
      appearance.performAsCurrentDrawingAppearance {
        background = Self.hex(NSColor(Tok.surface))
        foreground = Self.hex(NSColor(Tok.fg))
      }
      let source = view.source
      let dark = view.dark
      web.evaluateJavaScript("window.diagramRevision = \(current)", completionHandler: nil)
      Task { [weak self] in
        do {
          _ = try await web.callAsyncJavaScript("""
        window.diagramObserver?.disconnect();
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,
          theme:dark?'dark':'base',themeVariables:{darkMode:dark,background,
          primaryColor:background,primaryTextColor:foreground,primaryBorderColor:foreground,
          lineColor:foreground,secondaryColor:background,tertiaryColor:background,fontFamily:'-apple-system, sans-serif'}});
        const {svg} = await mermaid.render('omni-diagram-' + revision, source);
        if (revision !== window.diagramRevision) return;
        document.getElementById('diagram').innerHTML = svg;
        document.body.style.background = background;
        const report = () => window.webkit.messageHandlers.diagramHeight.postMessage({revision,height:document.body.getBoundingClientRect().height});
        window.diagramObserver = new ResizeObserver(report);
        window.diagramObserver.observe(document.body);
        report();
        """, arguments: ["source": source, "dark": dark, "background": background, "foreground": foreground, "revision": current],
            in: nil, contentWorld: .page)
        } catch {
          guard let self, self.revision == current else { return }
          self.view.failed = true
        }
      }
    }

    private static func hex(_ color: NSColor) -> String {
      let c = color.usingColorSpace(.sRGB) ?? color
      return String(format: "#%02x%02x%02x", Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded()))
    }
  }
}
