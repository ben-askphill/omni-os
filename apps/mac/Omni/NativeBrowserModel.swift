import AppKit
import CryptoKit
import Observation
import OmniKit
import WebKit

/// The Mac app's own browser for a channel: real `WKWebView`s in the app, so a page is drawn by the Mac and not streamed.
/// Ben browses, logs in and annotates here; the agent keeps driving the channel's server-side Chrome (`ChannelBrowserModel`).
/// A channel's tabs and logins last for the app's run and, as addresses and cookies, across launches.
@MainActor @Observable
final class NativeBrowserModel {
  let channel: String
  /// In the shape the shared Chrome frame draws: `running` is always true, a web view needs no start.
  private(set) var state = BrowserState.stopped
  /// Why a page could not be shown that the page itself cannot say, such as a failed download.
  private(set) var notice: String?
  @ObservationIgnored fileprivate(set) var tabs: [NativeTab] = []
  @ObservationIgnored private var active: String?
  @ObservationIgnored private let store: WKWebsiteDataStore
  /// Pages Ben has seen load, restored next launch.
  @ObservationIgnored private let defaults: UserDefaults
  /// Where the page is read by Annotate's pick: its own world, so nothing the page defines can change the answer.
  @ObservationIgnored private let pickWorld = WKContentWorld.world(name: "omni-pick")
  /// The page as the last capture saw it, which a pick is only answered for while it holds.
  @ObservationIgnored private var captured: NativePageSnapshot?

  init(channel: String, defaults: UserDefaults = .standard) {
    self.channel = channel
    self.defaults = defaults
    store = WKWebsiteDataStore(forIdentifier: Self.storeID(channel))
    let saved = defaults.stringArray(forKey: Self.key(channel)) ?? []
    for address in saved.prefix(12) { addTab(address: URL(string: address), select: false) }
    if tabs.isEmpty { addTab(address: nil, select: true) }
    active = tabs.first?.id
    if let i = defaults.object(forKey: Self.key(channel) + ".active") as? Int, tabs.indices.contains(i) { active = tabs[i].id }
    refresh()
  }

