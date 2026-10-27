import OmniKit
import SwiftUI

/// Plan usage per harness, the 5 hour and the 7 day window or Cursor's month, as UsageCard in Sidebar.tsx.
/// Collapsed by default to one row with the live dot and the busiest window; click to open.
struct UsageCard: View {
  let model: AppModel
  @AppStorage("usageCard.open") private var open = false

  var body: some View {
    let running = model.store.status?.slots ?? [:]
    let rows = HarnessUsageRow.rows(usage: model.store.usage, slots: running)
    let slots = HarnessUsageRow.slotSummary(rows, slots: running)
    let live = model.connectionNotice == nil && model.supervisor.isRunning
    let summary = slots.isEmpty ? (live ? "Connected" : "Connecting") : slots.joined(separator: " · ")
    let peak = rows.flatMap { [$0.fiveHour, $0.week, $0.month?.meter] }.compactMap { $0 }.max { $0.fraction < $1.fraction }
    VStack(alignment: .leading, spacing: z(8)) {
      Button {
        withAnimation(.snappy(duration: 0.2)) { open.toggle() }
      } label: {
        HStack(spacing: z(8)) {
          GlyphView(glyph: live ? .done : .settled, size: 6)
          Text("Usage")
            .font(.omni(size: 11, weight: .medium))
            .foregroundStyle(Tok.fg2)
          Text(open ? "" : summary)
            .monospacedDigit()
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let peak, !open {
            Text("\(peak.percent)%")
              .font(.omni(size: 10))
              .monospacedDigit()
              .foregroundStyle(peak.tone == .bad ? Tok.needs : Tok.fg2)
              .help("Highest window across plans")
          }
          OmniIcon(name: open ? "chevronDown" : "chevronRight", size: 13)
            .foregroundStyle(Tok.fg4)
        }
        .font(.omni(size: 11))
        .foregroundStyle(Tok.fg3)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(open ? "Hide plan usage" : "Show plan usage")
      if open {
        HStack(spacing: z(8)) {
          Color.clear.frame(width: z(66), height: 1)
          Text("5h").frame(maxWidth: .infinity, alignment: .leading)
          Text("Week").frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.omni(size: 11, weight: .medium))
        .foregroundStyle(Tok.fg4)
        .padding(.top, z(2))
        ForEach(rows) { UsageRow(row: $0) }
        Rectangle().fill(Tok.line).frame(height: 1)
        // Five harnesses' slots outrun the sidebar's width: wrap, so Cursor Cloud's stays in view.
        Text(summary)
          .monospacedDigit()
          .lineLimit(2)
          .help(summary)
          .font(.omni(size: 11))
          .foregroundStyle(Tok.fg3)
          .padding(.top, z(2))
      }
    }
    .padding(z(12))
    .background(Tok.bg.opacity(0.7), in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
    .cardShadow(20)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Plan usage")
  }
}

private struct UsageRow: View {
  let row: HarnessUsageRow

  var body: some View {
    TimelineView(.everyMinute) { context in
      HStack(spacing: z(8)) {
        HStack(spacing: z(6)) {
          HarnessLogo(harness: row.id.rawValue, size: 12)
            .foregroundStyle(Tok.fg)
          Text(row.name)
        }
        .font(.omni(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg2)
        .frame(width: z(66), alignment: .leading)
        if row.hasWindows {
          Meter(meter: row.fiveHour, label: "\(row.name) 5 hour", now: context.date)
          Meter(meter: row.week, label: "\(row.name) week", now: context.date)
        } else if let month = row.month {
          MonthCell(month: month, name: row.name, now: context.date)
        } else {
          Text("no data")
            .font(.omni(size: 10.5))
            .foregroundStyle(Tok.fg4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }
}

/// A monthly cycle across both columns, as MonthCell in Sidebar.tsx: up to twenty bars, the percent, and "mo".
private struct MonthCell: View {
  let month: MonthMeter
  let name: String
  let now: Date

  var body: some View {
    let meter = month.meter
    HStack(spacing: z(6)) {
      Bars(meter: meter, count: 20)
      Text("\(meter.percent)%")
        .font(.omni(size: 10))
        .monospacedDigit()
        .foregroundStyle(Tok.fg2)
        .frame(width: z(26), alignment: .trailing)
      Text("mo")
        .font(.omni(size: 10))
        .foregroundStyle(Tok.fg4)
    }
    .frame(maxWidth: .infinity)
    .help(month.title(name, now: now))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(name) month usage")
    .accessibilityValue("\(meter.percent) percent")
  }
}

/// The tick bars of a meter: the used ones full height in ink (vermilion past 90%), the rest short and faint.
private struct Bars: View {
  let meter: UsageMeter
  var count = 10

  var body: some View {
    GeometryReader { geometry in
      // Match the Web UI: reduce granularity before ticks become thinner than 3pt at the current zoom.
      let visibleCount = max(1, min(count, Int((geometry.size.width + z(2)) / z(5))))
      let on = meter.fraction > 0 ? max(1, Int((meter.fraction * Double(visibleCount)).rounded())) : 0
      HStack(alignment: .bottom, spacing: z(2)) {
        ForEach(0..<visibleCount, id: \.self) { i in
          RoundedRectangle(cornerRadius: z(1.5))
            .fill(i < on ? (meter.tone == .bad ? Tok.needs : Tok.fg) : Tok.fg.opacity(0.14))
            .frame(height: i < on ? z(10) : z(5.5))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
    .frame(height: z(10), alignment: .bottom)
  }
}

/// `Ticks` in ui.tsx: up to ten bars, the used ones full height in ink (vermilion past 90%), the rest short and faint.
private struct Meter: View {
  let meter: UsageMeter?
  let label: String
  let now: Date

  var body: some View {
    if let meter {
      HStack(spacing: z(6)) {
        Bars(meter: meter)
        Text("\(meter.percent)%")
          .font(.omni(size: 10))
          .monospacedDigit()
          .foregroundStyle(Tok.fg2)
          .frame(width: z(26), alignment: .trailing)
      }
      .frame(maxWidth: .infinity)
      .help("\(label): \(meter.percent)% used, resets \(meter.resetLabel(now: now))")
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(label) usage")
      .accessibilityValue("\(meter.percent) percent")
    } else {
      Text("—")
        .font(.omni(size: 10))
        .foregroundStyle(Tok.fg4)
        .frame(maxWidth: .infinity)
    }
  }
}
