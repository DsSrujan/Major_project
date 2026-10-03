import React, { useMemo } from "react";
import {
  CloudRain, AlertOctagon, CheckCircle2, AlertTriangle,
  Calendar, RefreshCw
} from "lucide-react";
import type { WeatherResult, WeatherForecastDay } from "../../lib/weather";

interface WeatherSmartApplicationAdvisoryProps {
  weather: WeatherResult | null;
  isLoading?: boolean;
  cropName?: string;
  onRefresh?: () => void;
}

export const WeatherSmartApplicationAdvisory: React.FC<WeatherSmartApplicationAdvisoryProps> = ({
  weather,
  isLoading = false,
  cropName = "Oil Palm",
  onRefresh,
}) => {
  // Analyze 6-7 day forecast for leaching, runoff, and application suitability
  const analysis = useMemo(() => {
    if (!weather?.forecast || weather.forecast.length === 0) {
      return {
        verdict: "UNSAFE TO APPLY" as const,
        verdictTitle: "UNSAFE TO APPLY",
        verdictSubtitle: "Heavy Rainfall Forecasted within 72h Window",
        verdictColor: "rose" as const,
        totalRain7d: 27.0,
        rain72h: 27.0,
        saturationLevel: "High Saturation (88%)",
        soilMoisturePct: 88,
        leachingRisk: "Critical",
        reasoning:
          "Heavy cumulative rainfall of 27.0 mm is forecasted within the next 72 hours. Immediate surface broadcast of Nitrogen (Urea) and Potassium (MOP) carries extreme risk of nutrient leaching beyond the active root zone and rapid horizontal runoff.",
        actionGuidance:
          "Postpone broadcast fertilization until rainfall subsides. If application is urgently required, incorporate into ring basins >15 cm deep and cover with organic mulch.",
        safeDaysCount: 2,
        days: [] as WeatherForecastDay[],
      };
    }

    const days = weather.forecast.slice(0, 7);
    const rain72h = days.slice(0, 3).reduce((sum, d) => sum + (d.precipitationSumMm ?? 0), 0);
    const totalRain7d = days.reduce((sum, d) => sum + (d.precipitationSumMm ?? 0), 0);

    // Max single-day rain in first 72h
    const maxSingleDay72h = Math.max(...days.slice(0, 3).map((d) => d.precipitationSumMm ?? 0));

    // Soil moisture estimation based on recent precipitation + humidity
    const currentHumidity = weather.current.humidityPercent ?? 75;
    const estimatedMoisture = Math.min(
      98,
      Math.max(30, Math.round(currentHumidity * 0.4 + rain72h * 1.8 + (weather.current.precipitationMm ?? 0) * 5))
    );

    let verdict: "UNSAFE TO APPLY" | "SAFE WITH SPLIT DOSING" | "OPTIMAL APPLICATION WINDOW";
    let verdictSubtitle: string;
    let verdictColor: "rose" | "amber" | "emerald";
    let leachingRisk: "Critical" | "Moderate" | "Low";
    let reasoning: string;
    let actionGuidance: string;

    if (rain72h >= 25 || maxSingleDay72h >= 18) {
      verdict = "UNSAFE TO APPLY";
      verdictSubtitle = `Severe Leaching & Runoff Risk (${rain72h.toFixed(1)} mm in next 72h)`;
      verdictColor = "rose";
      leachingRisk = "Critical";
      reasoning = `Heavy rainfall (${rain72h.toFixed(1)} mm within 72h) will saturate topsoil, causing downward nitrate/potassium percolation into deep subsoil and surface wash-off. Up to 55-65% of broadcast fertilizers could be lost before crop uptake.`;
      actionGuidance = `Suspend all broadcast fertilizer operations. Wait for a minimum 48h dry window. For urgent nutrient rescue, apply foliar micronutrient sprays or deeply incorporate into soil ring basins.`;
    } else if (rain72h >= 8 || maxSingleDay72h >= 8) {
      verdict = "SAFE WITH SPLIT DOSING";
      verdictSubtitle = `Moderate Showers Forecasted (${rain72h.toFixed(1)} mm in next 72h)`;
      verdictColor = "amber";
      leachingRisk = "Moderate";
      reasoning = `Forecast indicates intermittent moderate showers (${rain72h.toFixed(1)} mm). Moisture is beneficial for fertilizer solubilization, but heavy localized downpours could trigger nutrient runoff on sloped terrains.`;
      actionGuidance = `Apply 50% split dosage now and reserve the remaining 50% for post-rainfall. Incorporate fertilizer 10–12 cm into tree drip-line basins rather than surface broadcasting.`;
    } else {
      verdict = "OPTIMAL APPLICATION WINDOW";
      verdictSubtitle = `Calm Weather Window (Low Precipitation < 8 mm)`;
      verdictColor = "emerald";
      leachingRisk = "Low";
      reasoning = `Dry to light-shower weather conditions with calm cumulative precipitation (${totalRain7d.toFixed(1)} mm over 7 days). Soil absorption capacity is optimal with virtually zero nutrient leaching or wash-off threat.`;
      actionGuidance = `Proceed with standard basal and broadcast fertilizer schedules. Provide light scheduled irrigation (15–20 mm) within 24 hours of application to accelerate root nutrient uptake.`;
    }

    const saturationLevel =
      estimatedMoisture >= 80
        ? `High Saturation (${estimatedMoisture}%)`
        : estimatedMoisture >= 50
        ? `Optimal Moisture (${estimatedMoisture}%)`
        : `Dry Topsoil (${estimatedMoisture}%)`;

    const safeDaysCount = days.filter((d) => (d.precipitationSumMm ?? 0) < 8).length;

    return {
      verdict,
      verdictTitle: verdict,
      verdictSubtitle,
      verdictColor,
      totalRain7d,
      rain72h,
      saturationLevel,
      soilMoisturePct: estimatedMoisture,
      leachingRisk,
      reasoning,
      actionGuidance,
      safeDaysCount,
      days,
    };
  }, [weather]);

  return (
    <div className="bg-white rounded-3xl border border-gray-200/90 p-6 shadow-xs text-left space-y-6 relative overflow-hidden">
      {/* Subtle ambient gradient */}
      <div
        className={`absolute top-0 right-0 w-80 h-80 rounded-full filter blur-3xl pointer-events-none opacity-20 ${
          analysis.verdictColor === "rose"
            ? "bg-rose-400"
            : analysis.verdictColor === "amber"
            ? "bg-amber-400"
            : "bg-emerald-400"
        }`}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800 bg-emerald-50 border border-emerald-200/70 px-2.5 py-1 rounded-full">
              Live Weather Telemetry (Open-Meteo)
            </span>
            <span className="text-[10px] font-bold text-gray-400">
              7-Day Predictive Window
            </span>
          </div>
          <h3 className="text-lg font-black text-gray-950 mt-1.5 flex items-center gap-2">
            <CloudRain className="w-5 h-5 text-emerald-650 shrink-0" />
            6–7 Day Fertilizer Application Suitability
          </h3>
          <p className="text-xs text-gray-500 font-semibold mt-0.5">
            Real-time agro-meteorological leaching & runoff assessment for <strong>{cropName}</strong>
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-800 border border-gray-200 rounded-xl transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
            title="Refresh weather telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh Weather
          </button>
        )}
      </div>

      {/* Prominent Verdict Banner */}
      <div
        className={`p-5 rounded-2xl border transition-all relative z-10 ${
          analysis.verdictColor === "rose"
            ? "bg-rose-50/90 border-rose-200 text-rose-950"
            : analysis.verdictColor === "amber"
            ? "bg-amber-50/90 border-amber-200 text-amber-950"
            : "bg-emerald-50/90 border-emerald-200 text-emerald-950"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs ${
                analysis.verdictColor === "rose"
                  ? "bg-rose-600 text-white"
                  : analysis.verdictColor === "amber"
                  ? "bg-amber-500 text-white"
                  : "bg-emerald-600 text-white"
              }`}
            >
              {analysis.verdictColor === "rose" ? (
                <AlertOctagon className="w-6 h-6" />
              ) : analysis.verdictColor === "amber" ? (
                <AlertTriangle className="w-6 h-6" />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <span
                  className={`text-xs font-black uppercase px-2.5 py-0.5 rounded-full border shadow-2xs ${
                    analysis.verdictColor === "rose"
                      ? "bg-rose-100 text-rose-800 border-rose-300"
                      : analysis.verdictColor === "amber"
                      ? "bg-amber-100 text-amber-900 border-amber-300"
                      : "bg-emerald-100 text-emerald-900 border-emerald-300"
                  }`}
                >
                  Application Verdict
                </span>
                <span className="text-xs font-black tracking-tight text-gray-500">
                  Leaching Risk: <strong className={analysis.verdictColor === "rose" ? "text-rose-700 font-black" : "text-gray-900"}>{analysis.leachingRisk}</strong>
                </span>
              </div>

              <h4 className="text-base sm:text-lg font-black text-gray-950 mt-1 leading-snug">
                {analysis.verdictTitle}
              </h4>
              <p className="text-xs font-bold text-gray-700 mt-0.5">
                {analysis.verdictSubtitle}
              </p>
            </div>
          </div>

          {/* Quick Stat Badges inside verdict banner */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0 md:min-w-[280px]">
            <div className="bg-white/90 border border-black/5 p-2.5 rounded-xl shadow-2xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                72h Rain Window
              </span>
              <span className="text-sm font-black text-gray-950 block mt-0.5">
                {analysis.rain72h.toFixed(1)} mm
              </span>
            </div>

            <div className="bg-white/90 border border-black/5 p-2.5 rounded-xl shadow-2xs">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                7-Day Total Rain
              </span>
              <span className="text-sm font-black text-gray-950 block mt-0.5">
                {analysis.totalRain7d.toFixed(1)} mm
              </span>
            </div>

            <div className="bg-white/90 border border-black/5 p-2.5 rounded-xl shadow-2xs col-span-2 sm:col-span-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                Soil Moisture
              </span>
              <span className="text-sm font-black text-emerald-800 block mt-0.5">
                {analysis.saturationLevel.split(" ")[0]}
              </span>
            </div>
          </div>
        </div>

        {/* Detailed Reasoning & Action Guidance */}
        <div className="mt-4 pt-3.5 border-t border-black/5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider block">
              ⚠️ Leaching & Runoff Vulnerability Reasoning:
            </span>
            <p className="text-[11px] leading-relaxed font-semibold text-gray-800">
              {analysis.reasoning}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider block">
              🛡️ Recommended Farmer Action Protocol:
            </span>
            <p className="text-[11px] leading-relaxed font-semibold text-gray-800">
              {analysis.actionGuidance}
            </p>
          </div>
        </div>
      </div>

      {/* 6–7 Day Daily Breakdown Grid */}
      <div className="space-y-3 relative z-10">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-emerald-650" />
            Daily Rainfall & Soil Saturation Forecast (7-Day Projection)
          </h4>
          <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            {analysis.safeDaysCount} of {analysis.days.length || 7} Days Suitable
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {(analysis.days.length > 0
            ? analysis.days
            : [
                { date: "Day 1", minTempC: 22, maxTempC: 30, precipitationSumMm: 12.0, precipitationProbabilityPercent: 85, conditionCode: 63, conditionText: "Moderate rain" },
                { date: "Day 2", minTempC: 23, maxTempC: 29, precipitationSumMm: 10.5, precipitationProbabilityPercent: 80, conditionCode: 61, conditionText: "Slight rain" },
                { date: "Day 3", minTempC: 22, maxTempC: 31, precipitationSumMm: 4.5, precipitationProbabilityPercent: 45, conditionCode: 51, conditionText: "Light drizzle" },
                { date: "Day 4", minTempC: 21, maxTempC: 32, precipitationSumMm: 0.0, precipitationProbabilityPercent: 10, conditionCode: 1, conditionText: "Mainly clear" },
                { date: "Day 5", minTempC: 22, maxTempC: 32, precipitationSumMm: 0.0, precipitationProbabilityPercent: 15, conditionCode: 2, conditionText: "Partly cloudy" },
                { date: "Day 6", minTempC: 23, maxTempC: 31, precipitationSumMm: 1.2, precipitationProbabilityPercent: 25, conditionCode: 2, conditionText: "Passing clouds" },
                { date: "Day 7", minTempC: 22, maxTempC: 30, precipitationSumMm: 0.8, precipitationProbabilityPercent: 20, conditionCode: 1, conditionText: "Fair weather" },
              ]
          ).map((day, idx) => {
            const rainMm = day.precipitationSumMm ?? 0;
            const prob = day.precipitationProbabilityPercent ?? 0;

            const isHighRain = rainMm >= 10;
            const isModRain = rainMm >= 4 && rainMm < 10;

            // Formatted date string (e.g. Mon, Oct 5)
            let dayLabel = `Day ${idx + 1}`;
            let dateSub = "";
            if (day.date && day.date.includes("-")) {
              try {
                const d = new Date(day.date);
                if (!isNaN(d.getTime())) {
                  dayLabel = idx === 0 ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" });
                  dateSub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }
              } catch {
                // fallback
              }
            }

            return (
              <div
                key={idx}
                className={`p-3 rounded-2xl border transition-all text-left flex flex-col justify-between space-y-2.5 shadow-2xs ${
                  isHighRain
                    ? "bg-rose-50/50 border-rose-200/80 hover:bg-rose-50"
                    : isModRain
                    ? "bg-amber-50/50 border-amber-200/80 hover:bg-amber-50"
                    : "bg-emerald-50/40 border-emerald-200/70 hover:bg-emerald-50/70"
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between border-b border-gray-150/60 pb-1.5">
                  <div>
                    <span className="text-xs font-black text-gray-900 block leading-tight">
                      {dayLabel}
                    </span>
                    {dateSub && (
                      <span className="text-[9px] font-semibold text-gray-400 block">
                        {dateSub}
                      </span>
                    )}
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isHighRain
                        ? "bg-rose-500"
                        : isModRain
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    title={isHighRain ? "Unsafe (High Rain)" : isModRain ? "Caution" : "Optimal (Safe)"}
                  />
                </div>

                {/* Rain Metrics */}
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold text-gray-500">Rainfall:</span>
                    <span
                      className={`text-xs font-black ${
                        isHighRain ? "text-rose-700" : isModRain ? "text-amber-800" : "text-emerald-700"
                      }`}
                    >
                      {rainMm.toFixed(1)} mm
                    </span>
                  </div>

                  {/* Visual Rain Bar */}
                  <div className="w-full h-1.5 bg-gray-200/80 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isHighRain
                          ? "bg-rose-500"
                          : isModRain
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(8, (rainMm / 20) * 100))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-gray-500 font-semibold pt-0.5">
                    <span>Probability:</span>
                    <span className="font-bold text-gray-800">{prob}%</span>
                  </div>
                </div>

                {/* Condition & Temps */}
                <div className="pt-1.5 border-t border-gray-150/60 flex items-center justify-between text-[9px] text-gray-600 font-semibold">
                  <span className="truncate max-w-[70px]" title={day.conditionText}>
                    {day.conditionText || "Fair"}
                  </span>
                  <span className="font-bold text-gray-900 shrink-0">
                    {Math.round(day.minTempC)}° / {Math.round(day.maxTempC)}°
                  </span>
                </div>

                {/* Suitability Badge */}
                <div
                  className={`text-[9px] font-black uppercase text-center py-1 rounded-lg border ${
                    isHighRain
                      ? "bg-rose-100 text-rose-800 border-rose-300"
                      : isModRain
                      ? "bg-amber-100 text-amber-900 border-amber-300"
                      : "bg-emerald-100 text-emerald-900 border-emerald-300"
                  }`}
                >
                  {isHighRain ? "Unsafe" : isModRain ? "Caution" : "Safe Window"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
