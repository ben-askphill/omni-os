import AppKit
import CoreImage.CIFilterBuiltins
import OmniKit
import SwiftUI

#if DEBUG
/// Show Pairing Code on the Omni for iOS card, for the QA harness to press. Set while the card shows.
@MainActor
enum QAIosPairingProbe {
  static var issue: (() async -> Void)?
  /// "Use Address" with a typed address. Returns the problem text, or nil when the card took it.
  static var useAddress: ((String) -> String?)?
  /// The card's frame in global coordinates, so the harness can scroll it into view.
  static var frame: CGRect?
}
#endif

/// The Omni for iOS card of the Sharing & access section, like the Web UI's Settings, Sharing & access, Omni for iOS
/// (apps/web/src/pages/IosPairing.tsx): a QR the iPhone app scans to pair. The address and the code come from OmniKit's
/// IosPairing.swift. A new model per client and per visit, and the code goes with it. The status reloads every
/// 5 seconds while the card shows, so it follows Omni Connect being switched on in the card above.
struct IosPairingSettings: View {
  let model: AppModel
  @State private var pairing: IosPairingModel?

  var body: some View {
    Group {
      if let pairing {
        IosPairingCard(pairing: pairing)
      } else {
        LoadingNote()
      }
    }
    .task(id: model.client.baseURL) {
      let pairing = IosPairingModel(client: model.client)
      self.pairing = pairing
      await pairing.refresh()
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled else { break }
        await pairing.refresh()
      }
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open, let pairing { Task { await pairing.refresh() } }
    }
    .onDisappear { pairing?.hide() }
  }
}

struct IosPairingCard: View {
  @Bindable var pairing: IosPairingModel

  var body: some View {
    SettingsCard(title: "Omni for iOS", note: "Pair the iPhone app by scanning a code. The code is short-lived and holds this Omni's address, never your token.") {
      if pairing.needsInstallToken {
        Text(IosPairing.needsInstallToken)
          .font(.omni(size: 13)).foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
      } else if pairing.isLoading {
        LoadingNote()
      } else {
        content
      }
    }
    #if DEBUG
    .onAppear {
      QAIosPairingProbe.issue = { await pairing.issue() }
      QAIosPairingProbe.useAddress = { pairing.useAddress($0) }
    }
    .onDisappear {
      QAIosPairingProbe.issue = nil
      QAIosPairingProbe.useAddress = nil
      QAIosPairingProbe.frame = nil
    }
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAIosPairingProbe.frame = $0 }
    #endif
  }

  @ViewBuilder
  private var content: some View {
    if let error = pairing.loadError, pairing.connect == nil {
      ErrorNote(text: error) { Task { await pairing.refresh() } }
    }
    if let address = pairing.address {
      InfoRows {
        InfoRow(label: "Address") { addressChoice(address) }
      }
      if address.isUnchecked {
        Text("Omni cannot check from here that your phone can reach this address. If you are unsure, open it in the phone's browser first.")
          .font(.omni(size: 12)).foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
      }
    } else if let problem = pairing.options.problem {
      Text(problem)
        .font(.omni(size: 13)).foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
    }
    AdvancedFold(title: "Use another address", forced: pairing.address == nil) {
      AddressEntry(pairing: pairing)
    }
    if pairing.address != nil {
      if let issued = pairing.issued {
        issuedCode(issued)
      } else {
        HStack(spacing: z(10)) {
          Button("Show Pairing Code") { Task { await pairing.issue() } }
            .buttonStyle(.pill(.primary, height: 28))
            .disabled(pairing.isBusy)
          if pairing.isBusy { Loader(size: 14) }
          if pairing.expired {
            Text("The last code expired.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
          }
        }
      }
    }
    if let error = pairing.actionError {
      ErrorNote(text: error)
    }
  }

  @ViewBuilder
  private func addressChoice(_ address: PairingAddress) -> some View {
    let all = pairing.options.addresses
    if all.count > 1 {
      Picker("Server address", selection: Binding(get: { address.url }, set: { pairing.select($0) })) {
        ForEach(all) { a in Text("\(a.host)  \(a.source.label)").tag(a.url) }
      }
      .labelsHidden()
      .pickerStyle(.menu)
      .accessibilityLabel("Server address")
    } else {
      Text(address.host).font(.omni(size: 12.5, design: .monospaced)).lineLimit(1).truncationMode(.middle)
    }
  }

  private func issuedCode(_ issued: IosPairingModel.Issued) -> some View {
    HStack(alignment: .top, spacing: z(20)) {
      QRCodeView(text: issued.payload)
        .frame(width: z(220), height: z(220))
      VStack(alignment: .leading, spacing: z(12)) {
        Text("Open Omni on your iPhone and scan this code.")
          .font(.omni(size: 13)).foregroundStyle(Tok.fg2)
          .fixedSize(horizontal: false, vertical: true)
        VStack(alignment: .leading, spacing: z(4)) {
          Text("Or enter the address above and this code in the app")
            .font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
          Text(issued.code)
            .font(.omni(size: 15, design: .monospaced)).tracking(0.3)
            .foregroundStyle(Tok.fg)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
        TimelineView(.periodic(from: .now, by: 1)) { context in
          let left = IosPairing.secondsLeft(issued.expiresAt, now: context.date)
          InfoRows {
            InfoRow("Expires", value: "in \(IosPairing.clock(left))")
          }
          .onChange(of: left, initial: true) { _, _ in pairing.expireIfNeeded(now: context.date) }
        }
        HStack(spacing: z(8)) {
          Button("New Code") { Task { await pairing.issue() } }
            .buttonStyle(.pill(.secondary, height: 28))
            .disabled(pairing.isBusy)
          Button("Hide") { pairing.hide() }
            .buttonStyle(.pill(.ghost, height: 28))
        }
      }
    }
  }
}

/// The address field of "Use another address": an HTTPS name typed in, checked by OmniKit's IosPairing before it is used.
struct AddressEntry: View {
  let pairing: IosPairingModel
  @State private var draft = ""
  @State private var problem: String?

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      FieldLabel(text: "HTTPS address", hint: "For Tailscale, run `tailscale serve --bg 4747` and enter your https://<mac>.<tailnet>.ts.net name.")
      HStack(spacing: z(8)) {
        TextField("HTTPS address", text: $draft, prompt: Text(verbatim: "https://mac.tailnet.ts.net"))
          .textFieldStyle(.omniMono)
          .onSubmit(use)
        Button("Use Address", action: use)
          .buttonStyle(.pill(.secondary, height: 28))
      }
      if let problem {
        ErrorNote(text: problem)
      }
    }
  }

  private func use() {
    problem = pairing.useAddress(draft)
    if problem == nil { draft = "" }
  }
}

/// A QR code, black on white in both appearances with room for the quiet zone scanners need: a themed code would not
/// scan in dark mode. The Web UI draws the same code in QrCode.tsx.
struct QRCodeView: View {
  let text: String
  @State private var image: NSImage?

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: z(12), style: .continuous).fill(Color.white)
      if let image {
        Image(nsImage: image)
          .interpolation(.none)
          .resizable()
          .scaledToFit()
          .padding(z(20))
      }
    }
    .accessibilityElement()
    .accessibilityLabel("QR code for pairing the Omni iOS app")
    .task(id: text) { image = Self.render(text) }
  }

  private static func render(_ text: String) -> NSImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    let scaled = output.samplingNearest().transformed(by: CGAffineTransform(scaleX: 10, y: 10))
    guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
    return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
  }
}
