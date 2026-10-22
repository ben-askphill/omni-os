import AppKit
import OmniKit
import SwiftUI

/// `AsyncImage` for a server image (an artifact, an upload): it loads through `OmniClient.imageData`, which sends
/// the API token to that server's exact host and port and to nothing else. `AsyncImage` would load through
/// `URLSession.shared`, which carries no token.
struct ClientImage<Content: View>: View {
  let client: OmniClient
  let url: URL?
  @ViewBuilder let content: (AsyncImagePhase) -> Content
  @State private var phase = AsyncImagePhase.empty

  var body: some View {
    content(phase)
      .task(id: url) {
        phase = .empty
        guard let url else { return phase = .failure(URLError(.badURL)) }
        do {
          let data = try await client.imageData(url)
          guard let image = NSImage(data: data) else { return phase = .failure(URLError(.cannotDecodeContentData)) }
          phase = .success(Image(nsImage: image))
        } catch {
          phase = .failure(error)
        }
      }
  }
}

extension ClientImage {
  /// Like `AsyncImage(url:content:placeholder:)`.
  init<I: View, P: View>(
    client: OmniClient, url: URL?, @ViewBuilder content image: @escaping (Image) -> I, @ViewBuilder placeholder: @escaping () -> P
  ) where Content == _ConditionalContent<I, P> {
    self.init(client: client, url: url) { phase in
      if let i = phase.image { image(i) } else { placeholder() }
    }
  }
}
