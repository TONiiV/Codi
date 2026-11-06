import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

export const HARNESSES = ["claude", "codex", "cursor", "opencode"] as const;
export type HarnessName = (typeof HARNESSES)[number];

const McpServer = Schema.Struct({
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  transport: Schema.optional(Schema.Literal("sse")),
  bearerTokenEnv: Schema.optional(Schema.String),
});
export type McpServer = typeof McpServer.Type;
export type McpServers = Readonly<Record<string, McpServer>>;

const McpFile = Schema.fromJsonString(
  Schema.Struct({ servers: Schema.Record(Schema.String, McpServer) }),
  { space: 2 },
);

const SkillName = Schema.String.check(Schema.isPattern(/^(?!\.\.?$)[\w.-]+$/u));

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    name: Schema.String,
    createdAt: Schema.String,
    skills: Schema.Array(SkillName),
  }),
  { space: 2 },
);

const encodeManifest = Schema.encodeEffect(Manifest);
const decodeManifest = Schema.decodeEffect(Manifest);
const encodeMcpFile = Schema.encodeEffect(McpFile);
const decodeMcpFile = Schema.decodeEffect(McpFile);

const PACK_FILES = { manifest: "pack.json", instructions: "instructions.md", mcp: "mcp.json" };

export interface Pack {
  readonly instructions: string;
  readonly skills: ReadonlyArray<{ readonly name: string; readonly dir: string }>;
  readonly mcp: McpServers;
}

export class ContextPackFormatError extends Schema.TaggedError<ContextPackFormatError>()(
  "ContextPackFormatError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not parse ${this.path}.`;
  }
}

export class ContextPackPathError extends Schema.TaggedError<ContextPackPathError>()(
  "ContextPackPathError",
  { path: Schema.String },
) {
  override get message(): string {
    return `${this.path} resolves outside the context pack.`;
  }
}

export class ContextPackOverlapError extends Schema.TaggedError<ContextPackOverlapError>()(
  "ContextPackOverlapError",
  { path: Schema.String, source: Schema.String },
) {
  override get message(): string {
    return `${this.path} overlaps ${this.source}. Keep the context pack directory outside the project.`;
  }
}

const formatErrorAt = (path: string) =>
  Effect.mapError((cause: Schema.SchemaError) => new ContextPackFormatError({ path, cause }));

type HarnessEffect<A> = Effect.Effect<
  A,
  PlatformError | ContextPackFormatError,
  FileSystem.FileSystem | Path.Path
>;

export interface HarnessSpec {
  readonly instructions: {
    readonly read: (dir: string) => HarnessEffect<string | undefined>;
    readonly write: (dir: string, text: string, merge: boolean) => HarnessEffect<void>;
  };
  // Written to the first directory, read from all of them.
  readonly skillsDirs: readonly [string, ...Array<string>];
  readonly mcp: {
    readonly file: string;
    readonly read: (text: string) => McpServers;
    readonly write: (existing: string | undefined, servers: McpServers, merge: boolean) => string;
  };
}

export type Harness = ReturnType<typeof makeHarness>;

// Helpers below run inside the ContextPackService.export/import spans, so they stay untraced.
export const makeHarness = (spec: HarnessSpec) => {
  const parse = <A>(path: string, run: () => A) =>
    Effect.try({ try: run, catch: (cause) => new ContextPackFormatError({ path, cause }) });
  return {
    // `root` is a real path; skills resolving outside it are skipped.
    read: Effect.fnUntraced(function* (root: string) {
      const path = yield* Path.Path;
      const mcpFile = path.join(root, spec.mcp.file);
      const mcpText = yield* readOptionalText(mcpFile);
      const skills: Array<Pack["skills"][number]> = [];
      for (const dir of spec.skillsDirs) {
        for (const skill of yield* readSkills(path.join(root, dir), root)) {
          if (!skills.some((s) => s.name === skill.name)) skills.push(skill);
        }
      }
      return {
        instructions: ((yield* spec.instructions.read(root)) ?? "")
          .replace(IMPORTED, "\n")
          .trimStart(),
        skills,
        mcp: mcpText === undefined ? {} : yield* parse(mcpFile, () => spec.mcp.read(mcpText)),
      } satisfies Pack;
    }),
    write: Effect.fnUntraced(function* (pack: Pack, dir: string, merge: boolean) {
      const path = yield* Path.Path;
      yield* writeSkills(pack.skills, path.join(dir, spec.skillsDirs[0]));
      yield* spec.instructions.write(dir, pack.instructions, merge);
      const mcpFile = path.join(dir, spec.mcp.file);
      const existing = yield* readOptionalText(mcpFile);
      if (existing === undefined && Object.keys(pack.mcp).length === 0) return;
      const text = yield* parse(mcpFile, () => spec.mcp.write(existing, pack.mcp, merge));
      yield* writeText(mcpFile, text);
    }),
  };
};

