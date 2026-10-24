import OmniKit
import SwiftUI

/// How the app shows one kind of message context (OmniKit's `MessageContextKind`): its icon and what its chip opens to.
/// The chip, the inspector, the fallback and the draft are shared (MessageContextChips.swift).
protocol MessageContextView: SendableMetatype {
  associatedtype Kind: MessageContextKind
  associatedtype Detail: View
  /// An `OmniIcon` name.
  static var icon: String { get }
  @MainActor static func detail(_ body: Kind.Body, record: MessageContext) -> Detail
}

/// Every kind the app shows, one line each. A kind missing here reads as a fallback chip.
let contextViews: [any MessageContextView.Type] = [DiffSelectionView.self]

/// The kinds the app reads, from `contextViews`.
let contextKinds: [any MessageContextKind.Type] = contextViews.map { $0.kindType }

extension MessageContextView {
  static var kindType: any MessageContextKind.Type { Kind.self }

  /// The kind's own label for a body this kind read.
  static func label(_ body: Any) -> String? {
    (body as? Kind.Body).map(Kind.label)
  }

  @MainActor static func detailView(_ body: Any, record: MessageContext) -> AnyView? {
    (body as? Kind.Body).map { AnyView(detail($0, record: record)) }
  }
}

/// The view of a record's kind, when the app has one.
func contextView(for kind: String) -> (any MessageContextView.Type)? {
  contextViews.first { $0.kindType.kind == kind }
}
