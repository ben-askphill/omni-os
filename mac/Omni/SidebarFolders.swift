import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

/// Sidebar folders, as FolderRow, FolderNameField and AddFolderButton in Sidebar.tsx. The edits and drop rules are
/// `FolderModel`'s; these are the rows.

/// A folder's name being typed: Return or leaving the field saves, Escape cancels.
struct FolderNameField: View {
  let initial: String
  let onSave: (String) -> Void
  let onCancel: () -> Void
  @State private var text = ""
  @State private var done = false
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: z(8)) {
      OmniIcon(name: "folder", size: 13)
        .foregroundStyle(Tok.fg3)
      TextField("Folder name", text: $text)
        .textFieldStyle(.plain)
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg)
        .focused($focused)
        .onSubmit { finish(save: true) }
        .onExitCommand { finish(save: false) }
        .onChange(of: text) { _, new in
          if new.count > FolderRules.maxName { text = String(new.prefix(FolderRules.maxName)) }
        }
        .onChange(of: focused) { _, now in
          if !now { finish(save: true) }
        }
        .padding(.horizontal, z(8))
        .frame(height: z(24))
        .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(8)))
        .overlay(RoundedRectangle(cornerRadius: z(8)).strokeBorder(Tok.lineStrong, lineWidth: 1))
        .accessibilityLabel("Folder name")
    }
    .padding(.leading, z(12))
    .padding(.trailing, z(6))
    .frame(height: z(28))
    .padding(.leading, z(25))
    .onAppear {
      text = initial
      DispatchQueue.main.async { focused = true }
    }
  }

  /// Escape also takes the focus away; that must not then save.
  private func finish(save: Bool) {
    guard !done else { return }
    done = true
    if save { onSave(text) } else { onCancel() }
  }
}

/// The items of a folder's menu: right-click and its "…" button.
struct FolderMenuItems: View {
  let model: AppModel
  let folder: FolderWithThreads

  var body: some View {
    Button("New Thread Here") { model.openNewThread(.inFolder(folder)) }
    Divider()
    Button("Rename") { model.folders.editing = .rename(folder.id) }
    Button("Duplicate") { Task { await model.folders.duplicate(folder.id) } }
    Divider()
    Button("Delete...", role: .destructive) { model.folders.deletingID = folder.id }
  }
}

/// A folder under its channel: chevron, name, thread count and a loader while any thread in it runs. Click opens and
/// closes it, double-click or F2 renames, Delete asks to delete, and the "…" button or a right-click opens its menu.
/// Drop a thread on it to file it; drop another folder on it to put that one just above.
struct FolderRowView: View {
  let model: AppModel
  let folder: FolderWithThreads
  /// The folder runs something: a thread in it, or a sub-agent of one.
  let busy: Bool
  @State private var hover = false

  private var target: FolderModel.Drop? {
    model.folders.dropTarget == folder.id ? model.folders.drop(on: folder) : nil
  }

  private var label: String {
    var s = "\(folder.name), \(Format.plural(folder.count, "thread"))"
    if folder.running > 0 { s += ", \(folder.running) running" }
    return s
  }

