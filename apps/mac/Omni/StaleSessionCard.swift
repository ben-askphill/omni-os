import OmniKit
import SwiftUI

/// StaleSessionCard.tsx: a thread this Mac did not resume because its latest session could not be brought here
/// (apps/server/runner/spawn.ts), so resuming the copy here could miss turns another machine ran. Ben tries the
/// download again, or starts with fresh context, a new session that reads the thread so far. Either sends the
/// messages waiting below.
struct StaleSessionCard: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var busy: Action?
  @State private var error: String?

  enum Action { case retry, fresh }

  private static let title = "Session not up to date"

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: z(12)) {
        ZStack {
          Circle().fill(Tok.needs.opacity(0.12))
          OmniIcon(name: "alert", size: 15).foregroundStyle(Tok.needs)
        }
        .frame(width: z(28), height: z(28))
        VStack(alignment: .leading, spacing: z(2)) {
          Text(Self.title)
            .font(.omni(size: 14, weight: .semibold))
            .foregroundStyle(Tok.fg)
          Text(thread.resumeBlocked ?? "")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
          Text("Try again, or start with fresh context: a new session that reads this thread so far. Your messages wait below.")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, z(4))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: z(6)) {
          Button { act(.retry) } label: {
            HStack(spacing: z(6)) {
              if busy == .retry { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 13) }
              Text("Try again")
            }
          }
          .buttonStyle(.pill(.primary, height: 28))
          .help("Download the thread's latest session again, then send the waiting messages")
          .disabled(busy != nil)
          Button { act(.fresh) } label: {
            HStack(spacing: z(6)) {
              if busy == .fresh { Loader(size: 12) } else { OmniIcon(name: "plus", size: 13) }
              Text("Start with fresh context")
            }
          }
          .buttonStyle(.pill(.secondary, height: 28))
          .help("Start a new session that reads this thread so far, instead of resuming the copy on this Mac")
          .disabled(busy != nil)
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
    .accessibilityLabel(Self.title)
  }

  private func act(_ action: Action) {
    guard busy == nil else { return }
    busy = action
    error = nil
    let client = model.client
    let id = thread.id
    Task {
      defer { busy = nil }
      do {
        switch action {
        case .retry: store.apply(recovery: try await client.retryResume(in: id))
        case .fresh: store.apply(recovery: try await client.startFresh(in: id))
        }
      } catch let e as OmniAPIError {
        error = e.message
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
