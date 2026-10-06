import Foundation

/// What the new-thread composer will start: the pickers' state. `role` and `effort` are "" for none and default,
/// `model` is "" until the harness's default is filled in.
public struct NewThreadChoice: Hashable, Sendable {
  public var channel: String
  public var role: String
  public var harness: HarnessID
  public var model: String
  public var effort: String

  public init(channel: String, role: String, harness: HarnessID, model: String, effort: String) {
    self.channel = channel
    self.role = role
    self.harness = harness
    self.model = model
    self.effort = effort
  }
}

/// What a crew role or a channel picks for a new thread's run. nil fields leave it to the harness default.
public struct RunDefaults: Hashable, Sendable {
  public var harness: HarnessID?
  public var model: String?
  public var effort: String?

  public init(harness: HarnessID? = nil, model: String? = nil, effort: String? = nil) {
    self.harness = harness
    self.model = model
    self.effort = effort
  }

  /// Whether it picks anything. `setsRun` in server/harness/resolve.ts.
  public var setsRun: Bool { harness != nil || model?.isEmpty == false || effort?.isEmpty == false }
}

extension CrewRole {
  public var runDefaults: RunDefaults { RunDefaults(harness: harness, model: model, effort: effort) }
}

/// How the pickers move each other, as `NewThreadComposer` in web/src/components/Composer.tsx.
public enum NewThreadRules {
  public static let conductor = "conductor"

  /// A new composer: the channel's own, else Conductor, on Claude Code. Role and model come once crew and harnesses load.
  public static func initial(fixedChannel: String?, defaultChannel: String = conductor) -> NewThreadChoice {
    let channel = fixedChannel ?? defaultChannel
    return NewThreadChoice(channel: channel, role: channel == conductor ? conductor : "", harness: .claudeCode, model: "", effort: "")
  }

  /// The harness's default model, else its first.
  public static func defaultModel(_ harness: HarnessID, in harnesses: [HarnessInfo]) -> String? {
    let models = harnesses.first { $0.id == harness }?.models
    return (models?.first { $0.isDefault } ?? models?.first)?.id
  }

  /// Fills in what arrives after the composer opens: the default model, and the Conductor role in its channel.
  public static func settled(_ choice: NewThreadChoice, crew: [CrewRole], harnesses: [HarnessInfo]) -> NewThreadChoice {
    var c = choice
    if c.model.isEmpty, let model = defaultModel(c.harness, in: harnesses) { c.model = model }
    if c.role.isEmpty, c.channel == conductor, crew.contains(where: { $0.id == conductor }) { c.role = conductor }
    return c
  }

  /// Picking a role presets its channel (unless the channel is fixed), then the run: the role's defaults when it sets any,
  /// else the channel's. "No role" goes back to the channel's.
  public static func selectingRole(
    _ id: String, from choice: NewThreadChoice, crew: [CrewRole], channels: Set<String>, harnesses: [HarnessInfo], channelFixed: Bool,
    defaults: [String: RunDefaults] = [:]
  ) -> NewThreadChoice {
    var c = choice
    c.role = id
    let role = crew.first { $0.id == id }
    if !channelFixed, let channel = role?.channel, channels.contains(channel) { c.channel = channel }
    return preselecting(c, crew: crew, harnesses: harnesses, defaults: defaults)
  }

  /// The Conductor role and channel go together: entering the channel without a role takes it, leaving drops it.
  /// The run is preselected again for the channel and role this leaves.
  public static func selectingChannel(
    _ id: String, from choice: NewThreadChoice, crew: [CrewRole], harnesses: [HarnessInfo], defaults: [String: RunDefaults]
  ) -> NewThreadChoice {
    var c = choice
    c.channel = id
    if id == conductor, c.role.isEmpty, crew.contains(where: { $0.id == conductor }) { c.role = conductor }
    if id != conductor, c.role == conductor { c.role = "" }
    return preselecting(c, crew: crew, harnesses: harnesses, defaults: defaults)
  }

  /// The harness, model and effort a new thread starts on, as `runPreselect` in web/src/new-thread-preset.ts: the role's
  /// defaults when it sets any (they replace the channel's whole, as the server resolves), else the channel's, else
  /// Claude Code's default model. A harness the catalog lacks falls back to Claude Code, on its default model.
  public static func preselecting(
    _ choice: NewThreadChoice, crew: [CrewRole], harnesses: [HarnessInfo], defaults: [String: RunDefaults]
  ) -> NewThreadChoice {
    let role = crew.first { $0.id == choice.role }?.runDefaults
    let channel = defaults[choice.channel]
    let d = role?.setsRun == true ? role! : channel?.setsRun == true ? channel! : RunDefaults()
    var c = choice
    let named = d.harness ?? .claudeCode
    c.harness = harnesses.contains { $0.id == named } ? named : .claudeCode
    c.model = (c.harness == named ? d.model.flatMap { $0.isEmpty ? nil : $0 } : nil) ?? defaultModel(c.harness, in: harnesses) ?? ""
    c.effort = d.effort ?? ""
    return c
  }

