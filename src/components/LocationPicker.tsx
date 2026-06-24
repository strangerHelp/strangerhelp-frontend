import { useState } from "react";

interface Props {
  onSelect?: (location: { lat: number; lng: number; address: string }) => void;
}

export default function LocationPicker({ onSelect }: Props) {
  const [address, setAddress] = useState("");
  const [detecting, setDetecting] = useState(false);

  function detectLocation() {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, address: "Current location" };
        setAddress(`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
        onSelect?.(loc);
        setDetecting(false);
      },
      () => setDetecting(false)
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Area, landmark, or address"
          className="flex-1 h-10 px-3 text-sm bg-[var(--color-canvas)] border border-[var(--color-hairline)] rounded-md focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-mute)]"
        />
        <button
          type="button"
          onClick={detectLocation}
          disabled={detecting}
          className="h-10 px-3 text-sm font-medium text-[var(--color-ink)] border border-[var(--color-hairline)] rounded-md hover:bg-[var(--color-canvas-soft-2)] transition-colors disabled:opacity-50"
          aria-label="Detect my location"
        >
          {detecting ? (
            <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 019.95 9" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
          )}
        </button>
      </div>
      {/* Map placeholder — integrate Leaflet or Google Maps here */}
      <div className="h-40 rounded-md bg-[var(--color-canvas-soft-2)] border border-[var(--color-hairline)] flex items-center justify-center text-xs text-[var(--color-mute)]">
        📍 Map loads here (Leaflet/Google Maps)
      </div>
    </div>
  );
}
