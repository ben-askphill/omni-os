import OmniKit
import SwiftUI

/// ⌘K: jump to a page, channel or recent thread, or search everything. Keyboard only if you like: type,
/// arrows, return, escape.
struct PaletteOverlay: View {
  let model: AppModel

  var body: some View {
    if model.shell.paletteOpen, model.serverScreen == nil {
      ZStack(alignment: .top) {
        Color(hex: 0x17181a).opacity(0.22)
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
        OmniIcon(name: "search", size: 18)
          .foregroundStyle(Tok.fg4)
        TextField("Search or jump to", text: $query)
          .textFieldStyle(.plain)
          .font(.omni(size: 16))
          .foregroundStyle(Tok.fg)
          .focused($focused)
          .onSubmit { run(items.indices.contains(at) ? items[at] : nil) }
          .onKeyPress(.downArrow) { cursor = min(items.count - 1, at + 1); return .handled }
          .onKeyPress(.upArrow) { cursor = max(0, at - 1); return .handled }
          .onKeyPress(.escape) { close(); return .handled }
        Kbd(text: "Esc")
      }
      .padding(.leading, 24)
      .padding(.trailing, 16)
      .frame(height: z(64))
      Rectangle().fill(Tok.line).frame(height: 1)
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
              if index == 0 || items[index - 1].group != item.group {
                Text(item.group.title)
                  .omniCaption()
                  .padding(.horizontal, 16)
                  .padding(.top, 12)
                  .padding(.bottom, 8)
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
                .font(.omni(size: 13))
                .foregroundStyle(Tok.fg3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            }
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 8)
        }
        .onChange(of: at) { if items.indices.contains(at) { proxy.scrollTo(items[at].id) } }
      }
      Rectangle().fill(Tok.line).frame(height: 1)
      HStack(spacing: 16) {
        HStack(spacing: 6) {
          Kbd(text: "↑")
          Kbd(text: "↓")
          Text("move")
        }
        HStack(spacing: 6) {
          Kbd(text: "↵")
          Text("open")
        }
        Spacer()
      }
      .font(.omni(size: 11.5))
      .foregroundStyle(Tok.fg4)
      .padding(.horizontal, 24)
      .padding(.vertical, 10)
    }
    .frame(width: z(620))
    .frame(maxHeight: z(640))
    .fixedSize(horizontal: false, vertical: true)
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    .menuShadow(28)
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

  /// The web's icon for each page, from the SF Symbol names OmniKit carries.
  private var icon: String {
    switch item.symbol {
    case "plus": item.id == "p:new-channel" ? "hash" : "plus"
    case "house": "home"
    case "square.stack.3d.up": "layers"
    case "bolt": "zap"
    case "key": "key"
    case "arrow.triangle.2.circlepath", "arrow.clockwise": "refresh"
    case "sun.max": "sun"
    case "moon": "moon"
    case "desktopcomputer": "monitor"
    default: "more"
    }
  }

  var body: some View {
    HStack(spacing: 12) {
      lead.frame(width: z(28), height: z(28))
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(item.label)
          .font(.omni(size: 13.5))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
        if let sub = item.sub {
          Text(sub)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      if let trailing = item.trailing {
        Text(trailing)
          .font(.omni(size: 11))
          .monospacedDigit()
          .foregroundStyle(item.group == .channels ? Tok.live : Tok.fg4)
      }
      if selected {
        OmniIcon(name: "arrowRight", size: 14)
          .foregroundStyle(Tok.fg3)
      }
    }
    .padding(.horizontal, 12)
    .frame(height: z(48))
    .background(selected ? Tok.surface2 : .clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .contentShape(Rectangle())
  }

  @ViewBuilder private var lead: some View {
    if let status = item.status {
      StatusDot(status: status)
    } else if item.group == .channels {
      ZStack {
        Circle().fill(Tok.surface2)
        if item.symbol == "scope" {
          OmniIcon(name: "target", size: 14).foregroundStyle(Tok.fg2)
        } else {
          Text(AvatarMark(name: String(item.label.drop { $0 == "#" })).letter)
            .font(.omni(size: 11.5, weight: .medium, design: .rounded))
            .foregroundStyle(Tok.fg2)
        }
      }
    } else {
      OmniIcon(name: icon, size: 14)
        .foregroundStyle(Tok.fg3)
        .frame(width: z(28), height: z(28))
        .background(Tok.surface2, in: Circle())
    }
  }
}
