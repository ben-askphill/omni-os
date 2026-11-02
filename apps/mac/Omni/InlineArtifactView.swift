import AppKit
import OmniKit
import SwiftUI
import WebKit

/// An HTML artifact running in the transcript: the web view's InlineArtifact (apps/web/src/components/InlineArtifact.tsx).
/// It loads through `ArtifactWebHost` with the same sandbox as the viewer (non-persistent store, the custom scheme, the
/// content rule list). The page's colour scheme follows the app's appearance, which the web view inherits.
struct InlineArtifactView: View {
  let artifact: Artifact
  let model: AppModel
  @State private var rules: WKContentRuleList?
  @State private var failure: String?
  @State private var height: CGFloat?
  @State private var unfolded = false

  /// The frame's height until the page reports its own.
  private static let firstHeight: CGFloat = 320
  /// Taller pages show this much and a "Show all" button, so one long report does not bury the thread.
  private static let foldedHeight: CGFloat = 560

  var body: some View {
    let ref = ArtifactRef(artifact)
    let fit = height ?? Self.firstHeight
    let folds = fit > Self.foldedHeight
    VStack(spacing: 0) {
      HStack(spacing: z(10)) {
        OmniIcon(name: "globe", size: 14)
          .foregroundStyle(Tok.fg3)
          .frame(width: z(28), height: z(28))
          .background(Tok.bg, in: Circle())
        Text(artifact.name)
          .font(.omni(size: 11.5, weight: .medium, design: .monospaced))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.middle)
          .frame(maxWidth: .infinity, alignment: .leading)
        if height == nil, failure == nil { ProgressView().controlSize(.mini) }
        Button("Open \(artifact.name)", systemImage: "arrow.up.left.and.arrow.down.right") {
          model.route = .thread(id: artifact.threadID, artifact: artifact.id)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.icon(size: 28))
        .help("Open in the viewer")
      }
      .padding(.leading, z(12))
      .padding(.trailing, z(6))
      .padding(.vertical, z(6))
      Group {
        if let rules {
          InlineWebView(client: model.client, ref: ref, rules: rules, port: port, scrolls: folds && !unfolded) { height = $0 }
            .id(ref)
        } else if let failure {
          ErrorNote(text: failure).padding(z(12))
        } else {
          Color.clear
        }
      }
      .frame(height: folds && !unfolded ? Self.foldedHeight : fit)
      .animation(.easeOut(duration: 0.2), value: fit)
      if folds {
        Button(unfolded ? "Show less" : "Show all") { unfolded.toggle() }
          .buttonStyle(.pill(.ghost, height: 28))
          .padding(.vertical, z(6))
      }
    }
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .accessibilityElement(children: .contain)
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

/// The page reports its height to a handler that only an isolated content world can reach: the page's own scripts
/// see no `webkit.messageHandlers`, and the measuring script runs where they cannot replace the DOM methods it reads.
private struct InlineWebView: NSViewRepresentable {
  let client: OmniClient
  let ref: ArtifactRef
  let rules: WKContentRuleList
  let port: Int
  /// The page is folded, so it scrolls itself. Unfolded, the wheel scrolls the transcript.
  let scrolls: Bool
  let onHeight: (CGFloat) -> Void

  private static let handler = "omniHeight"
  private static let measure = """
    (function(){var h=-1;function s(){var v=Math.ceil(document.documentElement.getBoundingClientRect().height);if(v===h)return;h=v;window.webkit.messageHandlers.\(handler).postMessage(v);}if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement);}document.addEventListener("DOMContentLoaded",s);window.addEventListener("load",s);})();
    """

  final class Coordinator: NSObject, WKScriptMessageHandler {
    let host: ArtifactWebHost
    var onHeight: (CGFloat) -> Void

    init(host: ArtifactWebHost, onHeight: @escaping (CGFloat) -> Void) {
      self.host = host
      self.onHeight = onHeight
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard let n = message.body as? Double, n.isFinite, n > 0 else { return }
      onHeight(CGFloat(min(InlineArtifacts.maxHeight, n.rounded(.up))))
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(host: ArtifactWebHost(client: client, ref: ref, port: port, opensLinks: true), onHeight: onHeight)
  }

  func makeNSView(context: Context) -> PassScrollWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.userContentController.add(rules)
    config.userContentController.add(context.coordinator, contentWorld: .defaultClient, name: Self.handler)
    config.userContentController.addUserScript(
      WKUserScript(source: Self.measure, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
    config.setURLSchemeHandler(context.coordinator.host, forURLScheme: RequestPolicy.scheme)
    let web = PassScrollWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator.host
    web.uiDelegate = context.coordinator.host
    web.underPageBackgroundColor = NSColor(Tok.bg)
    web.scrolls = scrolls
    web.load(URLRequest(url: context.coordinator.host.pageURL))
    return web
  }

  func updateNSView(_ web: PassScrollWebView, context: Context) {
    context.coordinator.onHeight = onHeight
    web.scrolls = scrolls
  }

  static func dismantleNSView(_ web: PassScrollWebView, coordinator: Coordinator) {
    web.configuration.userContentController.removeScriptMessageHandler(forName: handler, contentWorld: .defaultClient)
  }
}

/// A web view inside the transcript's scroll view. While the whole page shows, the wheel scrolls the transcript, not
/// the page.
final class PassScrollWebView: WKWebView {
  var scrolls = false

  override func scrollWheel(with event: NSEvent) {
    if scrolls { super.scrollWheel(with: event) } else { nextResponder?.scrollWheel(with: event) }
  }
}
