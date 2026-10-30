import OmniKit
import SwiftUI

/// The Storage part of the Machines tab (a tab of its own before #404), like the Web UI's Settings, Machines, Storage:
/// the inventory of data/worktrees, the cleanup of what can go and this Mac's retention policy. A new model per client
/// and per visit. It shows the last scan and scans only when Scan is pressed; closing the tab stops following a
/// running scan or cleanup.
struct StorageSettings: View {
  let model: AppModel
  @State private var inventory: WorktreeInventoryModel?

  var body: some View {
    Group {
      if let inventory {
        StorageForm(inventory: inventory)
      } else {
        LoadingNote()
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
  /// The list the Review sheet shows, kept as it was when the sheet opened so Remove posts exactly those.
  @State private var reviewing: CleanupPreview?

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      SettingsIntro(
        icon: "folder",
        text: Text(
          "Omni makes a git worktree for each thread in a repo channel, in data/worktrees. This lists them, what each costs on disk and why it must stay or can go, and removes the ones that can go when you ask or on a schedule. \(worktreeCleanupNote)\n\n\(worktreePruneNote)"
        )
      )

      switch inventory.loadState {
      case .loading:
        LoadingNote()
      case .failed(let message):
        ErrorNote(text: message) { Task { await inventory.load() } }
      case .loaded:
        scanCard
        if let cleanup = inventory.cleanup {
          cleanupCard(cleanup)
          retentionCard(cleanup)
        }
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
    .frame(maxWidth: .infinity, alignment: .leading)
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
          .disabled(inventory.isBusy || inventory.isCleaning)
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
      actionError(.scan)
    }
  }

  @ViewBuilder private func actionError(_ action: WorktreeInventoryModel.Action) -> some View {
    if let error = inventory.actionError, error.action == action { ErrorNote(text: error.message) }
  }

  private func scanNote(_ scan: WorktreeScan?) -> String {
    if inventory.isCleaning { return "A cleanup is running. Scan again once it is done." }
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

  // MARK: Cleanup

  private func cleanupCard(_ cleanup: CleanupState) -> some View {
    let run = cleanup.runs.manual
    let offer = cleanup.preview?.manual
    return SettingsCard(title: "Clean Up", note: inventory.cleanupNote) {
      if run?.isRunning != true, let offer, !offer.candidates.isEmpty {
        Button("Review…") { reviewing = offer }
          .buttonStyle(.pill(.secondary, height: 28))
          .disabled(inventory.isBusy || inventory.isCleaning)
      }
    } content: {
      if let run { CleanupRunReport(title: "Last cleanup", run: run) }
      if reviewing == nil { actionError(.cleanup) }
    }
    .sheet(isPresented: Binding(get: { reviewing != nil }, set: { if !$0 { reviewing = nil } })) {
      if let reviewing { CleanupReviewSheet(preview: reviewing, inventory: inventory) }
    }
  }

  private func retentionCard(_ cleanup: CleanupState) -> some View {
    let policy = cleanup.policy
    return SettingsCard(title: "Retention on This Mac") {
      SettingsToggle(
        title: "Remove idle worktrees on a schedule",
        detail: "Only this Mac: the setting is not synced. It covers worktrees of archived, merged or deleted threads with nothing unsaved, idle at least \(Format.plural(policy.idleDays, "day")). It runs a minute after Omni starts, then daily.",
        isOn: Binding(get: { policy.enabled }, set: { on in Task { await inventory.setRetention(enabled: on) } })
      )
      .disabled(inventory.isBusy)
      // The idle days only matter with the schedule on, so the picker shows with it (#405).
      if policy.enabled {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "After")
          Picker("After", selection: Binding(get: { policy.idleDays }, set: { days in Task { await inventory.setRetention(idleDays: days) } })) {
            ForEach(policy.dayChoices, id: \.self) { Text(Format.plural($0, "day")).tag($0) }
          }
          .labelsHidden()
          .fixedSize()
          .disabled(inventory.isBusy)
        }
      }
      if let line = inventory.retentionNote {
        Text(line).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).fixedSize(horizontal: false, vertical: true)
      }
      actionError(.retention)
      if let run = cleanup.runs.retention { CleanupRunReport(title: "Last pass", run: run) }
    }
  }

  // MARK: Totals

  private var summaryCard: some View {
    let s = inventory.summary
    return SettingsCard(title: "Disk use", note: "\(ByteSize.label(s.bytes)) in \(Format.plural(s.folders, "folder")).") {
      InfoRows {
        totalRow("Eligible", s.eligible, .done)
        totalRow("Kept", s.kept, .settled)
        totalRow("Unknown", s.unknown, .idle)
        InfoRow(label: "Stale") {
          Text("\(Format.plural(s.stale, "registration")), frees no space").monospacedDigit()
        }
      }
    }
  }

  private func totalRow(_ label: String, _ totals: VerdictTotals, _ glyph: Glyph) -> some View {
    InfoRow(label: label) {
      HStack(spacing: z(8)) {
        GlyphView(glyph: glyph, size: 7)
        Text("\(Format.plural(totals.count, "folder")), \(ByteSize.label(totals.bytes))").monospacedDigit()
      }
    }
  }

  // MARK: Items

  private func group(_ verdict: WorktreeItem.Verdict, _ folders: [WorktreeItem]) -> some View {
    let bytes = folders.reduce(Int64(0)) { $0 + ($1.bytes ?? 0) }
    return SettingsCard(title: verdict.label, note: "\(Format.plural(folders.count, "folder")), \(ByteSize.label(bytes)). \(blurb(verdict))") {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(folders.enumerated()), id: \.element.id) { index, item in
          if index > 0 { Hairline() }
          FolderRow(item: item)
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
          FolderRow(item: item)
        }
      }
    }
  }
}

