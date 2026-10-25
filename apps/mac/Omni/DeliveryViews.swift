import AppKit
import OmniKit
import SwiftUI

/// An automation's deliveries, newest first: the latest few the list carries, older ones on demand (DeliveryHistory in
/// the Web UI). A row's open state and the loaded history live in the model, so a reload leaves both alone.
struct DeliveryList: View {
  let model: AppModel
  let automations: AutomationsModel
  let automation: Automation

  var body: some View {
    let rows = automations.deliveries(of: automation)
    VStack(alignment: .leading, spacing: z(8)) {
      Text("Deliveries").omniCaption()
      if rows.isEmpty {
        Text(automation.noDeliveries).font(.omni(size: 12.5)).foregroundStyle(Tok.fg4)
      } else {
        VStack(spacing: 0) {
          ForEach(rows) { delivery in
            DeliveryRow(automations: automations, delivery: delivery) { id in model.route = .thread(id: id) }
          }
        }
        .padding(.horizontal, z(-8))
        if automations.hasOlder(automation) {
          Button {
            Task { await automations.showOlder(for: automation) }
          } label: {
            HStack(spacing: z(6)) {
              if automations.loadingOlder.contains(automation.id) { Loader(size: 12) }
              Text("Show older")
            }
          }
          .buttonStyle(.pill(.ghost, height: 28))
          .disabled(automations.loadingOlder.contains(automation.id))
        }
        if let error = automations.olderErrors[automation.id] {
          ErrorNote(text: error) { Task { await automations.showOlder(for: automation) } }
        }
      }
    }
  }
}

/// An event handed to the automation: its state, what happened and why, a dot for the thread it started and when it
/// came. A click opens the detail. A failed one that can go again has Retry right on the row. A row with no thread is
/// not dimmed: skipped or waiting is a normal state here.
private struct DeliveryRow: View {
  let automations: AutomationsModel
  let delivery: TriggerDelivery
  let open: (String) -> Void

  private var isOpen: Bool { automations.isExpanded(delivery) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: z(6)) {
        Button {
          withAnimation(Motion.settle) { automations.setExpanded(!isOpen, for: delivery) }
        } label: {
          summary.hoverWash(16, fill: Tok.surface2)
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
        if delivery.canRetry && !isOpen {
          RetryButton(automations: automations, delivery: delivery)
        }
      }
      if isOpen {
        DeliveryDetailView(automations: automations, delivery: delivery, open: open)
      }
      if let error = automations.deliveryErrors[delivery.id] {
        ErrorNote(text: error).padding(.horizontal, z(8)).padding(.bottom, z(8))
      }
    }
  }

  private var summary: some View {
    HStack(spacing: z(10)) {
      OmniIcon(name: "chevronRight", size: 12)
        .foregroundStyle(Tok.fg3)
        .rotationEffect(.degrees(isOpen ? 90 : 0))
      Chip(text: delivery.state.label, tone: tone)
      VStack(alignment: .leading, spacing: z(2)) {
        Text(delivery.summary).lineLimit(1).truncationMode(.tail).foregroundStyle(Tok.fg)
        if let note = delivery.reason ?? delivery.waiting {
          Text(note).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3).lineLimit(1).truncationMode(.tail).help(note)
        }
      }
      Spacer(minLength: z(8))
      if delivery.threadID != nil {
        GlyphView(glyph: delivery.threadStatus.map(Glyph.init) ?? .settled, size: 7)
          .help(delivery.threadStatus.map { "Thread \($0.label.lowercased())" } ?? "Thread removed")
      }
      TimelineView(.everyMinute) { context in
        Text(RelTime.label(delivery.createdAt, now: context.date))
          .font(.omni(size: 11).monospacedDigit())
          .foregroundStyle(Tok.fg4)
          .frame(width: z(96), alignment: .trailing)
      }
      .help(delivery.createdAt.formatted(date: .complete, time: .standard))
    }
    .font(.omni(size: 12.5))
    .padding(.horizontal, z(8))
    .padding(.vertical, z(6))
    .frame(minHeight: z(32))
    .contentShape(Rectangle())
  }

  /// Started reads as done, failed as needs you, skipped as quiet, and anything still on its way as plain.
  private var tone: Chip.Tone {
    switch delivery.state {
    case .started: .done
    case .failed: .needs
    case .skipped: .outline
    default: .plain
    }
  }
}

/// Retry, on the collapsed row and in the detail. Disabled while its request is out, so a second click sends nothing.
private struct RetryButton: View {
  let automations: AutomationsModel
  let delivery: TriggerDelivery

