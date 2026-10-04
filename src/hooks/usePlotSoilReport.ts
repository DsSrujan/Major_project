import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Plot } from "../data/plots";

export interface ParsedSoilNutrientMetric {
  key: string;
  label: string;
  value: number | null;
  displayVal: string;
  pct: number;
  color: string;
  statusText: string;
  isMissing: boolean;
}

export interface ParsedSoilReportData {
  ph: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  organic_carbon: number | null;
  electrical_conductivity: number | null;
  rawRecord?: any;
}

function extractNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "object" && typeof val.value === "number" && !isNaN(val.value)) return val.value;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

export function usePlotSoilReport(plotId: string, plot?: Plot) {
  const [reportData, setReportData] = useState<ParsedSoilReportData | null>(null);
  const [hasReport, setHasReport] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadReport = useCallback(async () => {
    if (!plotId) {
      setHasReport(false);
      setReportData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    let raw: any = null;

    // 1. Check localStorage for report uploaded for this specific plot
    const localKey = `nutripalm_soil_report_${plotId}`;
    const cached = localStorage.getItem(localKey);
    if (cached) {
      try {
        raw = JSON.parse(cached);
      } catch (e) {
        console.error("Failed to parse cached soil report for plot:", plotId, e);
      }
    }

    // 2. Check global last uploaded report if it matches this plot
    if (!raw) {
      const lastUploadedStr = localStorage.getItem("nutripalm:lastUploadedReport");
      if (lastUploadedStr) {
        try {
          const parsedLast = JSON.parse(lastUploadedStr);
          if (parsedLast && (parsedLast.plotId === plotId || parsedLast.plot_id === plotId)) {
            raw = parsedLast;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // 3. Check custom plot profile or embedded soil data if present on the plot object
    if (!raw && plot) {
      const customReport = (plot as any).soilReport || (plot as any).soilReportData || (plot as any).customProfile?.soilReport;
      if (customReport) {
        raw = customReport;
      }
    }

    // 4. If not found in local cache and plot is not a demo-only plot, query Supabase
    if (!raw && !plotId.startsWith("plot-")) {
      try {
        const { data, error } = await supabase
          .from("soil_reports")
          .select("*")
          .eq("plot_id", plotId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          raw = data;
          localStorage.setItem(localKey, JSON.stringify(data));
        }
      } catch (err) {
        console.error("Error querying Supabase soil_reports:", err);
      }
    }

    // Also factor in plot.soilReportAttached
    const plotFlagAttached = plot?.soilReportAttached === true;

    if (raw) {
      const ph = extractNumber(raw.ph ?? raw.ph_score);
      const nitrogen = extractNumber(raw.nitrogen_kg_ha ?? raw.nitrogen);
      const phosphorus = extractNumber(raw.phosphorus_kg_ha ?? raw.phosphorus);
      const potassium = extractNumber(raw.potassium_kg_ha ?? raw.potassium);
      const organic_carbon = extractNumber(raw.organic_carbon_percent ?? raw.organic_carbon);
      const electrical_conductivity = extractNumber(raw.electrical_conductivity_ds_m ?? raw.electrical_conductivity);

      setReportData({
        ph,
        nitrogen,
        phosphorus,
        potassium,
        organic_carbon,
        electrical_conductivity,
        rawRecord: raw
      });
      setHasReport(true);
    } else if (plotFlagAttached) {
      // Marked as attached via plot store, but payload details still loading or minimal
      setHasReport(true);
      setReportData({
        ph: null,
        nitrogen: null,
        phosphorus: null,
        potassium: null,
        organic_carbon: null,
        electrical_conductivity: null,
        rawRecord: null
      });
    } else {
      setHasReport(false);
      setReportData(null);
    }

    setIsLoading(false);
  }, [plotId, plot]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Construct structured metrics
  const noticeText = "Attach soil report to view live data";

  const metrics: ParsedSoilNutrientMetric[] = [
    {
      key: "ph",
      label: "pH Score",
      value: reportData?.ph ?? null,
      displayVal: reportData?.ph != null ? `${reportData.ph.toFixed(1)} pH` : noticeText,
      pct: reportData?.ph != null ? Math.min(100, Math.max(10, Math.round((reportData.ph / 8.5) * 100))) : 0,
      color: reportData?.ph != null
        ? reportData.ph >= 6.0 && reportData.ph <= 7.5 ? "bg-emerald-500" : reportData.ph < 5.5 ? "bg-rose-500" : "bg-amber-500"
        : "bg-gray-200",
      statusText: reportData?.ph != null
        ? reportData.ph >= 6.0 && reportData.ph <= 7.2 ? "Optimal (Slightly Acidic)" : reportData.ph < 5.5 ? "Acidic (Needs Liming)" : "Alkaline"
        : noticeText,
      isMissing: reportData?.ph == null
    },
    {
      key: "nitrogen",
      label: "Nitrogen (N)",
      value: reportData?.nitrogen ?? null,
      displayVal: reportData?.nitrogen != null ? `${Math.round(reportData.nitrogen)} kg/ha` : noticeText,
      pct: reportData?.nitrogen != null ? Math.min(100, Math.max(10, Math.round((reportData.nitrogen / 120) * 100))) : 0,
      color: reportData?.nitrogen != null ? (reportData.nitrogen >= 60 ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-200",
      statusText: reportData?.nitrogen != null
        ? reportData.nitrogen >= 70 ? "Optimal Concentration" : "Deficient - Recommended Boost"
        : noticeText,
      isMissing: reportData?.nitrogen == null
    },
    {
      key: "phosphorus",
      label: "Phosphorus (P)",
      value: reportData?.phosphorus ?? null,
      displayVal: reportData?.phosphorus != null ? `${Math.round(reportData.phosphorus)} kg/ha` : noticeText,
      pct: reportData?.phosphorus != null ? Math.min(100, Math.max(10, Math.round((reportData.phosphorus / 75) * 100))) : 0,
      color: reportData?.phosphorus != null ? (reportData.phosphorus >= 35 ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-200",
      statusText: reportData?.phosphorus != null
        ? reportData.phosphorus >= 40 ? "Optimal Content" : "Deficient - Recommended Boost"
        : noticeText,
      isMissing: reportData?.phosphorus == null
    },
    {
      key: "potassium",
      label: "Potassium (K)",
      value: reportData?.potassium ?? null,
      displayVal: reportData?.potassium != null ? `${Math.round(reportData.potassium)} kg/ha` : noticeText,
      pct: reportData?.potassium != null ? Math.min(100, Math.max(10, Math.round((reportData.potassium / 140) * 100))) : 0,
      color: reportData?.potassium != null ? (reportData.potassium >= 75 ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-200",
      statusText: reportData?.potassium != null
        ? reportData.potassium >= 80 ? "Optimal Content" : "Deficient - Recommended Boost"
        : noticeText,
      isMissing: reportData?.potassium == null
    },
    {
      key: "organic_carbon",
      label: "Organic Carbon (OC)",
      value: reportData?.organic_carbon ?? null,
      displayVal: reportData?.organic_carbon != null ? `${reportData.organic_carbon.toFixed(2)}%` : noticeText,
      pct: reportData?.organic_carbon != null ? Math.min(100, Math.max(10, Math.round((reportData.organic_carbon / 2.2) * 100))) : 0,
      color: reportData?.organic_carbon != null ? (reportData.organic_carbon >= 0.75 ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-200",
      statusText: reportData?.organic_carbon != null
        ? reportData.organic_carbon >= 1.0 ? "Excellent Microbial Base" : "Moderate Organic Base"
        : noticeText,
      isMissing: reportData?.organic_carbon == null
    },
    {
      key: "ec",
      label: "EC (Electrical Conductivity)",
      value: reportData?.electrical_conductivity ?? null,
      displayVal: reportData?.electrical_conductivity != null ? `${reportData.electrical_conductivity.toFixed(2)} dS/m` : noticeText,
      pct: reportData?.electrical_conductivity != null ? Math.min(100, Math.max(10, Math.round((reportData.electrical_conductivity / 0.8) * 100))) : 0,
      color: reportData?.electrical_conductivity != null ? (reportData.electrical_conductivity <= 0.8 ? "bg-emerald-500" : "bg-rose-500") : "bg-gray-200",
      statusText: reportData?.electrical_conductivity != null
        ? reportData.electrical_conductivity <= 0.8 ? "Optimal Salinity" : "High Salinity Risk"
        : noticeText,
      isMissing: reportData?.electrical_conductivity == null
    }
  ];

  return {
    hasReport,
    isLoading,
    reportData,
    metrics,
    refetch: loadReport
  };
}