/// One worktree: a glyph, its title and size, where it belongs, then why it stays, why it may go or what failed.
private struct FolderRow: View {
  struct Line {
    let text: String
    /// What failed reads in ink, the rest in fg-2.
    var failure = false
  }

  let glyph: Glyph
  let title: String
  var badge: String?
  /// Nil for a stale registration, which has no folder to measure.
  let size: String?
  let detail: String?
  let lines: [Line]

  var body: some View {
    VStack(alignment: .leading, spacing: z(6)) {
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        GlyphView(glyph: glyph, size: 7)
        Text(title)
          .font(.omni(size: 13.5, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.middle)
        if let badge { KindBadge(text: badge) }
        Spacer(minLength: z(8))
        if let size {
          Text(size).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).monospacedDigit()
        }
      }
      if let detail {
        Text(detail).font(.omni(size: 12)).foregroundStyle(Tok.fg3).lineLimit(1).truncationMode(.middle)
      }
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        Text(line.text)
          .font(.omni(size: 12))
          .foregroundStyle(line.failure ? Tok.fg : Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.leading, z(15))
      }
    }
    .padding(.vertical, z(10))
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

extension FolderRow {
  /// A folder of the scan.
  init(item: WorktreeItem) {
    glyph = switch item.verdict {
    case .eligible: .done
    case .kept: .settled
    case .unknown: .idle
    }
    title = item.title
    badge = item.kind == .managed ? nil : item.kind.label
    size = item.folder ? ByteSize.label(item.bytes) : nil
    detail = item.detail
    let because = item.verdict == .eligible ? item.eligibleBecause.map { [Line(text: $0.label)] } ?? [] : []
    lines = item.reasons.map { Line(text: $0.message) } + because + item.errors.map { Line(text: $0, failure: true) }
  }

  /// A worktree the Review sheet lists.
  init(candidate: CleanupCandidate) {
    glyph = .done
    title = candidate.title
    size = ByteSize.label(candidate.bytes)
    detail = candidate.detail
    lines = candidate.because.map { [Line(text: $0.label)] } ?? []
  }

  /// A worktree a cleanup finished with.
  init(result: CleanupResult) {
    glyph = switch result.outcome {
    case .removed: .done
    case .kept: .settled
    case .failed: .needs
    }
    title = result.candidate.title
    badge = result.outcome.label
    size = ByteSize.label(result.candidate.bytes)
    detail = result.candidate.detail
    lines = result.reasons.map { Line(text: $0.message) } + result.errors.map { Line(text: $0, failure: true) }
  }
}

/// A cleanup run: its progress while it runs, then what it removed and freed, and a row per worktree.
private struct CleanupRunReport: View {
  let title: String
  let run: CleanupRun

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(alignment: .firstTextBaseline, spacing: z(8)) {
        Text(title).font(.omni(size: 12.5, weight: .medium)).foregroundStyle(Tok.fg2)
        Spacer(minLength: z(8))
        if let finishedAt = run.finishedAt {
          Text(RelTime.label(finishedAt)).font(.omni(size: 12)).foregroundStyle(Tok.fg3).monospacedDigit()
        }
      }
      if run.isRunning {
        ProgressBar(value: run.progress, label: "Cleanup progress")
        Text(run.progressLabel).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).monospacedDigit()
      } else {
        Text(run.summary).font(.omni(size: 13)).foregroundStyle(Tok.fg).monospacedDigit()
      }
      if run.state == .failed, let error = run.error { ErrorNote(text: error) }
      if !run.items.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(run.items.enumerated()), id: \.element.id) { index, result in
            if index > 0 { Hairline() }
            FolderRow(result: result)
          }
        }
      }
    }
  }
}

/// Lists exactly what Remove posts. Cancel is the default button, so Return never removes anything.
private struct CleanupReviewSheet: View {
  let preview: CleanupPreview
  let inventory: WorktreeInventoryModel
  @Environment(\.dismiss) private var dismiss
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let count = preview.candidates.count
    VStack(alignment: .leading, spacing: z(14)) {
      Text("Remove \(Format.plural(count, "worktree"))?").font(.omni(size: 17, weight: .medium)).foregroundStyle(Tok.fg)
      Text(worktreeCleanupNote)
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
      if count > 5 {
        ScrollView { rows }.frame(height: z(340))
      } else {
        rows
      }
      if let error { ErrorNote(text: error) }
      HStack(spacing: z(8)) {
        Spacer()
        Button("Cancel") { dismiss() }
          .buttonStyle(.pill(.secondary, height: 34))
          .keyboardShortcut(.defaultAction)
          .disabled(busy)
        Button(role: .destructive) { remove() } label: {
          HStack(spacing: z(8)) {
            if busy { Loader(size: 14) }
            Text("Remove \(Format.plural(count, "Worktree"))")
          }
        }
        .buttonStyle(.pill(.needs, height: 34))
        .disabled(busy)
      }
    }
    .padding(z(24))
    .frame(width: z(480))
    .background(Tok.bg)
    .onExitCommand { if !busy { dismiss() } }
  }

  private var rows: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(preview.candidates.enumerated()), id: \.element.id) { index, candidate in
        if index > 0 { Hairline() }
        FolderRow(candidate: candidate)
      }
    }
  }

  private func remove() {
    busy = true
    error = nil
    Task {
      let started = await inventory.startCleanup(ids: preview.candidates.map(\.id))
      busy = false
      if started { dismiss() } else { error = inventory.actionError?.message ?? "The cleanup did not start. Try again." }
    }
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
  var label = "Scan progress"

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
    .accessibilityLabel(label)
    .accessibilityValue("\(Int(value * 100)) percent")
  }
}
