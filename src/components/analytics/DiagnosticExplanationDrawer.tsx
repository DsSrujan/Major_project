import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Sparkles, CloudRain, CheckCircle2,
  ShieldAlert
} from "lucide-react";

import type { DiagnosticExplainResponsePayload } from "../../lib/apiClient";

import { MarkdownRenderer } from "../ui/MarkdownRenderer";

export interface DiagnosticItem {
  key: string;
  name: string;
  symbol: string;
  value: number | null;
  unit: string;
  targetRange: string;
  status: "optimal" | "deficient" | "excess" | "critical";
  category: "macro" | "micro" | "physical";
}

interface DiagnosticExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  item: DiagnosticItem | null;
  cropName: string;
  isLoading: boolean;
  data: DiagnosticExplainResponsePayload | null;
  onRetry?: () => void;
}

export const DiagnosticExplanationDrawer: React.FC<DiagnosticExplanationDrawerProps> = ({
  isOpen,
  onClose,
  item,
  cropName,
  isLoading,
  data,
  onRetry,
}) => {
  if (!isOpen || !item) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden text-left">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        />

        <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="w-screen max-w-lg bg-white shadow-2xl flex flex-col justify-between border-l border-gray-200"
          >
            {/* Header */}
            <div className="p-6 bg-linear-to-b from-gray-50/80 to-white border-b border-gray-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-sm shadow-md shadow-emerald-600/20">
                    {item.symbol}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-black text-gray-900 leading-tight">
                        {item.name}
                      </h3>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        item.status === "critical"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : item.status === "deficient"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-semibold mt-0.5">
                      Target Range: {item.targetRange} • Crop: <strong>{cropName}</strong>
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors cursor-pointer border-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Parameter Metrics Pill */}
              <div className="mt-4 grid grid-cols-2 gap-3 bg-white p-3 rounded-2xl border border-gray-200/70 shadow-xs">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Measured Level</span>
                  <span className="text-lg font-black text-gray-950 mt-0.5 block">
                    {item.value !== null ? `${item.value} ${item.unit}` : "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Recommended Ideal</span>
                  <span className="text-lg font-black text-emerald-700 mt-0.5 block">
                    {item.targetRange}
                  </span>
                </div>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
              {/* Weather Telemetry Strip */}
              {data?.weather_summary && (
                <div className="bg-sky-50/80 border border-sky-200/80 rounded-2xl p-3.5 flex items-start gap-3">
                  <CloudRain className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-sky-900 leading-relaxed font-semibold">
                    <strong className="block text-sky-950 font-extrabold mb-0.5">Live Weather Telemetry (Open-Meteo):</strong>
                    {data.weather_summary}
                  </div>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-3 border-emerald-500/20 border-t-emerald-600 animate-spin" />
                    <Sparkles className="w-5 h-5 text-emerald-650 absolute inset-0 m-auto animate-pulse" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-gray-800">
                      Consulting Agronomy Knowledge Base...
                    </p>
                    <p className="text-[11px] text-gray-500 font-semibold mt-1">
                      Synthesizing ICAR & KAU Package of Practices via NutriPalm AI Engine
                    </p>
                  </div>
                </div>
              )}

              {/* Error or Free Token Exhaustion Notice */}
              {!isLoading && data && !data.success && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4.5 space-y-2">
                  <div className="flex items-center gap-2 text-rose-800 font-extrabold text-xs">
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                    <span>
                      {data.pop_message
                        ? data.pop_message.replace(/Groq response failed:\s*/gi, "").replace(/Groq/gi, "AI Advisory")
                        : "Advisory Analysis Notice"}
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-700/80 leading-relaxed font-medium">
                    {data.error_code === "GROQ_TOKEN_LIMIT_EXCEEDED"
                      ? "The AI advisory service quota has been temporarily reached. Please wait about 60 seconds before requesting another diagnostic analysis."
                      : (data.error || "An error occurred while connecting to the agronomy advisory service.")
                          .replace(/Groq/gi, "AI Advisory")}
                  </p>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="mt-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 px-3.5 py-1.5 rounded-xl border-0 cursor-pointer shadow-xs"
                    >
                      Retry Generation
                    </button>
                  )}
                </div>
              )}

              {/* Formatted Markdown Explanation */}
              {!isLoading && data && data.success && data.explanation && (
                <div className="space-y-4 text-xs text-gray-800 leading-relaxed">
                  <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-3.5 flex items-center gap-2.5 text-emerald-900 text-[11px] font-bold shadow-2xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Validated with localized Package of Practices recommendations</span>
                  </div>

                  <div className="space-y-3 font-medium">
                    {data.explanation.includes("###") ? (
                      data.explanation.split("###").map((section, idx) => {
                        if (!section.trim()) return null;
                        const lines = section.trim().split("\n");
                        const heading = lines[0].replace(/^[\s#*]+/, "").replace(/[*]+$/, "").trim();
                        const body = lines.slice(1).join("\n").trim();

                        return (
                          <div
                            key={idx}
                            className="bg-gray-50/80 border border-gray-200/70 p-4 rounded-2xl space-y-2 shadow-2xs"
                          >
                            <h4 className="font-black text-gray-950 text-xs flex items-center gap-1.5 pb-2 border-b border-gray-200/60">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{heading}</span>
                            </h4>
                            <MarkdownRenderer content={body} variant="drawer" />
                          </div>
                        );
                      })
                    ) : (
                      <div className="bg-gray-50/80 border border-gray-200/70 p-4 rounded-2xl shadow-2xs">
                        <MarkdownRenderer content={data.explanation} variant="drawer" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-gray-50/90 border-t border-gray-150 flex items-center justify-between text-[11px] text-gray-500 font-bold">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                NutriPalm AI Agronomy Engine
              </span>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-white border border-gray-250 hover:bg-gray-100 text-gray-700 font-bold rounded-xl text-xs cursor-pointer shadow-xs transition-colors"
              >
                Close Panel
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  );
};

