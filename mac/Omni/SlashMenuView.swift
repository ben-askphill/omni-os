import OmniKit
import SwiftUI

/// The `/` menu, as web/src/components/SlashMenu.tsx: a list of commands grouped by where they come from,
/// or a loading or unavailable note. It is an overlay in the composer's window, not a key window or a
/// popover, so the text view keeps focus. A click picks a row.
struct SlashMenuView: View {
  let model: SlashMenuModel

  var body: some View {
    if model.isFileMenu {
      FileMenuView(model: model)
    } else {
      commandsBody
    }
  }

  @ViewBuilder private var commandsBody: some View {
    let sections = model.sections
    let active = model.activeIndex
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          note
          ForEach(Array(sections.enumerated()), id: \.offset) { s, section in
            if let label = section.label {
              Text(label)
                .omniCaption()
                .padding(.horizontal, z(12))
                .padding(.top, z(8))
                .padding(.bottom, z(4))
            }
            ForEach(Array(section.commands.enumerated()), id: \.element.id) { i, command in
              let index = sections[..<s].reduce(0) { $0 + $1.commands.count } + i
              SlashRow(command: command, isActive: index == active, onHover: { model.setActive(index) }, onPick: { model.pick(command) })
                .id(command.id)
            }
          }
        }
        .padding(z(6))
      }
      .scrollIndicators(.automatic)
      .onChange(of: active) {
        let items = model.items
        if items.indices.contains(active) { proxy.scrollTo(items[active].id) }
      }
    }
    .frame(maxHeight: z(352))
    .fixedSize(horizontal: false, vertical: true)
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .menuShadow(22)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Commands")
  }

  @ViewBuilder private var note: some View {
    let list = model.commands.list
    if list?.status == .unavailable {
      // A thread's menu still lists Omni's own commands, so say why the harness's are missing.
      Group {
        if let fix = list?.fix {
          Text("Couldn't read the commands. Run \(Text(fix).font(.omni(size: 12, design: .monospaced)).foregroundStyle(Tok.fg2)) in a terminal to see why.")
        } else {
          Text("Couldn't read the commands.")
        }
      }
      .font(.omni(size: 12.5))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, z(12))
      .padding(.vertical, z(10))
    } else if list == nil || list?.status == .loading {
      HStack(spacing: z(8)) {
        Loader(size: 13)
        Text("Loading commands")
      }
      .font(.omni(size: 12.5))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, z(12))
      .padding(.vertical, z(10))
    }
  }
}

/// The `@` menu, as web/src/components/FileMenu.tsx: the thread's artifacts, then the repo's files.
private struct FileMenuView: View {
  let model: SlashMenuModel

  var body: some View {
    let rows = model.fileRows
    let active = model.activeIndex
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
            FileRow(row: row, isActive: i == active, onHover: { model.setActive(i) }, onPick: { model.pick(file: row) })
              .id(row.id)
          }
        }
        .padding(z(6))
      }
      .scrollIndicators(.automatic)
      .onChange(of: active) {
        if rows.indices.contains(active) { proxy.scrollTo(rows[active].id) }
      }
    }
    .frame(maxHeight: z(352))
    .fixedSize(horizontal: false, vertical: true)
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: z(22), style: .continuous))
    .menuShadow(22)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Files")
  }
}

private struct FileRow: View {
  let row: FileMention
  let isActive: Bool
  let onHover: () -> Void
  let onPick: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: z(10)) {
      Image(systemName: "doc")
        .font(.omni(size: 13))
        .foregroundStyle(Tok.fg3)
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        Text(row.name)
          .font(.omni(size: 13, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .layoutPriority(1)
        Text(row.detail)
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
          .truncationMode(.head)
      }
      Spacer(minLength: 0)
      if row.kind == .artifact {
        Text("artifact")
          .font(.omni(size: 11))
          .foregroundStyle(Tok.fg3)
          .padding(.horizontal, z(8))
          .padding(.vertical, 1)
          .background(Tok.surface2, in: Capsule())
      }
    }
    .padding(.horizontal, z(12))
    .padding(.vertical, z(6))
    .frame(minHeight: z(40))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isActive ? Tok.wash : .clear, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .contentShape(Rectangle())
    .onTapGesture(perform: onPick)
    .onContinuousHover { phase in
      if case .active = phase, !isActive { onHover() }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
  }
}

