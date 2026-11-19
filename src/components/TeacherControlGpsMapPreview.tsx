import { useEffect, useRef, useState } from 'react';
import type { Coords, DoneCallback, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';

type MapAvailability = 'loading' | 'ready' | 'error';

type TeacherControlGpsMapPreviewProps = {
  candidateKey: number;
  latitude: number;
  longitude: number;
  onAvailabilityChange: (candidateKey: number, status: MapAvailability) => void;
  onPositionChange: (candidateKey: number, latitude: number, longitude: number) => void;
};

const TILE_LOAD_TIMEOUT_MS = 15_000;
const OPENSTREETMAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function TeacherControlGpsMapPreview({
  candidateKey,
  latitude,
  longitude,
  onAvailabilityChange,
  onPositionChange,
}: TeacherControlGpsMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const coordinatesRef = useRef({ latitude, longitude });
  const [mapStatus, setMapStatus] = useState<MapAvailability>('loading');
  const [mapError, setMapError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  onAvailabilityChangeRef.current = onAvailabilityChange;
  onPositionChangeRef.current = onPositionChange;
  coordinatesRef.current = { latitude, longitude };

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | null = null;
    let tileTimeoutId: number | null = null;
    let resizeFrame = 0;
    const loadedTiles = new Set<HTMLImageElement>();
    const failedTiles = new Map<HTMLImageElement, string>();
    const tileRequests = new WeakMap<HTMLImageElement, {
      controller: AbortController;
      objectUrl: string | null;
    }>();

    const reportStatus = (status: MapAvailability, message?: string) => {
      if (disposed) return;
      setMapStatus(status);
      setMapError(message ?? null);
      onAvailabilityChangeRef.current(candidateKey, status);
    };

    const clearTileTimeout = () => {
      if (tileTimeoutId != null) window.clearTimeout(tileTimeoutId);
      tileTimeoutId = null;
    };

    const failMap = (message: string) => {
      clearTileTimeout();
      reportStatus('error', message);
    };

    const revokeTileObjectUrl = (tileRequest: { objectUrl: string | null }) => {
      if (tileRequest.objectUrl == null) return;
      URL.revokeObjectURL(tileRequest.objectUrl);
      tileRequest.objectUrl = null;
    };

    void import('leaflet').then((leaflet) => {
      if (disposed || !containerRef.current) return;

      class StatusCheckedTileLayer extends leaflet.TileLayer {
        protected override createTile(coords: Coords, done: DoneCallback): HTMLElement {
          const tile = document.createElement('img');
          const controller = new AbortController();
          const tileRequest = { controller, objectUrl: null as string | null };
          tile.alt = '';
          tile.setAttribute('role', 'presentation');
          tileRequests.set(tile, tileRequest);

          void fetch(this.getTileUrl(coords), {
            mode: 'cors',
            referrerPolicy: 'strict-origin-when-cross-origin',
            signal: controller.signal,
          }).then((response) => {
            if (!response.ok) throw new Error(`Le serveur cartographique a répondu HTTP ${response.status}.`);
            const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
            if (contentType !== 'image/png') {
              throw new Error('Le serveur cartographique n’a pas renvoyé une tuile PNG valide.');
            }
            return response.blob();
          }).then((blob) => {
            if (controller.signal.aborted) return;
            tileRequest.objectUrl = URL.createObjectURL(blob);
            tile.onload = () => {
              revokeTileObjectUrl(tileRequest);
              tileRequests.delete(tile);
              done(undefined, tile);
            };
            tile.onerror = () => {
              revokeTileObjectUrl(tileRequest);
              tileRequests.delete(tile);
              done(new Error('La tuile reçue ne peut pas être décodée comme une image.'), tile);
            };
            tile.src = tileRequest.objectUrl;
          }).catch((tileError: unknown) => {
            if (controller.signal.aborted) return;
            tileRequests.delete(tile);
            const message = tileError instanceof Error && tileError.message.startsWith('Le serveur cartographique')
              ? tileError.message
              : 'Le navigateur n’a pas pu vérifier la tuile (erreur réseau ou restriction CORS).';
            done(new Error(message), tile);
          });

          return tile;
        }
      }

      map = leaflet.map(containerRef.current, {
        center: [coordinatesRef.current.latitude, coordinatesRef.current.longitude],
        zoom: 16,
        scrollWheelZoom: false,
      });

      const tiles = new StatusCheckedTileLayer(OPENSTREETMAP_TILE_URL, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        maxZoom: 19,
      });
      const beginTileLoad = () => {
        clearTileTimeout();
        reportStatus('loading');
        tileTimeoutId = window.setTimeout(() => {
          failMap('Le chargement des tuiles cartographiques a dépassé le délai autorisé.');
        }, TILE_LOAD_TIMEOUT_MS);
      };

      tiles.on('loading', beginTileLoad);
      tiles.on('tileload', (event) => {
        loadedTiles.add(event.tile);
        failedTiles.delete(event.tile);
      });
      tiles.on('tileerror', (event) => {
        loadedTiles.delete(event.tile);
        failedTiles.set(event.tile, event.error.message);
      });
      tiles.on('load', () => {
        clearTileTimeout();
        if (loadedTiles.size > 0 && failedTiles.size === 0) {
          reportStatus('ready');
        } else {
          failMap(failedTiles.values().next().value
            ?? 'Le navigateur n’a pas pu vérifier les réponses des tuiles cartographiques (CORS).');
        }
      });
      tiles.on('tileunload', (event) => {
        loadedTiles.delete(event.tile);
        failedTiles.delete(event.tile);
        const tileRequest = tileRequests.get(event.tile);
        if (!tileRequest) return;
        tileRequest.controller.abort();
        revokeTileObjectUrl(tileRequest);
        tileRequests.delete(event.tile);
      });

      beginTileLoad();
      tiles.addTo(map);
      const marker = leaflet.marker([coordinatesRef.current.latitude, coordinatesRef.current.longitude], {
        draggable: true,
        icon: leaflet.divIcon({
          className: '',
          html: '<span style="display:block;width:18px;height:18px;border:3px solid white;border-radius:50%;background:#4f46e5;box-shadow:0 0 0 2px #312e81"></span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(map);
      marker.on('dragend', () => {
        const position = marker.getLatLng();
        onPositionChangeRef.current(candidateKey, position.lat, position.lng);
      });

      resizeFrame = window.requestAnimationFrame(() => map?.invalidateSize());
    }).catch(() => {
      failMap('La bibliothèque cartographique n’a pas pu être chargée.');
    });

    return () => {
      disposed = true;
      clearTileTimeout();
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      map?.remove();
    };
  }, [candidateKey, retryCount]);

  const retryMapLoad = () => {
    setMapStatus('loading');
    setMapError(null);
    onAvailabilityChangeRef.current(candidateKey, 'loading');
    setRetryCount((current) => current + 1);
  };

  return (
    <section aria-label="Prévisualisation cartographique de l’emplacement candidat" className="space-y-2">
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        role="region"
        aria-label={`Carte centrée sur ${latitude}, ${longitude}`}
        style={{ height: 320 }}
      />
      {mapStatus === 'loading' && (
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          Chargement et vérification des tuiles cartographiques…
        </p>
      )}
      {mapStatus === 'ready' && (
        <p role="status" className="text-sm text-emerald-700">
          Carte vérifiée. Repérez l’établissement, puis repositionnez le marqueur si nécessaire.
        </p>
      )}
      {mapStatus === 'error' && (
        <div role="alert" className="space-y-2 text-sm text-rose-700">
          <p>{mapError} La candidate est conservée; aucune position enregistrée n’a été modifiée.</p>
          <button className="rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold" type="button" onClick={retryMapLoad}>
            Réessayer le chargement de la carte
          </button>
        </div>
      )}
      <p className="text-xs text-slate-600">
        L’aperçu charge les tuiles depuis tile.openstreetmap.org. Ce service reçoit les requêtes des zones affichées et l’adresse IP du navigateur; aucune API de géocodage n’est appelée.
      </p>
    </section>
  );
}