export const markdownInstructions = (file: string): HarnessSpec["instructions"] => ({
  read: Effect.fnUntraced(function* (dir) {
    return yield* readOptionalText((yield* Path.Path).join(dir, file));
  }),
  write: Effect.fnUntraced(function* (dir, text, merge) {
    const target = (yield* Path.Path).join(dir, file);
    yield* writeText(target, mergeInstructions(yield* readOptionalText(target), text, merge));
  }),
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const objectAt = (value: unknown): Json => (isObject(value) ? value : {});
export const stringAt = (value: unknown) => (typeof value === "string" ? value : undefined);
export const stringsAt = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
export const keysAt = (value: unknown) => (isObject(value) ? Object.keys(value) : undefined);
// Matches `Bearer ${X}`, `Bearer ${env:X}` and `Bearer {env:X}`; any other header value is dropped.
export const bearerEnvAt = (headers: unknown) =>
  /^Bearer \$?\{(?:env:)?(\w+)\}$/.exec(stringAt(objectAt(headers).Authorization) ?? "")?.[1];

export const envPlaceholders = (
  names: ReadonlyArray<string> | undefined,
  render: (name: string) => string,
) => (names?.length ? Object.fromEntries(names.map((name) => [name, render(name)])) : undefined);

export const bearerHeaders = (name: string | undefined, render: (name: string) => string) =>
  name === undefined ? undefined : { Authorization: `Bearer ${render(name)}` };

const mapValues = <A, B>(record: Readonly<Record<string, A>>, f: (a: A) => B) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, f(value)]));

// Servers live under one key of a JSON file the harness may share with other settings.
export const jsonMcp = (
  file: string,
  key: string,
  toNative: (server: McpServer) => Json,
  fromNative: (native: Json) => McpServer = (native) => ({
    command: stringAt(native.command),
    args: stringsAt(native.args),
    env: keysAt(native.env),
    url: stringAt(native.url),
    transport: native.type === "sse" ? "sse" : undefined,
    bearerTokenEnv: bearerEnvAt(native.headers),
  }),
): HarnessSpec["mcp"] => ({
  file,
  read: (text) =>
    mapValues(objectAt(objectAt(JSON.parse(text))[key]), (v) => fromNative(objectAt(v))),
  write: (existing, servers, merge) => {
    const doc = existing === undefined ? {} : objectAt(JSON.parse(existing));
    const native = mapValues(servers, toNative);
    doc[key] = merge ? { ...objectAt(doc[key]), ...native } : native;
    return `${JSON.stringify(doc, null, 2)}\n`;
  },
});

const readOptionalText = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(file)) ? yield* fs.readFileString(file) : undefined;
});

export const writeText = Effect.fnUntraced(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory((yield* Path.Path).dirname(file), { recursive: true });
  yield* fs.writeFileString(file, text);
});

const BLOCK = /<!-- context-pack:begin -->[\s\S]*?<!-- context-pack:end -->/;
// The block an earlier merge import wrote belongs to that pack, so export leaves it out.
const IMPORTED = /\n*<!-- context-pack:begin -->[\s\S]*?<!-- context-pack:end -->\n?/g;

// Merge keeps the harness file and swaps only the block a previous import wrote.
export const mergeInstructions = (existing: string | undefined, text: string, merge: boolean) => {
  if (!merge) return text;
  const block = `<!-- context-pack:begin -->\n${text.trim()}\n<!-- context-pack:end -->`;
  if (existing !== undefined && BLOCK.test(existing)) return existing.replace(BLOCK, () => block);
  return existing?.trim() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
};

