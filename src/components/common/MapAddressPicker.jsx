import React, { useEffect, useRef } from 'react';
import { Navigation } from 'lucide-react';
import L from 'leaflet';

export default function MapAddressPicker({
  initialLat = 10.4950,
  initialLng = -66.8480,
  onLocationChange,
  height = '200px'
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const coords = [initialLat || 10.4950, initialLng || -66.8480];

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: coords,
        zoom: 15
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);

      // Marcador con pin arrastrable
      const marker = L.marker(coords, {
        draggable: true,
        icon: L.divIcon({
          className: 'custom-map-pin',
          html: '<div style="background:#82133a; border:3px solid #ef9d24; border-radius:50%; width:22px; height:22px; box-shadow:0 0 10px rgba(0,0,0,0.4);"></div>',
          iconSize: [22, 22]
        })
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        if (onLocationChange) {
          onLocationChange({ lat: pos.lat, lng: pos.lng });
        }
      });

      map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        if (onLocationChange) {
          onLocationChange({ lat: e.latlng.lat, lng: e.latlng.lng });
        }
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
    } else {
      mapInstanceRef.current.setView(coords, 15);
      if (markerRef.current) {
        markerRef.current.setLatLng(coords);
      }
    }

    return () => {
      // Defer cleanup to prevent leaflet unmount issues
    };
  }, [initialLat, initialLng]);

  function handleUsarGPS() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (mapInstanceRef.current && markerRef.current) {
          mapInstanceRef.current.setView([lat, lng], 16);
          markerRef.current.setLatLng([lat, lng]);
          if (onLocationChange) {
            onLocationChange({ lat, lng });
          }
        }
      },
      (err) => {
        alert('No pudimos acceder a tu GPS: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          height,
          borderRadius: '14px',
          overflow: 'hidden',
          border: '1.5px solid #cbd5e1',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}
      />
      <button
        type="button"
        onClick={handleUsarGPS}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '999px',
          padding: '6px 12px',
          fontSize: '0.75rem',
          fontWeight: 700,
          color: 'var(--dark-amaranth)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <Navigation size={13} color="var(--dark-amaranth)" /> Mi GPS
      </button>
      <small style={{ color: '#64748b', fontSize: '0.72rem', display: 'block', marginTop: '4px' }}>
        Toca o arrastra el pin en el mapa para fijar la ubicación exacta de entrega.
      </small>
    </div>
  );
}

