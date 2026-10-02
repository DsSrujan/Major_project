/**
 * LeafletMapPicker.tsx
 *
 * GIS Boundary Map Card used in FarmPlotScreen's wizard Step 2.
 *
 * Features:
 * - Dedicated trigger to launch the TRUE FULL-SCREEN Google Maps Satellite Survey
 * - Embedded high-contrast satellite card with current boundary preview
 * - Village / mandal / district search
 * - Emits: onBoundaryChange({ geoJSON, areaAcres, centroid })
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  AlertTriangle,
  RefreshCw,
  Search,
  Layers as LayersIcon,
  Maximize2,
  CheckCircle2,
  Navigation,
} from "lucide-react";
import {
  computePolygonAreaAcres,
  computeCentroid,
  validatePolygon,
  acresToHectares,
  type GeoJSONPolygon,
} from "../../lib/geo";
import GoogleMapBoundarySurveyor from "./GoogleMapBoundarySurveyor";

// ---------------------------------------------------------------------------
// Leaflet CSS
// ---------------------------------------------------------------------------
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoundaryData {
  geoJSON: GeoJSONPolygon;
  areaAcres: number;
  centroid: { lat: number; lng: number } | null;
}

export interface LeafletMapPickerProps {
  /** Called whenever a polygon is drawn, confirmed, or cleared */
  onBoundaryChange: (data: BoundaryData | null) => void;
  /** Pre-fill with an existing boundary (e.g. from GeoJSON import or edit) */
  initialGeoJSON?: GeoJSONPolygon;
  /** Controlled area unit display */
  areaUnit?: "acres" | "hectares";
  showToast?: (msg: string, type?: "success" | "info" | "warning") => void;
  plotName?: string;
}

const DEFAULT_CENTER: [number, number] = [17.3912, 78.4948];
const DEFAULT_ZOOM = 15;

type BasemapId = "standard" | "satellite";

const MAPTILER_KEY = (import.meta as any).env?.VITE_MAPTILER_API_KEY as string | undefined;

function getSatelliteTileConfig(): { url: string; attribution: string; maxZoom: number } {
  if (MAPTILER_KEY) {
    return {
      url: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
      attribution: "© MapTiler © Airbus, Maxar, CNES/Airbus",
      maxZoom: 20,
    };
  }
  return {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  };
}

const STANDARD_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const STANDARD_ATTRIBUTION = "© OpenStreetMap contributors";

// Regional coordinate bias (Karnataka / Andhra Pradesh / Telangana Southern India zone)
const REGIONAL_BIAS_LAT = 12.9716;
const REGIONAL_BIAS_LNG = 77.5946;