private struct SlashRow: View {
  let command: SlashCommand
  let isActive: Bool
  let onHover: () -> Void
  let onPick: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: z(10)) {
      VStack(alignment: .leading, spacing: 1) {
        HStack(alignment: .firstTextBaseline, spacing: z(8)) {
          Text("/\(command.name)")
            .font(.omni(size: 13, weight: .medium, design: .monospaced))
            .foregroundStyle(Tok.fg)
            .lineLimit(1)
            .truncationMode(.middle)
            .layoutPriority(1)
          if let hint = command.argumentHint {
            Text(hint)
              .font(.omni(size: 12, design: .monospaced))
              .foregroundStyle(Tok.fg4)
              .lineLimit(1)
          }
        }
        if !command.description.isEmpty {
          Text(command.description)
            .font(.omni(size: 11.5))
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      Text(command.sourceTag)
        .font(.omni(size: 11))
        .foregroundStyle(Tok.fg3)
        .padding(.horizontal, z(8))
        .padding(.vertical, 1)
        .background(Tok.surface2, in: Capsule())
    }
    .padding(.horizontal, z(12))
    .padding(.vertical, z(6))
    .frame(minHeight: z(40))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isActive ? Tok.wash : .clear, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .contentShape(Rectangle())
    .onTapGesture(perform: onPick)
    .onContinuousHover { phase in
      if case .active = phase, !isActive { onHover() }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
  }
}

/// The quiet line under the composer, hidden while the menu is open. `/model`, `/effort` and `/fast` offer
/// a new thread on another model.
struct SlashHintView: View {
  let model: SlashMenuModel
  let onNewThreadOnAnotherModel: () -> Void

  var body: some View {
    if let hint = model.hint {
      HStack(spacing: z(8)) {
        Text(hint)
        if model.reply?.action == .fixed {
          Button("New thread on another model", action: onNewThreadOnAnotherModel)
            .buttonStyle(.plain)
            .fontWeight(.medium)
            .foregroundStyle(Tok.fg2)
        }
      }
      .font(.omni(size: 12))
      .foregroundStyle(Tok.fg3)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

extension View {
  /// Shows the `/` menu over the composer (`below` for one near the top of the page) and gives it the
  /// arrow keys, Return, Tab and Esc while it is open. Put it on the composer, with the text view inside.
  func slashMenu(_ model: SlashMenuModel, below: Bool = false) -> some View {
    overlay(alignment: below ? .bottom : .top) {
      if model.isOpen {
        // A zero height frame at the composer's edge, with the menu overflowing away from it.
        SlashMenuView(model: model)
          .padding(below ? .top : .bottom, 8)
          .frame(height: 0, alignment: below ? .top : .bottom)
          .transition(.opacity)
          .zIndex(1)
      }
    }
    .onKeyPress(phases: [.down, .repeat]) { press in
      let key: SlashKey? = switch press.key {
      case .upArrow: .up
      case .downArrow: .down
      case .return: press.modifiers.isEmpty ? .return : nil
      case .tab: press.modifiers.contains(.shift) ? nil : .tab
      case .escape: .escape
      default: nil
      }
      guard let key else { return .ignored }
      return model.handle(key) ? .handled : .ignored
    }
  }
}

extension AttributedString {
  // For a composer whose TextEditor edits an AttributedString: its indices and the engine's UTF-16 offsets.

  /// UTF-16 units before `index`.
  func utf16Offset(of index: AttributedString.Index) -> Int {
    String(characters[startIndex..<index]).utf16.count
  }

  /// The index `offset` UTF-16 units in, clamped to the text.
  func index(utf16Offset offset: Int) -> AttributedString.Index {
    let plain = String(characters)
    let stringIndex = plain.index(utf16Offset: offset)
    return characters.index(startIndex, offsetBy: plain.distance(from: plain.startIndex, to: stringIndex))
  }
}
