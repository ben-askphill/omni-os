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
      VStack(alignment: .leading, spacing: 16) {
        Text("Pages, reports and files the crew produced, newest first.")
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
        filters
        content(items)
      }
      .padding(.horizontal, 24)
      .padding(.top, 8)
      .padding(.bottom, 32)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .onAppear {
      store.start()
      UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: Self.seenKey)
    }
    .onDisappear { store.stop() }
  }

  private var filters: some View {
    Picker("Filter artifacts", selection: $filter) {
      ForEach(ArtifactFilter.allCases) { f in
        let n = store.gallery.count(matching: f)
        Text(n > 0 ? "\(f.label) \(n)" : f.label).tag(f)
      }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .fixedSize()
  }

  @ViewBuilder private func content(_ items: [GalleryArtifact]) -> some View {
    switch store.loadState {
    case .failed(let error) where store.gallery.items.isEmpty:
      ErrorNote(text: error.message) { Task { await store.reload() } }
    case .loading where store.gallery.items.isEmpty:
      ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 60)
    default:
      if items.isEmpty {
        ContentUnavailableView {
          Label(store.gallery.items.isEmpty ? "No artifacts yet" : "Nothing matches this filter", systemImage: "square.stack.3d.up")
        } description: {
          Text("Ask for a report, audit or mockup and it lands here and in the thread's side panel.")
        }
        .padding(.top, 40)
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230, maximum: 340), spacing: 14, alignment: .top)], spacing: 14) {
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
          .background(ThreadStyle.surface2)
          .clipShape(RoundedRectangle(cornerRadius: 12))
          .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(ThreadStyle.line))
          .overlay(alignment: .topLeading) {
            if isNew {
              Label("New", systemImage: "circle.fill")
                .labelStyle(NewBadgeStyle())
                .padding(8)
            }
          }
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Image(systemName: artifactSymbol(a.kind)).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(a.name).font(.system(size: 13.5, weight: .medium)).lineLimit(1).truncationMode(.middle)
          }
          Text(item.threadTitle).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
          HStack {
            Text("#\(model.store.channel(item.channelID)?.name ?? item.channelID)").lineLimit(1)
            Spacer(minLength: 6)
            Text(Format.relTime(a.updatedAt)).monospacedDigit()
          }
          .font(.system(size: 11.5))
          .foregroundStyle(.tertiary)
          .padding(.top, 4)
        }
        .padding(.horizontal, 4)
        .padding(.top, 10)
        .padding(.bottom, 4)
      }
      .padding(6)
      .background(hovering ? ThreadStyle.surface2 : ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 18))
      .contentShape(RoundedRectangle(cornerRadius: 18))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help("Open \(a.name) in its thread")
    .accessibilityLabel("\(a.name), \(item.threadTitle)")
  }
}

private struct NewBadgeStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.system(size: 4)).foregroundStyle(.orange)
      configuration.title.font(.system(size: 10, weight: .medium)).textCase(.uppercase)
    }
    .padding(.horizontal, 8)
    .frame(height: 20)
    .background(.regularMaterial, in: Capsule())
  }
}
