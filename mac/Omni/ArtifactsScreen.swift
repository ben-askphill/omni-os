import OmniKit
import SwiftUI

/// The Artifacts page (web/src/pages/Artifacts.tsx): what the crew produced, newest first, as a grid.
struct ArtifactsScreen: View {
  let model: AppModel

  var body: some View {
    // A new store when the port changes, as the client does.
    ArtifactsPage(model: model, client: model.client)
      .id(model.client.baseURL)
  }
}

private struct ArtifactsPage: View {
  let model: AppModel
  let client: OmniClient
  @State private var store: ArtifactsStore
  @State private var filter = ArtifactFilter.all
  /// When the page was last visited, if ever. "New" means changed since then.
  @State private var seenAt: Date?
  private static let seenKey = "artifacts.seen"

  init(model: AppModel, client: OmniClient) {
    self.model = model
    self.client = client
    _store = State(initialValue: ArtifactsStore(client: client) { [model] id in
      model.store.recent.first { $0.id == id }.map { ($0.title, $0.channelID) }
    })
    let seen = UserDefaults.standard.double(forKey: Self.seenKey)
    _seenAt = State(initialValue: seen > 0 ? Date(timeIntervalSince1970: seen) : nil)
  }

  var body: some View {
    let items = store.gallery.items(matching: filter)
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        OmniPageHeader(title: "Artifacts", subtitle: "Pages, reports and files the crew produced, newest first.")
          .padding(.top, 40)
          .padding(.bottom, 24)
        filters.padding(.bottom, 20)
        content(items)
      }
      .padding(.horizontal, 32)
      .padding(.bottom, 64)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .onAppear {
      store.start()
      UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: Self.seenKey)
    }
    .onDisappear { store.stop() }
  }

  private var filters: some View {
    SegmentedPill(selection: $filter, counted: ArtifactFilter.allCases.map { ($0, $0.label, store.gallery.count(matching: $0)) }, small: true)
      .fixedSize()
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Filter artifacts")
  }

  @ViewBuilder private func content(_ items: [GalleryArtifact]) -> some View {
    switch store.loadState {
    case .failed(let error) where store.gallery.items.isEmpty:
      ErrorNote(text: error.message) { Task { await store.reload() } }
    case .loading where store.gallery.items.isEmpty:
      LoadingNote()
    default:
      if items.isEmpty {
        EmptyNote(symbol: "layers", title: store.gallery.items.isEmpty ? "No artifacts yet" : "Nothing matches this filter",
                  message: "Ask for a report, audit or mockup and it lands here and in the thread's side panel.")
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 16, alignment: .top)], spacing: 16) {
          ForEach(items) { item in
            ArtifactCard(model: model, client: client, item: item, isNew: seenAt.map { item.artifact.updatedAt > $0 } ?? false)
          }
        }
      }
    }
  }
}

private struct ArtifactCard: View {
  let model: AppModel
  let client: OmniClient
  let item: GalleryArtifact
  let isNew: Bool
  @State private var hovering = false

  var body: some View {
    let a = item.artifact
    let ref = ArtifactRef(a)
    Button {
      model.route = .thread(id: a.threadID, artifact: a.id)
    } label: {
      VStack(alignment: .leading, spacing: 0) {
        ArtifactThumbnail(client: client, ref: ref)
          .aspectRatio(16.0 / 10.0, contentMode: .fit)
          .background(Tok.surface2)
          .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
          .overlay(alignment: .topLeading) {
            if isNew { NewBadge().padding(8) }
          }
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            OmniIcon(name: artifactIcon(a.kind), size: 13).foregroundStyle(Tok.fg3)
            Text(a.name).font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1).truncationMode(.middle)
          }
          Text(item.threadTitle).font(.omni(size: 12)).foregroundStyle(Tok.fg3).lineLimit(1)
          HStack(spacing: 8) {
            Text("#\(model.store.channel(item.channelID)?.name ?? item.channelID)").lineLimit(1)
            Spacer(minLength: 6)
            Text(Format.relTime(a.updatedAt)).font(.omni(size: 10.5)).monospacedDigit()
          }
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg4)
          .padding(.top, 4)
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 6)
      }
      .padding(6)
      .background(hovering ? Tok.elev : Tok.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Tok.paneEdge, lineWidth: 0.5).opacity(hovering ? 1 : 0)
      }
      .shadow(color: .black.opacity(hovering ? 0.06 : 0), radius: 8, y: 3)
      .offset(y: hovering ? -2 : 0)
      .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.spring, value: hovering)
    .help("Open \(a.name) in its thread")
    .accessibilityLabel("\(a.name), \(item.threadTitle)")
  }
}

/// Changed since the last visit: an ink pill with a volt dot, as the web's badge.
private struct NewBadge: View {
  var body: some View {
    HStack(spacing: 4) {
      Circle().fill(Tok.done).frame(width: z(4), height: z(4))
      Text("New").font(.omni(size: 10.5, weight: .medium))
    }
    .foregroundStyle(Tok.onInk)
    .padding(.horizontal, 8)
    .frame(height: z(20))
    .background(Tok.fg, in: Capsule())
  }
}