  /// A new model resets effort to its default.
  public static func selectingModel(harness: HarnessID, model: String, from choice: NewThreadChoice) -> NewThreadChoice {
    var c = choice
    c.harness = harness
    c.model = model
    c.effort = ""
    return c
  }

  /// The POST /api/threads body: role, model and effort left out when default. An effort the model does not take is left out.
  public static func request(_ choice: NewThreadChoice, prompt: String, harnesses: [HarnessInfo]) -> NewThread {
    let model = harnesses.first { $0.id == choice.harness }?.models.first { $0.id == choice.model }
    let effort = model.map { EffortRules.resolved(choice.effort, for: $0) } ?? choice.effort
    return NewThread(
      channel: choice.channel, prompt: prompt, role: choice.role.isEmpty ? nil : choice.role,
      model: choice.model.isEmpty ? nil : choice.model, harness: choice.harness, effort: effort.isEmpty ? nil : effort)
  }
}

public struct EffortOption: Hashable, Sendable, Identifiable {
  /// "" is the model's default.
  public let value: String
  public let label: String
  public var id: String { value }
}

public enum EffortRules {
  /// Default, then the model's levels. Empty when the model has none: the picker reads "Auto effort", disabled.
  public static func options(for model: ModelEntry?) -> [EffortOption] {
    guard let model, !model.efforts.isEmpty else { return [] }
    let def = EffortOption(value: "", label: model.defaultEffort.map { "Default (\($0))" } ?? "Default")
    return [def] + model.efforts.map { EffortOption(value: $0, label: $0) }
  }

  /// The model whose levels apply: the one picked, or with none ("") the harness's default.
  public static func model(harness: HarnessID, model: String, in harnesses: [HarnessInfo]) -> ModelEntry? {
    let info = harnesses.first { $0.id == harness }
    if !model.isEmpty { return info?.models.first { $0.id == model } }
    return info?.models.first { $0.isDefault } ?? info?.models.first
  }

  /// The level if the model takes it, else "" for the default.
  public static func resolved(_ effort: String, for model: ModelEntry?) -> String {
    guard let model, model.efforts.contains(effort) else { return "" }
    return effort
  }
}

/// The model and effort a reply composer shows. They are fixed once a thread starts, so this only names them.
/// An empty model is the harness default. An empty effort is that model's default. `threadRunLabels` in web/src/thread-run.ts is the same.
public struct ThreadRunLabels: Hashable, Sendable {
  public let model: String
  public let harnessName: String
  public let effort: String

  public init(model: String, harnessName: String, effort: String) {
    self.model = model
    self.harnessName = harnessName
    self.effort = effort
  }

  public static func make(harness: HarnessID, model: String?, effort: String?, harnesses: [HarnessInfo]) -> ThreadRunLabels {
    let info = harnesses.first { $0.id == harness }
    let picked = model.flatMap { id in info?.models.first { $0.id == id } }
    let entry = picked ?? (model == nil ? info?.models.first { $0.isDefault } ?? info?.models.first : nil)
    return ThreadRunLabels(
      model: entry?.label ?? model ?? "default",
      harnessName: info?.name ?? ThreadDetails.harnessName(harness),
      effort: effortText(effort, model: entry, catalog: info != nil))
  }

  private static func effortText(_ effort: String?, model: ModelEntry?, catalog: Bool) -> String {
    guard catalog, let model else { return (effort?.isEmpty == false ? effort : nil) ?? "default" }
    if model.efforts.isEmpty { return "Auto effort" }
    if let effort, !effort.isEmpty { return effort }
    if let def = model.defaultEffort { return "Default (\(def))" }
    return "Default"
  }
}

public struct ModelGroup: Hashable, Sendable, Identifiable {
  public let harness: HarnessInfo
  public let models: [ModelEntry]
  public var id: HarnessID { harness.id }
}

public enum ModelSearch {
  /// Every harness with the models matching `query` in their label, id, or the harness's name or plan. A harness stays in the list when nothing matches.
  public static func groups(_ harnesses: [HarnessInfo], query: String) -> [ModelGroup] {
    let s = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return harnesses.map { h in
      ModelGroup(
        harness: h,
        models: s.isEmpty ? h.models : h.models.filter { "\($0.label) \($0.id) \(h.name) \(h.plan)".lowercased().contains(s) })
    }
  }
}
