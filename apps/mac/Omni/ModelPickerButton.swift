import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

// The model and effort pills the new-thread and reply composers share: `ModelPickerButton`, `EffortMenu` and their rows.

extension View {
  func pillMenu() -> some View {
    menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
  }
}

/// The effort pill: Default and the model's levels, or a disabled "Auto effort" when the model has none or Auto picks it.
struct EffortMenu: View {
  let options: [EffortOption]
  let value: String
  var auto = false
  /// Why it can't be picked now. nil when it can.
  var disabledHelp: String? = nil
  let pick: (String) -> Void

  var body: some View {
    if auto || options.isEmpty {
      PickerPill(text: "Auto effort") { PillIcon(name: "sliders") }
        .opacity(0.45)
        .help(auto ? "Auto picks the effort for each task" : "This model has no effort levels")
    } else {
      let label = options.first { $0.value == value }?.label ?? options[0].label
      Menu {
        Picker("Effort", selection: Binding(get: { value }, set: { pick($0) })) {
          ForEach(options) { o in Text(o.label).tag(o.value) }
        }
        .pickerStyle(.inline)
        .labelsHidden()
      } label: {
        PickerPill(text: label) { PillIcon(name: "sliders") }
      }
      .pillMenu()
      .disabled(disabledHelp != nil)
      .opacity(disabledHelp != nil ? 0.45 : 1)
      .help(disabledHelp ?? "Effort")
      .accessibilityLabel("Effort: \(label)")
    }
  }
}

/// The effort `ModelPickerButton` folds in: the levels for its model, the one picked ("" for the default), and where a pick goes.
struct EffortPick {
  let options: [EffortOption]
  let value: String
  let pick: (String) -> Void
}

/// The model pill and its list: Auto first, then models under each harness with its plan, one search, the default
/// marked, and a harness that isn't installed or logged in shown disabled with the command that fixes it (`ModelPicker.tsx`).
struct ModelPickerButton: View {
  let harnesses: [HarnessInfo]
  let harness: HarnessID
  /// "" when none is picked: the pill reads `placeholder`. `AutoRun.model` for Auto.
  let model: String
  /// The pill's label when no model is picked.
  var placeholder = "Model"
  let pick: (HarnessID, String) -> Void
  let refresh: () -> Void
  /// Bumped to open the list: a preset that picks the model, or `/model` in a thread's reply box.
  var openRequest = 0
  /// The search the list opens with on `openRequest`.
  var openQuery = ""
  /// A thread's reply box leaves Auto out: Auto only picks a run for a new thread.
  var offersAuto = true
  /// Why Auto picked this model. The pill then reads "Auto · <model>".
  var autoReason: String? = nil
  /// Why it can't be picked now. nil when it can.
  var disabledHelp: String? = nil
  /// The effort for the picked model: the pill then reads "Sonnet 5.5 · high" and the list ends with its levels.
  var effort: EffortPick? = nil
  @State private var open = false
  @State private var query = ""

  /// The levels the list offers, and the level the pill shows. nil for Auto or a model without levels.
  private var effortShown: (options: [EffortOption], label: String)? {
    guard let effort, !AutoRun.isAuto(model), !effort.options.isEmpty else { return nil }
    let label = effort.value.isEmpty
      ? EffortRules.model(harness: harness, model: model, in: harnesses)?.defaultEffort ?? "default"
      : effort.value
    return (effort.options, label)
  }

  private var current: (harness: HarnessInfo?, model: ModelEntry?) {
    let h = harnesses.first { $0.id == harness }
    return (h, h?.models.first { $0.id == model })
  }

  var body: some View {
    let c = current
    Button {
      query = ""
      open.toggle()
      if open { refresh() }
    } label: {
      ViewThatFits(in: .horizontal) {
        pill(c, harness: true)
        pill(c, harness: false)
      }
    }
    .buttonStyle(.plain)
    .disabled(disabledHelp != nil)
    .opacity(disabledHelp != nil ? 0.45 : 1)
    .help(disabledHelp ?? autoReason ?? "Model")
    .accessibilityLabel(AutoRun.isAuto(model) ? "Model: Auto" : "Model: \(autoReason == nil ? "" : "Auto · ")\(c.model?.label ?? "none")\(c.harness.map { " on \($0.name)" } ?? "")\(effortShown.map { ", effort \($0.label)" } ?? "")")
    .popover(isPresented: $open, arrowEdge: .bottom) { list }
    .onChange(of: openRequest) {
      query = openQuery
      open = true
      refresh()
    }
  }

  private func title(_ c: (harness: HarnessInfo?, model: ModelEntry?)) -> String {
    let label = c.model?.label ?? placeholder
    return autoReason == nil ? label : "Auto · \(label)"
  }

  private func pill(_ c: (harness: HarnessInfo?, model: ModelEntry?), harness: Bool) -> some View {
    let auto = AutoRun.isAuto(model)
    let secondary = effortShown?.label ?? (harness && c.model != nil ? c.harness?.name : nil)
    return PickerPill(text: auto ? "Auto" : title(c), secondary: secondary) {
      if !auto, let h = c.harness {
        PillAvatar(fill: Tok.bg) { HarnessLogo(harness: h.id.rawValue, size: 13).foregroundStyle(Tok.fg) }
      } else {
        PillIcon(name: "zap")
      }
    }
  }

