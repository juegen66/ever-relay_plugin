import { HostBridge } from "@everrelay/plugin-sdk"
import { useEffect, useMemo, useRef, useState } from "react"

type WeatherState = {
  city: string
  tempC: number
  condition: string
}

type ForecastRow = {
  day: string
  highC: number
  lowC: number
}

const initialWeather: WeatherState = {
  city: "San Francisco",
  tempC: 18,
  condition: "Partly cloudy",
}

function makeForecast(tempC: number, days: number): ForecastRow[] {
  return Array.from({ length: days }, (_, index) => ({
    day: `D+${index + 1}`,
    highC: tempC + index,
    lowC: tempC - 2 + Math.max(0, index - 1),
  }))
}

function formatLog(label: string): string {
  const time = new Date().toLocaleTimeString()
  return `[${time}] ${label}`
}

export function App() {
  const [weather, setWeather] = useState<WeatherState>(initialWeather)
  const [forecast, setForecast] = useState<ForecastRow[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [bridgeState, setBridgeState] = useState<"connecting" | "ready" | "standalone">("connecting")

  const weatherRef = useRef(weather)

  useEffect(() => {
    weatherRef.current = weather
  }, [weather])

  const pluginLabel = useMemo(
    () => `${weather.city} · ${Math.round(weather.tempC)}°C · ${weather.condition}`,
    [weather]
  )

  useEffect(() => {
    const appInstanceId = HostBridge.resolveAppInstanceIdFromLocation()

    if (!appInstanceId) {
      setBridgeState("standalone")
      setLogs([formatLog("Missing everrelayWindowId. Open this page from EverRelay desktop.")])
      return
    }

    const bridge = new HostBridge({ appInstanceId })

    const pushLog = (line: string) => {
      setLogs((current) => [formatLog(line), ...current].slice(0, 8))
    }

    bridge.registerTool({
      id: "get_weather",
      name: "get_weather",
      description: "Return the current demo city, temperature in Celsius, and short condition string.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const current = weatherRef.current
        pushLog("tool get_weather")
        return {
          city: current.city,
          tempC: current.tempC,
          condition: current.condition,
        }
      },
    })

    bridge.registerTool({
      id: "set_location",
      name: "set_location",
      description: "Set the active city name shown in the iframe UI.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
      handler: async (args) => {
        const city = typeof args.city === "string" ? args.city.trim() : ""
        if (!city) {
          throw new Error("city is required")
        }

        setWeather((current) => ({
          ...current,
          city,
        }))
        pushLog(`tool set_location -> ${city}`)

        return { ok: true, city }
      },
    })

    bridge.registerTool({
      id: "show_forecast",
      name: "show_forecast",
      description: "Generate a short multi-day outlook and refresh the widget summary.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days 1-7" },
        },
      },
      handler: async (args) => {
        const rawDays = typeof args.days === "number" ? Math.floor(args.days) : 3
        const days = Math.min(7, Math.max(1, rawDays))
        const current = weatherRef.current
        const outlook = makeForecast(current.tempC, days)

        setForecast(outlook)
        setWeather((state) => ({
          ...state,
          condition: "Multi-day outlook updated",
        }))

        pushLog(`tool show_forecast days=${days}`)

        return { days, outlook }
      },
    })

    bridge.registerTools()
    bridge.signalReady({ version: "1.0.0-react" })
    pushLog(`ready instance ${appInstanceId.slice(0, 8)}...`)
    setBridgeState("ready")

    return () => {
      bridge.destroy()
    }
  }, [])

  return (
    <main className="min-h-screen p-3 sm:p-[18px]">
      <section className="relative mx-auto max-w-[380px] overflow-hidden rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(252,253,255,0.9),rgba(242,247,255,0.94))] p-[18px] shadow-weather backdrop-blur-[18px] sm:rounded-[28px] sm:p-[22px]">
        <div className="pointer-events-none absolute -bottom-24 -right-10 h-[180px] w-[180px] rounded-full bg-[radial-gradient(circle,rgba(79,140,255,0.26),transparent_68%)]" />

        <header className="relative z-[1] flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-[#13213f]/45">
              EverRelay Plugin Demo
            </p>
            <h1 className="mt-2 font-display text-[30px] leading-[0.95] tracking-[-0.04em] text-[#13213f] sm:text-[34px]">
              Weather Atelier
            </h1>
          </div>
          <span
            className={[
              "flex-none rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em]",
              bridgeState === "ready"
                ? "bg-[#47d08e]/20 text-[#0f5132]"
                : bridgeState === "standalone"
                  ? "bg-[#ffb84c]/25 text-[#92400e]"
                  : "bg-[#4f8cff]/15 text-[#1e429f]",
            ].join(" ")}
          >
            {bridgeState === "ready"
              ? "Connected"
              : bridgeState === "standalone"
                ? "Standalone"
                : "Connecting"}
          </span>
        </header>

        <section className="relative z-[1] mt-[22px] grid gap-[18px] rounded-[24px] border border-white/75 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.84),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.82),rgba(222,234,255,0.72))] p-[22px] sm:grid-cols-[1fr_auto]">
          <div className="pointer-events-none absolute bottom-3 right-3 h-[120px] w-[120px] rounded-full bg-[radial-gradient(circle,rgba(255,184,76,0.28),transparent_70%)] blur-md" />

          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-[#13213f]/45">
              {weather.city}
            </p>
            <div className="mt-2 flex items-start gap-[14px] sm:items-center">
              <span className="font-display text-[68px] leading-[0.9] tracking-[-0.06em] text-[#13213f]">
                {Math.round(weather.tempC)}°
              </span>
              <div className="grid max-w-none gap-[5px] text-[#13213f]/72 sm:max-w-[126px]">
                <strong className="text-[14px] text-[#13213f]">{weather.condition}</strong>
                <span className="text-[13px] leading-[1.45]">
                  Plugin state syncs through the EverRelay SDK.
                </span>
              </div>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="relative mt-1 h-[82px] w-[82px] animate-drift rounded-full bg-[linear-gradient(180deg,rgba(255,190,89,0.86),rgba(255,140,66,0.92))] shadow-[inset_0_3px_16px_rgba(255,255,255,0.58),0_18px_30px_rgba(255,165,58,0.28)]"
          >
            <div className="absolute inset-[14px] rounded-full border border-white/55" />
          </div>
        </section>

        <section className="relative z-[1] mt-4 grid grid-cols-2 gap-3" aria-label="Weather summary">
          <article className="rounded-[18px] border border-white/70 bg-white/65 p-4">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-[#13213f]/45">
              Signal
            </span>
            <strong className="block text-[14px] leading-[1.4] text-[#13213f]">{pluginLabel}</strong>
          </article>
          <article className="rounded-[18px] border border-white/70 bg-white/65 p-4">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-[#13213f]/45">
              Forecast
            </span>
            <strong className="block text-[14px] leading-[1.4] text-[#13213f]">
              {forecast.length > 0 ? `${forecast.length} days ready` : "Waiting for tool call"}
            </strong>
          </article>
        </section>

        <section
          className="relative z-[1] mt-[14px] rounded-[18px] border border-white/70 bg-white/65 p-4"
          aria-label="Forecast outlook"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-[#13213f]/45">
              Outlook
            </p>
            <span className="text-[12px] text-[#13213f]/72">Generated by `show_forecast`</span>
          </div>
          <div className="mt-[14px] grid grid-cols-3 gap-[10px]">
            {(forecast.length > 0 ? forecast : makeForecast(weather.tempC, 3)).map((row) => (
              <article
                key={row.day}
                className="rounded-[18px] bg-[linear-gradient(180deg,rgba(16,33,63,0.06),rgba(79,140,255,0.08))] px-3 py-[14px]"
              >
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#13213f]/45">
                  {row.day}
                </span>
                <strong className="mt-2 block font-display text-[30px] leading-none tracking-[-0.04em] text-[#13213f]">
                  {row.highC}°
                </strong>
                <small className="mt-1 block text-[12px] text-[#13213f]/72">{row.lowC}° low</small>
              </article>
            ))}
          </div>
        </section>

        <section
          className="relative z-[1] mt-[14px] rounded-[18px] border border-white/70 bg-white/65 p-4"
          aria-label="Activity log"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.18em] text-[#13213f]/45">
              Activity Log
            </p>
            <span className="text-[12px] text-[#13213f]/72">Latest bridge events</span>
          </div>
          <div className="mt-[14px] grid gap-2">
            {logs.length > 0 ? (
              logs.map((line) => (
                <p
                  key={line}
                  className="m-0 rounded-[14px] bg-white/70 px-3 py-[11px] text-[12px] leading-[1.45] text-[#13213f]/72"
                >
                  {line}
                </p>
              ))
            ) : (
              <p className="m-0 rounded-[14px] bg-white/70 px-3 py-[11px] text-[12px] leading-[1.45] text-[#13213f]/45">
                Waiting for bridge activity...
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  )
}
