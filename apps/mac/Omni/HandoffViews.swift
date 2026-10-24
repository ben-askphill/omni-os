import OmniKit
import SwiftUI

/// The other Macs as menu items: each one's name over its reachability. A Mac Tailscale knows is away is disabled.
struct HandOffItems: View {
  let store: ThreadStore
  let devices: [Device]

  var body: some View {
    ForEach(devices) { d in
      Button {
        Task { await store.handOff(to: d.id) }
      } label: {
        Text(d.name)
        Text(d.reachabilityLabel())
      }
      .disabled(!d.canTake)
    }
  }
}

/// Hand Off to as a submenu, for the thread's right-click and the Thread menu. Only while the thread's store is open,
/// since only its detail says whether the turn runs on this Mac.
struct HandOffMenu: View {
  let model: AppModel
  let threadID: String

  var body: some View {
    if let store = model.threads.store(threadID), let devices = model.devices.targets(store) {
      Menu("Hand Off to…") {
        HandOffItems(store: store, devices: devices)
      }
    }
  }
}

/// The thread header's Hand Off button. It also keeps the list of Macs fresh while the thread could go.
struct HandOffButton: View {
  let model: AppModel
  let store: ThreadStore

  var body: some View {
    ZStack {
      if let devices = model.devices.targets(store) {
        Menu {
          Section("Hand Off to") {
            HandOffItems(store: store, devices: devices)
          }
        } label: {
          OmniIcon(name: "share", size: 15)
        }
        .menuStyle(.button)
        .buttonStyle(.icon(size: 28))
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Hand off to another Mac: stop the turn here and keep it running there")
        .accessibilityLabel("Hand off to another Mac")
        #if DEBUG
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAHandoffProbe.button = $0 }
        .onAppear { QAHandoffProbe.handOff = { [store] in await store.handOff(to: $0) } }
        .onDisappear {
          QAHandoffProbe.button = nil
          QAHandoffProbe.handOff = nil
        }
        #endif
      }
    }
    // Tailscale's view of the other Mac changes as it sleeps and wakes, so ask again while the thread could go.
    .task(id: store.canHandOff) {
      guard store.canHandOff else { return }
      while !Task.isCancelled {
        await model.devices.refresh()
        try? await Task.sleep(for: .seconds(30))
      }
    }
  }
}

#if DEBUG
/// Where the header's Hand Off button is, for the QA harness to click it, and the pick its menu makes.
@MainActor
enum QAHandoffProbe {
  static var button: CGRect?
  static var handOff: ((String) async -> Void)?
}
#endif

/// Handoff.tsx: the thread's handoff at the end of the transcript, as `HandoffBanner` words it. A card with Cancel on
/// the giving Mac while it is under way, and one quiet line once it settled.
struct HandoffCard: View {
  let store: ThreadStore
  let handoff: HandoffView

  var body: some View {
    // An offer goes stale on screen 90 seconds in; the card says so within a few seconds of that.
    TimelineView(.periodic(from: .now, by: 5)) { context in
      switch HandoffBanner(handoff, status: store.thread?.status, now: context.date) {
      case .card(let tone, let text, let cancel)?: card(tone, text, cancel: cancel)
      case .line(let tone, let text)?: line(tone, text)
      case nil: EmptyView()
      }
    }
  }

  private func card(_ tone: HandoffBanner.Tone, _ text: String, cancel: Bool) -> some View {
    HStack(alignment: .center, spacing: z(12)) {
      ZStack {
        Circle().fill(tone == .alert ? Tok.needs.opacity(0.12) : Tok.surface2)
        if tone == .working {
          Loader(size: 14, color: Tok.fg2)
        } else {
          OmniIcon(name: tone == .alert ? "alert" : "clock", size: 15).foregroundStyle(tone == .alert ? Tok.needs : Tok.fg2)
        }
      }
      .frame(width: z(28), height: z(28))
      lines(text, size: 13.5, tone: Tok.fg)
      if cancel {
        Button {
          Task { await store.cancelHandoff() }
        } label: {
          HStack(spacing: z(6)) {
            if store.handingOff { Loader(size: 12) } else { OmniIcon(name: "x", size: 13) }
            Text("Cancel")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(store.handingOff)
        .help("Keep the thread on this Mac")
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Handoff")
  }

  private func line(_ tone: HandoffBanner.Tone, _ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: z(8)) {
      OmniIcon(name: tone == .done ? "share" : "x", size: 13)
        .foregroundStyle(Tok.fg4)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
      lines(text, size: 12.5, tone: Tok.fg3)
    }
    .padding(.horizontal, z(4))
    .accessibilityElement(children: .combine)
  }

  private func lines(_ text: String, size: CGFloat, tone: Color) -> some View {
    VStack(alignment: .leading, spacing: z(2)) {
      Text(text)
        .font(.omni(size: size))
        .foregroundStyle(tone)
        .fixedSize(horizontal: false, vertical: true)
      if let left = handoff.leftBehind {
        Text(left.hasSuffix(".") ? left : left + ".")
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg4)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .textSelection(.enabled)
  }
}
