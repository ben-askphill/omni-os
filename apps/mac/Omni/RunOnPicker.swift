import OmniKit
import SwiftUI

// The Machine chip: one control for where a thread runs, next to the model pill on both composers (MachineChip.tsx).
// `RunOnMenu` is a new thread's (Run on) and Settings' default; `ThreadMachineMenu` an open thread's (Hand Off and
// Take Over). Each hides while there is one machine.

/// The Run on pill: This Mac, then each other synced machine in picker order, an offline one marked.
/// One Tailscale sees offline can't be picked. The new-thread box and Settings > Machines both use it (RunOn.swift).
struct RunOnMenu: View {
  let devices: [Device]
  /// A device id, or "" for this Mac.
  let pick: String
  let select: (String) -> Void

  var body: some View {
    let label = RunOnRules.label(pick, devices: devices)
    Menu {
      Picker("Run on", selection: Binding(get: { pick }, set: select)) {
        Text("This Mac").tag("")
        Section("Synced machines") {
          ForEach(devices) { d in
            Text(d.canTake ? d.name : "\(d.name) · Offline")
              .tag(d.id)
              .selectionDisabled(!d.canTake)
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

/// An open thread's Machine chip: the Mac that holds it, and where it can go. While this Mac holds it, the other Macs
/// hand it off (the items the menu bar's Thread menu lists too); while another Mac holds it, This Mac takes it over,
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

  private func heldHere(_ devices: [Device]) -> some View {
    Menu {
      Section("This Mac") {
        Text(store.running ? "Running here now" : "Runs here")
      }
      Section("Hand off to") {
        HandOffItems(store: store, devices: devices)
      }
    } label: {
      PickerPill(text: "This Mac") { PillIcon(name: "monitor") }
    }
    .pillMenu()
    .disabled(store.handingOff)
    .help("Where this thread runs. Pick another Mac to hand it off.")
    .accessibilityLabel("Run on: This Mac")
  }

  private func heldElsewhere(_ takeover: Takeover) -> some View {
    let confirm = takeover.confirm
    return Menu {
      Section(takeover.from.name) {
        Text(takeover.running ? "Running there now" : "Last ran there")
      }
      Section("This Mac") {
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
