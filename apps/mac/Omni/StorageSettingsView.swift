import OmniKit
import SwiftUI

/// The Storage tab, like the Web UI's Storage page: a read-only inventory of data/worktrees. A new model per client and
/// per visit. It shows the last scan and scans only when Scan is pressed; closing the tab stops following a running one.
struct StorageSettings: View {
  let model: AppModel
  @State private var inventory: WorktreeInventoryModel?

  var body: some View {
    Group {
      if let inventory {
        StorageForm(inventory: inventory)
      } else {
        Loader(size: 18).frame(maxWidth: .infinity, maxHeight: .infinity).background(Tok.bg)
      }
    }
    .task(id: model.client.baseURL) {
      let inventory = WorktreeInventoryModel(client: model.client)
      self.inventory = inventory
      await inventory.load()
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let inventory { Task { await inventory.load() } }
    }
    .onDisappear { inventory?.stop() }
  }
}

struct StorageForm: View {
  let inventory: WorktreeInventoryModel

  var body: some View {
    SettingsPage {
      SettingsIntro(
        icon: "folder",
        text: Text(
          "Omni makes a git worktree for each thread in a repo channel, in data/worktrees. This lists them, what each costs on disk and why it must stay or can go. Nothing is deleted here.\n\n\(worktreePruneNote)"
        )
      )

      switch inventory.loadState {
      case .loading:
        LoadingNote()
      case .failed(let message):
        ErrorNote(text: message) { Task { await inventory.load() } }
      case .loaded:
        scanCard
        if let scan = inventory.scan {
          if scan.state == .failed, let error = scan.error { ErrorNote(text: error) }
          if !scan.items.isEmpty || !scan.isRunning { summaryCard }
          ForEach([WorktreeItem.Verdict.eligible, .kept, .unknown], id: \.self) { verdict in
            let folders = inventory.folders(verdict)
            if !folders.isEmpty { group(verdict, folders) }
          }
          if !inventory.staleRegistrations.isEmpty { staleCard }
        }
      }
    }
  }

  // MARK: Scan

  private var scanCard: some View {
    let scan = inventory.scan
    return SettingsCard(title: "Scan", note: scanNote(scan)) {
      if inventory.isBusy { Loader(size: 14) }
      if scan?.isRunning == true {
        Button("Cancel") { Task { await inventory.cancelScan() } }
          .buttonStyle(.pill(.secondary, height: 28))
          .disabled(inventory.isBusy)
      } else {
        Button(scan == nil ? "Scan" : "Scan Again") { Task { await inventory.startScan() } }
          .buttonStyle(.pill(.primary, height: 28))
          .disabled(inventory.isBusy)
      }
    } content: {
      if let scan, scan.isRunning || scan.state == .cancelled {
        VStack(alignment: .leading, spacing: z(8)) {
          ProgressBar(value: scan.progress)
          if let label = inventory.progressLabel {
            Text(label).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).monospacedDigit()
          }
        }
      }
      if let error = inventory.actionError { ErrorNote(text: error) }
    }
  }

  private func scanNote(_ scan: WorktreeScan?) -> String {
    guard let scan else { return "Not scanned yet. A scan measures each folder, which can take a minute. Threads keep running while it works." }
    switch scan.state {
    case .running: return "Threads keep running while it works."
    case .cancelled: return "Stopped. What was checked is below."
    case .failed: return "The scan stopped."
    case .done:
      let when = scan.finishedAt.map { RelTime.label($0) } ?? "just now"
      return "Scanned \(when)."
    }
  }

  // MARK: Totals

  private var summaryCard: some View {
    let s = inventory.summary
    return SettingsCard(title: "Disk use", note: "\(ByteSize.label(s.bytes)) in \(plural(s.folders, "folder")).") {
      InfoRows {
        totalRow("Eligible", s.eligible, .done)
        totalRow("Kept", s.kept, .settled)
        totalRow("Unknown", s.unknown, .idle)
        InfoRow(label: "Stale") {
          Text("\(plural(s.stale, "registration")), frees no space").monospacedDigit()
        }
      }
    }
  }

  private func totalRow(_ label: String, _ totals: VerdictTotals, _ glyph: Glyph) -> some View {
    InfoRow(label: label) {
      HStack(spacing: z(8)) {
        GlyphView(glyph: glyph, size: 7)
        Text("\(plural(totals.count, "folder")), \(ByteSize.label(totals.bytes))").monospacedDigit()
      }
    }
  }

  // MARK: Items

  private func group(_ verdict: WorktreeItem.Verdict, _ folders: [WorktreeItem]) -> some View {
    let bytes = folders.reduce(Int64(0)) { $0 + ($1.bytes ?? 0) }
    return SettingsCard(title: verdict.label, note: "\(plural(folders.count, "folder")), \(ByteSize.label(bytes)). \(blurb(verdict))") {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(folders.enumerated()), id: \.element.id) { index, item in
          if index > 0 { Hairline() }
          StorageRow(item: item)
        }
      }
    }
  }

  private func blurb(_ verdict: WorktreeItem.Verdict) -> String {
    switch verdict {
    case .eligible: "Nothing in them can be lost and their threads are done with them."
    case .kept: "Each has a reason to stay."
    case .unknown: "A check failed, so nothing is claimed. Scan again before acting."
    }
  }

  private var staleCard: some View {
    SettingsCard(title: "Stale registrations", note: "Git lists these worktrees, but their folders are gone. They take no space.") {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(inventory.staleRegistrations.enumerated()), id: \.element.id) { index, item in
          if index > 0 { Hairline() }
          StorageRow(item: item)
        }
      }
    }
  }

  private func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
}