  /// One stable identity per channel, so its logins are its own and last.
  nonisolated static func storeID(_ channel: String) -> UUID {
    let h = Array(SHA256.hash(data: Data("omni-native-browser:\(channel)".utf8)))
    return UUID(uuid: (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10], h[11], h[12], h[13], h[14], h[15]))
  }

  private nonisolated static func key(_ channel: String) -> String { "nativeBrowser.tabs.\(channel)" }

  var activeTab: NativeTab? { tabs.first { $0.id == active } }
  var webView: WKWebView? { activeTab?.web }

  // MARK: Tabs

  @discardableResult
  func addTab(address: URL?, select: Bool = true, configuration: WKWebViewConfiguration? = nil) -> NativeTab {
    let config = configuration ?? WKWebViewConfiguration()
    if configuration == nil {
      config.websiteDataStore = store
      config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
      config.preferences.isElementFullscreenEnabled = true
    }
    let tab = NativeTab(owner: self, configuration: config)
    tabs.append(tab)
    if select { active = tab.id }
    if let address, address.scheme != nil, address.absoluteString != "about:blank" { tab.web.load(URLRequest(url: address)) }
    refresh()
    return tab
  }

  func closeTab(_ id: String) {
    guard let i = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs.remove(at: i).tearDown()
    if tabs.isEmpty {
      addTab(address: nil)
    } else if active == id {
      active = tabs[min(i, tabs.count - 1)].id
    }
    refresh()
  }

  func select(_ id: String) {
    guard tabs.contains(where: { $0.id == id }) else { return }
    active = id
    refresh()
  }

  // MARK: Actions

  /// The same actions the toolbar gives the agent's browser, here for the web view.
  func perform(_ action: BrowserAction) {
    let web = webView
    switch action {
    case .navigate(let text): if let url = NativeBrowserAddress.resolve(text) { web?.load(URLRequest(url: url)) }
    case .back: web?.goBack()
    case .forward: web?.goForward()
    case .reload: web?.reload()
    case .stop: web?.stopLoading()
    case .restart: web?.reloadFromOrigin()
    case .newTab: addTab(address: nil)
    case .tab(let id): select(id)
    case .closeTab(let id): closeTab(id)
    case .resize: break
    }
  }

  func say(_ text: String?) { notice = text }

  /// Rebuilds `state` from the tabs. Called by a tab whenever something about it changes.
  func refresh() {
    let on = activeTab
    state = BrowserState(
      running: true,
      url: on?.web.url?.absoluteString ?? "",
      title: on?.web.title ?? "",
      loading: on?.web.isLoading ?? false,
      canBack: on?.web.canGoBack ?? false,
      canForward: on?.web.canGoForward ?? false,
      tabs: tabs.map(\.info),
      active: active,
      viewport: nil)
    let open = tabs.compactMap { $0.web.url?.absoluteString }.filter { $0.hasPrefix("http") }
    defaults.set(open, forKey: Self.key(channel))
    if let i = tabs.firstIndex(where: { $0.id == active }) { defaults.set(i, forKey: Self.key(channel) + ".active") }
  }

  // MARK: Annotate

  /// The page as it is, in CSS pixels: what a capture records and a pick is checked against.
  func look() async -> NativePageSnapshot? {
    guard let web = webView else { return nil }
    var scroll = (x: 0, y: 0)
    if let r = try? await web.evaluateJavaScript("[Math.round(scrollX), Math.round(scrollY)]", in: nil, contentWorld: pickWorld) as? [Any],
      r.count == 2, let x = (r[0] as? NSNumber)?.intValue, let y = (r[1] as? NSNumber)?.intValue
    {
      scroll = (x, y)
    }
    return NativePageSnapshot(
      url: web.url?.absoluteString ?? "", title: web.title ?? "", viewportWidth: Int(web.bounds.width.rounded()), viewportHeight: Int(web.bounds.height.rounded()),
      scrollX: scroll.x, scrollY: scroll.y)
  }

  /// A screenshot of the visible page and what it shows, for `captureNative`. It reads the page and changes nothing on it.
  private func shoot() async throws(BrowserCaptureError) -> (page: NativePageSnapshot, png: Data, jpeg: Data) {
    guard let web = webView, let before = await look() else { throw BrowserCaptureError(message: "There is no page to annotate.", retryable: false) }
    guard before.url.lowercased().hasPrefix("http") else { throw BrowserCaptureError(message: "Only a web page can be annotated. Open one in the browser first.", retryable: false) }
    guard !web.isLoading else { throw BrowserCaptureError(message: "The page is still loading. Try again once it has loaded.", retryable: true) }
    guard before.viewportWidth > 0, before.viewportHeight > 0 else { throw BrowserCaptureError(message: "The browser has no size yet. Try again.", retryable: true) }
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = NSNumber(value: Double(before.viewportWidth))
    config.afterScreenUpdates = true
    let image: NSImage
    do {
      image = try await web.takeSnapshot(configuration: config)
    } catch {
      throw BrowserCaptureError(message: "The page could not be captured: \(error.localizedDescription)", retryable: true)
    }
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw BrowserCaptureError(message: "The page did not give an image. Try again.", retryable: true) }
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let png = rep.representation(using: .png, properties: [:]), let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else {
      throw BrowserCaptureError(message: "The page could not be encoded as an image.", retryable: true)
    }
    guard let after = await look(), after.matches(before) else { throw BrowserCaptureError(message: "The page moved while the screenshot was taken. Try again.", retryable: true, stale: "scrolled") }
    return (before, png, jpeg)
  }

  func capture(client: OmniClient, thread: String) async throws(BrowserCaptureError) -> BrowserAnnotationContext.Capture {
    let shot = try await shoot()
    // Lossless while it fits the inline limit every harness takes, then a JPEG.
    let usePNG = shot.png.count <= BrowserNativeCapture.maxBytes
    let capture = try await client.captureNative(
      channel: channel, thread: thread, page: shot.page, image: usePNG ? shot.png : shot.jpeg, mime: usePNG ? "image/png" : "image/jpeg")
    captured = shot.page
    return capture
  }

  /// What is at (`x`, `y`) of the screenshot, read from the page itself with the script the server uses for its own browser.
  /// Only while the page is as the screenshot saw it.
  func pick(client: OmniClient, thread: String, name: String, x: Int, y: Int) async throws(OmniAPIError) -> ElementPickReply {
    let note = " The screenshot and the area you mark still go with your message."
    guard let web = webView, let was = captured else { return .unavailable(reason: "unknown_capture", message: "This screenshot is too old to look elements up in." + note) }
    guard let now = await look(), now.matches(was) else { return .unavailable(reason: "stale", message: "The page changed after the screenshot." + note) }
    let script = try await client.pickScript(channel: channel, x: x, y: y)
    let answer: Any?
    do {
      answer = try await web.evaluateJavaScript(script, in: nil, contentWorld: pickWorld)
    } catch {
      return .unavailable(reason: "unreadable", message: "That part of the page could not be read." + note)
    }
    guard let answer, JSONSerialization.isValidJSONObject(answer), let raw = try? JSONSerialization.data(withJSONObject: answer) else {
      return .unavailable(reason: "unreadable", message: "That part of the page could not be read." + note)
    }
    return try await client.pickElementNative(channel: channel, thread: thread, name: name, x: x, y: y, viewport: (was.viewportWidth, was.viewportHeight), raw: raw)
  }

  /// The Annotate flow for a thread, taking the page from this web view and not from the server's Chrome.
  func annotateModel(client: OmniClient, thread: String) -> BrowserAnnotateModel {
    let channel = channel
    return BrowserAnnotateModel(
      thread: thread,
      capture: { [weak self] thread throws(BrowserCaptureError) in
        guard let self else { throw BrowserCaptureError(message: "The browser was closed.", retryable: false) }
        return try await self.capture(client: client, thread: thread)
      },
      discard: { name in await client.discardCapture(channel: channel, thread: thread, name: name) },
      pick: { [weak self] name, x, y throws(OmniAPIError) in
        guard let self else { return .unavailable(reason: "stale", message: "The browser was closed.") }
        return try await self.pick(client: client, thread: thread, name: name, x: x, y: y)
      },
      mark: { capture, marks throws(OmniAPIError) in try await client.uploadMarkedScreenshot(channel: channel, capture: capture, marks: marks) })
  }
}

