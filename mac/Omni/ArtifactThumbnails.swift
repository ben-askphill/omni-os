import AppKit
import ImageIO
import OmniKit
import SwiftUI
import WebKit

/// Thumbnails for the Artifacts page, made once per version of a file and kept in memory. Images are
/// decoded small; pages are loaded in the same sandbox as the viewer and snapshotted, one at a time.
@MainActor
final class ArtifactThumbnails {
  static let shared = ArtifactThumbnails()
  nonisolated static let width: CGFloat = 480
  private static let page = CGSize(width: 1280, height: 800)

  private let cache = NSCache<NSString, NSImage>()
  private var failed: Set<String> = []
  private var busy = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  func thumbnail(client: OmniClient, ref: ArtifactRef) async -> NSImage? {
    let key = "\(client.baseURL.port ?? 0)/\(ref.id)/\(ref.updatedAt.timeIntervalSince1970)"
    if let hit = cache.object(forKey: key as NSString) { return hit }
    guard !failed.contains(key) else { return nil }
    let image: NSImage? =
      switch ref.kind {
      case "image": await bitmap(client: client, ref: ref)
      case "svg": await vector(client: client, ref: ref)
      case "html": await snapshot(client: client, ref: ref)
      default: nil
      }
    guard !Task.isCancelled else { return nil }
    if let image { cache.setObject(image, forKey: key as NSString) } else { failed.insert(key) }
    return image
  }

  private func bitmap(client: OmniClient, ref: ArtifactRef) async -> NSImage? {
    guard let data = try? await client.artifactData(ref) else { return nil }
    return await Task.detached {
      let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: Self.width * 2,
      ] as CFDictionary
      guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options)
      else { return nil }
      return NSImage(cgImage: cg, size: NSSize(width: cg.width / 2, height: cg.height / 2))
    }.value
  }

  private func vector(client: OmniClient, ref: ArtifactRef) async -> NSImage? {
    guard let data = try? await client.artifactData(ref), let image = NSImage(data: data), image.size.width > 0 else { return nil }
    return image
  }

  // MARK: Pages

  private func acquire() async {
    if busy { await withCheckedContinuation { waiting.append($0) } }
    busy = true
  }

  private func release() {
    busy = false
    if !waiting.isEmpty { waiting.removeFirst().resume() }
  }

  private func snapshot(client: OmniClient, ref: ArtifactRef) async -> NSImage? {
    await acquire()
    defer { release() }
    guard !Task.isCancelled else { return nil }
    let port = client.baseURL.port ?? 4747
    guard let rules = try? await SandboxRules.list(port: port) else { return nil }
    let host = ArtifactWebHost(client: client, ref: ref, port: port)
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(rules)
    config.setURLSchemeHandler(host, forURLScheme: RequestPolicy.scheme)
    let web = WKWebView(frame: CGRect(origin: .zero, size: Self.page), configuration: config)
    web.navigationDelegate = host
    web.uiDelegate = host
    web.underPageBackgroundColor = .white
    // Off screen but in a window, or WebKit does not draw.
    let window = NSWindow(contentRect: CGRect(x: -10_000, y: -10_000, width: Self.page.width, height: Self.page.height), styleMask: .borderless, backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = web
    window.orderBack(nil)
    defer { window.close() }
    web.load(URLRequest(url: host.pageURL))
    for _ in 0..<160 where web.isLoading || web.url == nil {
      guard !Task.isCancelled else { return nil }
      try? await Task.sleep(for: .milliseconds(50))
    }
    guard !web.isLoading else { return nil }
    try? await Task.sleep(for: .milliseconds(400))
    let shot = WKSnapshotConfiguration()
    shot.rect = CGRect(origin: .zero, size: Self.page)
    shot.snapshotWidth = NSNumber(value: Self.width)
    return try? await web.takeSnapshot(configuration: shot)
  }
}

/// A card's picture: the file's thumbnail, or its type icon while it loads and when there is none.
struct ArtifactThumbnail: View {
  let client: OmniClient
  let ref: ArtifactRef
  @State private var image: NSImage?

  var body: some View {
    ZStack {
      if let image {
        Image(nsImage: image)
          .resizable()
          .aspectRatio(contentMode: .fill)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      } else {
        OmniIcon(name: artifactIcon(ref.kind), size: 28, weight: 1.25)
          .foregroundStyle(Tok.fg4)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipped()
    .background(ref.kind == "html" ? Color.white : Color.clear)
    .task(id: ref) {
      image = await ArtifactThumbnails.shared.thumbnail(client: client, ref: ref)
    }
  }
}
