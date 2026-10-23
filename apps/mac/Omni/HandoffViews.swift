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
          Image(systemName: "laptopcomputer.and.arrow.down")
            .font(.omni(size: 14))
        }
        .menuStyle(.button)
        .buttonStyle(.icon(size: 28))
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Hand off to another Mac")
        .accessibilityLabel("Hand off to another Mac")
        #if DEBUG
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAHandoffProbe.button = $0 }
        .onDisappear { QAHandoffProbe.button = nil }
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
/// Where the header's Hand Off button is, for the QA harness to click it.
@MainActor
enum QAHandoffProbe {
  static var button: CGRect?
}
#endif

/// The thread's handoff above the reply box: a card with Cancel while it is under way, the error when it failed,
/// and one quiet line once it is over.
struct HandoffBanner: View {
  let store: ThreadStore
  let handoff: HandoffView

  var body: some View {
    // An offer goes stale on screen 90 seconds in; the line says so within a few seconds of that.
    TimelineView(.periodic(from: .now, by: 5)) { context in
      let phase = handoff.phase(now: context.date)
      let text = handoff.text(now: context.date)
      switch phase {
      case .preparing, .offered: card(text, stale: phase == .offered(stale: true))
      case .failed: ErrorNote(text: text)
      case .accepted, .cancelled: quiet(text)
      }
    }
  }

  private func card(_ text: String, stale: Bool) -> some View {
    HStack(alignment: .center, spacing: z(10)) {
      if stale {
        OmniIcon(name: "clock", size: 14).foregroundStyle(Tok.needs)
      } else {
        Loader(size: 13)
      }
      lines(text, tone: Tok.fg2)
      if handoff.outgoing {
        Button {
          Task { await store.cancelHandoff() }
        } label: {
          HStack(spacing: z(6)) {
            if store.handingOff { Loader(size: 12) }
            Text("Cancel")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(store.handingOff)
        .help("Keep the thread on this Mac")
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(16), style: .continuous).strokeBorder(Tok.line))
    .accessibilityElement(children: .contain)
  }

  private func quiet(_ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: z(6)) {
      Image(systemName: "laptopcomputer")
        .font(.omni(size: 11))
        .foregroundStyle(Tok.fg3)
      lines(text, tone: Tok.fg3)
    }
    .padding(.horizontal, z(4))
    .accessibilityElement(children: .combine)
  }

  private func lines(_ text: String, tone: Color) -> some View {
    VStack(alignment: .leading, spacing: z(2)) {
      Text(text)
        .font(.omni(size: 12.5))
        .foregroundStyle(tone)
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
