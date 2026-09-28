import OmniKit
import SwiftUI

/// ⌘K: jump to a page, channel or recent thread, or search everything. Keyboard only if you like: type,
/// arrows, return, escape.
struct PaletteOverlay: View {
  let model: AppModel

  var body: some View {
    if model.shell.paletteOpen, model.serverScreen == nil {
      ZStack(alignment: .top) {
        Color.black.opacity(0.22)
          .ignoresSafeArea()
          .onTapGesture { close() }
        PaletteView(model: model, close: close)
          .padding(.top, 60)
      }
      .transition(.opacity)
    }
  }

  private func close() { model.shell.paletteOpen = false }
}

private struct PaletteView: View {
  let model: AppModel
  let close: () -> Void
  @State private var query: String
  @State private var cursor = 0
  @FocusState private var focused: Bool

  init(model: AppModel, close: @escaping () -> Void) {
    self.model = model
    self.close = close
    _query = State(initialValue: model.shell.paletteQuery)
  }

  var body: some View {
    let items = Palette.items(query: query, channels: model.store.channels, recent: model.store.recent)
    let at = min(cursor, max(0, items.count - 1))
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 16))
          .foregroundStyle(.tertiary)
        TextField("Search or jump to", text: $query)
          .textFieldStyle(.plain)
          .font(.system(size: 16))
          .focused($focused)
          .onSubmit { run(items.indices.contains(at) ? items[at] : nil) }
          .onKeyPress(.downArrow) { cursor = min(items.count - 1, at + 1); return .handled }
          .onKeyPress(.upArrow) { cursor = max(0, at - 1); return .handled }
          .onKeyPress(.escape) { close(); return .handled }
        Text("esc")
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(.tertiary)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(ThreadStyle.line))
      }
      .padding(.horizontal, 20)
      .frame(height: 52)
      Divider()
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
              if index == 0 || items[index - 1].group != item.group {
                Text(item.group.title.uppercased())
                  .font(.system(size: 10.5, weight: .medium))
                  .tracking(0.6)
                  .foregroundStyle(.tertiary)
                  .padding(.horizontal, 14)
                  .padding(.top, index == 0 ? 4 : 12)
                  .padding(.bottom, 4)
              }
              PaletteRow(item: item, selected: index == at)
                .id(item.id)
                .onTapGesture { run(item) }
                .onContinuousHover { phase in
                  if case .active = phase, cursor != index { cursor = index }
                }
            }
            if items.isEmpty {
              Text("Nothing matches")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            }
          }
          .padding(8)
        }
        .onChange(of: at) { if items.indices.contains(at) { proxy.scrollTo(items[at].id) } }
      }
      Divider()
      HStack(spacing: 16) {
        Text("↑↓ move")
        Text("↵ open")
        Spacer()
      }
      .font(.system(size: 11.5))
      .foregroundStyle(.tertiary)
      .padding(.horizontal, 20)
      .frame(height: 32)
    }
    .frame(width: 620)
    .frame(maxHeight: 520)
    .fixedSize(horizontal: false, vertical: true)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(ThreadStyle.line))
    .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
    .onChange(of: query) { cursor = 0 }
    .onAppear { focused = true }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Command menu")
  }

  private func run(_ item: PaletteItem?) {
    guard let item else { return }
    close()
    switch item.action {
    case .newThread: model.startNewThread()
    case .go(let route): model.route = route
    case .search(let text): model.route = .search(query: text)
    }
  }
}

private struct PaletteRow: View {
  let item: PaletteItem
  let selected: Bool

  var body: some View {
    HStack(spacing: 12) {
      Group {
        if let status = item.status {
          StatusDot(status: status)
        } else {
          Image(systemName: item.symbol)
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
        }
      }
      .frame(width: 26, height: 26)
      .background(ThreadStyle.surface2, in: Circle())
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(item.label)
          .font(.system(size: 13.5))
          .lineLimit(1)
        if let sub = item.sub {
          Text(sub)
            .font(.system(size: 12))
            .foregroundStyle(.tertiary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      if let trailing = item.trailing {
        Text(trailing)
          .font(.system(size: 11))
          .monospacedDigit()
          .foregroundStyle(item.group == .channels ? AnyShapeStyle(ThreadStyle.info) : AnyShapeStyle(.tertiary))
      }
      if selected {
        Image(systemName: "arrow.right")
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 8)
    .frame(height: 42)
    .background(selected ? ThreadStyle.surface2 : .clear, in: RoundedRectangle(cornerRadius: 12))
    .contentShape(Rectangle())
  }
}