  var body: some View {
    Button {
      Task { await automations.retry(delivery) }
    } label: {
      HStack(spacing: z(5)) {
        if automations.acting.contains(delivery.id) {
          Loader(size: 11)
        } else {
          OmniIcon(name: "refresh", size: 12)
        }
        Text("Retry")
      }
    }
    .buttonStyle(.pill(.secondary, height: 28))
    .disabled(!automations.canRetry(delivery))
    .help("Go again as attempt \(delivery.attempt + 1)")
  }
}

/// Under an open row: where the delivery got to, what it carried and what Ben can do with it. Everything shown is
/// what the server kept: the bounded context fields, never the request, a header or a signature.
private struct DeliveryDetailView: View {
  let automations: AutomationsModel
  let delivery: TriggerDelivery
  let open: (String) -> Void
  @State private var confirmingSkip = false

  private var hasActions: Bool { delivery.canRetry || delivery.canSkip || delivery.threadID != nil || delivery.retryBlocked != nil }

  var body: some View {
    VStack(alignment: .leading, spacing: z(12)) {
      DeliveryStagesView(stages: delivery.stages)
      rule
      facts
      if !delivery.contextFields.isEmpty {
        rule
        VStack(alignment: .leading, spacing: z(4)) {
          ForEach(delivery.contextFields) { field in
            Fact(label: field.key) { ContextValue(field: field) }
          }
        }
      }
      if hasActions {
        rule
        actions
      }
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .padding(.horizontal, z(8))
    .padding(.top, z(4))
    .padding(.bottom, z(8))
    .confirmationDialog("Skip this delivery?", isPresented: $confirmingSkip) {
      Button("Skip", role: .destructive) { Task { await automations.skip(delivery) } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Omni never starts a run for it, and this cannot be undone.")
    }
  }

  private var rule: some View { Rectangle().fill(Tok.line).frame(height: 1) }

  private var facts: some View {
    TimelineView(.everyMinute) { context in
      VStack(alignment: .leading, spacing: z(4)) {
        Fact(label: "Received") {
          Text("\(delivery.receivedLabel()) \(Text("· \(RelTime.label(delivery.createdAt, now: context.date))").foregroundStyle(Tok.fg4))")
            .textSelection(.enabled)
        }
        if delivery.attempt > 1 {
          Fact(label: "Attempt") { Text("\(delivery.attempt)").monospacedDigit() }
        }
        if let expires = delivery.expiresLabel(now: context.date) {
          Fact(label: "Expires") { Text(expires) }
        }
        Fact(label: "Source") {
          VStack(alignment: .leading, spacing: z(1)) {
            Text(delivery.sourceLabel)
            Text(delivery.sourceID)
              .font(.omni(size: 11, design: .monospaced))
              .foregroundStyle(Tok.fg3)
              .textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
  }

  private var actions: some View {
    HStack(spacing: z(8)) {
      if delivery.canRetry { RetryButton(automations: automations, delivery: delivery) }
      if delivery.canSkip {
        Button {
          confirmingSkip = true
        } label: {
          HStack(spacing: z(5)) {
            OmniIcon(name: "x", size: 12)
            Text("Skip")
          }
        }
        .buttonStyle(.pill(.ghost, height: 28))
        .disabled(!automations.canSkip(delivery))
        .help("Never start this one")
      }
      if let id = delivery.threadID {
        Button {
          open(id)
        } label: {
          HStack(spacing: z(5)) {
            Text("Open thread")
            OmniIcon(name: "arrowRight", size: 12)
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
      }
      if let blocked = delivery.retryBlocked {
        Text(blocked)
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
          .textSelection(.enabled)
      } else {
        Spacer(minLength: 0)
      }
    }
  }
}

/// A label and its value, in the detail's two columns.
private struct Fact<Value: View>: View {
  let label: String
  @ViewBuilder var value: Value

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: z(12)) {
      Text(label)
        .foregroundStyle(Tok.fg4)
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(width: z(88), alignment: .leading)
      value
        .foregroundStyle(Tok.fg2)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.omni(size: 12))
  }
}

/// A context value: a web link opens in the browser and shows its address, anything else is text.
private struct ContextValue: View {
  let field: DeliveryField

  var body: some View {
    if let url = field.url {
      Button {
        NSWorkspace.shared.open(url)
      } label: {
        Text(field.value).underline().multilineTextAlignment(.leading)
      }
      .buttonStyle(.plain)
      .foregroundStyle(Tok.fg)
      .help("Open \(field.value)")
    } else {
      Text(field.value).textSelection(.enabled)
    }
  }
}

#if DEBUG
extension QAProbe {
  /// The `deliveries` QA step: shows an automation's deliveries on the Automations page. Returns why it could not.
  static var showDeliveries: ((QADeliveries) async -> String?)?
}
#endif
