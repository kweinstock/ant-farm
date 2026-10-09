// Shared layout constants for the overlay UI. The phone layout (bottom nav bar,
// ant name bar along the top, panels as bottom sheets) switches on at
// MOBILE_MAX_WIDTH; every component's injected CSS interpolates these so the
// breakpoint lives in one place.
export const MOBILE_MAX_WIDTH = 640; // px, viewport width at or below which the phone layout applies
export const NAV_HEIGHT_REM = 3.4; // phone: height of the bottom nav bar (ui/nav-bar.ts); sheets sit above it
export const DOCK_OFFSET_REM = 5; // desktop: how far above the bottom edge the panels float so they clear the dock (ui/nav-bar.ts)
