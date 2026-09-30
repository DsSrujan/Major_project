/**
 * GoogleMapBoundarySurveyor.tsx
 *
 * Full-Screen Google Maps & Satellite Farm Plot Creation Dashboard & GIS Toolkit
 *
 * Architecture:
 * 1. FIXED VIEWPORT CONTAINER (z-[99999]): True full-screen layout.
 * 2. TOP NAVIGATION BAR (z-[1000]): Location search, Satellite/Road toggle, Zoom, My Location GPS.
 * 3. DEDICATED SIDE TOOLKIT PANEL (aside):
 *    - Rendered in a separate layout container (flex-row on desktop), NEVER underneath map tiles.
 *    - Pencil/Draw Tool button with live status.
 *    - Retake / Undo button (removes last placed vertex).
 *    - Clear All button (resets boundary).
 *    - Dropdowns: Irrigation Method & Soil Classification.
 *    - Live Area (Acres/Ha) & Perimeter measurements.
 *    - Primary "Create Plot" submission button.
 * 4. MAP CANVAS (main): Full remaining viewport width, high-res Google Maps satellite with
 *    keyless Esri World Imagery fallback, smooth zoom/pan, click-to-draw.
 * 5. API CONFIGURATION MODAL: Solid backdrop (z-[100000]) preventing DOM flickers or map reloads.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Check,
  MapPin,
  Navigation,
  Trash2,
  Undo2,
  Search,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Info,
  Key,
  RefreshCw,
  HelpCircle,
  Globe2,
  Edit3,
  ArrowLeft,
  Sparkles,
  Maximize2,
  Droplets,
  Layers,
  Sprout,
  Calendar,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  computePolygonAreaAcres,
  computeCentroid,
  validatePolygon,
  acresToHectares,
  type GeoJSONPolygon,
} from "../../lib/geo";
import {
  loadGoogleMaps,
  setGoogleMapsApiKeyOverride,
} from "../../lib/googleMapsLoader";

import "leaflet/dist/leaflet.css";
import L from "leaflet";

export interface PlotCreationMetadata {
  name: string;
  farmer: string;
  crop: string;
  soilType: string;
  irrigation: string;
  plantingDate?: string;
  plantCount?: string;
}

export interface BoundaryData {
  geoJSON: GeoJSONPolygon;
  areaAcres: number;
  centroid: { lat: number; lng: number } | null;
  metadata?: PlotCreationMetadata;
}

export interface GoogleMapBoundarySurveyorProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: BoundaryData) => void;
  initialGeoJSON?: GeoJSONPolygon;
  initialMetadata?: Partial<PlotCreationMetadata>;
  plotName?: string;
  mode?: "create" | "survey_only";
  defaultAreaUnit?: "acres" | "hectares";
  showToast?: (msg: string, type?: "success" | "info" | "warning") => void;
}

const DEFAULT_CENTER = { lat: 17.3912, lng: 78.4948 }; // Andhra Pradesh / Telangana Oil Palm Belt
const DEFAULT_FARM_ZOOM = 18;

// Popular agricultural presets for one-tap locating
const QUICK_LOCATIONS = [
  { name: "Khammam", lat: 17.2473, lng: 80.1514 },
  { name: "Eluru", lat: 16.7107, lng: 81.0952 },
  { name: "Pedavegi", lat: 16.8083, lng: 81.1274 },
  { name: "Chintalapudi", lat: 17.0673, lng: 80.9983 },
  { name: "Kothagudem", lat: 17.5521, lng: 80.6186 },
];

interface SearchSuggestion {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
}

function calculateDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // metres
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const GoogleMapBoundarySurveyor: React.FC<GoogleMapBoundarySurveyorProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialGeoJSON,
  initialMetadata,
  plotName = "New Farm Plot",
  mode = "create",
  defaultAreaUnit = "acres",
  showToast,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Google Maps Instance & Overlays
  const googleMapRef = useRef<any>(null);
  const googlePolygonRef = useRef<any>(null);
  const googlePolylineRef = useRef<any>(null);
  const googleAccuracyCircleRef = useRef<any>(null);
  const googleUserMarkerRef = useRef<any>(null);
  const googleSearchMarkerRef = useRef<any>(null);
  const isSyncingGooglePathRef = useRef<boolean>(false);

  // Leaflet Fallback Refs
  const leafletMapRef = useRef<L.Map | null>(null);
  const leafletPolygonRef = useRef<L.Polygon | null>(null);
  const leafletPolylineRef = useRef<L.Polyline | null>(null);
  const leafletMarkersGroupRef = useRef<L.LayerGroup | null>(null);
  const leafletAccuracyCircleRef = useRef<L.Circle | null>(null);
  const leafletUserMarkerRef = useRef<L.CircleMarker | L.Marker | null>(null);
  const leafletSearchMarkerRef = useRef<L.Marker | null>(null);

  // Drawing & Plot Creation State
  const [isDrawingActive, setIsDrawingActive] = useState(true);
  const [activeEngine, setActiveEngine] = useState<"google" | "satellite_fallback">("google");
  const [areaUnit, setAreaUnit] = useState<"acres" | "hectares">(defaultAreaUnit);
  const [mapType, setMapType] = useState<"hybrid" | "roadmap" | "satellite">("hybrid");
  const [vertices, setVertices] = useState<Array<{ lat: number; lng: number }>>([]);
  const [areaAcres, setAreaAcres] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showMoreFields, setShowMoreFields] = useState(false);

  // Form Metadata State
  const [plotFormData, setPlotFormData] = useState<PlotCreationMetadata>({
    name: initialMetadata?.name || (mode === "create" ? "" : plotName),
    farmer: initialMetadata?.farmer || "Swaminathan Gowda",
    crop: initialMetadata?.crop || "Oil Palm",
    soilType: initialMetadata?.soilType || "Loamy",
    irrigation: initialMetadata?.irrigation || "Precision Drip",
    plantingDate: initialMetadata?.plantingDate || "",
    plantCount: initialMetadata?.plantCount || "",
  });

  // GPS Geolocation States
  const [isLocating, setIsLocating] = useState(false);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);

  // Location Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestionsDropdown, setShowSuggestionsDropdown] = useState(false);

  // Modals & UI States
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isLoadingMaps, setIsLoadingMaps] = useState(true);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [tempApiKey, setTempApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(false);

  const triggerToast = useCallback(
    (msg: string, type: "success" | "info" | "warning" = "info") => {
      if (showToast) showToast(msg, type);
    },
    [showToast]
  );

  // Keep drawing active state synchronized with ref for event handlers
  const isDrawingActiveRef = useRef(isDrawingActive);
  useEffect(() => {
    isDrawingActiveRef.current = isDrawingActive;
  }, [isDrawingActive]);

  const verticesRef = useRef(vertices);
  useEffect(() => {
    verticesRef.current = vertices;
  }, [vertices]);

  // ---------------------------------------------------------------------------
  // Parse initial GeoJSON if provided
  // ---------------------------------------------------------------------------
  const getInitialCoordinates = useCallback((): Array<{ lat: number; lng: number }> => {
    if (!initialGeoJSON || !initialGeoJSON.coordinates || !initialGeoJSON.coordinates[0]) {
      return [];
    }
    const ring = initialGeoJSON.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 3) return [];

    const pts = ring.map(([lng, lat]) => ({ lat, lng }));
    if (
      pts.length > 3 &&
      pts[0].lat === pts[pts.length - 1].lat &&
      pts[0].lng === pts[pts.length - 1].lng
    ) {
      return pts.slice(0, -1);
    }
    return pts;
  }, [initialGeoJSON]);

  // ---------------------------------------------------------------------------
  // Geometry & Distance calculations
  // ---------------------------------------------------------------------------
  const segmentStats = useMemo(() => {
    if (vertices.length < 2) return { perimeterM: 0, segments: [] };
    let perimeter = 0;
    const segments: Array<{ from: { lat: number; lng: number }; to: { lat: number; lng: number }; distM: number }> = [];

    for (let i = 0; i < vertices.length; i++) {
      const nextIdx = (i + 1) % vertices.length;
      if (vertices.length < 3 && nextIdx === 0) continue;
      const d = calculateDistanceM(
        vertices[i].lat,
        vertices[i].lng,
        vertices[nextIdx].lat,
        vertices[nextIdx].lng
      );
      perimeter += d;
      segments.push({
        from: vertices[i],
        to: vertices[nextIdx],
        distM: d,
      });
    }

    return { perimeterM: perimeter, segments };
  }, [vertices]);

  const recalculateGeometry = useCallback(
    async (coords: Array<{ lat: number; lng: number }>) => {
      if (coords.length < 3) {
        setAreaAcres(null);
        setValidationError(coords.length > 0 ? "Place at least 3 points to form a closed boundary." : null);
        return;
      }

      const ring = coords.map((c) => [c.lng, c.lat]);
      ring.push([coords[0].lng, coords[0].lat]);

      const geoJSON: GeoJSONPolygon = {
        type: "Polygon",
        coordinates: [ring],
      };

      try {
        const computedAcres = await computePolygonAreaAcres(geoJSON);
        setAreaAcres(computedAcres);

        const validation = await validatePolygon(geoJSON, computedAcres);
        if (!validation.valid) {
          setValidationError(validation.reason || "Invalid polygon geometry.");
        } else {
          setValidationError(null);
        }
      } catch {
        setValidationError("Could not calculate boundary area.");
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Core: Add Vertex Handler (Called on map/canvas tap or click)
  // ---------------------------------------------------------------------------
  const handleAddVertex = useCallback(
    (lat: number, lng: number) => {
      setVertices((prev) => {
        const updated = [...prev, { lat, lng }];
        verticesRef.current = updated;

        // Sync with Google Maps layers
        if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
          isSyncingGooglePathRef.current = true;
          const latLng = new window.google.maps.LatLng(lat, lng);

          if (googlePolygonRef.current) {
            const path = googlePolygonRef.current.getPath();
            path.push(latLng);

            if (updated.length < 3 && googlePolylineRef.current) {
              googlePolylineRef.current.setPath(path);
              googlePolygonRef.current.setVisible(false);
            } else if (updated.length >= 3) {
              googlePolygonRef.current.setVisible(true);
              if (googlePolylineRef.current) googlePolylineRef.current.setPath([]);
            }
          }
          isSyncingGooglePathRef.current = false;
        }

        // Sync with Leaflet fallback layers
        if (activeEngine === "satellite_fallback" && leafletMapRef.current) {
          renderLeafletPolygon(updated);
        }

        recalculateGeometry(updated);
        return updated;
      });
    },
    [activeEngine, recalculateGeometry]
  );

  // ---------------------------------------------------------------------------
  // Leaflet Satellite Fallback Engine
  // ---------------------------------------------------------------------------
  const renderLeafletPolygon = useCallback(
    (pts: Array<{ lat: number; lng: number }>) => {
      if (!leafletMapRef.current || !leafletMarkersGroupRef.current || !leafletPolygonRef.current) return;
      leafletMarkersGroupRef.current.clearLayers();
      const latLngs = pts.map((p) => [p.lat, p.lng] as [number, number]);

      if (pts.length >= 3) {
        leafletPolygonRef.current.setLatLngs(latLngs);
        if (leafletPolylineRef.current) leafletPolylineRef.current.setLatLngs([]);
      } else {
        leafletPolygonRef.current.setLatLngs([]);
        if (leafletPolylineRef.current) leafletPolylineRef.current.setLatLngs(latLngs);
      }

      // Add draggable vertex markers with visual feedback
      pts.forEach((pt, idx) => {
        const marker = L.circleMarker([pt.lat, pt.lng], {
          radius: 8,
          color: "#ffffff",
          fillColor: "#10b981",
          fillOpacity: 1,
          weight: 2.5,
        });

        marker.on("mousedown touchstart", () => {
          if (!leafletMapRef.current) return;
          leafletMapRef.current.dragging.disable();

          const onMouseMove = (e: any) => {
            const newPts = [...verticesRef.current];
            const lat = e.latlng?.lat ?? (e.touches ? e.touches[0].clientY : 0);
            const lng = e.latlng?.lng ?? (e.touches ? e.touches[0].clientX : 0);
            if (e.latlng) {
              newPts[idx] = { lat, lng };
              verticesRef.current = newPts;
              setVertices(newPts);
              renderLeafletPolygon(newPts);
              recalculateGeometry(newPts);
            }
          };

          const onMouseUp = () => {
            if (leafletMapRef.current) {
              leafletMapRef.current.dragging.enable();
              leafletMapRef.current.off("mousemove", onMouseMove);
              leafletMapRef.current.off("mouseup", onMouseUp);
            }
          };

          leafletMapRef.current.on("mousemove", onMouseMove);
          leafletMapRef.current.on("mouseup", onMouseUp);
        });

        marker.addTo(leafletMarkersGroupRef.current!);
      });
    },
    [recalculateGeometry]
  );

  const initLeafletFallback = useCallback(
    (coords: Array<{ lat: number; lng: number }>) => {
      if (!mapContainerRef.current) return;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }

      let center: [number, number] = [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];
      let zoom = DEFAULT_FARM_ZOOM;

      if (coords.length > 0) {
        center = [coords[0].lat, coords[0].lng];
      }

      const map = L.map(mapContainerRef.current, {
        center,
        zoom,
        zoomControl: false,
        attributionControl: false,
        doubleClickZoom: false,
      });

      // High-resolution satellite tiles (Esri World Imagery)
      const satLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19 }
      );
      satLayer.addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      leafletMarkersGroupRef.current = markersGroup;

      const polygon = L.polygon([], {
        color: "#10b981",
        fillColor: "#10b981",
        fillOpacity: 0.35,
        weight: 3,
        interactive: true,
      }).addTo(map);
      leafletPolygonRef.current = polygon;

      const polyline = L.polyline([], {
        color: "#34d399",
        weight: 2.5,
        dashArray: "4, 6",
        interactive: false,
      }).addTo(map);
      leafletPolylineRef.current = polyline;

      const onMapClick = (e: L.LeafletMouseEvent) => {
        if (!isDrawingActiveRef.current) {
          setIsDrawingActive(true);
        }
        handleAddVertex(e.latlng.lat, e.latlng.lng);
      };

      map.on("click", onMapClick);
      polygon.on("click", onMapClick);

      if (coords.length >= 3) {
        renderLeafletPolygon(coords);
        const bounds = L.latLngBounds(coords.map((c) => [c.lat, c.lng]));
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 19 });
        setIsDrawingActive(false);
      } else {
        setIsDrawingActive(true);
      }

      leafletMapRef.current = map;
      setActiveEngine("satellite_fallback");
      setIsLoadingMaps(false);

      setTimeout(() => {
        map.invalidateSize();
      }, 250);
    },
    [renderLeafletPolygon, handleAddVertex]
  );

  // ---------------------------------------------------------------------------
  // Move Map to Location Helper (Works on both Google Maps and Leaflet)
  // ---------------------------------------------------------------------------
  const navigateMapToCoordinates = useCallback(
    (lat: number, lng: number, placeName: string, zoomLevel = 18) => {
      setShowSuggestionsDropdown(false);

      if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
        const latLng = new window.google.maps.LatLng(lat, lng);
        googleMapRef.current.panTo(latLng);
        googleMapRef.current.setZoom(zoomLevel);

        if (googleSearchMarkerRef.current) {
          googleSearchMarkerRef.current.setMap(null);
        }
        googleSearchMarkerRef.current = new window.google.maps.Marker({
          position: latLng,
          map: googleMapRef.current,
          title: placeName,
          animation: window.google.maps.Animation.DROP,
          icon: {
            path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: "#10b981",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 8,
        });
      } else if (leafletMapRef.current) {
        leafletMapRef.current.setView([lat, lng], zoomLevel);
        if (leafletSearchMarkerRef.current) {
          leafletMapRef.current.removeLayer(leafletSearchMarkerRef.current);
        }
        leafletSearchMarkerRef.current = L.marker([lat, lng]).addTo(leafletMapRef.current);
      }

      triggerToast(`Centered on: ${placeName}. Tap anywhere on the map to draw corners.`, "success");
    },
    [activeEngine, triggerToast]
  );

  // ---------------------------------------------------------------------------
  // Initialize Google Maps Engine
  // ---------------------------------------------------------------------------
  const initGoogleMaps = useCallback(
    async (keyOverride?: string) => {
      if (!mapContainerRef.current) return;
      setIsLoadingMaps(true);
      setMapsLoadError(null);

      const initialCoords = getInitialCoordinates();

      try {
        const google = await loadGoogleMaps(keyOverride);
        if (!mapContainerRef.current) return;

        let center = DEFAULT_CENTER;
        let zoom = DEFAULT_FARM_ZOOM;

        if (initialCoords.length > 0) {
          center = initialCoords[0];
        }

        const map = new google.maps.Map(mapContainerRef.current, {
          center,
          zoom,
          mapTypeId: google.maps.MapTypeId.HYBRID,
          tilt: 0,
          rotateControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          zoomControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
          disableDoubleClickZoom: true,
          maxZoom: 21,
          minZoom: 3,
        });

        googleMapRef.current = map;

        // Boundary Polygon
        const polygon = new google.maps.Polygon({
          strokeColor: "#10b981",
          strokeOpacity: 0.95,
          strokeWeight: 3,
          fillColor: "#10b981",
          fillOpacity: 0.35,
          editable: false,
          draggable: false,
          clickable: true,
          zIndex: 10,
        });
        polygon.setMap(map);
        googlePolygonRef.current = polygon;

        // In-progress polyline for 1-2 points
        const polyline = new google.maps.Polyline({
          strokeColor: "#34d399",
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          map: map,
          clickable: false,
          zIndex: 9,
        });
        googlePolylineRef.current = polyline;

        // Synchronize manual vertex drags back to state
        const updateFromPolygonPath = () => {
          if (isSyncingGooglePathRef.current) return;
          const currentPath = polygon.getPath();
          const newCoords: Array<{ lat: number; lng: number }> = [];
          for (let i = 0; i < currentPath.getLength(); i++) {
            const pt = currentPath.getAt(i);
            newCoords.push({ lat: pt.lat(), lng: pt.lng() });
          }
          verticesRef.current = newCoords;
          setVertices(newCoords);
          recalculateGeometry(newCoords);
        };

        const path = polygon.getPath();
        path.addListener("set_at", updateFromPolygonPath);
        path.addListener("insert_at", updateFromPolygonPath);
        path.addListener("remove_at", updateFromPolygonPath);

        // Click on Map to Drop Vertex
        const onGoogleMapClick = (e: any) => {
          if (!e.latLng) return;
          if (!isDrawingActiveRef.current) {
            setIsDrawingActive(true);
          }
          handleAddVertex(e.latLng.lat(), e.latLng.lng());
        };

        map.addListener("click", onGoogleMapClick);
        polygon.addListener("click", onGoogleMapClick);

        // Initialize Places Autocomplete if available
        if (google.maps.places && searchInputRef.current) {
          try {
            const autocomplete = new google.maps.places.Autocomplete(searchInputRef.current, {
              types: ["geocode", "establishment"],
              fields: ["geometry", "name", "formatted_address"],
              componentRestrictions: { country: ["in"] },
            });
            autocomplete.bindTo("bounds", map);

            autocomplete.addListener("place_changed", () => {
              const place = autocomplete.getPlace();
              if (place.geometry && place.geometry.location) {
                const lat = place.geometry.location.lat();
                const lng = place.geometry.location.lng();
                const name = place.name || place.formatted_address || "Searched Farm Location";
                navigateMapToCoordinates(lat, lng, name, 18);
              }
            });
          } catch (e) {
            console.warn("Places autocomplete init bypassed:", e);
          }
        }

        // Handle initial GeoJSON geometry if existing plot
        if (initialCoords.length >= 3) {
          isSyncingGooglePathRef.current = true;
          const mvcPath = polygon.getPath();
          mvcPath.clear();
          const bounds = new google.maps.LatLngBounds();
          initialCoords.forEach((pt) => {
            const latLng = new google.maps.LatLng(pt.lat, pt.lng);
            mvcPath.push(latLng);
            bounds.extend(latLng);
          });
          map.fitBounds(bounds, { top: 80, right: 80, bottom: 80, left: 80 });
          setVertices(initialCoords);
          verticesRef.current = initialCoords;
          polygon.setEditable(true);
          polygon.setVisible(true);
          isSyncingGooglePathRef.current = false;

          recalculateGeometry(initialCoords);
          setIsDrawingActive(false);
        } else {
          setIsDrawingActive(true);
        }

        setActiveEngine("google");
        setIsLoadingMaps(false);
      } catch (err: any) {
        console.warn("Google Maps JS API did not load:", err?.message);
        setMapsLoadError(err?.message || "Google Maps API key required");
        // Fall back gracefully to keyless satellite engine
        initLeafletFallback(initialCoords);
      }
    },
    [getInitialCoordinates, recalculateGeometry, initLeafletFallback, navigateMapToCoordinates, handleAddVertex]
  );

  // Sync editable state on Google Maps polygon when toggling drawing mode
  useEffect(() => {
    if (activeEngine === "google" && googlePolygonRef.current) {
      if (isDrawingActive) {
        googlePolygonRef.current.setEditable(false);
      } else if (vertices.length >= 3) {
        googlePolygonRef.current.setEditable(true);
      }
    }
  }, [isDrawingActive, activeEngine, vertices.length]);

  // Invalidate map size on sidebar toggle
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
        window.google.maps.event.trigger(googleMapRef.current, "resize");
      } else if (leafletMapRef.current) {
        leafletMapRef.current.invalidateSize();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [isSidebarOpen, activeEngine]);

  // ---------------------------------------------------------------------------
  // Lifecycle Hook
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isOpen) {
      const initialCoords = getInitialCoordinates();
      setVertices(initialCoords);
      verticesRef.current = initialCoords;
      if (initialCoords.length >= 3) {
        setIsDrawingActive(false);
      } else {
        setIsDrawingActive(true);
      }
      initGoogleMaps();
    }

    return () => {
      if (googlePolygonRef.current) {
        googlePolygonRef.current.setMap(null);
        googlePolygonRef.current = null;
      }
      if (googlePolylineRef.current) {
        googlePolylineRef.current.setMap(null);
        googlePolylineRef.current = null;
      }
      if (googleAccuracyCircleRef.current) {
        googleAccuracyCircleRef.current.setMap(null);
        googleAccuracyCircleRef.current = null;
      }
      if (googleUserMarkerRef.current) {
        googleUserMarkerRef.current.setMap(null);
        googleUserMarkerRef.current = null;
      }
      if (googleSearchMarkerRef.current) {
        googleSearchMarkerRef.current.setMap(null);
        googleSearchMarkerRef.current = null;
      }
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      googleMapRef.current = null;
    };
  }, [isOpen, initGoogleMaps, getInitialCoordinates]);

  // Keyboard Shortcuts (Escape to close, Ctrl+Z to undo)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showClearConfirm) {
          setShowClearConfirm(false);
        } else if (showKeyModal) {
          setShowKeyModal(false);
        } else if (showHelpGuide) {
          setShowHelpGuide(false);
        } else {
          onClose();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showClearConfirm, showKeyModal, showHelpGuide, onClose]);

  // ---------------------------------------------------------------------------
  // Basemap Switcher
  // ---------------------------------------------------------------------------
  const handleBasemapChange = (type: "hybrid" | "roadmap" | "satellite") => {
    setMapType(type);
    if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
      if (type === "hybrid") {
        googleMapRef.current.setMapTypeId(window.google.maps.MapTypeId.HYBRID);
      } else if (type === "satellite") {
        googleMapRef.current.setMapTypeId(window.google.maps.MapTypeId.SATELLITE);
      } else {
        googleMapRef.current.setMapTypeId(window.google.maps.MapTypeId.ROADMAP);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Geolocation Application Helper
  // ---------------------------------------------------------------------------
  const applyLocationFix = useCallback(
    (latitude: number, longitude: number, accuracy: number) => {
      setIsLocating(false);
      setGpsAccuracyM(accuracy);

      let zoom = 19;
      if (accuracy > 500) zoom = 15;
      else if (accuracy > 150) zoom = 17;
      else if (accuracy > 30) zoom = 18;
      else zoom = 19;

      if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
        const latLng = new window.google.maps.LatLng(latitude, longitude);
        googleMapRef.current.panTo(latLng);
        googleMapRef.current.setZoom(zoom);

        if (googleAccuracyCircleRef.current) {
          googleAccuracyCircleRef.current.setMap(null);
        }
        googleAccuracyCircleRef.current = new window.google.maps.Circle({
          strokeColor: accuracy > 100 ? "#f59e0b" : "#3b82f6",
          strokeOpacity: 0.85,
          strokeWeight: 1.5,
          fillColor: accuracy > 100 ? "#f59e0b" : "#3b82f6",
          fillOpacity: 0.15,
          map: googleMapRef.current,
          center: latLng,
          radius: accuracy,
          zIndex: 4,
        });

        if (googleUserMarkerRef.current) {
          googleUserMarkerRef.current.setMap(null);
        }
        googleUserMarkerRef.current = new window.google.maps.Marker({
          position: latLng,
          map: googleMapRef.current,
          title: `Your Location (±${Math.round(accuracy)}m)`,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: accuracy > 100 ? "#f59e0b" : "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
          zIndex: 6,
        });
      } else if (leafletMapRef.current) {
        leafletMapRef.current.setView([latitude, longitude], zoom);
        if (leafletAccuracyCircleRef.current) {
          leafletMapRef.current.removeLayer(leafletAccuracyCircleRef.current);
        }
        leafletAccuracyCircleRef.current = L.circle([latitude, longitude], {
          radius: accuracy,
          color: accuracy > 100 ? "#f59e0b" : "#3b82f6",
          fillColor: accuracy > 100 ? "#f59e0b" : "#3b82f6",
          fillOpacity: 0.15,
          weight: 1.5,
        }).addTo(leafletMapRef.current);

        if (leafletUserMarkerRef.current) {
          leafletMapRef.current.removeLayer(leafletUserMarkerRef.current);
        }
        leafletUserMarkerRef.current = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: "#ffffff",
          fillColor: accuracy > 100 ? "#f59e0b" : "#2563eb",
          fillOpacity: 1,
          weight: 2.5,
        }).addTo(leafletMapRef.current);
      }

      if (accuracy > 100) {
        setGpsWarning("Location accuracy is moderate. Move outdoors or search your village name above.");
        triggerToast(`Location acquired (±${Math.round(accuracy)}m). Tap on map to start drawing.`, "warning");
      } else {
        setGpsWarning(null);
        triggerToast(`High accuracy fix (±${Math.round(accuracy)}m). Centered on your location.`, "success");
      }
    },
    [activeEngine, triggerToast]
  );

  // ---------------------------------------------------------------------------
  // 1. FIND FARM: Resilient Geolocation Handler
  // ---------------------------------------------------------------------------
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      const err = "Geolocation is not supported by your browser or device.";
      setGpsError(err);
      triggerToast(err, "warning");
      return;
    }

    setIsLocating(true);
    setGpsError(null);
    setGpsWarning(null);

    const tryPosition = (highAccuracy: boolean) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLocationFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        (err) => {
          if (highAccuracy) {
            tryPosition(false);
            return;
          }

          setIsLocating(false);
          let msg = "Could not obtain your current location.";
          if (err.code === err.PERMISSION_DENIED) {
            msg = "Location permission was denied. Please enable location access in browser settings.";
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            msg = "GPS position unavailable. Try searching your village name above.";
          } else if (err.code === err.TIMEOUT) {
            msg = "Location request timed out. Please try again.";
          }
          setGpsError(msg);
          triggerToast(msg, "warning");
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 8000 : 12000,
          maximumAge: 0,
        }
      );
    };

    tryPosition(true);
  }, [applyLocationFix, triggerToast]);

  // ---------------------------------------------------------------------------
  // 1. FIND FARM: Live Search Input Changes & Geocoding Resolver
  // ---------------------------------------------------------------------------
  const handleSearchInputChange = async (val: string) => {
    setSearchQuery(val);
    if (!val.trim() || val.trim().length < 2) {
      setSearchSuggestions([]);
      setShowSuggestionsDropdown(false);
      return;
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          val.trim()
        )}&countrycodes=in&addressdetails=1&limit=5`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const formatted: SearchSuggestion[] = data.map((d: any) => ({
          displayName: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          type: d.type,
        }));
        setSearchSuggestions(formatted);
        setShowSuggestionsDropdown(true);
      } else {
        setSearchSuggestions([]);
      }
    } catch {
      // Ignore background suggestion network errors
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setGpsError(null);
    setShowSuggestionsDropdown(false);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery.trim()
        )}&countrycodes=in&addressdetails=1&limit=5`
      );
      const data = await res.json();

      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        const name = data[0].display_name.split(",")[0];
        navigateMapToCoordinates(lat, lon, name, 18);
      } else {
        triggerToast("Location not found. Try entering a nearby town or mandal name.", "warning");
      }
    } catch {
      triggerToast("Search connection failed. Please check internet connection.", "warning");
    } finally {
      setIsSearching(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 3. ADJUST BOUNDARY: Undo & Clear
  // ---------------------------------------------------------------------------
  const handleUndo = () => {
    if (vertices.length === 0) return;
    const updated = vertices.slice(0, -1);
    setVertices(updated);
    verticesRef.current = updated;

    if (activeEngine === "google" && googlePolygonRef.current) {
      isSyncingGooglePathRef.current = true;
      const mvcPath = googlePolygonRef.current.getPath();
      mvcPath.pop();
      if (googlePolylineRef.current) {
        if (updated.length < 3) {
          googlePolylineRef.current.setPath(mvcPath);
          googlePolygonRef.current.setVisible(false);
        } else {
          googlePolylineRef.current.setPath([]);
          googlePolygonRef.current.setVisible(true);
        }
      }
      isSyncingGooglePathRef.current = false;
    } else if (leafletMapRef.current) {
      renderLeafletPolygon(updated);
    }

    if (updated.length < 3) {
      setIsDrawingActive(true);
    }

    recalculateGeometry(updated);
  };

  const handleClear = () => {
    setVertices([]);
    verticesRef.current = [];
    setAreaAcres(null);
    setValidationError(null);
    setShowClearConfirm(false);

    if (activeEngine === "google" && googlePolygonRef.current) {
      isSyncingGooglePathRef.current = true;
      googlePolygonRef.current.getPath().clear();
      googlePolygonRef.current.setVisible(false);
      if (googlePolylineRef.current) googlePolylineRef.current.setPath([]);
      isSyncingGooglePathRef.current = false;
    } else if (leafletMapRef.current && leafletPolygonRef.current) {
      leafletPolygonRef.current.setLatLngs([]);
      if (leafletPolylineRef.current) leafletPolylineRef.current.setLatLngs([]);
      leafletMarkersGroupRef.current?.clearLayers();
    }

    setIsDrawingActive(true);
    triggerToast("Boundary cleared. Tap on the satellite map to start fresh.", "info");
  };

  // ---------------------------------------------------------------------------
  // 4. SUBMIT: Finalize & Create Plot
  // ---------------------------------------------------------------------------
  const handleSubmitPlot = async () => {
    if (!plotFormData.name.trim()) {
      triggerToast("Please enter a Plot Name.", "warning");
      return;
    }

    if (vertices.length < 3) {
      triggerToast("Please place at least 3 points around the farm boundary.", "warning");
      return;
    }

    const ring = vertices.map((v) => [v.lng, v.lat]);
    ring.push([vertices[0].lng, vertices[0].lat]); // Close the polygon ring

    const geoJSON: GeoJSONPolygon = {
      type: "Polygon",
      coordinates: [ring],
    };

    const calculatedAcres = await computePolygonAreaAcres(geoJSON);
    const validation = await validatePolygon(geoJSON, calculatedAcres);

    if (!validation.valid) {
      triggerToast(validation.reason || "Invalid boundary polygon.", "warning");
      return;
    }

    const centroid = await computeCentroid(geoJSON);

    onConfirm({
      geoJSON,
      areaAcres: calculatedAcres,
      centroid,
      metadata: plotFormData,
    });
    onClose();
  };

  // Recenter map to fit current drawn boundary or location
  const handleFitBounds = () => {
    if (vertices.length > 0) {
      if (activeEngine === "google" && googleMapRef.current && window.google?.maps) {
        const bounds = new window.google.maps.LatLngBounds();
        vertices.forEach((v) => bounds.extend(new window.google.maps.LatLng(v.lat, v.lng)));
        googleMapRef.current.fitBounds(bounds, 80);
      } else if (leafletMapRef.current) {
        const bounds = L.latLngBounds(vertices.map((v) => [v.lat, v.lng]));
        leafletMapRef.current.fitBounds(bounds, { padding: [60, 60] });
      }
    } else if (googleMapRef.current) {
      googleMapRef.current.panTo(DEFAULT_CENTER);
      googleMapRef.current.setZoom(16);
    } else if (leafletMapRef.current) {
      leafletMapRef.current.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 16);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] w-screen h-screen bg-slate-950 text-white flex flex-col overflow-hidden font-sans select-none top-0 left-0 right-0 bottom-0">
      {/* ================= 1. TOP NAVIGATION BAR (z-[1000]) ================= */}
      <header className="bg-slate-900 border-b border-slate-800 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3 shrink-0 z-[1000] shadow-md relative">
        {/* Left: Back / Close & Mode Title */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer border border-slate-700 flex items-center gap-1.5 text-xs font-bold"
            title="Return to Farm Plot Management"
          >
            <ArrowLeft className="w-4 h-4 text-slate-300" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer border border-slate-700 flex items-center gap-1.5 text-xs font-bold"
            title={isSidebarOpen ? "Collapse Side Toolkit" : "Expand Side Toolkit"}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            <span className="hidden sm:inline text-[11px]">{isSidebarOpen ? "Sidebar" : "Show Sidebar"}</span>
          </button>

          <div className="flex flex-col">
            <span className="font-black text-xs sm:text-sm text-white tracking-tight truncate max-w-[130px] sm:max-w-[220px]">
              {mode === "create" ? "Plot Creation Workspace" : plotName}
            </span>
            <div className="flex items-center gap-1.5">
              {activeEngine === "google" ? (
                <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Google Maps Satellite
                </span>
              ) : (
                <span className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
                  <Globe2 className="w-3 h-3" />
                  Satellite Engine
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Search & GPS Locator */}
        <div className="flex-1 max-w-md sm:max-w-lg flex items-center gap-2 relative">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <div className="flex items-center bg-slate-950/90 border border-slate-700 rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors shadow-inner">
              <div className="pl-2.5 text-slate-400 shrink-0">
                <Search className="w-3.5 h-3.5" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search village, town, or mandal..."
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onFocus={() => {
                  if (searchSuggestions.length > 0) setShowSuggestionsDropdown(true);
                }}
                className="bg-transparent border-none text-xs text-white px-2 py-1.5 w-full focus:outline-none placeholder:text-slate-500 font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchSuggestions([]);
                    setShowSuggestionsDropdown(false);
                  }}
                  className="p-1 text-slate-500 hover:text-slate-300 mr-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 px-2.5 py-1 mr-1 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
              >
                {isSearching ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Find"}
              </button>
            </div>

            {/* Live Search Suggestions Dropdown */}
            <AnimatePresence>
              {showSuggestionsDropdown && searchSuggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="absolute top-full left-0 right-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[1500] overflow-hidden divide-y divide-slate-800 text-left"
                >
                  {searchSuggestions.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSearchQuery(item.displayName.split(",")[0]);
                        navigateMapToCoordinates(item.lat, item.lng, item.displayName.split(",")[0], 18);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-start gap-2 transition-colors cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">
                          {item.displayName.split(",")[0]}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {item.displayName.split(",").slice(1).join(",")}
                        </p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </form>

          {/* Use My Current Location Button */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer shrink-0 border-0 ${
              gpsAccuracyM !== null
                ? "bg-slate-800 hover:bg-slate-700 text-blue-300 border border-blue-500/30"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
            title="Locate via device GPS"
          >
            {isLocating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
            ) : (
              <Navigation className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">{isLocating ? "Locating…" : "My Location"}</span>
          </button>
        </div>

        {/* Right: Basemap Toggles, Zoom, API Config & Help */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Basemap Switcher (Satellite vs Road) */}
          <div className="inline-flex bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            {(["hybrid", "roadmap"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleBasemapChange(t)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${
                  mapType === t ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                }`}
              >
                {t === "hybrid" ? "Satellite" : "Road"}
              </button>
            ))}
          </div>

          {/* Zoom In & Out Quick Buttons */}
          <div className="hidden sm:inline-flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 items-center">
            <button
              type="button"
              onClick={() => {
                if (activeEngine === "google") googleMapRef.current?.setZoom(googleMapRef.current.getZoom() + 1);
                else leafletMapRef.current?.zoomIn();
              }}
              className="p-1 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeEngine === "google") googleMapRef.current?.setZoom(googleMapRef.current.getZoom() - 1);
                else leafletMapRef.current?.zoomOut();
              }}
              className="p-1 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitBounds}
              className="p-1 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Fit Bounds"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* API Configuration Button (Flicker-Free Modal Trigger) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowKeyModal(true);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-400 transition-all cursor-pointer border border-slate-700 flex items-center gap-1 text-xs font-semibold"
            title="Google Maps API Key Setup"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden xl:inline text-[11px]">API Key</span>
          </button>

          {/* Help Guide Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowHelpGuide(true);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all cursor-pointer border border-slate-700"
            title="Survey Guide"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ================= 2. WORKSPACE BODY: DEDICATED SIDE TOOLKIT + MAP CANVAS ================= */}
      <div className="relative flex-1 w-full min-h-0 flex flex-row overflow-hidden">
        {/* ================= DEDICATED SIDE TOOLKIT (aside: GUARANTEED z-[2000] - NEVER underneath map) ================= */}
        {isSidebarOpen && (
          <aside className="relative z-[2000] w-[360px] sm:w-[380px] lg:w-[410px] shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col shadow-2xl h-full overflow-hidden select-text">
            {/* Scrollable Form Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Header inside Sidebar */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    <Edit3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-white tracking-tight">
                      {mode === "create" ? "Plot Configuration" : "Boundary Surveyor"}
                    </h3>
                    <p className="text-[11px] text-slate-400">Trace perimeter & set agronomics</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      isDrawingActive
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isDrawingActive ? "Draw Active" : "Paused"}
                  </span>
                </div>
              </div>

              {/* 1. GIS Drawing Tools (Pencil, Undo, Clear) */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  GIS Boundary Drawing Tools:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {/* Pencil / Draw Tool Toggle */}
                  <button
                    type="button"
                    onClick={() => setIsDrawingActive(!isDrawingActive)}
                    className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border shadow-sm ${
                      isDrawingActive
                        ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-emerald-500/20"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                    }`}
                    title="Toggle Polygon Drawing Mode"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isDrawingActive ? "Active" : "Draw"}</span>
                  </button>

                  {/* Retake / Undo Button */}
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={vertices.length === 0}
                    className="py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                    title="Undo last placed corner point"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Undo</span>
                  </button>

                  {/* Clear All Button */}
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={vertices.length === 0}
                    className="py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-rose-300 hover:text-rose-200 border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                    title="Reset boundary"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* 2. Live Boundary Measurements Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Calculated Metrics
                  </span>
                  <div className="inline-flex bg-slate-800 p-0.5 rounded-md border border-slate-700">
                    {(["acres", "hectares"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setAreaUnit(u)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-all cursor-pointer ${
                          areaUnit === u ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {u === "acres" ? "ac" : "ha"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Area</span>
                    <span className="font-mono font-black text-emerald-400 text-sm">
                      {areaAcres !== null
                        ? areaUnit === "hectares"
                          ? `${acresToHectares(areaAcres).toFixed(2)} ha`
                          : `${areaAcres.toFixed(2)} ac`
                        : "0.00 ac"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Perimeter</span>
                    <span className="font-mono font-bold text-white text-xs">
                      {segmentStats.perimeterM > 1000
                        ? `${(segmentStats.perimeterM / 1000).toFixed(2)} km`
                        : `${Math.round(segmentStats.perimeterM)} m`}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">Boundary</span>
                    <span className="font-mono font-bold text-slate-300 text-xs">
                      {vertices.length} vertices
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Plot Metadata & Agronomic Selectors */}
              <div className="space-y-3 pt-1 border-t border-slate-800">
                {/* Plot Name Input */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                    Plot Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., East Palm Sector A"
                    value={plotFormData.name}
                    onChange={(e) => setPlotFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-medium focus:border-emerald-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* Dropdowns Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Irrigation Method Dropdown */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                      <Droplets className="w-3 h-3 text-blue-400" />
                      Irrigation Method
                    </label>
                    <select
                      value={plotFormData.irrigation}
                      onChange={(e) => setPlotFormData((prev) => ({ ...prev, irrigation: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-medium focus:border-emerald-500 focus:outline-none cursor-pointer"
                    >
                      <option value="Precision Drip">Precision Drip (Recommended)</option>
                      <option value="Manual Drip">Manual Drip</option>
                      <option value="Sprinkler System">Sprinkler System</option>
                      <option value="Flood Irrigation">Flood Irrigation</option>
                      <option value="Furrow Irrigation">Furrow Irrigation</option>
                    </select>
                  </div>

                  {/* Soil Classification Dropdown */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1">
                      <Layers className="w-3 h-3 text-amber-400" />
                      Soil Classification
                    </label>
                    <select
                      value={plotFormData.soilType}
                      onChange={(e) => setPlotFormData((prev) => ({ ...prev, soilType: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-medium focus:border-emerald-500 focus:outline-none cursor-pointer"
                    >
                      <option value="Loamy">Loamy (Optimal)</option>
                      <option value="Red Laterite">Red Laterite</option>
                      <option value="Clay">Clay Soil</option>
                      <option value="Sandy">Sandy Loam</option>
                      <option value="Alluvial">Alluvial Soil</option>
                      <option value="Black Cotton">Black Cotton Soil</option>
                    </select>
                  </div>
                </div>

                {/* Expandable Optional Details */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowMoreFields(!showMoreFields)}
                    className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 py-1 cursor-pointer"
                  >
                    <ChevronDown className={`w-3 h-3 transition-transform ${showMoreFields ? "rotate-180" : ""}`} />
                    <span>{showMoreFields ? "Hide Advanced Crop Specs" : "+ Advanced Crop & Planting Details"}</span>
                  </button>

                  {showMoreFields && (
                    <div className="grid grid-cols-2 gap-2.5 pt-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Sprout className="w-3 h-3 text-emerald-400" />
                          Crop Type
                        </label>
                        <input
                          type="text"
                          value={plotFormData.crop}
                          onChange={(e) => setPlotFormData((prev) => ({ ...prev, crop: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-blue-400" />
                          Planting Date
                        </label>
                        <input
                          type="date"
                          value={plotFormData.plantingDate}
                          onChange={(e) => setPlotFormData((prev) => ({ ...prev, plantingDate: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Validation Error Banner */}
                {validationError && (
                  <div className="bg-rose-950/80 border border-rose-800 px-3 py-2 rounded-xl text-[11px] text-rose-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}
              </div>

              {/* Quick Preset Location Shortcuts */}
              {vertices.length === 0 && (
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Quick Jump to Oil Palm Belts:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_LOCATIONS.map((loc) => (
                      <button
                        key={loc.name}
                        type="button"
                        onClick={() => navigateMapToCoordinates(loc.lat, loc.lng, loc.name, 17)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-semibold border border-slate-700 cursor-pointer"
                      >
                        {loc.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pinned Bottom Submit Action in Sidebar */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/95 shrink-0">
              <button
                type="button"
                onClick={handleSubmitPlot}
                disabled={vertices.length < 3 || !plotFormData.name.trim() || !!validationError}
                className={`w-full py-3 px-4 rounded-xl font-black text-xs transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer border-0 ${
                  vertices.length >= 3 && plotFormData.name.trim() && !validationError
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25 active:scale-98"
                    : "bg-slate-800 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Check className="w-4 h-4" />
                <span>{mode === "create" ? "Create Farm Plot" : "Save Plot Boundary"}</span>
              </button>
              {vertices.length < 3 && (
                <p className="text-[10px] text-slate-400 text-center mt-1.5 font-medium">
                  Click farm corners on the satellite map to draw perimeter ({vertices.length}/3 points placed)
                </p>
              )}
            </div>
          </aside>
        )}

        {/* ================= MAP CANVAS (main: taking all remaining screen width) ================= */}
        <main
          className={`relative flex-1 h-full min-w-0 min-h-0 bg-slate-950 overflow-hidden z-[100] ${
            isDrawingActive ? "cursor-crosshair" : "cursor-grab"
          }`}
          onClick={() => setShowSuggestionsDropdown(false)}
        >
          {/* Map DOM Element (absolute inset-0 ensures precise pixel bounding box) */}
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-[100]" />

          {/* Loading Indicator */}
          {isLoadingMaps && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2.5 z-[600]">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
              <p className="text-sm font-bold text-slate-200">Loading Satellite Imagery...</p>
            </div>
          )}

          {/* ================= FLOATING MAP GIS QUICK TOOLS & STATUS (z-[1500]) ================= */}
          <div className="absolute top-3.5 left-3.5 z-[1500] flex flex-wrap items-center gap-2 pointer-events-auto max-w-[calc(100%-120px)]">
            {!isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="py-2 px-3.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 text-emerald-400 border border-emerald-500/40 text-xs font-black shadow-2xl flex items-center gap-2 cursor-pointer backdrop-blur-md transition-all active:scale-95"
                title="Open Plot Configuration & Details Panel"
              >
                <PanelLeftOpen className="w-4 h-4" />
                <span>Open Plot Toolkit</span>
              </button>
            )}

            {/* Quick Draw Mode Switcher */}
            <button
              type="button"
              onClick={() => setIsDrawingActive(!isDrawingActive)}
              className={`py-2 px-3.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-2xl backdrop-blur-md border active:scale-95 ${
                isDrawingActive
                  ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-emerald-500/30"
                  : "bg-slate-900/95 text-slate-200 border-slate-700 hover:bg-slate-800"
              }`}
              title="Click on the satellite map to trace boundary"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isDrawingActive ? "Drawing Active (Click Map)" : "Pencil Tool"}</span>
            </button>

            {/* Quick Undo */}
            <button
              type="button"
              onClick={handleUndo}
              disabled={vertices.length === 0}
              className="py-2 px-3 rounded-xl bg-slate-900/95 hover:bg-slate-800 disabled:opacity-40 text-amber-400 border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xl backdrop-blur-md active:scale-95"
              title="Undo last placed corner point"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>

            {/* Quick Clear */}
            {vertices.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="py-2 px-3 rounded-xl bg-slate-900/95 hover:bg-rose-950/80 text-rose-400 border border-rose-500/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xl backdrop-blur-md active:scale-95"
                title="Reset boundary"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            {/* Quick Live Calculated Metric Pill */}
            {areaAcres !== null && (
              <div className="bg-slate-900/95 backdrop-blur-md border border-emerald-500/50 px-3 py-1.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono font-black text-emerald-400">
                  {areaUnit === "hectares" ? `${acresToHectares(areaAcres).toFixed(2)} ha` : `${areaAcres.toFixed(2)} ac`}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">({vertices.length} vertices)</span>
              </div>
            )}

            {/* GPS Accuracy Indicator */}
            {gpsAccuracyM !== null && !isLocating && (
              <div className="bg-slate-900/90 backdrop-blur-md border border-blue-500/40 px-3 py-1.5 rounded-xl shadow-lg flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-blue-300">GPS: ±{Math.round(gpsAccuracyM)}m</span>
              </div>
            )}
          </div>

          {/* Floating Right Map Controls (z-[900]) */}
          <div className="absolute top-3 right-3 z-[900] flex flex-col gap-2">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl overflow-hidden shadow-xl flex flex-col">
              <button
                type="button"
                onClick={() => {
                  if (activeEngine === "google") googleMapRef.current?.setZoom(googleMapRef.current.getZoom() + 1);
                  else leafletMapRef.current?.zoomIn();
                }}
                className="p-2.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer border-b border-slate-800"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeEngine === "google") googleMapRef.current?.setZoom(googleMapRef.current.getZoom() - 1);
                  else leafletMapRef.current?.zoomOut();
                }}
                className="p-2.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer border-b border-slate-800"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleFitBounds}
                className="p-2.5 text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                title="Recenter / Fit Bounds"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Floating GPS Warning & Errors */}
          {(gpsWarning || gpsError) && (
            <div className="absolute bottom-4 right-4 z-[900] flex flex-col gap-2 max-w-sm">
              {gpsWarning && (
                <div className="bg-amber-950/90 border border-amber-800 px-3 py-2 rounded-xl text-xs text-amber-200 flex items-center gap-2 shadow-xl">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-semibold text-[11px]">{gpsWarning}</span>
                </div>
              )}
              {gpsError && (
                <div className="bg-rose-950/90 border border-rose-800 px-3 py-2 rounded-xl text-xs text-rose-200 flex items-center justify-between gap-2 shadow-xl">
                  <span className="text-[11px] font-semibold">{gpsError}</span>
                  <button
                    type="button"
                    onClick={() => setGpsError(null)}
                    className="text-rose-400 hover:text-white p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ================= 4. CLEAR BOUNDARY CONFIRMATION DIALOG ================= */}
      <AnimatePresence>
        {showClearConfirm && (
          <div
            className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h3 className="font-black text-base text-white">Reset Drawn Boundary?</h3>
                <p className="text-xs text-slate-300">
                  This will remove all {vertices.length} corner points and allow you to re-trace the plot.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white cursor-pointer border-0"
                >
                  Yes, Reset
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= 5. API KEY CONFIGURATION MODAL (Flicker-Free) ================= */}
      <AnimatePresence>
        {showKeyModal && (
          <div
            className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowKeyModal(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-white">Google Maps API Setup</h3>
                    <p className="text-xs text-slate-400">Configure key for Google Satellite tiles</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  VITE_GOOGLE_MAPS_API_KEY:
                </label>
                <input
                  type="text"
                  placeholder="AIzaSy..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[10px] text-slate-400 space-y-1">
                <p className="font-bold text-slate-300">Map Engine Status:</p>
                {mapsLoadError && (
                  <p className="text-amber-400 font-semibold">• Notice: {mapsLoadError}</p>
                )}
                <p>• If no key is provided, NutriPalm seamlessly uses the high-resolution keyless satellite engine so your boundary survey continues uninterrupted.</p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowKeyModal(false);
                    initLeafletFallback(vertices);
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 cursor-pointer"
                >
                  Use Keyless Satellite
                </button>
                <button
                  type="button"
                  disabled={!tempApiKey.trim()}
                  onClick={() => {
                    setGoogleMapsApiKeyOverride(tempApiKey.trim());
                    setShowKeyModal(false);
                    initGoogleMaps(tempApiKey.trim());
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 cursor-pointer border-0"
                >
                  Apply & Load Google Maps
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= 6. INSTRUCTIONS GUIDE MODAL ================= */}
      <AnimatePresence>
        {showHelpGuide && (
          <div
            className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowHelpGuide(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-left max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Info className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-black text-base text-white">Plot Creation & GIS Guide</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelpGuide(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                  <p className="font-bold text-white">1. Locate Your Field</p>
                  <p>Type your village, town, or mandal in the top search bar, or click <strong>My Location</strong> to automatically center on your field.</p>
                </div>

                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                  <p className="font-bold text-white">2. Trace the Boundary</p>
                  <p>Click directly along your field perimeter on the satellite map. The system automatically computes acreage in real-time.</p>
                </div>

                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                  <p className="font-bold text-white">3. Configure Agronomics & Submit</p>
                  <p>Select your Irrigation Method and Soil Classification in the side toolkit, then click <strong>Create Farm Plot</strong>.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowHelpGuide(false)}
                className="w-full py-2.5 bg-emerald-500 text-slate-950 font-extrabold text-xs rounded-xl cursor-pointer hover:bg-emerald-400 transition-all border-0"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  );
};

export default GoogleMapBoundarySurveyor;
