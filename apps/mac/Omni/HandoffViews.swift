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
        .help("Hand off to another Mac: a running turn carries on there, an idle thread continues there with your next message")
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

/// Take Over from <Mac>… in the thread's right-click, while its store is open and it can be taken now. It raises the
/// reply box's confirm.
struct TakeOverItem: View {
  let model: AppModel
  let threadID: String

  var body: some View {
    if let store = model.threads.store(threadID), store.canTakeOver, let takeover = store.takeover {
      Button("Take Over from \(takeover.from.name)…") { store.askTakeOver() }
    }
  }
}

/// The note over the reply box on a thread another Mac holds, as TakeoverNote in Takeover.tsx: where it runs, then Take
/// Over, or why it cannot be taken now. The pill, the Thread menu and the right-click all ask through the store, so
/// this one confirm answers all three.
struct TakeoverNote: View {
  let store: ThreadStore
  let takeover: Takeover
  @State private var confirming = false

  var body: some View {
    let confirm = takeover.confirm
    HStack(alignment: .firstTextBaseline, spacing: z(10)) {
      GlyphView(glyph: takeover.running ? .running : .settled, size: 8)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
      VStack(alignment: .leading, spacing: z(2)) {
        Text(takeover.note)
        if let refused = takeover.refused {
          Text(refused)
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg3)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .textSelection(.enabled)
      if takeover.refused == nil {
        Button {
          store.askTakeOver()
        } label: {
          HStack(spacing: z(6)) {
            if store.handingOff { Loader(size: 12) }
            Text("Take Over")
          }
        }
        .buttonStyle(.pill(.secondary, height: 26))
        .disabled(!store.canTakeOver)
        .help("Ask \(takeover.from.name) to hand this thread to this Mac")
        #if DEBUG
        .onAppear {
          QAHandoffProbe.takeOver = QAHandoffProbe.TakeOver(
            ask: { store.askTakeOver() },
            confirm: {
              confirming = false
              await store.takeOver()
            })
        }
        .onDisappear { QAHandoffProbe.takeOver = nil }
        #endif
      }
    }
    .font(.omni(size: 13))
    .foregroundStyle(Tok.fg)
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .accessibilityElement(children: .contain)
    .onChange(of: store.takeOverAsks) { confirming = true }
    .confirmationDialog(confirm.title, isPresented: $confirming) {
      Button("Take Over") { Task { await store.takeOver() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(confirm.body)
    }
  }
}

#if DEBUG
/// Where the header's Hand Off button is, for the QA harness to click it, the pick its menu makes, and the reply box's
/// Take Over.
@MainActor
enum QAHandoffProbe {
  struct TakeOver {
    /// Presses the note's Take Over, which opens its confirm.
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
