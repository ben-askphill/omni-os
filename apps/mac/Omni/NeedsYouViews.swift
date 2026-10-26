import OmniKit
import SwiftUI

/// The Needs you section of Home and of a channel, as NeedsYouSection in NeedsYou.tsx. Hidden in a channel with
/// nothing in it (`quiet`); Home says all clear.
struct NeedsYouSection: View {
  let model: AppModel
  let inbox: NeedsYou?
  var showChannel = false
  var quiet = false

  var body: some View {
    if let inbox, !(quiet && inbox.items.isEmpty) {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .firstTextBaseline) {
          HStack(spacing: z(8)) {
            Text("Needs you")
              .font(.omni(size: 17, weight: .medium))
              .tracking(-0.17)
              .foregroundStyle(Tok.fg)
            if !inbox.items.isEmpty {
              Text("\(inbox.items.count)")
                .font(.omni(size: 11.5))
                .monospacedDigit()
                .foregroundStyle(Tok.fg4)
            }
          }
          Spacer()
          if let counts = counts(inbox) {
            Text(counts)
              .font(.omni(size: 11.5))
              .monospacedDigit()
              .foregroundStyle(Tok.fg4)
          }
        }
        .padding(.horizontal, z(4))
        .padding(.bottom, z(8))
        if inbox.items.isEmpty {
          Text("All caught up. Finished and failed threads you have not opened show up here.")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg4)
            .padding(.horizontal, z(4))
        } else {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(inbox.items) { item in
              NeedsYouRow(model: model, item: item, showChannel: showChannel)
                .openInNewWindow(item.id, model: model, title: item.thread.title, stub: ThreadStub(item.thread))
            }
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Needs you")
    }
  }

  private func counts(_ n: NeedsYou) -> String? {
    let parts = [n.unread > 0 ? "\(n.unread) unread" : nil, n.blocked > 0 ? "\(n.blocked) blocked" : nil].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

/// One thread that needs Ben: why, and the result's last words or Setup's reason. Opening it reads the result. On
/// hover, a check in place of the time marks it done (as NeedsYouRow in NeedsYou.tsx); right-click has it too.
private struct NeedsYouRow: View {
  let model: AppModel
  let item: NeedsYouItem
  let showChannel: Bool
  @State private var hovering = false

  var body: some View {
    let reason = item.reason
    let glyph = Self.glyph(reason.tone)
    let unread = item.result != nil
    Button {
      model.route = .thread(id: item.id)
    } label: {
      HStack(alignment: .top, spacing: z(12)) {
        leading(glyph)
        VStack(alignment: .leading, spacing: z(5)) {
          HStack(spacing: z(8)) {
            Text(item.thread.title.isEmpty ? "Untitled" : item.thread.title)
              .font(.omni(size: 14))
              .foregroundStyle(unread ? Tok.fg : Tok.fg2)
              .lineLimit(1)
            if unread {
              Circle()
                .fill(Tok.fg)
                .frame(width: z(6), height: z(6))
                .accessibilityLabel("Unread")
            }
            Spacer(minLength: z(8))
            TimelineView(.everyMinute) { _ in
              Text(Format.relTime(item.at))
                .font(.omni(size: 11))
                .monospacedDigit()
                .foregroundStyle(Tok.fg4)
            }
            .opacity(hovering && canDone ? 0 : 1)
          }
          HStack(spacing: z(6)) {
            if showChannel {
              Text("#\(item.thread.channelID)")
                .foregroundStyle(Tok.fg2)
            }
            Text(reason.label)
              .foregroundStyle(Tok.fg2)
              .layoutPriority(1)
            if let detail = reason.detail {
              Text("· \(detail)")
                .lineLimit(1)
            }
          }
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
        }
      }
      .padding(.horizontal, z(10))
      .padding(.vertical, z(10))
      .contentShape(Rectangle())
      .background(hovering ? Tok.surface : .clear, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
    }
    .buttonStyle(.plain)
    .overlay(alignment: .topTrailing) {
      if canDone {
        Button {
          Task { await model.setThreadDone(item.id, true) }
        } label: {
          OmniIcon(name: "check", size: 15)
            .foregroundStyle(Tok.fg3)
            .frame(width: z(28), height: z(28))
            .background(Tok.bg, in: Circle())
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(.top, z(6))
        .padding(.trailing, z(6))
        .opacity(hovering ? 1 : 0)
        .help("Mark as done")
        .accessibilityLabel("Mark \(item.thread.title.isEmpty ? "Untitled" : item.thread.title) as done")
      }
    }
    .onHover { hovering = $0 }
    .accessibilityElement(children: .combine)
  }

  private var canDone: Bool { !item.thread.status.isActive }

  @ViewBuilder private func leading(_ glyph: Glyph) -> some View {
    if showChannel {
      ChannelAvatar(
        name: item.thread.channelID, conductor: item.thread.channelID == SidebarSections.conductorID, size: 32,
        icon: model.store.channel(item.thread.channelID)?.icon
      )
      .overlay(alignment: .bottomTrailing) {
        GlyphView(glyph: glyph, size: 8)
          .padding(z(2))
          .background(Tok.bg, in: Circle())
          .offset(x: 2, y: 2)
      }
    } else {
      GlyphView(glyph: glyph)
        .frame(width: z(32), height: z(32))
        .background(ThreadStyle.surface, in: Circle())
    }
  }

  static func glyph(_ tone: NeedsYouItem.Tone) -> Glyph {
    switch tone {
    case .needs: .needs
    case .done: .done
    case .settled: .settled
    }
  }
}

extension View {
  /// On screen, the open thread's newest result is read: exactly the one Needs you listed, so a turn that ends after
  /// it stays unread until the inbox lists it and this shows it too. Nothing is read while the app is in the background.
  func readsShownResult(model: AppModel, threadID: String, status: ThreadStatus?) -> some View {
    modifier(ReadsShownResult(model: model, threadID: threadID, status: status))
  }
}

private struct ReadsShownResult: ViewModifier {
  let model: AppModel
  let threadID: String
  let status: ThreadStatus?
  @Environment(\.scenePhase) private var phase

  func body(content: Content) -> some View {
    let shown = phase == .active ? model.store.needsYou?.shownResult(threadID: threadID, status: status) : nil
    content.task(id: shown) {
      guard let shown else { return }
      await model.store.readResult(shown)
    }
  }
}
