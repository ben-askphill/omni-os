import OmniKit
import SwiftUI

/// Plan usage per harness, the 5 hour and the 7 day window, as UsageCard in Sidebar.tsx.
struct UsageCard: View {
  let model: AppModel

  var body: some View {
    let rows = HarnessUsageRow.rows(usage: model.store.usage, slots: model.store.status?.slots ?? [:])
    let slots = rows.compactMap { r in r.slot.map { "\(r.name) \($0.running)/\($0.cap)" } }
    let live = model.connectionNotice == nil && model.supervisor.isRunning
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Color.clear.frame(width: 66, height: 1)
        Text("5h").frame(maxWidth: .infinity, alignment: .leading)
        Text("Week").frame(maxWidth: .infinity, alignment: .leading)
      }
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(Tok.fg4)
      .padding(.bottom, 2)
      ForEach(rows) { UsageRow(row: $0) }
      Rectangle().fill(Tok.line).frame(height: 1)
      HStack(spacing: 8) {
        GlyphView(glyph: live ? .done : .settled, size: 6)
        Text(slots.isEmpty ? (live ? "Connected" : "Connecting") : slots.joined(separator: " · "))
          .monospacedDigit()
          .lineLimit(1)
      }
      .font(.system(size: 11))
      .foregroundStyle(Tok.fg3)
      .padding(.top, 2)
    }
    .padding(12)
    .background(Tok.bg.opacity(0.7), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    .cardShadow(20)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Plan usage")
  }
}

private struct UsageRow: View {
  let row: HarnessUsageRow

  var body: some View {
    TimelineView(.everyMinute) { context in
      HStack(spacing: 8) {
        HStack(spacing: 6) {
          HarnessLogo(harness: row.id.rawValue, size: 12)
            .foregroundStyle(Tok.fg)
          Text(row.name)
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg2)
        .frame(width: 66, alignment: .leading)
        if row.hasData {
          Meter(meter: row.fiveHour, label: "\(row.name) 5 hour", now: context.date)
          Meter(meter: row.week, label: "\(row.name) week", now: context.date)
        } else {
          Text("no data")
            .font(.system(size: 10.5))
            .foregroundStyle(Tok.fg4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }
}

/// `Ticks` in ui.tsx: ten bars, the used ones full height in ink (vermilion past 90%), the rest short and faint.
private struct Meter: View {
  let meter: UsageMeter?
  let label: String
  let now: Date

  var body: some View {
    if let meter {
      let on = meter.fraction > 0 ? max(1, Int((meter.fraction * 10).rounded())) : 0
      HStack(spacing: 6) {
        HStack(alignment: .bottom, spacing: 2) {
          ForEach(0..<10, id: \.self) { i in
            RoundedRectangle(cornerRadius: 1.5)
              .fill(i < on ? (meter.tone == .bad ? Tok.needs : Tok.fg) : Tok.fg.opacity(0.14))
              .frame(height: i < on ? 10 : 5.5)
          }
        }
        .frame(height: 10, alignment: .bottom)
        Text("\(meter.percent)%")
          .font(.system(size: 10))
          .monospacedDigit()
          .foregroundStyle(Tok.fg2)
          .frame(width: 28, alignment: .trailing)
      }
      .frame(maxWidth: .infinity)
      .help("\(label): \(meter.percent)% used, resets \(meter.resetLabel(now: now))")
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(label) usage")
      .accessibilityValue("\(meter.percent) percent")
    } else {
      Text("—")
        .font(.system(size: 10))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity)
    }
  }
}
