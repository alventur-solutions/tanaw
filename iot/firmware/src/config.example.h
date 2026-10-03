// Copy this file to config.h and fill in your values.
// config.h is gitignored so credentials never get committed.

#pragma once

// WiFi
#define WIFI_SSID       ""
#define WIFI_PASSWORD   ""

// TANAW API ingest endpoint (FastAPI, writes to Neon Postgres).
// Use the LAN IP of the machine running uvicorn, not localhost.
// Example: http://192.168.1.50:8000/ingest   (https if you put TLS in front)
#define SERVER_URL      "http://your-server:8000/ingest"

// Optional shared secret. If set, sent as "Authorization: Bearer <token>".
// Must match STATION_TOKEN (station_token) on the server.
#define STATION_TOKEN   ""

// Identity for this physical station.
#define STATION_ID      "river-marikina-bridge-01"
// "river" (reports water level) or "street" (reports flood depth).
#define STATION_TYPE    "river"
