import OmniKit
import SwiftUI

/// The Base pill of the new-thread box: what a worktree thread's branch is cut from. It reads the current default
/// ("From main · a1b2c3d") and lists the checkout, origin's default branch, then branches and tags (`BaseRules`).
struct BasePicker: View {
  let options: BaseOptions
  let pick: BasePick
  let select: (BasePick) -> Void

  var body: some View {
    let choices = BaseRules.choices(options)
    let summary = BaseRules.summary(pick, in: options)
    Menu {
      Picker("Base", selection: Binding(get: { pick }, set: select)) {
        ForEach(choices.filter { $0.group == .current || $0.group == .remote }) { c in Text(c.title).tag(c.pick) }
        section("Branches", choices.filter { $0.group == .branch })
        section("Tags", choices.filter { $0.group == .tag })
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: summary.title, secondary: summary.sha) { PillIcon(name: "branch") }
    }
    .pillMenu()
    .help("Base: the commit the thread's branch starts from")
    .accessibilityLabel("Base: \(summary.title)\(summary.sha.map { " at \($0)" } ?? "")")
  }

  @ViewBuilder private func section(_ title: String, _ rows: [BaseChoice]) -> some View {
    if !rows.isEmpty {
      Section(title) {
        ForEach(rows) { c in Text(c.title).tag(c.pick) }
      }
    }
  }
}
