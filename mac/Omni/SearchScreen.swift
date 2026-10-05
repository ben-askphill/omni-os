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
        OmniPageHeader(title: "Search", subtitle: "Titles, prompts, replies and tool output across every channel.")
          .padding(.top, 40)
          .padding(.bottom, 24)
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
      OmniIcon(name: "search", size: 17).foregroundStyle(Tok.fg3)
      TextField("Search threads", text: $value, prompt: Text("Search threads").foregroundStyle(Tok.fg4))
        .textFieldStyle(.plain)
        .font(.system(size: 15))
        .focused($focused)
        .onSubmit { model.route = .search(query: value.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    .foregroundStyle(Tok.fg)
    .padding(.leading, 18)
    .padding(.trailing, 20)
    .frame(height: 48)
    .background(focused ? Tok.bg : Tok.surface, in: Capsule())
    .overlay(Capsule().strokeBorder(focused ? Tok.lineStrong : Tok.line))
    .background(Capsule().fill(Tok.wash).padding(-5).opacity(focused ? 1 : 0))
    .animation(.easeOut(duration: 0.16), value: focused)
  }

  @ViewBuilder private var results: some View {
    if trimmed.isEmpty {
      EmptyNote(symbol: "search", title: "Search everything", message: "Prefix matches work, so checko finds checkout.")
    } else {
      switch phase {
      case .idle, .loading:
        LoadingNote(label: "Searching")
      case .failed(let message):
        ErrorNote(text: message) { Task { await run() } }
      case .loaded(let hits) where hits.isEmpty:
        EmptyNote(symbol: "search", title: "No results for \"\(trimmed)\"", message: "Try fewer or shorter words.")
      case .loaded(let hits):
        VStack(alignment: .leading, spacing: 0) {
          Text(hits.count >= 40 ? "Top 40 results" : Format.plural(hits.count, "result"))
            .omniCaption()
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
          ForEach(hits) { SearchRow(model: model, hit: $0).openInNewWindow($0.threadID, model: model) }
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
  var body: some View {
    Button {
      model.route = .thread(id: hit.threadID)
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          StatusDot(status: hit.status)
          Text(hit.title.isEmpty ? "Untitled" : hit.title)
            .font(.system(size: 13.5, weight: .medium))
            .foregroundStyle(Tok.fg)
            .lineLimit(1)
          Spacer(minLength: 8)
          Text("#\(model.store.channel(hit.channelID)?.name ?? hit.channelID)")
            .font(.system(size: 11.5))
            .foregroundStyle(Tok.fg2)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(Tok.surface2, in: Capsule())
          Text(Format.relTime(hit.updatedAt))
            .font(.system(size: 11))
            .monospacedDigit()
            .foregroundStyle(Tok.fg4)
            .frame(width: 64, alignment: .trailing)
        }
        if !hit.snippet.isEmpty {
          Text(Self.highlighted(hit.snippet))
            .font(.system(size: 12.5))
            .foregroundStyle(Tok.fg2)
            .lineSpacing(3)
            .lineLimit(2)
            .padding(.leading, 16)
            .multilineTextAlignment(.leading)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .hoverWash()
    }
    .buttonStyle(.plain)
  }

  static func highlighted(_ snippet: String) -> AttributedString {
    var out = AttributedString()
    for run in Snippet.runs(snippet) {
      var piece = AttributedString(run.text)
      if run.marked {
        piece.font = .system(size: 12.5, weight: .medium)
        piece.foregroundColor = Tok.fg
        piece.backgroundColor = Tok.mark
      }
      out += piece
    }
    return out
  }
}
