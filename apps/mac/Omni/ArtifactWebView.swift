import AppKit
import OmniKit
import SwiftUI
import WebKit

/// An HTML or SVG artifact in a web view that can reach nothing of Ben's: a non-persistent data store, the
/// artifact's bytes served by a custom scheme (never over http from the Omni server), a content rule list
/// that blocks this machine, the tailnet and the Omni port, no script message handlers, and every link or new
/// window sent to the default browser.
struct ArtifactWebView: View {
  let client: OmniClient
  let ref: ArtifactRef
  @State private var rules: WKContentRuleList?
  @State private var failure: String?

  var body: some View {
    let port = client.baseURL.port ?? 4747
    Group {
      if let rules {
        SandboxedWebView(client: client, ref: ref, rules: rules, port: port)
          .id(ref)
      } else if let failure {
        ErrorNote(text: failure).padding(z(12))
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: port) {
      do {
        rules = try await SandboxRules.list(port: port)
      } catch {
        failure = "Could not set up the page's sandbox, so it is not shown."
      }
    }
  }
}

@MainActor
enum SandboxRules {
  private static var cache: [Int: WKContentRuleList] = [:]

  static func list(port: Int) async throws -> WKContentRuleList {
    if let hit = cache[port] { return hit }
    guard let list = try await WKContentRuleListStore.default().compileContentRuleList(
      forIdentifier: "omni-artifact-\(port)", encodedContentRuleList: RequestPolicy.ruleListJSON(omniPort: port))
    else { throw OmniAPIError.decoding("no rule list") }
    cache[port] = list
    return list
  }
}

private struct SandboxedWebView: NSViewRepresentable {
  let client: OmniClient
  let ref: ArtifactRef
  let rules: WKContentRuleList
  let port: Int

  func makeCoordinator() -> ArtifactWebHost { ArtifactWebHost(client: client, ref: ref, port: port, opensLinks: true) }

  func makeNSView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.userContentController.add(rules)
    config.setURLSchemeHandler(context.coordinator, forURLScheme: RequestPolicy.scheme)
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator
    web.uiDelegate = context.coordinator
    web.underPageBackgroundColor = .white
    #if DEBUG
    InspectorProbe.webView = web
    #endif
    web.load(URLRequest(url: context.coordinator.pageURL))
    return web
  }

  func updateNSView(_ web: WKWebView, context: Context) {}
}

/// Serves the artifact to its page and decides where links go. Links open in the default browser only from a
/// view Ben looks at (`opensLinks`) and only when a link is followed: a page that redirects itself, or one
/// drawn for a thumbnail, never starts the browser.
@MainActor
final class ArtifactWebHost: NSObject, WKURLSchemeHandler, WKNavigationDelegate, WKUIDelegate {
  private let client: OmniClient
  private let ref: ArtifactRef
  private let port: Int
  private let opensLinks: Bool
  private var active: Set<ObjectIdentifier> = []

  init(client: OmniClient, ref: ArtifactRef, port: Int, opensLinks: Bool = false) {
    self.client = client
    self.ref = ref
    self.port = port
    self.opensLinks = opensLinks
  }

  var pageURL: URL {
    var c = URLComponents()
    c.scheme = RequestPolicy.scheme
    c.host = String(ref.id)
    c.percentEncodedPath = "/" + (ref.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "artifact")
    return c.url ?? URL(string: "\(RequestPolicy.scheme)://\(ref.id)/")!
  }

  // MARK: Scheme

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url, url.host() == String(ref.id), url.path() == pageURL.path() else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let key = ObjectIdentifier(task)
    active.insert(key)
    let client = client
    let ref = ref
    Task { [weak self] in
      let result: Result<Data, OmniAPIError>
      do throws(OmniAPIError) {
        result = .success(try await client.artifactData(ref))
      } catch {
        result = .failure(error)
      }
      guard let self, self.active.remove(key) != nil else { return }
      switch result {
      case .success(let data):
        let type = ref.kind == "svg" ? "image/svg+xml" : "text/html; charset=utf-8"
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store"]
        if let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
          task.didReceive(response)
          task.didReceive(data)
          task.didFinish()
        }
      case .failure:
        task.didFailWithError(URLError(.cannotLoadFromNetwork))
      }
    }
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
    active.remove(ObjectIdentifier(task))
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = action.request.url else { return .cancel }
    let mainFrame = action.targetFrame?.isMainFrame ?? false
    if url.scheme == RequestPolicy.scheme {
      // Its own page, or a jump inside it.
      return !mainFrame || url.path() == pageURL.path() ? .allow : .cancel
    }
    // A frame inside the page loads what the rule list lets through. Not file: and the like.
    if !mainFrame, action.targetFrame != nil, action.navigationType == .other,
      ["http", "https", "about", "data", "blob"].contains(url.scheme?.lowercased() ?? "")
    {
      return .allow
    }
    if action.navigationType == .linkActivated { openOutside(url) }
    return .cancel
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { openOutside(url) }
    return nil
  }

  private func openOutside(_ url: URL) {
    guard opensLinks, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""), !RequestPolicy.isBlocked(url, omniPort: port) else { return }
    NSWorkspace.shared.open(url)
  }
}