// Custom SVG map marker for searched locations
const createSearchPinIcon = (placeName: string) =>
  L.divIcon({
    className: "custom-leaflet-search-pin",
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); pointer-events: none;">
        <div style="background-color: #0f172a; color: #10b981; border: 1.5px solid #10b981; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); white-space: nowrap; margin-bottom: 2px;">
          ${placeName}
        </div>
        <svg width="26" height="34" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0C5.37258 0 0 5.37258 0 12C0 20.25 12 32 12 32C12 32 24 20.25 24 12C24 5.37258 18.6274 0 12 0Z" fill="#10b981"/>
          <circle cx="12" cy="12" r="4.5" fill="#ffffff"/>
        </svg>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const LeafletMapPicker: React.FC<LeafletMapPickerProps> = ({
  onBoundaryChange,
  initialGeoJSON,
  areaUnit = "acres",
  showToast,
  plotName = "New Farm Plot",
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const drawnLayerRef = useRef<import("leaflet").Layer | null>(null);
  const standardLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const satelliteLayerRef = useRef<import("leaflet").TileLayer | null>(null);

  const [isFullScreenSurveyorOpen, setIsFullScreenSurveyorOpen] = useState(false);
  const [currentGeoJSON, setCurrentGeoJSON] = useState<GeoJSONPolygon | undefined>(initialGeoJSON);

  const [basemap, setBasemapState] = useState<BasemapId>("satellite");
  const [mapReady, setMapReady] = useState(false);
  const [polygonError, setPolygonError] = useState<string | null>(null);
  const [areaAcres, setAreaAcres] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);

  const triggerToast = useCallback(
    (msg: string, type: "success" | "info" | "warning" = "info") => {
      if (showToast) showToast(msg, type);
    },
    [showToast]
  );

  // ---------------------------------------------------------------------------
  // Basemap switching
  // ---------------------------------------------------------------------------
  const setBasemap = (next: BasemapId) => {
    const map = mapRef.current;
    if (!map || !standardLayerRef.current || !satelliteLayerRef.current) return;
    if (next === basemap) return;

    if (next === "satellite") {
      if (map.hasLayer(standardLayerRef.current)) map.removeLayer(standardLayerRef.current);
      satelliteLayerRef.current.addTo(map);
    } else {
      if (map.hasLayer(satelliteLayerRef.current)) map.removeLayer(satelliteLayerRef.current);
      standardLayerRef.current.addTo(map);
    }
    setBasemapState(next);
  };

  // ---------------------------------------------------------------------------
  // Process layer
  // ---------------------------------------------------------------------------
  const processLayer = useCallback(
    async (layer: import("leaflet").Layer) => {
      try {
        const geojson =
          (layer as import("leaflet").GeoJSON).toGeoJSON?.() ??
          (layer as unknown as { toGeoJSON: () => GeoJSON.Feature }).toGeoJSON();

        let geometry: GeoJSON.Geometry;
        if (geojson.type === "Feature") {
          geometry = (geojson as GeoJSON.Feature).geometry;
        } else if (geojson.type === "FeatureCollection") {
          const features = (geojson as GeoJSON.FeatureCollection).features;
          if (!features.length) return;
          geometry = features[0].geometry;
        } else {
          geometry = geojson as unknown as GeoJSON.Geometry;
        }

        if (geometry.type !== "Polygon") {
          setPolygonError("Only polygon shapes are supported.");
          return;
        }

        const geoJSONPolygon: GeoJSONPolygon = {
          type: "Polygon",
          coordinates: (geometry as GeoJSON.Polygon).coordinates as number[][][],
        };

        const acres = await computePolygonAreaAcres(geoJSONPolygon);
        const validation = await validatePolygon(geoJSONPolygon, acres);

        if (!validation.valid) {
          setPolygonError(validation.reason ?? "Invalid polygon.");
          onBoundaryChange(null);
          return;
        }

        setPolygonError(null);
        setAreaAcres(acres);
        setCurrentGeoJSON(geoJSONPolygon);

        const centroid = await computeCentroid(geoJSONPolygon);
        onBoundaryChange({ geoJSON: geoJSONPolygon, areaAcres: acres, centroid });
      } catch (err) {
        console.error("Polygon processing error:", err);
        setPolygonError("Could not compute polygon area. Please redraw.");
      }
    },
    [onBoundaryChange]
  );

  // ---------------------------------------------------------------------------
  // Initialize Leaflet Map
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Fix default marker icons
    // @ts-expect-error - leaflet private property
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
    });

    const satConfig = getSatelliteTileConfig();
    const standardLayer = L.tileLayer(STANDARD_TILE_URL, {
      maxZoom: 19,
      attribution: STANDARD_ATTRIBUTION,
    });
    const satelliteLayer = L.tileLayer(satConfig.url, {
      maxZoom: satConfig.maxZoom,
      attribution: satConfig.attribution,
    });

    standardLayerRef.current = standardLayer;
    satelliteLayerRef.current = satelliteLayer;
    satelliteLayer.addTo(map);

    mapRef.current = map;
    setMapReady(true);

    if (initialGeoJSON) {
      try {
        const layer = L.geoJSON(initialGeoJSON as GeoJSON.GeoJsonObject, {
          style: {
            color: "#10b981",
            fillColor: "#10b981",
            fillOpacity: 0.25,
            weight: 2,
          },
        });
        layer.addTo(map);
        drawnLayerRef.current = layer;
        map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        processLayer(layer);
      } catch {
        // ignore malformed initial GeoJSON
      }
    }

    const sizeTimeout = setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(sizeTimeout);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      standardLayerRef.current = null;
      satelliteLayerRef.current = null;
    };
  }, [initialGeoJSON, processLayer]);

  // ---------------------------------------------------------------------------
  // Update Leaflet display when full-screen surveyor confirms a new boundary
  // ---------------------------------------------------------------------------
  const handleSurveyorConfirm = useCallback(
    (data: BoundaryData) => {
      setCurrentGeoJSON(data.geoJSON);
      setAreaAcres(data.areaAcres);
      setPolygonError(null);
      onBoundaryChange(data);

      const map = mapRef.current;
      if (map) {
        if (drawnLayerRef.current) {
          map.removeLayer(drawnLayerRef.current);
        }
        try {
          const layer = L.geoJSON(data.geoJSON as GeoJSON.GeoJsonObject, {
            style: {
              color: "#10b981",
              fillColor: "#10b981",
              fillOpacity: 0.25,
              weight: 2.5,
            },
          });
          layer.addTo(map);
          drawnLayerRef.current = layer;
          map.fitBounds(layer.getBounds(), { padding: [25, 25] });
        } catch (e) {
          console.error("Failed to render confirmed polygon on preview:", e);
        }
      }

      triggerToast("Boundary survey confirmed and synchronized!", "success");
    },
    [onBoundaryChange, triggerToast]
  );

  // ---------------------------------------------------------------------------
  // 1. Photon Geocoder with Regional Coordinate Bias
  // ---------------------------------------------------------------------------
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError(null);

    // 1. Direct coordinate pattern detection
    const coordMatch = query.match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        setIsSearching(false);
        if (mapRef.current) {
          mapRef.current.setView([lat, lng], 18, { animate: true });
          if (searchMarkerRef.current) {
            mapRef.current.removeLayer(searchMarkerRef.current);
          }
          searchMarkerRef.current = L.marker([lat, lng], {
            icon: createSearchPinIcon(`Coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`),
            interactive: false,
          }).addTo(mapRef.current);
        }
        setSearchQuery("");
        triggerToast(`Centered on coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)})`, "success");
        return;
      }
    }

    // 2. Primary: Photon Geocoder with regional coordinate bias
    try {
      const center = mapRef.current?.getCenter?.();
      const biasLat = center?.lat ?? REGIONAL_BIAS_LAT;
      const biasLng = center?.lng ?? REGIONAL_BIAS_LNG;

      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${biasLat}&lon=${biasLng}&limit=6`
      );
      const data = await res.json();
      if (data?.features && Array.isArray(data.features) && data.features.length > 0) {
        const first = data.features[0];
        const lat = Number(first.geometry.coordinates[1]);
        const lng = Number(first.geometry.coordinates[0]);
        if (!isNaN(lat) && !isNaN(lng)) {
          const props = first.properties || {};
          const parts = [
            props.name,
            props.district || props.county || props.city,
            props.state,
          ].filter(Boolean);
          const name = parts.join(", ") || props.name || query;

          if (mapRef.current) {
            mapRef.current.setView([lat, lng], 18, { animate: true });
            if (searchMarkerRef.current) {
              mapRef.current.removeLayer(searchMarkerRef.current);
            }
            searchMarkerRef.current = L.marker([lat, lng], {
              icon: createSearchPinIcon(name),
              interactive: false,
            }).addTo(mapRef.current);
          }
          setSearchQuery("");
          setIsSearching(false);
          triggerToast(`Found: ${name}`, "success");
          return;
        }
      }
    } catch (err) {
      console.warn("[Search] Photon lookup failed, trying backup geocoder:", err);
    }

    // 3. Fallback: Nominatim OpenStreetMap (Restricted to India)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&countrycodes=in&addressdetails=1&limit=5`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          const name = data[0].display_name.split(",")[0] || query;
          if (mapRef.current) {
            mapRef.current.setView([lat, lng], 18, { animate: true });
            if (searchMarkerRef.current) {
              mapRef.current.removeLayer(searchMarkerRef.current);
            }
            searchMarkerRef.current = L.marker([lat, lng], {
              icon: createSearchPinIcon(name),
              interactive: false,
            }).addTo(mapRef.current);
          }
          setSearchQuery("");
          setIsSearching(false);
          triggerToast(`Found: ${name}`, "success");
          return;
        }
      }
    } catch (err) {
      console.warn("[Search] Nominatim backup failed:", err);
    }

    setIsSearching(false);
    setSearchError(`Location "${query}" not found. Try searching a nearby village or town (e.g. Khammam, Eluru, Pedavegi).`);
  };

  // ---------------------------------------------------------------------------
  // 2. HTML5 Geolocation Device GPS
  // ---------------------------------------------------------------------------
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      const err = "Geolocation is not supported by your browser or device.";
      console.warn("[GPS]", err);
      setSearchError("Geolocation not supported. Please search your village manually.");
      triggerToast("Geolocation not supported. Please use the search bar.", "warning");
      return;
    }

    setIsLocating(true);
    setSearchError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        if (isNaN(latitude) || isNaN(longitude)) {
          setSearchError("GPS returned invalid coordinates. Please search your village manually.");
          return;
        }

        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 18, { animate: true });

          if (accuracyCircleRef.current) {
            mapRef.current.removeLayer(accuracyCircleRef.current);
          }
          accuracyCircleRef.current = L.circle([latitude, longitude], {
            radius: Math.max(accuracy, 10),
            color: accuracy > 100 ? "#f59e0b" : "#3b82f6",
            fillColor: accuracy > 100 ? "#f59e0b" : "#3b82f6",
            fillOpacity: 0.15,
            weight: 1.5,
            interactive: false,
          }).addTo(mapRef.current);

          if (userMarkerRef.current) {
            mapRef.current.removeLayer(userMarkerRef.current);
          }
          userMarkerRef.current = L.circleMarker([latitude, longitude], {
            radius: 8,
            color: "#ffffff",
            fillColor: accuracy > 100 ? "#f59e0b" : "#2563eb",
            fillOpacity: 1,
            weight: 2.5,
            interactive: false,
          }).addTo(mapRef.current);
        }
        triggerToast(`Location acquired (±${Math.round(accuracy)}m).`, "success");
      },
      (err) => {
        setIsLocating(false);
        console.warn(
          `[GPS] Geolocation failed (code ${err.code}: ${err.message}). ` +
          "Desktop/localhost browsers often fail or timeout if precise hardware GPS is unavailable. " +
          "User guided to manual village/mandal search."
        );

        let userMsg = "Could not obtain device location. Please search your village or mandal manually above.";
        if (err.code === err.PERMISSION_DENIED) {
          userMsg = "Location permission denied. Please allow location access or search your village/mandal above.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          userMsg = "GPS position unavailable on this device. Please type your village, mandal, or district above.";
        } else if (err.code === err.TIMEOUT) {
          userMsg = "GPS request timed out. On desktop environments, please use the search bar above.";
        }

        // NO SILENT FALLBACK to DEFAULT_CENTER or hardcoded location!
        setSearchError(userMsg);
        triggerToast(userMsg, "warning");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, [triggerToast]);

  const areaDisplay =
    areaAcres !== null
      ? areaUnit === "hectares"
        ? `${acresToHectares(areaAcres).toFixed(2)} ha`
        : `${areaAcres.toFixed(2)} ac`
      : null;

  return (
    <div className="space-y-3 text-left">
      {/* ================= HERO FULL-SCREEN SURVEY LAUNCH BUTTON ================= */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 p-4 rounded-2xl border-2 border-emerald-500/40 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <h4 className="text-xs font-black text-white uppercase tracking-wider">
              Google Maps Satellite GIS Survey
            </h4>
          </div>
          <p className="text-[11px] text-slate-300 font-medium leading-tight">
            Open in full screen to visually trace boundary corners on high-resolution satellite imagery.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsFullScreenSurveyorOpen(true)}
          className="w-full sm:w-auto px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer transition-all active:scale-95 border-0 shrink-0"
        >
          <Maximize2 className="w-4 h-4" />
          <span>Open Full-Screen Map</span>
        </button>
      </div>

      {/* Location Search Bar + GPS */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center bg-gray-50 border border-gray-200 rounded-xl overflow-hidden shadow-xs h-[38px] focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
          <div className="pl-3 text-gray-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search village, mandal, or district..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            className="bg-transparent border-none text-xs text-gray-800 px-2.5 py-1.5 w-full focus:outline-none placeholder:text-gray-400 font-semibold"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 text-white px-3.5 h-full text-xs font-bold transition-all cursor-pointer shrink-0"
          >
            {isSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Find"}
          </button>
        </div>

        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={isLocating}
          title="Locate via device GPS"
          className="h-[38px] px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0 border-0"
        >
          {isLocating ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Navigation className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{isLocating ? "Locating…" : "GPS"}</span>
        </button>
      </div>

      {/* Embedded Map Container */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden relative shadow-md">
        <div ref={mapContainerRef} className="w-full touch-none" style={{ height: "260px" }} />

        {/* Floating Top Controls */}
        <div className="absolute top-2.5 left-2.5 right-2.5 z-[1000] flex items-center justify-between gap-2 pointer-events-none">
          {/* Status Badge */}
          <div className="bg-slate-900/95 backdrop-blur-md px-2.5 py-1 rounded-xl border border-slate-800 text-[9px] text-emerald-400 font-mono flex items-center gap-1.5 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {mapReady ? "SATELLITE BOUNDARY PREVIEW" : "LOADING MAP..."}
          </div>

          {/* Mini Toolbar */}
          <div className="flex items-center gap-1 pointer-events-auto">
            <button
              type="button"
              title="Launch True Full-Screen Survey"
              onClick={() => setIsFullScreenSurveyorOpen(true)}
              className="p-2 rounded-xl bg-emerald-500 text-slate-950 font-bold border border-emerald-400 shadow-md flex items-center gap-1 text-[10px] cursor-pointer hover:bg-emerald-400 transition-all"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Full Screen</span>
            </button>

            {/* Basemap switcher */}
            <div className="flex rounded-xl border border-slate-700 overflow-hidden bg-slate-900/90">
              <button
                type="button"
                title="Satellite View"
                onClick={() => setBasemap("satellite")}
                className={`p-2 transition-all cursor-pointer ${
                  basemap === "satellite" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <LayersIcon className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Standard Map"
                onClick={() => setBasemap("standard")}
                className={`p-2 transition-all cursor-pointer border-l border-slate-700 ${
                  basemap === "standard" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-2.5 left-2.5 text-[8px] font-mono text-slate-500 z-[1000] pointer-events-none">
          WGS 84 / EPSG:4326 | Tap &apos;Open Full-Screen Map&apos; to survey
        </div>
      </div>

      {/* Search & Polygon Feedback */}
      <AnimatePresence>
        {searchError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2 p-2.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-800"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <span className="font-semibold">{searchError}</span>
          </motion.div>
        )}

        {polygonError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2 p-2.5 bg-red-50/80 border border-red-200 rounded-xl text-xs text-red-800"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
            <span className="font-semibold">{polygonError}</span>
          </motion.div>
        )}

        {areaDisplay && !polygonError && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="text-xs">
                <span className="text-gray-500 font-semibold">Surveyed Boundary: </span>
                <span className="font-black text-emerald-800">{areaDisplay}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsFullScreenSurveyorOpen(true)}
              className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline cursor-pointer bg-transparent border-0"
            >
              Adjust in Full Screen
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= FULL SCREEN GOOGLE MAPS SURVEYOR MODAL ================= */}
      <GoogleMapBoundarySurveyor
        isOpen={isFullScreenSurveyorOpen}
        onClose={() => setIsFullScreenSurveyorOpen(false)}
        onConfirm={handleSurveyorConfirm}
        initialGeoJSON={currentGeoJSON}
        plotName={plotName}
        defaultAreaUnit={areaUnit}
        showToast={showToast}
      />
    </div>
  );
};

export default LeafletMapPicker;