  private var list: some View {
    let groups = ModelSearch.groups(harnesses, query: query)
    return VStack(spacing: 0) {
      HStack(spacing: z(8)) {
        OmniIcon(name: "search", size: 15).foregroundStyle(Tok.fg4)
        TextField("Find a model or harness", text: $query).textFieldStyle(.plain).font(.omni(size: 13)).foregroundStyle(Tok.fg)
      }
      .padding(.horizontal, z(12))
      .frame(height: z(40))
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
      .padding([.horizontal, .top], z(6))
      .padding(.bottom, z(4))
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
          if offersAuto && "auto".hasPrefix(query.trimmingCharacters(in: .whitespaces).lowercased()) { autoRow }
          ForEach(groups) { group in
            Section {
              rows(group)
            } header: {
              header(group.harness)
            }
          }
        }
        .padding(.horizontal, z(6))
        .padding(.bottom, z(6))
      }
      .frame(height: z(320))
      if let shown = effortShown, let effort { effortRow(shown.options, effort: effort) }
    }
    .frame(width: z(340))
    .background(Tok.elev)
  }

  /// The phone's model sheet ends with the same levels: Default, then the model's own.
  private func effortRow(_ options: [EffortOption], effort: EffortPick) -> some View {
    let name = EffortRules.model(harness: harness, model: model, in: harnesses)?.label ?? "this model"
    return VStack(alignment: .leading, spacing: z(6)) {
      Text("Effort for \(name)").omniCaption().padding(.horizontal, z(4))
      HStack(spacing: z(4)) {
        ForEach(options) { o in
          let on = o.value == effort.value
          Button {
            effort.pick(o.value)
            open = false
          } label: {
            Text(o.label)
              .font(.omni(size: 12))
              .foregroundStyle(on ? Tok.onInk : Tok.fg2)
              .lineLimit(1)
              .padding(.horizontal, z(10))
              .frame(height: z(28))
              .background(on ? Tok.fg : .clear, in: Capsule())
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
    }
    .padding(.horizontal, z(8))
    .padding(.vertical, z(8))
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .top) { Rectangle().fill(Tok.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Effort")
  }

  private func header(_ h: HarnessInfo) -> some View {
    HStack(spacing: z(8)) {
      HStack(spacing: z(6)) {
        HarnessLogo(harness: h.id.rawValue, size: 12)
        Text(h.name).lineLimit(1)
      }
      .omniCaption()
      .layoutPriority(1)
      Text(h.available ? "Bills your \(h.plan)" : "Unavailable")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg4)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(.horizontal, z(12))
    .padding(.top, z(8))
    .padding(.bottom, z(4))
    .frame(maxWidth: .infinity)
    .fixedSize(horizontal: false, vertical: true)
    .background(Tok.elev)
  }

  private var autoRow: some View {
    let selected = AutoRun.isAuto(model)
    return Button {
      pick(AutoRun.harness, AutoRun.model)
      open = false
    } label: {
      row(selected: selected, title: Text("Auto").foregroundStyle(Tok.fg), note: "Picks a model for each task") {
        OmniIcon(name: "zap", size: 13)
      }
    }
    .buttonStyle(PickerRowButtonStyle())
    .padding(.top, z(4))
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private func row(selected: Bool, title: Text, note: String?, @ViewBuilder mark: () -> some View) -> some View {
    HStack(spacing: z(10)) {
      mark()
        .foregroundStyle(Tok.fg)
        .frame(width: z(28), height: z(28))
        .background(Tok.surface2, in: Circle())
      VStack(alignment: .leading, spacing: 1) {
        title.font(.omni(size: 13)).lineLimit(1)
        if let note { Text(note).font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).lineLimit(1) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      PickMark(on: selected)
    }
    .padding(.horizontal, z(8))
    .frame(height: z(note == nil ? 40 : 56), alignment: .leading)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }

  @ViewBuilder private func rows(_ group: ModelGroup) -> some View {
    let h = group.harness
    if !h.available {
      Group {
        if let fix = h.fix, h.fixCommand == nil {
          Text("Not available. \(fix)")
        } else {
          Text("Not available. Run \(Text(h.fix ?? "the harness login").monospaced()).")
        }
      }
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg4)
        .padding(.horizontal, z(12))
        .padding(.bottom, z(8))
    } else if group.models.isEmpty {
      if !query.trimmingCharacters(in: .whitespaces).isEmpty {
        Text("No match").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).padding(.horizontal, z(12)).padding(.bottom, z(8))
      }
    } else {
      ForEach(group.models) { m in
        let selected = h.id == harness && m.id == model
        Button {
          pick(h.id, m.id)
          open = false
        } label: {
          row(selected: selected, title: Text(m.label).foregroundStyle(Tok.fg) + Text(m.isDefault ? " (default)" : "").foregroundStyle(Tok.fg4), note: m.note) {
            HarnessLogo(harness: h.id.rawValue, size: 13)
          }
        }
        .buttonStyle(PickerRowButtonStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
  }
}

/// The row's button. `.plain` in a popover still pads some rows, which opened a blank gap under them.
private struct PickerRowButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
  }
}

/// `.pik-mark` in index.css: an outlined square that fills with ink when picked.
private struct PickMark: View {
  let on: Bool

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: z(6), style: .continuous)
    ZStack {
      shape.fill(on ? Tok.fg : .clear)
      shape.strokeBorder(on ? Tok.fg : Tok.lineStrong, lineWidth: 1.5)
      if on { OmniIcon(name: "check", size: 12, weight: 2.4).foregroundStyle(Tok.onInk) }
    }
    .frame(width: z(18), height: z(18))
    .animation(.easeOut(duration: 0.16), value: on)
  }
}
