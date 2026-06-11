import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../../core/errors.ts";
import { type AgentRuntime, type AgentRuntimeOptions, createAgentRuntime } from "../../agent-runtime.ts";
import type { CesrBodyMode } from "../../cesr-http.ts";
import type { Hab, Habery } from "../../habbing.ts";
import { setupHby } from "./existing.ts";

/** Common store-location and unlock arguments shared by existing-store CLI commands. */
export interface CommandStoreArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

/** Safe existing-habery open options forwarded through CLI context helpers. */
export interface CommandHaberyOptions {
  compat?: boolean;
  readonly?: boolean;
  skipConfig?: boolean;
  skipSignator?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
  /**
   * Internal lifecycle seam for focused helper tests and specialized adapters.
   *
   * Normal command code should not set this; use the default production openers.
   */
  dependencies?: CommandContextDependencies;
}

/** Dependency overrides for lifecycle helper tests and narrow host adapters. */
export interface CommandContextDependencies {
  setupHby?: typeof setupHby;
  createAgentRuntime?: typeof createAgentRuntime;
}

/** Opened existing habery context. */
export interface HaberyContext {
  hby: Habery;
}

/** Opened existing habery plus command-local runtime context. */
export interface AgentRuntimeContext extends HaberyContext {
  runtime: AgentRuntime;
}

/** Opened existing habery, command-local runtime, and selected local habitat. */
export interface HabAgentRuntimeContext extends AgentRuntimeContext {
  hab: Hab;
}

type ContextUse<TContext, TResult> = (context: TContext) => Operation<TResult>;

/** Open an existing Habery for one CLI command and close it after the callback. */
export function* withExistingHabery<TResult>(
  args: CommandStoreArgs,
  options: CommandHaberyOptions,
  use: ContextUse<HaberyContext, TResult>,
): Operation<TResult> {
  const name = requireName(args.name);
  const { dependencies: _, ...openOptions } = options;
  const hby = yield* (options.dependencies?.setupHby ?? setupHby)(
    name,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      ...openOptions,
      compat: options.compat ?? args.compat ?? false,
    },
  );

  try {
    return yield* use({ hby });
  } finally {
    yield* hby.close();
  }
}

/** Open an existing Habery plus local AgentRuntime and close runtime before Habery. */
export function* withAgentRuntime<TResult>(
  args: CommandStoreArgs,
  options: CommandHaberyOptions,
  use: ContextUse<AgentRuntimeContext, TResult>,
): Operation<TResult> {
  return yield* withExistingHabery(args, options, function*({ hby }) {
    const runtime = yield* (options.dependencies?.createAgentRuntime ?? createAgentRuntime)(
      hby,
      localRuntimeOptions(),
    );
    try {
      return yield* use({ hby, runtime });
    } finally {
      yield* runtime.close();
    }
  });
}

/** Open an existing Habery, local AgentRuntime, and required local habitat alias. */
export function* withHabAndAgentRuntime<TResult>(
  args: CommandStoreArgs,
  alias: string | undefined,
  options: CommandHaberyOptions,
  use: ContextUse<HabAgentRuntimeContext, TResult>,
): Operation<TResult> {
  const requiredAlias = requireAlias(alias);
  return yield* withAgentRuntime(args, options, function*({ hby, runtime }) {
    const hab = hby.habByName(requiredAlias);
    if (!hab?.pre) {
      throw new ValidationError(`Alias ${requiredAlias} is invalid`);
    }
    return yield* use({ hby, runtime, hab });
  });
}

function requireName(name: string | undefined): string {
  if (!name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  return name;
}

function requireAlias(alias: string | undefined): string {
  if (!alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  return alias;
}

function localRuntimeOptions(): AgentRuntimeOptions {
  return { mode: "local" };
}
