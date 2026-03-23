export const THIRD_PARTY_RPC_CHANNEL = "everrelay:plugin:rpc" as const
export const THIRD_PARTY_RPC_VERSION = 1 as const

export type ThirdPartyRpcType = "ready" | "register" | "call" | "result" | "error" | "event"

export type ThirdPartyToolParameters = Record<string, unknown>

export interface ThirdPartyToolDescriptor<TArgs extends ThirdPartyToolParameters = ThirdPartyToolParameters> {
  id: string
  name: string
  description: string
  /** JSON Schema object (optional) */
  parameters?: Record<string, unknown>
}

export interface ThirdPartyRpcReadyPayload {
  version?: string
}

export interface ThirdPartyRpcRegisterPayload {
  tools: ThirdPartyToolDescriptor[]
}

export interface ThirdPartyRpcCallPayload {
  callId: string
  toolName: string
  args: ThirdPartyToolParameters
}

export interface ThirdPartyRpcSuccessPayload {
  callId: string
  ok: true
  result: unknown
}

export interface ThirdPartyRpcFailurePayload {
  callId: string
  ok: false
  error: string
  code?: string
}

export type ThirdPartyRpcResultPayload = ThirdPartyRpcSuccessPayload | ThirdPartyRpcFailurePayload

export interface ThirdPartyRpcEventPayload {
  name: string
  data?: unknown
}

export interface ThirdPartyRpcPayloadMap {
  ready: ThirdPartyRpcReadyPayload
  register: ThirdPartyRpcRegisterPayload
  call: ThirdPartyRpcCallPayload
  result: ThirdPartyRpcResultPayload
  error: ThirdPartyRpcFailurePayload
  event: ThirdPartyRpcEventPayload
}

export interface ThirdPartyRpcEnvelope<TType extends ThirdPartyRpcType = ThirdPartyRpcType> {
  channel: typeof THIRD_PARTY_RPC_CHANNEL
  v: typeof THIRD_PARTY_RPC_VERSION
  type: TType
  appInstanceId: string
  payload: ThirdPartyRpcPayloadMap[TType]
}
