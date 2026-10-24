import AuthenticationServices
import OmniKit
import SwiftUI

/// The Account tab, like the Account section of the web's Settings: who this Mac is signed in as with Google, or
/// that it uses the install token, who may sign in, and the devices signed in with Google.
struct AccountSettings: View {
  let model: AppModel

  var body: some View {
    let account = model.account
    SettingsPage {
      SettingsCard(
        title: "Account",
        note: "Signing in with Google gives this Mac its own session. Everything else keeps using the install token, so scripts and pairing still work."
      ) {
        switch account.state {
        case .signedIn(let user, let device):
          HStack(alignment: .center, spacing: z(12)) {
            VStack(alignment: .leading, spacing: z(3)) {
              Text("Signed in as \(user.email)").font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg)
              Text(device.name).font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
            }
            Spacer(minLength: 0)
            Button("Sign out") { Task { await account.signOut() } }
              .buttonStyle(.pill(.secondary, height: 32))
          }
        case .signedOut, .signingIn, .failed:
          Text("This Mac uses the install token.").font(.omni(size: 13.5)).foregroundStyle(Tok.fg)
          if account.google?.loopback == true {
            HStack { GoogleSignInButton(account: account) }
          }
          if case .failed(let message) = account.state { ErrorNote(text: message) }
        }
        if let google = account.google, google.loopback || google.broker {
          Text(google.whoMaySignIn)
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      if let google = account.google, google.loopback || google.broker {
        DevicesCard(account: account)
      }
    }
    .task(id: model.client.baseURL) { await account.refresh() }
  }
}

/// Every browser and Mac signed in with Google, most recently seen first, each with a Sign out that asks first.
private struct DevicesCard: View {
  let account: AccountModel
  @State private var confirming: SignedInDevice?

  var body: some View {
    SettingsCard(title: "Devices") {
      if let devices = account.devices {
        if devices.isEmpty {
          Text("No devices are signed in with Google.").font(.omni(size: 13)).foregroundStyle(Tok.fg3)
        } else {
          VStack(spacing: 0) {
            ForEach(devices) { device in
              if device.id != devices.first?.id { Hairline().padding(.horizontal, z(10)) }
              DeviceRow(device: device) { confirming = device }
            }
          }
          .padding(z(6))
          .omniCard(20)
        }
      } else if account.devicesError == nil {
        LoadingNote()
      }
      if let error = account.devicesError { ErrorNote(text: error) }
      Text("Scripts, agents and the Mac app's server check use the install token, which is not listed here. To shut everything out, delete data/api-token and restart Omni.")
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
    }
    .confirmationDialog(
      confirming.map { "Sign out \($0.name)?" } ?? "",
      isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
      presenting: confirming
    ) { device in
      Button("Sign out", role: .destructive) { Task { await account.revoke(device) } }
      Button("Cancel", role: .cancel) {}
    } message: { device in
      Text(
        device.current
          ? "This Mac goes back to the install token. You can sign in again any time."
          : "Its session stops working at once. It can sign in with Google again.")
    }
    #if DEBUG
      .onAppear { QAAccountProbe.confirm = { confirming = $0 } }
      .onDisappear { QAAccountProbe.confirm = nil }
    #endif
  }
}

/// A device: the browser or Mac glyph, its name, then the account and when it was last seen, or "This device".
private struct DeviceRow: View {
  let device: SignedInDevice
  let signOut: () -> Void

  var body: some View {
    HStack(spacing: z(12)) {
      OmniIcon(name: device.kind == .browser ? "browser" : "monitor", size: 15)
        .foregroundStyle(Tok.fg2)
        .frame(width: z(32), height: z(32))
        .background(Tok.bg, in: Circle())
      VStack(alignment: .leading, spacing: z(2)) {
        Text(device.name).font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
        TimelineView(.everyMinute) { context in
          Text(device.detail(now: context.date)).font(.omni(size: 12)).foregroundStyle(Tok.fg3).lineLimit(1).truncationMode(.middle)
        }
      }
      .help("Last seen \(device.lastSeenAt.formatted(date: .abbreviated, time: .shortened))")
      Spacer(minLength: 0)
      Button("Sign out", role: .destructive, action: signOut)
        .buttonStyle(.pill(.ghost, height: 28))
    }
    .padding(.horizontal, z(10))
    .padding(.vertical, z(8))
  }
}

#if DEBUG
  /// Opens or closes a device's Sign out confirmation, while the Devices list shows.
  @MainActor enum QAAccountProbe {
    static var confirm: ((SignedInDevice?) -> Void)?
  }
#endif

/// "Sign in with Google": a pill with Google's G on the left, a Loader in its place while the sheet is up.
struct GoogleSignInButton: View {
  let account: AccountModel
  var variant = PillButtonStyle.Variant.secondary
  var height: CGFloat = 34

  var body: some View {
    Button {
      Task { await account.signIn(open: GoogleSignInSheet.open) }
    } label: {
      HStack(spacing: z(8)) {
        if account.state == .signingIn { Loader(size: 14) } else { GoogleMark(size: 16) }
        Text("Sign in with Google")
      }
    }
    .buttonStyle(.pill(variant, height: height))
  }
}

/// The system's web sign-in sheet. Google, then the server, end it on `omni://signin?attempt=`. Closing it throws
/// `CancellationError`.
@MainActor
enum GoogleSignInSheet {
  /// The sheet must be kept alive while it shows.
  private static var current: ASWebAuthenticationSession?
  private static let anchor = Anchor()

  static func open(_ url: URL) async throws -> URL {
    #if DEBUG
      if let hint = UserDefaults.standard.string(forKey: "OmniQASignInHint"), !hint.isEmpty {
        return try await QASignIn.follow(url, hint: hint)
      }
    #endif
    defer { current = nil }
    return try await withCheckedThrowingContinuation { done in
      let session = ASWebAuthenticationSession(url: url, callback: .customScheme("omni")) { @Sendable callback, error in
        if let callback {
          done.resume(returning: callback)
        } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
          done.resume(throwing: CancellationError())
        } else {
          done.resume(throwing: error ?? CancellationError())
        }
      }
      session.presentationContextProvider = anchor
      session.prefersEphemeralWebBrowserSession = false
      current = session
      if !session.start() { done.resume(throwing: DidNotOpen()) }
    }
  }

  private struct DidNotOpen: LocalizedError {
    var errorDescription: String? { "The sign-in window did not open. Try again." }
  }

  private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }
  }
}
