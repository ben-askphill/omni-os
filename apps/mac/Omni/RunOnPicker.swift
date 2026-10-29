import OmniKit
import SwiftUI

/// The Run on pill: This Mac, then each other synced machine in picker order, an offline one marked.
/// One Tailscale sees offline can't be picked. The new-thread box and Settings > Server both use it (RunOn.swift).
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
