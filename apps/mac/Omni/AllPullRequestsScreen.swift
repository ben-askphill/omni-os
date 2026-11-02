/// `#/prs`: every channel's PRs, searched, sorted, filtered and grouped by `PRQuery`. A row opens the PR on GitHub.
/// After AllPRs.tsx.
struct AllPullRequestsScreen: View {
  let model: AppModel
  @State private var result: Result<AllPullRequests, OmniAPIError>?
  @State private var reloading = false
  @State private var query = PRQuery()

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        OmniPageHeader(title: "Pull requests", subtitle: "Every channel’s repo.") { EmptyView() }
          .padding(.top, z(40))
          .padding(.bottom, z(24))
        content
      }
      .frame(maxWidth: z(896))
      .padding(.horizontal, z(32))
      .padding(.bottom, z(64))
      .frame(maxWidth: .infinity)
    }
    .task(id: model.client.baseURL) {
      result = nil
      await load()
    }
  }

  @ViewBuilder private var content: some View {
    switch result {
    case nil:
      LoadingNote(label: "Asking GitHub")
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let all):
      switch all.empty {
      case .noRepos?:
        EmptyNote(symbol: "pr", title: "No pull requests", message: "No channel has a GitHub repo. Set a repo path in a channel’s settings and its PRs show here.")
      case .allFailed?:
        ErrorNote(text: all.failedText) { Task { await load() } }
      case .nothingYet?:
        EmptyNote(symbol: "pr", title: "No pull requests", message: "No pull requests yet.")
      case nil:
        VStack(alignment: .leading, spacing: z(12)) {
          PullRequestToolbar(query: $query, prs: all.prs, repos: all.repos, reloading: reloading) { Task { await load() } }
          if !all.failed.isEmpty { ErrorNote(text: all.failedText) }
          let groups = query.groups(all.prs, viewer: all.viewer)
          if groups.isEmpty {
            EmptyNote(symbol: "search", title: "No match",
                      message: query.isNarrowed ? "No pull request matches this search and these filters." : "No pull requests in \(query.repo ?? "this repo").") {
              if query.isNarrowed {
                Button("Clear search and filters") {
                  query.search = ""
                  query.filters = [:]
                }
                .buttonStyle(.pill(.secondary, height: 28))
              }
            }
          }
          ForEach(groups) { g in
            VStack(alignment: .leading, spacing: 0) {
              PullRequestGroupHead(group: g).padding(.horizontal, z(14)).padding(.top, z(8)).padding(.bottom, z(4))
              ForEach(g.prs) { pr in
                if let url = URL(string: pr.url) {
                  Link(destination: url) { AllPullRequestRow(pr: pr) }
                    .buttonStyle(.plain)
                }
              }
            }
          }
        }
      }
    }
  }

  private func load() async {
    reloading = true
    defer { reloading = false }
    let r = await attempt { () async throws(OmniAPIError) in try await model.client.allPullRequests() }
    if case .failure(.cancelled) = r { return }
    result = r
  }
}

private struct AllPullRequestRow: View {
  let pr: AllPullRequests.Listed

  var body: some View {
    VStack(alignment: .leading, spacing: z(3)) {
      HStack(spacing: z(8)) {
        PRStateIcon(state: pr.state, isDraft: pr.isDraft)
        Text(pr.title).font(.omni(size: 14, weight: .medium)).foregroundStyle(Tok.fg).lineLimit(1)
        Text("#\(pr.number)").font(.omni(size: 11.5)).monospacedDigit().foregroundStyle(Tok.fg4)
        Chip(text: pr.badge, tone: pr.badge == "open" ? .live : pr.badge == "merged" ? .done : .outline)
        Spacer(minLength: z(8))
        ChecksSummary(checks: pr.checks)
      }
      HStack(spacing: z(12)) {
        Text(pr.repo).font(.omni(size: 11.5, design: .monospaced)).lineLimit(1)
        Text(pr.author?.login ?? "unknown")
        ForEach(pr.labels, id: \.self) { Chip(text: $0, tone: .outline) }
        Spacer(minLength: z(8))
        Text(Format.relTime(pr.updatedAt)).font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg4)
      }
      .font(.omni(size: 12))
      .foregroundStyle(Tok.fg3)
      .padding(.leading, z(22))
    }
    .padding(.horizontal, z(14))
    .padding(.vertical, z(12))
    .contentShape(RoundedRectangle(cornerRadius: z(18), style: .continuous))
    .hoverWash()
    .accessibilityElement(children: .combine)
  }
}

