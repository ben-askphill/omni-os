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

/// Hand Off to as a submenu, for the menu bar's Thread menu. Only while the thread's store is open, since only its
/// detail says whether the turn runs on this Mac. In the window it is the reply box's Machine chip (RunOnPicker.swift).
struct HandOffMenu: View {
  let model: AppModel
  let threadID: String
  var title = "Hand Off to…"

  var body: some View {
    if let store = model.threads.store(threadID), let devices = model.devices.targets(store) {
      Menu(title) {
        HandOffItems(store: store, devices: devices)
      }
    }
  }
}

#if DEBUG
/// Where the thread header's ⋯ menu is, for the QA harness to click it, a hand off to a Mac, and the Machine chip's
/// Take Over.
@MainActor
enum QAHandoffProbe {
  struct TakeOver {
    /// Picks This Mac in the Machine chip, which opens Take Over's confirm.
    let ask: () -> Void
    /// Presses Take Over in the confirm.
    let confirm: () async -> Void
  }

  static var button: CGRect?
  static var handOff: ((String) async -> Void)?
  static var takeOver: TakeOver?
}
#endif

/// Handoff.tsx: the thread's handoff at the end of the transcript, as `HandoffBanner` words it. A card with Cancel on
/// the Mac that started it while it is under way, and one quiet line once it settled.
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
        .help(handoff.outgoing ? "Keep the thread on this Mac" : "Leave the thread on \(handoff.from.name)")
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
