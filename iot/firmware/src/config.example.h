// Copy this file to config.h and fill in your values.
// config.h is gitignored so credentials never get committed.

#pragma once

// WiFi
#define WIFI_SSID       ""
#define WIFI_PASSWORD   ""

// TANAW server HTTPS endpoint that receives readings.
// Example: https://192.168.1.50:8443/ingest
#define SERVER_URL      "https://your-server:8443/ingest"

// Optional shared secret. If set, sent as "Authorization: Bearer <token>".
// Must match TANAW_STATION_TOKEN on the server.
#define STATION_TOKEN   ""

// Identity for this physical station.
#define STATION_ID      "river-marikina-bridge-01"
// "river" (reports water level) or "street" (reports flood depth).
#define STATION_TYPE    "river"
