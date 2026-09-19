/** Real LLM API required. No mocking. Missing keys = FAIL. */

/**
 * OpenClawPluginApiHarness — faithfully implements OpenClawPluginApi for testing.
 *
 * This is NOT a mock. It records registrations in typed arrays so tests can
 * assert what was registered. The logger writes to stderr only (no stdout
 * pollution). Service lifecycle (start/stop) is driven by the test harness.
 */

import { dirname } from "node:path";
import { bindTestMemory, stopTestMemory } from "./memory-sidecar-fixture.ts";

import type {
	AnyAgentTool,
	MemoryPluginCapability,
	OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

type InternalHookHandler = Parameters<OpenClawPluginApi["registerHook"]>[1];
type RegisterHookOptions = Parameters<OpenClawPluginApi["registerHook"]>[2];
type CliRegistrar = Parameters<OpenClawPluginApi["registerCli"]>[0];
type CliOptions = Parameters<OpenClawPluginApi["registerCli"]>[1];
type OpenClawPluginCommandDefinition = Parameters<OpenClawPluginApi["registerCommand"]>[0];
type OpenClawPluginService = Parameters<OpenClawPluginApi["registerService"]>[0];
type OpenClawPluginTool = Parameters<OpenClawPluginApi["registerTool"]>[0];
type OpenClawPluginToolOptions = Parameters<OpenClawPluginApi["registerTool"]>[1];
declare const pluginOn: OpenClawPluginApi["on"];
type PluginHookName = Parameters<typeof pluginOn>[0];
type PluginHookHandler = Parameters<typeof pluginOn>[1];
type PluginHookHandlerFor<K extends PluginHookName> = Parameters<typeof pluginOn<K>>[1];
type PluginHookOptions = Parameters<typeof pluginOn>[2];
type PluginLogger = OpenClawPluginApi["logger"];
type EmbeddingProviderAdapter = Parameters<
	OpenClawPluginApi["registerEmbeddingProvider"]
>[0];
type HostLlmComplete = OpenClawPluginApi["runtime"]["llm"]["complete"];
type SessionExtensionRegistration = Parameters<
	OpenClawPluginApi["registerSessionExtension"]
>[0];
type SessionActionRegistration = Parameters<
	OpenClawPluginApi["registerSessionAction"]
>[0];
type SessionSchedulerJobRegistration = Parameters<
	OpenClawPluginApi["registerSessionSchedulerJob"]
>[0];
type AgentEventSubscriptionRegistration = Parameters<
	OpenClawPluginApi["registerAgentEventSubscription"]
>[0];
type RuntimeLifecycleRegistration = Parameters<
	OpenClawPluginApi["registerRuntimeLifecycle"]
>[0];
type NextTurnInjection = Parameters<OpenClawPluginApi["enqueueNextTurnInjection"]>[0];

type HookRegistration = {
	hookName: string;
	handler: InternalHookHandler;
	opts: RegisterHookOptions;
};

type CliRegistration = {
	registrar: CliRegistrar;
	opts: CliOptions;
};

type OnRegistration = {
	hookName: PluginHookName;
	handler: PluginHookHandler;
	opts: PluginHookOptions;
};

type HookContext = {
	agentId: string;
	sessionKey: string;
};

const harnessesWithRuntimeServices = new Set<OpenClawPluginApiHarness>();

export async function stopAllOpenClawHarnessServices(): Promise<void> {
	await Promise.all([...harnessesWithRuntimeServices].map((harness) => harness.stopServices()));
}

export class OpenClawPluginApiHarness implements OpenClawPluginApi {
	readonly id = "test-harness";
	readonly name = "Test Harness";
	readonly version = "0.0.0";
	readonly description = "Test harness for mem-claw";
	readonly source = "test";
	readonly registrationMode: OpenClawPluginApi["registrationMode"] = "full";
	readonly rootDir?: string;

	/** Public for assertions */
	readonly registeredTools: AnyAgentTool[] = [];
	readonly registeredCommands: OpenClawPluginCommandDefinition[] = [];
	readonly registeredServices: OpenClawPluginService[] = [];
	readonly registeredHooks: HookRegistration[] = [];
	readonly registeredOnHooks: OnRegistration[] = [];
	readonly registeredCli: CliRegistration[] = [];
	readonly registeredMemoryCapabilities: MemoryPluginCapability[] = [];
	readonly registeredEmbeddingProviders: EmbeddingProviderAdapter[] = [];
	readonly registeredSessionExtensions: SessionExtensionRegistration[] = [];
	readonly registeredSessionActions: SessionActionRegistration[] = [];
	readonly registeredSessionSchedulerJobs: SessionSchedulerJobRegistration[] = [];
	readonly registeredAgentEventSubscriptions: AgentEventSubscriptionRegistration[] = [];
	readonly registeredRuntimeLifecycles: RuntimeLifecycleRegistration[] = [];
	readonly registeredNextTurnInjections: NextTurnInjection[] = [];
	readonly logMessages = {
		debug: [] as string[],
		info: [] as string[],
		warn: [] as string[],
		error: [] as string[],
	};
	private readonly runContextValues = new Map<
		string,
		Map<string, ReturnType<OpenClawPluginApi["getRunContext"]>>
	>();

	readonly logger: PluginLogger = {
		debug: (message: string) => {
			this.logMessages.debug.push(message);
			process.stderr.write(`[debug] ${message}\n`);
		},
		info: (message: string) => {
			this.logMessages.info.push(message);
			process.stderr.write(`[info] ${message}\n`);
		},
		warn: (message: string) => {
			this.logMessages.warn.push(message);
			process.stderr.write(`[warn] ${message}\n`);
		},
		error: (message: string) => {
			this.logMessages.error.push(message);
			process.stderr.write(`[error] ${message}\n`);
		},
	};

	// Use a plain object as the OpenClaw config — tests only need pluginConfig
	readonly config = {} as OpenClawPluginApi["config"];

	readonly pluginConfig: Record<string, unknown>;

	private hostLlmComplete: HostLlmComplete = async () => {
		throw new Error("OpenClawPluginApiHarness runtime.llm.complete was not configured");
	};

	readonly runtime = {
		running: false,
		lastStartAt: null,
		lastStopAt: null,
		lastError: null,
		llm: {
			complete: (params: Parameters<HostLlmComplete>[0]) => this.hostLlmComplete(params),
		},
	} as unknown as OpenClawPluginApi["runtime"];

	readonly session: OpenClawPluginApi["session"] = {
		state: {
			registerSessionExtension: (extension) => this.registerSessionExtension(extension),
		},
		workflow: {
			enqueueNextTurnInjection: (injection) => this.enqueueNextTurnInjection(injection),
			registerSessionSchedulerJob: (job) => this.registerSessionSchedulerJob(job),
			sendSessionAttachment: (params) => this.sendSessionAttachment(params),
			scheduleSessionTurn: (params) => this.scheduleSessionTurn(params),
			unscheduleSessionTurnsByTag: (params) => this.unscheduleSessionTurnsByTag(params),
		},
		controls: {
			registerSessionAction: (action) => this.registerSessionAction(action),
			registerControlUiDescriptor: (descriptor) => this.registerControlUiDescriptor(descriptor),
		},
	};

	readonly agent: OpenClawPluginApi["agent"] = {
		events: {
			registerAgentEventSubscription: (subscription) =>
				this.registerAgentEventSubscription(subscription),
			emitAgentEvent: (params) => this.emitAgentEvent(params),
		},
	};

	readonly runContext: OpenClawPluginApi["runContext"] = {
		setRunContext: (patch) => this.setRunContext(patch),
		getRunContext: (params) => this.getRunContext(params),
		clearRunContext: (params) => this.clearRunContext(params),
	};

	readonly lifecycle: OpenClawPluginApi["lifecycle"] = {
		registerRuntimeLifecycle: (lifecycle) => this.registerRuntimeLifecycle(lifecycle),
	};

	/** Optional workspace dir exposed to hooks via context */
	workspaceDir?: string;
	readonly runtimeAgentId?: string;

	constructor(
		pluginConfig: Record<string, unknown> = {},
		opts?: {
			workspaceDir?: string;
			runtimeAgentId?: string;
			llmComplete?: HostLlmComplete;
		},
	) {
		this.pluginConfig = pluginConfig;
		if (typeof pluginConfig.dbPath === "string") {
			const profileRoot = process.env.SNO_PROFILE_DIR ?? dirname(pluginConfig.dbPath);
			process.env.SNO_PROFILE_DIR = profileRoot;
			bindTestMemory(profileRoot, pluginConfig.dbPath, pluginConfig);
		}
		this.workspaceDir = opts?.workspaceDir;
		this.runtimeAgentId = opts?.runtimeAgentId;
		this.rootDir = opts?.workspaceDir;
		if (opts?.llmComplete) this.hostLlmComplete = opts.llmComplete;
	}

	registerTool(
		tool: OpenClawPluginTool,
		_opts?: OpenClawPluginToolOptions,
	): void {
		if (typeof tool === "function") {
			const instance = tool({
				...(this.runtimeAgentId ? { agentId: this.runtimeAgentId } : {}),
			} as Record<string, unknown>);
			this.registeredTools.push(instance as AnyAgentTool);
		} else {
			this.registeredTools.push(tool);
		}
	}

	registerHook(
		events: string | string[],
		handler: InternalHookHandler,
		opts?: RegisterHookOptions,
	): void {
		const hookNames = Array.isArray(events) ? events : [events];
		for (const hookName of hookNames) {
			this.registeredHooks.push({ hookName, handler, opts });
		}
	}

	registerHttpHandler(_handler: unknown): void {
		// Not used by mem-claw plugin
	}

	registerHttpRoute(_params: unknown): void {
		// Not used by mem-claw plugin
	}

	registerHostedMediaResolver(_resolver: unknown): void {
		// Not used by mem-claw plugin
	}

	registerWidgetPresenter(_presenter: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMcpServerConnectionResolver(_resolver: unknown): void {
		// Not used by mem-claw plugin
	}

	registerChannel(_registration: unknown): void {
		// Not used by mem-claw plugin
	}

	registerGatewayMethod(_method: string, _handler: unknown, _opts?: unknown): void {
		// Not used by mem-claw plugin
	}

	registerBoardWidgetContentKind(_definition: unknown): void {
		// Not used by mem-claw plugin
	}

	registerSessionCatalog(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerCli(registrar: CliRegistrar, opts?: CliOptions): void {
		this.registeredCli.push({ registrar, opts });
	}

	registerNodeCliFeature(registrar: CliRegistrar, opts?: CliOptions): void {
		this.registerCli(registrar, { ...opts, parentPath: ["nodes", ...(opts?.parentPath ?? [])] });
	}

	registerReload(_registration: unknown): void {
		// Not used by mem-claw plugin
	}

	registerNodeHostCommand(_command: unknown): void {
		// Not used by mem-claw plugin
	}

	registerNodeInvokePolicy(_policy: unknown): void {
		// Not used by mem-claw plugin
	}

	registerSecurityAuditCollector(_collector: unknown): void {
		// Not used by mem-claw plugin
	}

	registerService(service: OpenClawPluginService): void {
		this.registeredServices.push(service);
		harnessesWithRuntimeServices.add(this);
	}

	registerGatewayDiscoveryService(_service: unknown): void {
		// Not used by mem-claw plugin
	}

	registerCliBackend(_backend: unknown): void {
		// Not used by mem-claw plugin
	}

	registerTextTransforms(_transforms: unknown): void {
		// Not used by mem-claw plugin
	}

	registerConfigMigration(_migrate: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMigrationProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerAutoEnableProbe(_probe: unknown): void {
		// Not used by mem-claw plugin
	}

	registerWorkerProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryCapability(capability: MemoryPluginCapability): void {
		this.registeredMemoryCapabilities.push(capability);
	}

	registerMemoryPromptSection(_builder: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryPromptSupplement(_builder: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryPromptPreparation(_prepare: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryCorpusSupplement(_supplement: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryFlushPlan(_resolver: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMemoryRuntime(_runtime: unknown): void {
		// Not used by mem-claw plugin
	}

	registerProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerModelCatalogProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerEmbeddingProvider(adapter: EmbeddingProviderAdapter): void {
		this.registeredEmbeddingProviders.push(adapter);
	}

	registerSpeechProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerRealtimeTranscriptionProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerRealtimeVoiceProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMediaUnderstandingProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerTranscriptSourceProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerImageGenerationProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerVideoGenerationProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerMusicGenerationProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerWebFetchProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerWebSearchProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerInteractiveHandler(_registration: unknown): void {
		// Not used by mem-claw plugin
	}

	onConversationBindingResolved(_handler: unknown): void {
		// Not used by mem-claw plugin
	}

	registerCommand(command: OpenClawPluginCommandDefinition): void {
		this.registeredCommands.push(command);
	}

	registerContextEngine(_id: string, _factory: unknown): void {
		// Not used by mem-claw plugin
	}

	registerCompactionProvider(_provider: unknown): void {
		// Not used by mem-claw plugin
	}

	registerAgentHarness(_harness: unknown): void {
		// Not used by mem-claw plugin
	}

	registerCodexAppServerExtensionFactory(_factory: unknown): void {
		// Not used by mem-claw plugin
	}

	registerAgentToolResultMiddleware(_handler: unknown, _options?: unknown): void {
		// Not used by mem-claw plugin
	}

	registerSessionExtension(extension: SessionExtensionRegistration): void {
		this.registeredSessionExtensions.push(extension);
	}

	async enqueueNextTurnInjection(
		injection: NextTurnInjection,
	): ReturnType<OpenClawPluginApi["enqueueNextTurnInjection"]> {
		this.registeredNextTurnInjections.push(injection);
		return {
			enqueued: true,
			id: `test-injection-${this.registeredNextTurnInjections.length}`,
			sessionKey: injection.sessionKey,
		};
	}

	registerTrustedToolPolicy(_policy: unknown): void {
		// Not used by mem-claw plugin
	}

	registerToolMetadata(_metadata: unknown): void {
		// Not used by mem-claw plugin
	}

	registerControlUiDescriptor(_descriptor: unknown): void {
		// Not used by mem-claw plugin
	}

	registerRuntimeLifecycle(lifecycle: RuntimeLifecycleRegistration): void {
		this.registeredRuntimeLifecycles.push(lifecycle);
	}

	registerAgentEventSubscription(subscription: AgentEventSubscriptionRegistration): void {
		this.registeredAgentEventSubscriptions.push(subscription);
	}

	emitAgentEvent(
		params: Parameters<OpenClawPluginApi["emitAgentEvent"]>[0],
	): ReturnType<OpenClawPluginApi["emitAgentEvent"]> {
		return {
			emitted: true,
			stream: params.stream,
		};
	}

	setRunContext(
		patch: Parameters<OpenClawPluginApi["setRunContext"]>[0],
	): ReturnType<OpenClawPluginApi["setRunContext"]> {
		const values = this.runContextValues.get(patch.runId) ?? new Map();
		this.runContextValues.set(patch.runId, values);
		if (patch.unset || patch.value === undefined) {
			values.delete(patch.namespace);
		} else {
			values.set(patch.namespace, patch.value);
		}
		return true;
	}

	getRunContext(
		params: Parameters<OpenClawPluginApi["getRunContext"]>[0],
	): ReturnType<OpenClawPluginApi["getRunContext"]> {
		return this.runContextValues.get(params.runId)?.get(params.namespace);
	}

	clearRunContext(params: Parameters<OpenClawPluginApi["clearRunContext"]>[0]): void {
		if (params.namespace === undefined) {
			this.runContextValues.delete(params.runId);
			return;
		}
		this.runContextValues.get(params.runId)?.delete(params.namespace);
	}

	registerSessionSchedulerJob(
		job: SessionSchedulerJobRegistration,
	): ReturnType<OpenClawPluginApi["registerSessionSchedulerJob"]> {
		this.registeredSessionSchedulerJobs.push(job);
		return {
			id: job.id,
			pluginId: this.id,
			sessionKey: job.sessionKey,
			kind: job.kind,
		};
	}

	registerSessionAction(action: SessionActionRegistration): void {
		this.registeredSessionActions.push(action);
	}

	async sendSessionAttachment(
		_params: Parameters<OpenClawPluginApi["sendSessionAttachment"]>[0],
	): ReturnType<OpenClawPluginApi["sendSessionAttachment"]> {
		return {
			ok: false,
			error: "OpenClawPluginApiHarness does not deliver session attachments",
		};
	}

	async scheduleSessionTurn(
		_params: Parameters<OpenClawPluginApi["scheduleSessionTurn"]>[0],
	): ReturnType<OpenClawPluginApi["scheduleSessionTurn"]> {
		return undefined;
	}

	async unscheduleSessionTurnsByTag(
		_params: Parameters<OpenClawPluginApi["unscheduleSessionTurnsByTag"]>[0],
	): ReturnType<
		OpenClawPluginApi["unscheduleSessionTurnsByTag"]
	> {
		return {
			removed: 0,
			failed: 0,
		};
	}

	registerDetachedTaskRuntime(_runtime: unknown): void {
		// Not used by mem-claw plugin
	}

	resolvePath(input: string): string {
		return input;
	}

	on(hookName: PluginHookName, handler: PluginHookHandler, opts?: PluginHookOptions): void {
		this.registeredOnHooks.push({
			hookName,
			handler,
			opts,
		});
	}

	/** Get a registered tool by name */
	getRegisteredTool(name: string): AnyAgentTool | undefined {
		return this.registeredTools.find((tool) => tool.name === name);
	}

	/** Get a registered slash command by name */
	getRegisteredCommand(
		name: string,
	): OpenClawPluginCommandDefinition | undefined {
		return this.registeredCommands.find((cmd) => cmd.name === name);
	}

	/** Get an `on()` hook handler by hook name (first match) */
	getOnHookHandler<K extends PluginHookName>(
		hookName: K,
	): PluginHookHandlerFor<K> | undefined {
		const registration = this.registeredOnHooks.find(
			(h) => h.hookName === hookName,
		);
		return registration
			? (this.withRuntimeHookContext(registration.handler) as PluginHookHandlerFor<K>)
			: undefined;
	}

	/** Get ALL `on()` hook handlers for a given hook name (e.g. multiple before_prompt_build) */
	getAllOnHookHandlers<K extends PluginHookName>(
		hookName: K,
	): Array<{
		handler: PluginHookHandlerFor<K>;
		priority?: number;
	}> {
		return this.registeredOnHooks
			.filter((h) => h.hookName === hookName)
			.map((h) => ({
				handler: this.withRuntimeHookContext(h.handler) as PluginHookHandlerFor<K>,
				priority: h.opts?.priority,
			}));
	}

	/** Get a registerHook handler by event name (first match) */
	getHookHandler(eventName: string): InternalHookHandler | undefined {
		const registration = this.registeredHooks.find(
			(h) => h.hookName === eventName,
		);
		return registration?.handler;
	}

	/** Get ALL registerHook handlers for an event name */
	getAllHookHandlers(
		eventName: string,
	): Array<{ handler: InternalHookHandler; name?: string }> {
		return this.registeredHooks
			.filter((h) => h.hookName === eventName)
			.map((h) => ({ handler: h.handler, name: h.opts?.name }));
	}

	/** Start all registered services (calls service.start()) */
	async startServices(): Promise<void> {
		const ctx = {
			config: this.config,
			stateDir: "/tmp",
			logger: this.logger,
		};
		for (const service of this.registeredServices) {
			await service.start(ctx as Parameters<typeof service.start>[0]);
		}
	}

	/** Stop all registered services (calls service.stop()) */
	async stopServices(): Promise<void> {
		const ctx = {
			config: this.config,
			stateDir: "/tmp",
			logger: this.logger,
		};
		try {
			for (const service of this.registeredServices) {
				await service.stop?.(ctx as Parameters<typeof service.start>[0]);
			}
		} finally {
			if (typeof this.pluginConfig.dbPath === "string") stopTestMemory(this.pluginConfig.dbPath);
			harnessesWithRuntimeServices.delete(this);
		}
	}

	private runtimeHookContext(): HookContext | undefined {
		if (!this.runtimeAgentId) return undefined;
		return {
			agentId: this.runtimeAgentId,
			sessionKey: `agent:${this.runtimeAgentId}:test`,
		};
	}

	private withRuntimeHookContext(handler: PluginHookHandler): PluginHookHandler {
		const runtimeCtx = this.runtimeHookContext();
		if (!runtimeCtx) return handler;

		return (async (event: unknown, ctx?: unknown) => {
			return (handler as (event: unknown, ctx?: unknown) => Promise<unknown>)(
				event,
				ctx ?? runtimeCtx,
			);
		}) as PluginHookHandler;
	}
}
