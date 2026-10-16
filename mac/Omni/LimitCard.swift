import OmniKit
import SwiftUI

/// LimitCard.tsx: a turn the harness stopped at the plan's usage limit (server/runner/limits.ts). With the reset time
/// it reported, Ben can have Omni continue the thread then, once, or cancel that; without one, or any time, he
/// resumes it now.
struct LimitCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var busy: LimitStop.Action?
  @State private var error: String?

  var body: some View {
    TimelineView(.everyMinute) { context in
      if let view = LimitStop.view(thread, now: context.date) {
        card(view)
      }
    }
  }

  private func card(_ view: LimitStop.View) -> some View {
    let scheduled = thread.limit == .scheduled
    return VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: z(12)) {
        ZStack {
          Circle().fill(scheduled ? Tok.surface2 : Tok.needs.opacity(0.12))
          OmniIcon(name: scheduled ? "clock" : "gauge", size: 15).foregroundStyle(scheduled ? Tok.fg2 : Tok.needs)
        }
        .frame(width: z(28), height: z(28))
        VStack(alignment: .leading, spacing: z(2)) {
          Text(view.title)
            .font(.omni(size: 14, weight: .semibold))
            .foregroundStyle(Tok.fg)
          Text(view.body)
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: z(6)) {
          ForEach(Array(view.actions.enumerated()), id: \.element) { i, action in
            Button { act(action) } label: {
              HStack(spacing: z(6)) {
                if busy == action { Loader(size: 12) } else { OmniIcon(name: action.icon, size: 13) }
                Text(action.label)
              }
            }
            .buttonStyle(.pill(i == 0 ? .primary : .secondary, height: 28))
            .disabled(busy != nil)
          }
        }
      }
      .padding(.horizontal, z(16))
      .padding(.vertical, z(12))
      if let error {
        ErrorNote(text: error)
          .padding(.horizontal, z(12))
          .padding(.bottom, z(12))
      }
    }
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Tok.line))
    .padding(.top, z(8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(view.title)
  }

  private func act(_ action: LimitStop.Action) {
    guard busy == nil else { return }
    busy = action
    error = nil
    let client = model.client
    let id = thread.id
    Task {
      defer { busy = nil }
      do {
        store.apply(recovery: try await client.limit(action, in: id))
      } catch let e as OmniAPIError {
        error = e.message
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
