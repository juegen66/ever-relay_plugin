import {
  THIRD_PARTY_RPC_CHANNEL,
  THIRD_PARTY_RPC_VERSION,
  type ThirdPartyRpcCallPayload,
  type ThirdPartyRpcEnvelope,
  type ThirdPartyRpcEventPayload,
  type ThirdPartyRpcFailurePayload,
  type ThirdPartyRpcReadyPayload,
  type ThirdPartyRpcRegisterPayload,
  type ThirdPartyRpcResultPayload,
  type ThirdPartyToolParameters,
  type ThirdPartyToolDescriptor,
} from "./types.js"

export interface HostBridgeOptions {
  appInstanceId: string
  /** Parent origin for postMessage when known; default "*". */
  targetOrigin?: string
}

export interface ToolCallContext {
  appInstanceId: string
  callId: string
  bridge: HostBridge
  sourceEvent: MessageEvent
}

export type ToolHandler<
  TArgs extends ThirdPartyToolParameters = ThirdPartyToolParameters,
  TResult = unknown,
> = (args: TArgs, context: ToolCallContext) => TResult | Promise<TResult>

export interface RegisteredTool<
  TArgs extends ThirdPartyToolParameters = ThirdPartyToolParameters,
  TResult = unknown,
> extends ThirdPartyToolDescriptor<TArgs> {
  handler: ToolHandler<TArgs, TResult>
}

function createEnvelope<TType extends ThirdPartyRpcEnvelope["type"]>(
  appInstanceId: string,
  type: TType,
  payload: ThirdPartyRpcEnvelope<TType>["payload"]
): ThirdPartyRpcEnvelope<TType> {
  return {
    channel: THIRD_PARTY_RPC_CHANNEL,
    v: THIRD_PARTY_RPC_VERSION,
    type,
    appInstanceId,
    payload,
  }
}

function isThirdPartyRpcEnvelope(value: unknown): value is ThirdPartyRpcEnvelope {
  if (!value || typeof value !== "object") return false
  const maybeEnvelope = value as Partial<ThirdPartyRpcEnvelope>

  return (
    maybeEnvelope.channel === THIRD_PARTY_RPC_CHANNEL &&
    maybeEnvelope.v === THIRD_PARTY_RPC_VERSION &&
    typeof maybeEnvelope.type === "string" &&
    typeof maybeEnvelope.appInstanceId === "string"
  )
}

/**
 * Browser-side SDK: run inside the iframe, talk to the EverRelay parent via postMessage.
 */
export class HostBridge {
  private readonly appInstanceId: string
  private readonly targetOrigin: string
  private readonly handlers = new Map<string, ToolHandler<ThirdPartyToolParameters, unknown>>()
  private readonly toolDescriptors = new Map<string, ThirdPartyToolDescriptor>()
  private readonly boundMessage: (event: MessageEvent) => void

  constructor(options: HostBridgeOptions) {
    if (!options.appInstanceId) {
      throw new Error("HostBridge: appInstanceId is required")
    }
    this.appInstanceId = options.appInstanceId
    this.targetOrigin =
      options.targetOrigin ?? HostBridge.resolveTargetOriginFromDocumentReferrer() ?? "*"
    this.boundMessage = this.onMessage.bind(this)
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.boundMessage)
    }
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.boundMessage)
    }
    this.handlers.clear()
    this.toolDescriptors.clear()
  }

  onTool<TArgs extends ThirdPartyToolParameters, TResult>(name: string, handler: ToolHandler<TArgs, TResult>): void {
    this.handlers.set(name, handler as ToolHandler<ThirdPartyToolParameters, unknown>)
  }

  registerTool<TArgs extends ThirdPartyToolParameters, TResult>(
    tool: RegisteredTool<TArgs, TResult>
  ): void {
    this.onTool(tool.name, tool.handler)
    this.toolDescriptors.set(tool.name, {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })
  }

  getRegisteredTools(): ThirdPartyToolDescriptor[] {
    return [...this.toolDescriptors.values()]
  }

  registerTools(tools: readonly ThirdPartyToolDescriptor[] = this.getRegisteredTools()): void {
    for (const tool of tools) {
      this.toolDescriptors.set(tool.name, {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })
    }

    const payload: ThirdPartyRpcRegisterPayload = {
      tools: [...this.toolDescriptors.values()],
    }

    this.postToParent(createEnvelope(this.appInstanceId, "register", payload))
  }

  signalReady(payload: ThirdPartyRpcReadyPayload = {}): void {
    this.postToParent(createEnvelope(this.appInstanceId, "ready", payload))
  }

  emitEvent(name: string, data?: unknown): void {
    const payload: ThirdPartyRpcEventPayload = { name, data }
    this.postToParent(createEnvelope(this.appInstanceId, "event", payload))
  }

  static resolveAppInstanceIdFromLocation(): string | null {
    if (typeof window === "undefined") return null
    try {
      const q = new URLSearchParams(window.location.search)
      const id = q.get("everrelayWindowId")
      return id && id.length > 0 ? id : null
    } catch {
      return null
    }
  }

  static resolveTargetOriginFromDocumentReferrer(): string | undefined {
    if (typeof document === "undefined" || !document.referrer) return undefined

    try {
      return new URL(document.referrer).origin
    } catch {
      return undefined
    }
  }

  private postToParent(envelope: ThirdPartyRpcEnvelope): void {
    if (typeof window === "undefined" || !window.parent) return
    window.parent.postMessage(envelope, this.targetOrigin)
  }

  private onMessage(event: MessageEvent): void {
    if (typeof window !== "undefined" && event.source !== window.parent) return
    if (this.targetOrigin !== "*" && event.origin !== this.targetOrigin) return

    const data = event.data
    if (!isThirdPartyRpcEnvelope(data)) return
    if (data.appInstanceId !== this.appInstanceId) return
    if (data.type !== "call") return

    const payload = data.payload as Partial<ThirdPartyRpcCallPayload>
    const callId = typeof payload.callId === "string" ? payload.callId : ""
    const toolName = typeof payload.toolName === "string" ? payload.toolName : ""
    const args =
      payload.args && typeof payload.args === "object" && !Array.isArray(payload.args)
        ? payload.args
        : {}

    const reply = (payload: ThirdPartyRpcResultPayload) => {
      this.postToParent(createEnvelope(this.appInstanceId, "result", payload))
    }

    const handler = this.handlers.get(toolName)
    if (!handler) {
      const errorPayload: ThirdPartyRpcFailurePayload = {
        callId,
        ok: false,
        error: `Unknown tool: ${toolName}`,
      }
      reply(errorPayload)
      return
    }

    const context: ToolCallContext = {
      appInstanceId: this.appInstanceId,
      callId,
      bridge: this,
      sourceEvent: event,
    }

    void Promise.resolve(handler(args, context))
      .then((res) => {
        reply({
          callId,
          ok: true,
          result: res,
        })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        reply({
          callId,
          ok: false,
          error: msg,
        })
      })
  }
}
