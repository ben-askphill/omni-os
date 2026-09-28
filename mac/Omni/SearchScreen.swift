import OmniKit
import SwiftUI

/// The `#/search?q=` screen: full-text results with the matched words marked, as Search.tsx.
struct SearchScreen: View {
  let model: AppModel
  let query: String
  @State private var value: String
  @State private var phase = Phase.idle
  @FocusState private var focused: Bool

  private enum Phase {
    case idle, loading
    case loaded([SearchHit])
    case failed(String)
  }

  init(model: AppModel, query: String) {
    self.model = model
    self.query = query
    _value = State(initialValue: query)
  }

  private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        Text("Search")
          .font(.system(size: 28, weight: .semibold))
          .padding(.top, 32)
        Text("Titles, prompts, replies and tool output across every channel.")
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
          .padding(.top, 4)
          .padding(.bottom, 16)
        field
        results
          .padding(.top, 20)
      }
    }
    .task(id: "\(trimmed)/\(ObjectIdentifier(model.store).hashValue)") { await run() }
    .onChange(of: query) { value = query }
    .onAppear { if query.isEmpty { focused = true } }
  }

  private var field: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
      TextField("Search threads", text: $value)
        .textFieldStyle(.plain)
        .font(.system(size: 15))
        .focused($focused)
        .onSubmit { model.route = .search(query: value.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    .padding(.horizontal, 16)
    .frame(height: 44)
    .background(ThreadStyle.surface, in: Capsule())
    .overlay(Capsule().strokeBorder(focused ? Color.primary.opacity(0.25) : ThreadStyle.line))
  }

  @ViewBuilder private var results: some View {
    if trimmed.isEmpty {
      EmptyNote(symbol: "magnifyingglass", title: "Search everything", message: "Prefix matches work, so checko finds checkout.")
    } else {
      switch phase {
      case .idle, .loading:
        ProgressView("Searching").controlSize(.small).frame(maxWidth: .infinity).padding(.vertical, 40)
      case .failed(let message):
        ErrorNote(text: message) { Task { await run() } }
      case .loaded(let hits) where hits.isEmpty:
        EmptyNote(symbol: "magnifyingglass", title: "No results for \"\(trimmed)\"", message: "Try fewer or shorter words.")
      case .loaded(let hits):
        VStack(alignment: .leading, spacing: 0) {
          Text((hits.count >= 40 ? "Top 40 results" : Format.plural(hits.count, "result")).uppercased())
            .font(.system(size: 10.5, weight: .medium))
            .tracking(0.6)
            .foregroundStyle(.tertiary)
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
          ForEach(hits) { SearchRow(model: model, hit: $0) }
        }
      }
    }
  }

  private func run() async {
    guard !trimmed.isEmpty else { return phase = .idle }
    phase = .loading
    do {
      phase = .loaded(try await model.client.search(trimmed))
    } catch {
      if error != .cancelled { phase = .failed(error.message) }
    }
  }
}

private struct SearchRow: View {
  let model: AppModel
  let hit: SearchHit
  @State private var hovering = false

  var body: some View {
    Button {
      model.route = .thread(id: hit.threadID)
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          StatusDot(status: hit.status)
          Text(hit.title.isEmpty ? "Untitled" : hit.title)
            .font(.system(size: 13.5, weight: .medium))
            .lineLimit(1)
          Spacer(minLength: 8)
          Text("#\(model.store.channel(hit.channelID)?.name ?? hit.channelID)")
            .font(.system(size: 11.5))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .background(ThreadStyle.surface2, in: Capsule())
          Text(Format.relTime(hit.updatedAt))
            .font(.system(size: 11))
            .monospacedDigit()
            .foregroundStyle(.tertiary)
            .frame(width: 84, alignment: .trailing)
        }
        if !hit.snippet.isEmpty {
          Text(Self.highlighted(hit.snippet))
            .font(.system(size: 12.5))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .padding(.leading, 16)
            .multilineTextAlignment(.leading)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 10)
      .padding(.vertical, 10)
      .contentShape(Rectangle())
      .background(hovering ? ThreadStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 14))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
  }

  static func highlighted(_ snippet: String) -> AttributedString {
    var out = AttributedString()
    for run in Snippet.runs(snippet) {
      var piece = AttributedString(run.text)
      if run.marked {
        piece.font = .system(size: 12.5, weight: .semibold)
        piece.foregroundColor = .primary
        piece.backgroundColor = Color.yellow.opacity(0.35)
      }
      out += piece
    }
    return out
  }
}
