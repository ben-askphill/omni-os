import AppKit
import OmniKit
import SwiftUI
import WebKit

/// A page html_render showed, in the transcript with no card around it: the web's HtmlRender
/// (apps/web/src/components/HtmlRender.tsx). It loads through `ArtifactWebHost` with the viewer's sandbox
/// (non-persistent store, the custom scheme, the content rule list), so it reaches nothing of Ben's.
struct HtmlRenderView: View {
  let artifact: Artifact
  let page: RenderedPage
  let model: AppModel
  @State private var rules: WKContentRuleList?
  @State private var failure: String?
  @State private var height: CGFloat?
  @State private var unfolded = false
  @State private var hovering = false

  /// The frame's height until the page reports its own.
  private static let firstHeight: CGFloat = 240
  /// Taller pages show this much and a "Show all" button, so one long page does not bury the thread.
  private static let foldedHeight: CGFloat = 640

  var body: some View {
    let fit = height ?? Self.firstHeight
    let folds = fit > Self.foldedHeight
    VStack(spacing: z(4)) {
      ZStack(alignment: .topTrailing) {
        if let rules {
          RenderWebView(client: model.client, ref: ArtifactRef(artifact), rules: rules, port: port, scrolls: folds && !unfolded) { height = $0 }
            .id(ArtifactRef(artifact))
        } else if let failure {
          ErrorNote(text: failure)
        }
        Button("Open \(page.title)", systemImage: "arrow.up.left.and.arrow.down.right") {
          model.route = .thread(id: artifact.threadID, artifact: artifact.id)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.icon(size: 28))
        .background(Tok.elev, in: Circle())
        .help("Open in the viewer")
        .padding(z(8))
        .opacity(hovering ? 1 : 0)
      }
      .frame(height: folds && !unfolded ? Self.foldedHeight : fit)
      .animation(.easeOut(duration: 0.2), value: fit)
      .onHover { hovering = $0 }
      if folds {
        Button(unfolded ? "Show less" : "Show all") { unfolded.toggle() }
          .buttonStyle(.pill(.ghost, height: 28))
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(page.title)
    .task(id: port) {
      do {
        rules = try await SandboxRules.list(port: port)
      } catch {
        failure = "Could not set up the page's sandbox, so it is not shown."
      }
    }
  }

  private var port: Int { model.client.baseURL.port ?? 4747 }
}

/// The variables a rendered page reads, from Theme.swift: `RENDER_COLORS` and `RENDER_OTHER` in
/// packages/shared/html-render.ts, which the web fills from index.css.
enum RenderTheme {
  static let colors: [(String, Color)] = [
    ("--background", Tok.bg), ("--foreground", Tok.fg), ("--muted", Tok.surface2), ("--muted-foreground", Tok.fg3),
    ("--card", Tok.surface), ("--card-foreground", Tok.fg), ("--border", Tok.lineStrong), ("--primary", Tok.fg),
    ("--primary-foreground", Tok.onInk), ("--accent", Tok.live), ("--accent-foreground", Tok.onLive),
    ("--destructive", Tok.needs), ("--warning", Tok.warn), ("--success", Tok.done), ("--code-background", Tok.surface),
  ] + Tok.chart.enumerated().map { ("--chart-\($0.offset + 1)", $0.element) }

  static let other: [(String, String)] = [
    ("--radius", "14px"),
    ("--font-sans", #""SF Pro", "SF Pro Text", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif"#),
    ("--font-mono", #""SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace"#),
  ]

  /// The same base sheet the web's frame script writes.
  static let base =
    ":where(html){color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}:where(body){margin:0}:where(code,pre,kbd,samp){font-family:var(--font-mono)}"

  /// The theme sheet for an appearance: each colour resolved under it.
  static func css(for appearance: NSAppearance) -> String {
    let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    var decls = ["color-scheme:\(dark ? "dark" : "light")"]
    appearance.performAsCurrentDrawingAppearance {
      for (name, color) in colors {
        guard let c = NSColor(color).usingColorSpace(.sRGB) else { continue }
        decls.append(
          "\(name):rgb(\(Int((c.redComponent * 255).rounded())) \(Int((c.greenComponent * 255).rounded())) \(Int((c.blueComponent * 255).rounded())) / \(c.alphaComponent))")
      }
    }
    decls += other.map { "\($0.0):\($0.1)" }
    return ":root{\(decls.joined(separator: ";"))}" + base
  }
}

/// The page reports its height to a handler that only an isolated content world can reach: the page's own scripts see
/// no `webkit.messageHandlers`, and the measuring script runs where they cannot replace the DOM methods it reads. The
/// same world writes the theme sheet first in the page, where the page can still override it.
private struct RenderWebView: NSViewRepresentable {
  let client: OmniClient
  let ref: ArtifactRef
  let rules: WKContentRuleList
  let port: Int
  /// The page is folded, so it scrolls itself. Unfolded, the wheel scrolls the transcript.
  let scrolls: Bool
  let onHeight: (CGFloat) -> Void

  private static let handler = "omniHeight"

  private static func bootstrap(css: String) -> String {
    let sheet = (try? String(data: JSONEncoder().encode(css), encoding: .utf8)) ?? "\"\""
    return """
      (function(){var s=document.createElement("style");s.id="omni-theme";s.textContent=\(sheet);(document.head||document.documentElement).prepend(s);
      window.omniTheme=function(c){s.textContent=c;};
      var h=-1;function m(){var v=Math.ceil(document.documentElement.getBoundingClientRect().height);if(v===h)return;h=v;window.webkit.messageHandlers.\(handler).postMessage(v);}
      if(window.ResizeObserver){new ResizeObserver(m).observe(document.documentElement);}document.addEventListener("DOMContentLoaded",m);window.addEventListener("load",m);})();
      """
  }

  final class Coordinator: NSObject, WKScriptMessageHandler {
    let host: ArtifactWebHost
    var onHeight: (CGFloat) -> Void

    init(host: ArtifactWebHost, onHeight: @escaping (CGFloat) -> Void) {
      self.host = host
      self.onHeight = onHeight
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard let n = message.body as? Double, n.isFinite, n > 0 else { return }
      onHeight(CGFloat(min(RenderedPage.maxHeight, n.rounded(.up))))
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(host: ArtifactWebHost(client: client, ref: ref, port: port, opensLinks: true), onHeight: onHeight)
  }

  func makeNSView(context: Context) -> RenderWebKitView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.userContentController.add(rules)
    config.userContentController.add(context.coordinator, contentWorld: .defaultClient, name: Self.handler)
    let css = RenderTheme.css(for: NSApp.effectiveAppearance)
    config.userContentController.addUserScript(
      WKUserScript(source: Self.bootstrap(css: css), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
    config.setURLSchemeHandler(context.coordinator.host, forURLScheme: RequestPolicy.scheme)
    let web = RenderWebKitView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator.host
    web.uiDelegate = context.coordinator.host
    web.setValue(false, forKey: "drawsBackground")
    web.underPageBackgroundColor = .clear
    web.scrolls = scrolls
    web.load(URLRequest(url: context.coordinator.host.pageURL))
    return web
  }

  func updateNSView(_ web: RenderWebKitView, context: Context) {
    context.coordinator.onHeight = onHeight
    web.scrolls = scrolls
  }

  static func dismantleNSView(_ web: RenderWebKitView, coordinator: Coordinator) {
    web.configuration.userContentController.removeScriptMessageHandler(forName: handler, contentWorld: .defaultClient)
  }
}

/// A web view inside the transcript's scroll view. While the whole page shows, the wheel scrolls the transcript, not
/// the page. An appearance change rewrites the theme sheet without reloading the page.
final class RenderWebKitView: WKWebView {
  var scrolls = false

  override func scrollWheel(with event: NSEvent) {
    if scrolls { super.scrollWheel(with: event) } else { nextResponder?.scrollWheel(with: event) }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    let sheet = (try? String(data: JSONEncoder().encode(RenderTheme.css(for: effectiveAppearance)), encoding: .utf8)) ?? "\"\""
    evaluateJavaScript("window.omniTheme&&window.omniTheme(\(sheet))", in: nil, in: .defaultClient) { _ in }
  }
}