/// One tab: a web view, and the delegate for everything it asks of its host.
@MainActor
final class NativeTab: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  let id = UUID().uuidString
  let web: PageWebView
  private weak var owner: NativeBrowserModel?
  private var observers: [NSKeyValueObservation] = []

  init(owner: NativeBrowserModel, configuration: WKWebViewConfiguration) {
    self.owner = owner
    web = PageWebView(frame: .zero, configuration: configuration)
    super.init()
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.allowsMagnification = true
    web.setValue(false, forKey: "drawsBackground")
    let changed: (WKWebView, Any) -> Void = { [weak owner] _, _ in MainActor.assumeIsolated { owner?.refresh() } }
    observers = [
      web.observe(\.url, changeHandler: changed), web.observe(\.title, changeHandler: changed), web.observe(\.isLoading, changeHandler: changed),
      web.observe(\.canGoBack, changeHandler: changed), web.observe(\.canGoForward, changeHandler: changed),
    ]
  }

  func tearDown() {
    observers.removeAll()
    web.stopLoading()
    web.navigationDelegate = nil
    web.uiDelegate = nil
    web.removeFromSuperview()
  }

  var info: BrowserTabInfo {
    let url = web.url
    let icon = url.flatMap { u -> String? in
      guard let scheme = u.scheme, ["http", "https"].contains(scheme), let host = u.host else { return nil }
      return "\(scheme)://\(host)\(u.port.map { ":\($0)" } ?? "")/favicon.ico"
    }
    return BrowserTabInfo(id: id, url: url?.absoluteString ?? "", title: web.title ?? "", favicon: icon)
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return .allow }
    if ["http", "https", "about", "blob", "data"].contains(scheme) { return .allow }
    // mailto:, tel: and the like belong to the app that handles them; anything else does not load.
    // Only a click in the top frame opens another app: a script or a frame cannot launch one.
    if ["mailto", "tel", "sms", "facetime"].contains(scheme),
       action.navigationType == .linkActivated, action.sourceFrame.isMainFrame {
      NSWorkspace.shared.open(url)
    }
    return .cancel
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    if response.canShowMIMEType { return .allow }
    // A file the page cannot show downloads only when the top frame asked for it, never a subframe.
    return response.isForMainFrame ? .download : .cancel
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { failed(webView, error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) { failed(webView, error) }

  private func failed(_ webView: WKWebView, _ error: any Error) {
    let e = error as NSError
    // A navigation replaced by another, and a download taking over, are not failures.
    guard e.code != NSURLErrorCancelled, e.code != 102 else { return }
    let address = (e.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? webView.url?.absoluteString ?? ""
    let page = """
      <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
      <style>body{font:15px -apple-system,system-ui;display:grid;place-items:center;height:100vh;margin:0;color:CanvasText;background:Canvas}
      main{max-width:420px;padding:24px}h1{font-size:17px;margin:0 0 8px}p{opacity:.65;margin:0 0 6px;word-break:break-all}</style>
      <main><h1>This page can't be opened</h1><p>\(Self.escape(e.localizedDescription))</p><p>\(Self.escape(address))</p></main>
      """
    webView.loadHTMLString(page, baseURL: URL(string: address))
  }

  private static func escape(_ s: String) -> String {
    s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
  }

  // MARK: Windows, dialogs and files

  /// A link that opens a window, or `window.open` (a sign-in popup): a tab here.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let owner else { return nil }
    return owner.addTab(address: nil, configuration: configuration).web
  }

  func webViewDidClose(_ webView: WKWebView) {
    owner?.closeTab(id)
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
    let a = alert(message, frame)
    a.addButton(withTitle: "OK")
    a.runModal()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
    let a = alert(message, frame)
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    return a.runModal() == .alertFirstButtonReturn
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
    let a = alert(prompt, frame)
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
    field.stringValue = defaultText ?? ""
    a.accessoryView = field
    return a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil
  }

  private func alert(_ message: String, _ frame: WKFrameInfo) -> NSAlert {
    let a = NSAlert()
    a.messageText = frame.request.url?.host ?? "This page says"
    a.informativeText = message
    return a
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    return panel.runModal() == .OK ? panel.urls : nil
  }

  // MARK: Downloads

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
    let base = (suggestedFilename as NSString).lastPathComponent
    var target = dir.appendingPathComponent(base.isEmpty ? "download" : base)
    var n = 1
    while FileManager.default.fileExists(atPath: target.path) {
      let ext = (base as NSString).pathExtension
      let stem = (base as NSString).deletingPathExtension
      target = dir.appendingPathComponent("\(stem) \(n)" + (ext.isEmpty ? "" : ".\(ext)"))
      n += 1
    }
    // WebKit quarantines the finished file, so Gatekeeper still checks it on first open.
    owner?.say("Downloading \(target.lastPathComponent) to Downloads")
    return target
  }

  func downloadDidFinish(_ download: WKDownload) { owner?.say("Saved to Downloads") }
  func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) { owner?.say("A download failed: \(error.localizedDescription)") }
}

/// A web view that handles Chrome's Cmd shortcuts when it has focus, as the streamed browser does.
final class PageWebView: WKWebView {
  var shortcut: ((_ key: String, _ shift: Bool) -> Bool)?

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if window?.firstResponder === self || (window?.firstResponder as? NSView)?.isDescendant(of: self) == true,
      event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command),
      !event.modifierFlags.contains(.option),
      shortcut?((event.charactersIgnoringModifiers ?? "").lowercased(), event.modifierFlags.contains(.shift)) == true
    {
      return true
    }
    return super.performKeyEquivalent(with: event)
  }
}

/// Native browsers by channel, so a channel's tabs and open pages stay as they are when Ben switches tabs or threads.
@MainActor
enum NativeBrowsers {
  private static var models: [String: NativeBrowserModel] = [:]

  static func model(for channel: String) -> NativeBrowserModel {
    if let m = models[channel] { return m }
    let m = NativeBrowserModel(channel: channel)
    models[channel] = m
    return m
  }
}