/// Search, sort, filters, the repo to list and refresh, as PRToolbar.tsx. The search takes what the pills leave.
private struct PullRequestToolbar: View {
  @Binding var query: PRQuery
  let prs: [ListedPR]
  let repos: [String]
  let reloading: Bool
  let refresh: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(spacing: z(8)) {
        HStack(spacing: z(8)) {
          OmniIcon(name: "search", size: 14).foregroundStyle(Tok.fg4)
          TextField("", text: $query.search, prompt: Text("Search pull requests, or label:bug"))
            .textFieldStyle(.plain)
            .font(.omni(size: 13))
            .onExitCommand { query.search = "" }
            .accessibilityLabel("Search pull requests")
        }
        .padding(.horizontal, z(12))
        .frame(height: z(32))
        .background(Tok.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Tok.line))
        sortMenu
        filterMenu
        repoMenu
        Button(action: refresh) {
          if reloading { Loader(size: 12) } else { OmniIcon(name: "refresh", size: 14) }
        }
        .buttonStyle(.pill(.secondary, height: 32))
        .disabled(reloading)
        .help("Refresh")
        .accessibilityLabel("Refresh")
      }
      if !query.picked.isEmpty { pickedChips }
    }
  }

  private var sortMenu: some View {
    Menu {
      Picker("Sort", selection: $query.sort) {
        ForEach(PRSort.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: query.sort.label) { PillIcon(name: "sort") }
    }
    .pillMenu()
    .accessibilityLabel("Sort: \(query.sort.label)")
  }

  private var filterMenu: some View {
    let scoped = query.inScope(prs)
    return Menu {
      ForEach(PRFacet.allCases, id: \.self) { facet in
        let options = facet.options(for: scoped, picked: query.filters[facet] ?? [])
        if !options.isEmpty {
          Section(facet.title) {
            ForEach(options, id: \.value) { o in
              Toggle("\(o.label)  \(o.count)", isOn: Binding(
                get: { query.filters[facet]?.contains(o.value) ?? false },
                set: { _ in query.toggle(facet, o.value) }))
            }
          }
        }
      }
      if query.filterCount > 0 {
        Divider()
        Button("Clear filters") { query.filters = [:] }
      }
    } label: {
      PickerPill(text: query.filterCount > 0 ? "Filters · \(query.filterCount)" : "Filters", chevron: false) { PillIcon(name: "sliders") }
    }
    .pillMenu()
    .accessibilityLabel(query.filterCount > 0 ? "Filters, \(query.filterCount) on" : "Filters")
  }

  private var repoMenu: some View {
    Menu {
      Picker("Repo", selection: $query.repo) {
        Text("All").tag(String?.none)
        ForEach(repos, id: \.self) { Text($0).tag(String?.some($0)) }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: query.repo ?? "All") { PillIcon(name: "plug") }
    }
    .pillMenu()
    .accessibilityLabel("Repo: \(query.repo ?? "All")")
  }

  /// One chip per picked filter. A press removes it.
  private var pickedChips: some View {
    HStack(spacing: z(6)) {
      ForEach(query.picked) { p in
        Button { query.toggle(p.facet, p.value) } label: {
          Chip(text: "\(p.facet.title) \(p.label) ×")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(p.facet.title) \(p.label)")
      }
      Button("Clear") { query.filters = [:] }
        .buttonStyle(.plain)
        .font(.omni(size: 11.5, weight: .medium))
        .foregroundStyle(Tok.fg3)
    }
  }
}

/// A group's line: its icon, name and how many it shows, then a rule.
private struct PullRequestGroupHead: View {
  let group: PRGroup

  var body: some View {
    HStack(spacing: z(8)) {
      OmniIcon(name: group.key.icon, size: 14)
      Text(group.key.label)
      Text("\(group.prs.count)").monospacedDigit().foregroundStyle(Tok.fg4)
      Rectangle().fill(Tok.line).frame(height: 1)
    }
    .font(.omni(size: 12, weight: .medium))
    .foregroundStyle(Tok.fg3)
    .accessibilityElement(children: .combine)
  }
}