  var body: some View {
    let open = !folder.collapsed
    HStack(spacing: 0) {
      Button {
        withAnimation(Motion.settle) { Task { await model.folders.toggle(folder.id) } }
      } label: {
        HStack(spacing: z(8)) {
          OmniIcon(name: open ? "chevronDown" : "chevronRight", size: 12)
            .foregroundStyle(Tok.fg4)
            .frame(width: z(12))
          Text(folder.name)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if busy {
            Loader(size: 11)
              .foregroundStyle(Tok.live)
          }
          Text("\(folder.count)")
            .font(.omni(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg4)
            .opacity(hover ? 0 : 1)
            .frame(minWidth: z(16), alignment: .trailing)
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(hover ? Tok.fg : Tok.fg2)
        .padding(.leading, z(12))
        .padding(.trailing, z(8))
        .frame(height: z(28))
      }
      .buttonStyle(RailRowStyle())
      .simultaneousGesture(TapGesture(count: 2).onEnded { model.folders.editing = .rename(folder.id) })
      .onKeyPress(KeyEquivalent(Character(UnicodeScalar(UInt16(NSF2FunctionKey))!))) {
        model.folders.editing = .rename(folder.id)
        return .handled
      }
      .onDeleteCommand { model.folders.deletingID = folder.id }
      .accessibilityLabel(label)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      .accessibilityAction(named: "Rename") { model.folders.editing = .rename(folder.id) }
      .accessibilityAction(named: "Delete") { model.folders.deletingID = folder.id }
      .help("\(label). Double-click to rename.")
      .onDrag {
        model.folders.dragging = .folder(id: folder.id, channel: folder.channelID)
        return NSItemProvider(object: folder.name as NSString)
      }
      .overlay(alignment: .trailing) {
        Menu {
          FolderMenuItems(model: model, folder: folder)
        } label: {
          OmniIcon(name: "more", size: 14)
            .foregroundStyle(Tok.fg3)
            .frame(width: z(24), height: z(24))
            .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .padding(.trailing, z(2))
        .opacity(hover ? 1 : 0)
        .help("Folder actions")
        .accessibilityLabel("\(folder.name) actions")
      }
    }
    .background {
      if target == .file {
        Capsule().fill(Tok.wash).overlay(Capsule().strokeBorder(Tok.lineStrong, lineWidth: 1))
      }
    }
    .overlay(alignment: .top) {
      if target == .reorder {
        Capsule().fill(Tok.fg3).frame(height: 2).padding(.horizontal, z(8))
      }
    }
    .onHover { hover = $0 }
    .contextMenu { FolderMenuItems(model: model, folder: folder) }
    .onDrop(of: [.plainText], delegate: FolderDrop(folders: model.folders, folder: folder))
    #if DEBUG
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAFolderProbe.frames[folder.id] = $0 }
    #endif
    .padding(.leading, z(25))
    .opacity(folder.isStandIn ? 0.6 : 1)
  }
}

#if DEBUG
/// Where each folder row is in its window, for the QA harness to right-click it.
@MainActor
enum QAFolderProbe {
  static var frames: [String: CGRect] = [:]
}
#endif

/// A drop on a folder: a thread files there, another folder of the channel goes just above.
private struct FolderDrop: DropDelegate {
  let folders: FolderModel
  let folder: FolderWithThreads

  func validateDrop(info: DropInfo) -> Bool { folders.drop(on: folder) != nil }
  func dropEntered(info: DropInfo) { folders.dropTarget = folder.id }
  func dropExited(info: DropInfo) {
    if folders.dropTarget == folder.id { folders.dropTarget = nil }
  }
  func dropUpdated(info: DropInfo) -> DropProposal? {
    folders.drop(on: folder) == nil ? DropProposal(operation: .forbidden) : DropProposal(operation: .move)
  }
  func performDrop(info: DropInfo) -> Bool {
    guard folders.drop(on: folder) != nil else { return false }
    Task { await folders.performDrop(on: folder) }
    return true
  }
}

/// A thread dropped on its channel's name leaves its folder, back to the ungrouped list.
struct UngroupDrop: DropDelegate {
  let folders: FolderModel
  let channelID: String
  @Binding var on: Bool

  func validateDrop(info: DropInfo) -> Bool { folders.ungroups(on: channelID) }
  func dropEntered(info: DropInfo) { on = folders.ungroups(on: channelID) }
  func dropExited(info: DropInfo) { on = false }
  func dropUpdated(info: DropInfo) -> DropProposal? {
    folders.ungroups(on: channelID) ? DropProposal(operation: .move) : DropProposal(operation: .forbidden)
  }
  func performDrop(info: DropInfo) -> Bool {
    on = false
    guard folders.ungroups(on: channelID) else { return false }
    Task { await folders.performUngroup(on: channelID) }
    return true
  }
}

/// A channel's row with the folder-plus that shows on hover, and a drop that takes a thread out of its folder.
struct ChannelRowChrome<Content: View>: View {
  let model: AppModel
  let channel: ChannelWithRunning
  @ViewBuilder var content: (_ hover: Bool) -> Content
  @State private var hover = false
  @State private var dropOn = false

  var body: some View {
    content(hover)
      .overlay(alignment: .trailing) {
        Button {
          model.folders.editing = .new(channel: channel.id)
        } label: {
          OmniIcon(name: "folderPlus", size: 14)
            .foregroundStyle(Tok.fg3)
            .frame(width: z(24), height: z(24))
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(.trailing, z(4))
        .opacity(hover ? 1 : 0)
        .help("New folder")
        .accessibilityLabel("New folder in \(channel.name)")
      }
      .background {
        if dropOn {
          Capsule().fill(Tok.wash).overlay(Capsule().strokeBorder(Tok.lineStrong, lineWidth: 1))
        }
      }
      .help(dropOn ? "Drop to take it out of its folder" : "")
      .onHover { hover = $0 }
      .onDrop(of: [.plainText], delegate: UngroupDrop(folders: model.folders, channelID: channel.id, on: $dropOn))
  }
}

/// The "Move to Folder" submenu of a thread's right-click: its channel's folders, and Remove from Folder.
struct MoveToFolderMenu: View {
  let model: AppModel
  let thread: ThreadStub

  var body: some View {
    if let channel = model.store.channel(thread.channelID) {
      let current = model.folders.folder(of: thread)
      let choices = channel.folders.filter { !$0.isStandIn }
      Menu("Move to Folder") {
        ForEach(choices) { f in
          Toggle(
            f.name,
            isOn: Binding(get: { current == f.id }, set: { on in if on { Task { await model.folders.move(thread, to: f.id) } } }))
        }
        if choices.isEmpty {
          Text("No folders in this channel yet")
        }
        Divider()
        Button("Remove from Folder") { Task { await model.folders.move(thread, to: nil) } }
          .disabled(current == nil)
        Button("New Folder") { model.folders.editing = .new(channel: thread.channelID) }
      }
    }
  }
}

extension View {
  /// The folder alerts, once for the window: the delete confirm and an edit the server refused.
  func folderAlerts(_ model: AppModel) -> some View {
    modifier(FolderAlerts(folders: model.folders))
  }
}

private struct FolderAlerts: ViewModifier {
  @Bindable var folders: FolderModel

  func body(content: Content) -> some View {
    let deleting = folders.deleting
    content
      .alert(
        "Delete \"\(deleting?.name ?? "")\"?",
        isPresented: Binding(get: { folders.deletingID != nil }, set: { if !$0 { folders.deletingID = nil } }),
        presenting: deleting
      ) { f in
        Button("Delete Folder", role: .destructive) { Task { await folders.remove(f.id) } }
        Button("Cancel", role: .cancel) { folders.deletingID = nil }
      } message: { f in
        Text(FolderModel.deleteMessage(count: f.count))
      }
      .alert(
        folders.failure?.title ?? "",
        isPresented: Binding(get: { folders.failure != nil }, set: { if !$0 { folders.failure = nil } }),
        presenting: folders.failure
      ) { _ in
        Button("OK", role: .cancel) { folders.failure = nil }
      } message: { f in
        Text(f.message)
      }
  }
}
