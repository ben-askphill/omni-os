import OmniKit
import SwiftUI

/// Plan usage per harness, the 5 hour and the 7 day window, as UsageCard in Sidebar.tsx.
struct UsageCard: View {
  let model: AppModel

  var body: some View {
    let rows = HarnessUsageRow.rows(usage: model.store.usage, slots: model.store.status?.slots ?? [:])
    let slots = rows.compactMap { r in r.slot.map { "\(r.name) \($0.running)/\($0.cap)" } }
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Color.clear.frame(width: 44, height: 1)
        Text("5H").frame(maxWidth: .infinity, alignment: .leading)
        Text("WEEK").frame(maxWidth: .infinity, alignment: .leading)
      }
      .font(.system(size: 9, weight: .medium))
      .tracking(0.5)
      .foregroundStyle(.tertiary)
      ForEach(rows) { UsageRow(row: $0) }
      if !slots.isEmpty {
        Divider()
        Text(slots.joined(separator: " · "))
          .font(.system(size: 11))
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
    }
    .padding(12)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Plan usage")
  }
}

private struct UsageRow: View {
  let row: HarnessUsageRow

  var body: some View {
    TimelineView(.everyMinute) { context in
      HStack(spacing: 8) {
        Text(row.name.uppercased())
          .font(.system(size: 9.5, weight: .medium))
          .tracking(0.5)
          .foregroundStyle(.secondary)
          .frame(width: 44, alignment: .leading)
        if row.hasData {
          Meter(meter: row.fiveHour, label: "\(row.name) 5 hour", now: context.date)
          Meter(meter: row.week, label: "\(row.name) week", now: context.date)
        } else {
          Text("no data")
            .font(.system(size: 10.5))
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }
}

/// Ten ticks and the percentage. The reset time is in the tooltip.
private struct Meter: View {
  let meter: UsageMeter?
  let label: String
  let now: Date

  var body: some View {
    if let meter {
      HStack(spacing: 4) {
        HStack(spacing: 1.5) {
          ForEach(0..<10, id: \.self) { i in
            RoundedRectangle(cornerRadius: 1)
              .fill(Double(i) < (meter.fraction * 10).rounded(.up) ? AnyShapeStyle(color(meter)) : AnyShapeStyle(ThreadStyle.line))
              .frame(height: 10)
          }
        }
        Text("\(meter.percent)%")
          .font(.system(size: 10))
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .frame(width: 26, alignment: .trailing)
      }
      .frame(maxWidth: .infinity)
      .help("\(label): \(meter.percent)% used, resets \(meter.resetLabel(now: now))")
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(label) usage")
      .accessibilityValue("\(meter.percent) percent")
    } else {
      Text("—")
        .font(.system(size: 10))
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity)
    }
  }

  private func color(_ meter: UsageMeter) -> Color {
    switch meter.tone {
    case .bad: ThreadStyle.bad
    case .warn: ThreadStyle.warn
    case .normal: .primary.opacity(0.7)
    }
  }
}
