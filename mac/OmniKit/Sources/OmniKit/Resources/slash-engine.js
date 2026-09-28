"use strict";
(() => {
  // shared/slash.ts
  var OMNI_COMMANDS = [
    { name: "clear", description: "Start a new thread with the same settings", source: "omni", mentionable: false },
    { name: "new", description: "Start a new thread with the same settings", source: "omni", mentionable: false },
    { name: "rename", argumentHint: "<title>", description: "Rename this thread", source: "omni", mentionable: false },
    // A thread's model and effort are fixed, so these offer a new thread instead.
    { name: "model", description: "Fixed per thread, so it offers a new thread on another model", source: "omni", mentionable: false },
    { name: "effort", description: "Fixed per thread, so it offers a new thread with another effort", source: "omni", mentionable: false },
    { name: "fast", description: "Fixed per thread, so it offers a new thread on a faster model", source: "omni", mentionable: false }
  ];
  var OMNI_NAMES = new Set(OMNI_COMMANDS.map((c) => c.name));
  var TITLE_MAX = 200;
  var TERMINAL_ONLY = /* @__PURE__ */ new Set([
    "login",
    "logout",
    "config",
    "settings",
    "mcp",
    "resume",
    "continue",
    "exit",
    "quit",
    "color",
    "focus",
    "heapdump",
    "auto-mode-setup",
    "workflow-launch-exec"
  ]);
  var isOmniCommand = (name) => OMNI_NAMES.has(name.toLowerCase());
  var isTerminalOnly = (name) => name.startsWith("__") || TERMINAL_ONLY.has(name.toLowerCase());
  var runnableCommands = (commands) => commands.filter((c) => !isTerminalOnly(c.name));
  var visibleCommands = (commands) => runnableCommands(commands).filter((c) => !isOmniCommand(c.name));
  var NAME = "[A-Za-z0-9][A-Za-z0-9._:-]*";
  var LEAD = new RegExp(`^(\\s*)\\/(${NAME})(?=\\s|$)`);
  var LATER = new RegExp(`(?<=\\s)\\/(${NAME})(?=\\s|$)`, "g");
  function parseSlash(text) {
    const m = LEAD.exec(text);
    let lead = null;
    if (m) {
      const start = m[1].length;
      const end = start + 1 + m[2].length;
      lead = { name: m[2], start, end, args: text.slice(end).replace(/^\s+/, "") };
    }
    const mentions = [...text.matchAll(LATER)].map((x) => ({ name: x[1], start: x.index, end: x.index + x[0].length })).filter((t) => t.start !== lead?.start);
    return { lead, mentions };
  }
  var names = (c) => [c.name, ...c.aliases ?? []];
  function findCommand(name, commands) {
    const lower = name.toLowerCase();
    return commands.find((c) => names(c).includes(name)) ?? commands.find((c) => names(c).some((n) => n.toLowerCase() === lower));
  }
  var omniNamed = (name) => OMNI_COMMANDS.find((c) => c.name === name.toLowerCase());
  function omniCommand(name, commands) {
    const harness = findCommand(name, commands);
    return omniNamed(name) ?? (harness && omniNamed(harness.name));
  }
  function resolveSlash(text, commands) {
    const { lead } = parseSlash(text);
    if (!lead) return null;
    const { name } = lead;
    const omni = omniCommand(name, commands);
    if (omni) return { kind: "omni", name, command: omni, token: lead };
    const command = findCommand(name, commands);
    if (command) return { kind: "harness", name, command, token: lead };
    return { kind: isTerminalOnly(name) ? "terminal" : "unknown", name, token: lead };
  }
  function midMessageCommands(text, commands) {
    return parseSlash(text).mentions.flatMap((t) => {
      if (omniCommand(t.name, commands)) return [{ ...t, kind: "omni" }];
      const c = findCommand(t.name, commands);
      return c && !c.mentionable ? [{ ...t, kind: "builtin" }] : [];
    });
  }
  var hit = ({ name, source, description, argumentHint }, { start, end }) => ({
    name,
    source,
    description,
    ...argumentHint && { argumentHint },
    start,
    end
  });
  function mentionHits(text, commands) {
    return parseSlash(text).mentions.flatMap((t) => {
      const c = omniCommand(t.name, commands) ? void 0 : findCommand(t.name, commands);
      return c?.mentionable ? [hit(c, t)] : [];
    });
  }

  // shared/composer-slash.ts
  var HARNESS_NAME = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor Agent", hermes: "Hermes" };
  var harnessName = (id) => HARNESS_NAME[id] ?? id;
  var menuCommands = (list, where) => [
    ...visibleCommands(list ?? []),
    ...where === "reply" ? OMNI_COMMANDS : []
  ];
  function replySlash(text, list, harness) {
    const r = resolveSlash(text, list?.commands ?? []);
    if (r?.kind === "omni") {
      const args = r.token.args.trim();
      switch (r.command.name) {
        case "clear":
        case "new":
          return {
            action: { kind: "new-thread", prompt: args },
            armed: true,
            label: "New thread",
            hint: args ? "Starts a new thread with this prompt and the same settings. This one stays as it is." : "Opens a new thread with the same settings."
          };
        case "rename": {
          const title = args.replace(/\s+/g, " ");
          const hint = !title ? "Type the new title after /rename." : title.length > TITLE_MAX ? `A title can be up to ${TITLE_MAX} characters. This one is ${title.length}.` : null;
          return { action: { kind: "rename", title }, armed: !!title && !hint, label: "Rename", hint };
        }
        default:
          return { action: { kind: "fixed" }, armed: false, label: null, hint: "The model, effort and fast mode are fixed per thread." };
      }
    }
    return { action: { kind: "send" }, armed: !!text.trim(), label: null, hint: textHint(text, r, list, harness, "reply") };
  }
  function newThreadHint(text, list, harness) {
    const r = resolveSlash(text, list?.commands ?? []);
    if (r?.kind === "omni") return `/${r.name} works in a thread's reply box, so here it sends as text.`;
    return textHint(text, r, list, harness, "new-thread");
  }
  function textHint(text, r, list, harness, where) {
    if (r?.kind === "terminal") return `/${r.name} only works in a ${harnessName(harness)} terminal, so it sends as text.`;
    if (r?.kind === "unknown" && list?.status === "ready") {
      return `No /${r.name} command ${where === "reply" ? "in this thread" : `for ${harnessName(harness)} in this channel`}, so it sends as text.`;
    }
    if (harness === "codex" && r?.kind === "harness" && r.command.name === "compact" && r.token.args.trim()) {
      return "Codex compacts without instructions, so it leaves out the text after /compact.";
    }
    const [late] = midMessageCommands(text, list?.commands ?? []).filter((c) => where === "reply" || c.kind !== "omni");
    if (late) return `/${late.name} only works at the start of a message, so here it stays text.`;
    if (harness !== "claude-code") return null;
    const hits = mentionHits(text, list?.commands ?? []);
    const typed = hits.filter((h, i) => hits.findIndex((o) => o.name === h.name) === i).map((h) => text.slice(h.start, h.end));
    return typed.length ? `Claude Code loads ${and(typed)} only if the model decides to.` : null;
  }
  var and = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

  // shared/slash-menu.ts
  var TYPING = /^(\s*)\/([A-Za-z0-9._:-]*)$/;
  var TYPING_MENTION = /(?<=\s)\/([A-Za-z0-9._:-]*)$/;
  var NAME_REST = /^[A-Za-z0-9._:-]*/;
  function slashQuery(text, caret) {
    const before = text.slice(0, caret);
    const lead = TYPING.exec(before);
    const later = lead ? null : TYPING_MENTION.exec(before);
    if (!lead && !later) return null;
    const end = caret + NAME_REST.exec(text.slice(caret))[0].length;
    if (end < text.length && !/\s/.test(text[end])) return null;
    if (lead) return { query: lead[2], start: lead[1].length, end };
    return { query: later[1], start: later.index, end, mention: true };
  }
  var GROUPS = [
    ["project", "Project"],
    ["personal", "Personal"],
    ["plugin", "Plugins"],
    ["mcp", "MCP"],
    ["builtin", "Built-in"],
    ["omni", "Omni"]
  ];
  var byName = (a, b) => a.name.localeCompare(b.name);
  var DESCRIPTION = 4;
  function rank(c, q) {
    const names2 = [c.name, ...c.aliases ?? []].map((n) => n.toLowerCase());
    if (names2.includes(q)) return 0;
    if (names2.some((n) => n.startsWith(q))) return 1;
    if (names2.some((n) => n.split(/[:._-]/).some((w) => w.startsWith(q)))) return 2;
    if (names2.some((n) => n.includes(q))) return 3;
    if (c.description.toLowerCase().includes(q)) return DESCRIPTION;
    return null;
  }
  var RECENT_ROWS = 5;
  function menuSections(commands, query, recent = []) {
    return sections(commands, query, recent, DESCRIPTION);
  }
  function mentionSections(commands, query, recent = []) {
    return sections(commands.filter((c) => c.mentionable), query, recent, DESCRIPTION - 1);
  }
  function sections(commands, query, recent, worst) {
    const q = query.toLowerCase();
    if (!q) {
      const top = [...new Set(recent)].flatMap((n) => commands.find((c) => c.name === n) ?? []).slice(0, RECENT_ROWS);
      const rest = commands.filter((c) => !top.includes(c));
      return [
        { label: "Recent", commands: top },
        ...GROUPS.map(([source, label]) => ({ label, commands: rest.filter((c) => c.source === source).sort(byName) }))
      ].filter((s) => s.commands.length);
    }
    const used = (c) => {
      const i = recent.indexOf(c.name);
      return i < 0 ? recent.length : i;
    };
    const hits = commands.flatMap((c) => {
      const r = rank(c, q);
      return r === null || r > worst ? [] : [{ c, r }];
    });
    hits.sort((a, b) => a.r - b.r || used(a.c) - used(b.c) || byName(a.c, b.c));
    return hits.length ? [{ label: null, commands: hits.map((h) => h.c) }] : [];
  }
  function pickCommand(text, at, name) {
    const after = text.slice(at.end);
    const insert = `/${name}${/^[ \t]/.test(after) ? "" : " "}`;
    return { text: text.slice(0, at.start) + insert + after, caret: at.start + name.length + 2 };
  }

  // shared/slash-pills.ts
  function slashPieces(text, slash, visible = text.length) {
    const end = Math.min(visible, text.length);
    const hits = [...slash?.command ? [slash.command] : [], ...slash?.mentions ?? []].filter((h) => text[h.start] === "/" && h.start < h.end && h.end <= end).sort((a, b) => a.start - b.start);
    const pieces = [];
    let at = 0;
    for (const h of hits) {
      if (h.start < at) continue;
      if (h.start > at) pieces.push({ text: text.slice(at, h.start) });
      pieces.push({ text: text.slice(h.start, h.end), hit: h });
      at = h.end;
    }
    if (at < end) pieces.push({ text: text.slice(at, end) });
    return pieces;
  }

  // mac/slash-engine/entry.ts
  var call = (f) => (json) => JSON.stringify(f(JSON.parse(json)) ?? null);
  globalThis.OmniSlash = {
    query: call(({ text, caret }) => slashQuery(text, caret)),
    sections: call(
      ({ commands, where, query, mention, recent }) => (mention ? mentionSections : menuSections)(menuCommands(commands, where), query, recent)
    ),
    pick: call(({ text, at, name }) => pickCommand(text, at, name)),
    reply: call(({ text, list, harness }) => replySlash(text, list, harness)),
    newThreadHint: call(({ text, list, harness }) => newThreadHint(text, list, harness)),
    pieces: call(({ text, slash, visible }) => slashPieces(text, slash, visible)),
    omniCommands: call(() => OMNI_COMMANDS)
  };
})();
