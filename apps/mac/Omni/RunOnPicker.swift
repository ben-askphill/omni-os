import OmniKit
import SwiftUI

// The Machine chip: one control for where a thread runs, next to the model pill on both composers (MachineChip.tsx).
// `RunOnMenu` is a new thread's (Run on) and Settings' default; `ThreadMachineMenu` an open thread's (Hand Off and
// Take Over). Each hides while there is one machine.

/// The Run on pill: this machine under its own name, then each other synced machine in picker order, an offline one marked.
/// One Tailscale sees offline can't be picked. The new-thread box and Settings > Threads both use it (RunOn.swift).
struct RunOnMenu: View {
  let devices: [Device]
  /// A device id, or "" for this machine.
  let pick: String
  /// This machine's name (GET /api/status `device.name`), which its row and the pill show.
  let hereName: String?
  let select: (String) -> Void
  var allowOffline = false

  var body: some View {
    let label = RunOnRules.label(pick, devices: devices, hereName: hereName)
    Menu {
      Picker("Run on", selection: Binding(get: { pick }, set: select)) {
        Text(RunOnRules.hereLabel(hereName)).tag("")
        Section("Synced machines") {
          ForEach(devices) { d in
            Text(d.canTake ? d.name : "\(d.name) · Offline")
              .tag(d.id)
              .selectionDisabled(!allowOffline && !d.canTake)
          }
        }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: label) { PillIcon(name: "monitor") }
    }
    .pillMenu()
    .help("Run on: the machine this thread runs on. Replies and Stop follow it there.")
    .accessibilityLabel("Run on: \(label)")
  }
}

/// An open thread's Machine chip: the machine that holds it, and where it can go. While this machine holds it, the
/// other machines hand it off (the items the menu bar's Thread menu lists too); while another holds it, this one takes it over,
/// through the confirm `store.askTakeOver` raises, as the Thread menu's Take Over does. Nothing with one machine.
struct ThreadMachineMenu: View {
  let model: AppModel
  let store: ThreadStore
  @State private var confirming = false

  var body: some View {
    if let takeover = store.takeover, store.handoff?.inFlight != true {
      heldElsewhere(takeover)
    } else if let devices = model.devices.targets(store) {
      heldHere(devices)
    }
  }

  /// This machine's name, or "Unnamed machine": never "This Mac", since Omni runs on Linux machines too.
  private var here: String { RunOnRules.hereLabel(model.store.status?.device?.name) }

  private func heldHere(_ devices: [Device]) -> some View {
    Menu {
      Section(here) {
        Text(store.running ? "Running here now" : "Runs here")
      }
      Section("Hand off to") {
        HandOffItems(store: store, devices: devices)
      }
    } label: {
      PickerPill(text: here) { PillIcon(name: "monitor") }
    }
    .pillMenu()
    .disabled(store.handingOff)
    .help("Where this thread runs. Pick another machine to hand it off.")
    .accessibilityLabel("Run on: \(here)")
  }

  private func heldElsewhere(_ takeover: Takeover) -> some View {
    let confirm = takeover.confirm
    return Menu {
      Section(takeover.from.name) {
        Text(takeover.running ? "Running there now" : "Last ran there")
      }
      Section(RunOnRules.hereLabel(takeover.to.name)) {
        Button(takeover.running ? "Take Over: it stops there and continues here" : "Take Over: your next message runs here") { store.askTakeOver() }
          .disabled(!store.canTakeOver)
        if let refused = takeover.refused { Text(refused) }
      }
    } label: {
      PickerPill(text: takeover.from.name) { PillIcon(name: "monitor") }
    }
    .pillMenu()
    .help(takeover.note)
    .accessibilityLabel("Run on: \(takeover.from.name)")
    .onChange(of: store.takeOverAsks) { confirming = true }
    .confirmationDialog(confirm.title, isPresented: $confirming) {
      Button("Take Over") { Task { await store.takeOver() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(confirm.body)
    }
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