/// One folder: its title and size, where it belongs, then why it is kept, why it may go, or what failed.
private struct StorageRow: View {
  let item: WorktreeItem

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        GlyphView(glyph: glyph, size: 7)
        Text(item.title)
          .font(.omni(size: 13.5, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.middle)
        if item.kind != .managed { KindBadge(text: item.kind.label) }
        Spacer(minLength: z(8))
        if item.folder {
          Text(ByteSize.label(item.bytes)).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).monospacedDigit()
        }
      }
      if let detail = item.detail {
        Text(detail).font(.omni(size: 12)).foregroundStyle(Tok.fg3).lineLimit(1).truncationMode(.middle)
      }
      ForEach(item.reasons, id: \.self) { lineView($0.message, Tok.fg2) }
      if item.verdict == .eligible, let why = item.eligibleBecause { lineView(why.label, Tok.fg2) }
      ForEach(item.errors, id: \.self) { lineView($0, Tok.fg) }
    }
    .padding(.vertical, z(10))
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  private var glyph: Glyph {
    switch item.verdict {
    case .eligible: .done
    case .kept: .settled
    case .unknown: .idle
    }
  }

  private func lineView(_ text: String, _ color: Color) -> some View {
    Text(text)
      .font(.omni(size: 12))
      .foregroundStyle(color)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.leading, z(15))
  }
}

private struct KindBadge: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.omni(size: 11))
      .foregroundStyle(Tok.fg3)
      .padding(.horizontal, z(8))
      .padding(.vertical, z(2))
      .overlay(Capsule().strokeBorder(Tok.line))
  }
}

/// A thin determinate bar: a line track and an ink fill.
private struct ProgressBar: View {
  let value: Double

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(Tok.line)
        Capsule().fill(Tok.fg).frame(width: max(z(6), proxy.size.width * value))
      }
    }
    .frame(height: z(6))
    .animation(.easeOut(duration: 0.2), value: value)
    .accessibilityElement()
    .accessibilityLabel("Scan progress")
    .accessibilityValue("\(Int(value * 100)) percent")
  }
}