const isInside = (path: Path.Path, root: string, file: string) => {
  const rel = path.relative(root, file);
  return !(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
};

// Resolves links; undefined when the target is missing or outside `root` (a real path).
export const realPathInside = Effect.fnUntraced(function* (root: string, file: string) {
  const path = yield* Path.Path;
  const real = yield* (yield* FileSystem.FileSystem)
    .realPath(file)
    .pipe(Effect.orElseSucceed(() => undefined));
  return real !== undefined && isInside(path, root, real) ? real : undefined;
});

// The real path `file` has or would have once created, resolving links in its existing parents.
const plannedRealPath: (
  file: string,
) => Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> = Effect.fnUntraced(
  function* (file) {
    const path = yield* Path.Path;
    const real = yield* (yield* FileSystem.FileSystem)
      .realPath(file)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (real !== undefined || path.dirname(file) === file) return real ?? file;
    return path.join(yield* plannedRealPath(path.dirname(file)), path.basename(file));
  },
);

// Writing either directory would clobber the other when one lies inside the other.
export const assertSeparate = Effect.fnUntraced(function* (packDir: string, projectDir: string) {
  const path = yield* Path.Path;
  const pack = yield* plannedRealPath(packDir);
  const project = yield* plannedRealPath(projectDir);
  if (isInside(path, project, pack) || isInside(path, pack, project)) {
    return yield* new ContextPackOverlapError({ path: pack, source: project });
  }
});

const readSkills = Effect.fnUntraced(function* (skillsDir: string, root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(skillsDir))) return [];
  const names = (yield* fs.readDirectory(skillsDir)).toSorted();
  const skills: Array<Pack["skills"][number]> = [];
  for (const name of names) {
    const entry = path.join(skillsDir, name);
    const dir = yield* realPathInside(root, entry);
    if (dir === undefined && (yield* fs.exists(entry))) {
      yield* Effect.logWarning(`Skipped skill ${entry}: it resolves outside ${root}.`);
    }
    if (dir !== undefined && (yield* fs.exists(path.join(dir, "SKILL.md")))) {
      skills.push({ name, dir });
    }
  }
  return skills;
});

// Copies file contents, never links: a link is followed only while it stays inside the skill.
const copyTree: (
  from: string,
  to: string,
  root: string,
  ancestors: ReadonlyArray<string>,
) => Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fnUntraced(
  function* (from, to, root, ancestors) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(to, { recursive: true });
    for (const name of (yield* fs.readDirectory(from)).toSorted()) {
      const real = yield* realPathInside(root, path.join(from, name));
      if (real === undefined || ancestors.includes(real)) continue;
      const info = yield* fs.stat(real);
      if (info.type === "Directory") {
        yield* copyTree(real, path.join(to, name), root, [...ancestors, real]);
      } else if (info.type === "File") {
        yield* fs.writeFile(path.join(to, name), yield* fs.readFile(real));
      }
    }
  },
);

const writeSkills = Effect.fnUntraced(function* (skills: Pack["skills"], skillsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Second guard behind assertSeparate, for harness dirs that link into the pack or the project.
  for (const skill of skills) {
    const target = yield* plannedRealPath(path.join(skillsDir, skill.name));
    const source = skills.find(
      (s) => isInside(path, s.dir, target) || isInside(path, target, s.dir),
    );
    if (source) return yield* new ContextPackOverlapError({ path: target, source: source.dir });
  }
  for (const skill of skills) {
    const target = path.join(skillsDir, skill.name);
    yield* fs.remove(target, { recursive: true, force: true });
    yield* copyTree(skill.dir, target, skill.dir, [skill.dir]);
  }
});

export const writePackDir = Effect.fn("ContextPack.writePackDir")(function* (
  pack: Pack,
  outDir: string,
  meta: Pick<typeof Manifest.Type, "name" | "createdAt">,
) {
  const path = yield* Path.Path;
  yield* writeSkills(pack.skills, path.join(outDir, "skills"));
  const manifest: typeof Manifest.Type = {
    version: 1,
    ...meta,
    skills: pack.skills.map((skill) => skill.name),
  };
  yield* writeText(
    path.join(outDir, PACK_FILES.manifest),
    yield* encodeManifest(manifest).pipe(Effect.orDie),
  );
  yield* writeText(path.join(outDir, PACK_FILES.instructions), pack.instructions);
  const mcp = yield* encodeMcpFile({ servers: pack.mcp }).pipe(Effect.orDie);
  yield* writeText(path.join(outDir, PACK_FILES.mcp), mcp);
});

// A pack is untrusted input: every file it supplies must resolve inside the pack.
export const readPackDir = Effect.fn("ContextPack.readPackDir")(function* (packDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(packDir);
  const read = Effect.fnUntraced(function* (name: string) {
    const file = path.join(root, name);
    const real = yield* realPathInside(root, file);
    if (real !== undefined) return yield* fs.readFileString(real);
    if (yield* fs.exists(file)) return yield* new ContextPackPathError({ path: file });
    return yield* fs.readFileString(file);
  });
  const manifest = yield* decodeManifest(yield* read(PACK_FILES.manifest)).pipe(
    formatErrorAt(path.join(root, PACK_FILES.manifest)),
  );
  const mcp = yield* decodeMcpFile(yield* read(PACK_FILES.mcp)).pipe(
    formatErrorAt(path.join(root, PACK_FILES.mcp)),
  );
  const skills = (yield* readSkills(path.join(root, "skills"), root)).filter((s) =>
    manifest.skills.includes(s.name),
  );
  const instructions = yield* read(PACK_FILES.instructions);
  return { instructions, skills, mcp: mcp.servers } satisfies Pack;
});
